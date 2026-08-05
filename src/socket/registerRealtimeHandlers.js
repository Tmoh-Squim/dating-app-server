const { WebSocketServer } = require("ws");
const Conversation = require("../models/Conversation");
const Message = require("../models/Message");
const { decryptMessageDocument, encryptMessageDocumentFields } = require("../lib/messageCrypto");
const { ensureConversationBetweenUsers } = require("../services/conversation-service");
const { registerSwipe } = require("../services/match-service");
const {
  createCallSessionWithMessage,
  updateCallSessionWithMessage,
} = require("../services/call-service");

function createConnectionRegistry() {
  const connections = new Map();

  return {
    add(userId, socket) {
      if (!connections.has(userId)) {
        connections.set(userId, new Set());
      }
      connections.get(userId).add(socket);
    },
    remove(userId, socket) {
      const bucket = connections.get(userId);
      if (!bucket) return;
      bucket.delete(socket);
      if (bucket.size === 0) {
        connections.delete(userId);
      }
    },
    send(userId, payload) {
      const bucket = connections.get(userId);
      if (!bucket) return;
      const serialized = JSON.stringify(payload);
      bucket.forEach(socket => {
        if (socket.readyState === socket.OPEN) {
          socket.send(serialized);
        }
      });
    },
  };
}

function registerRealtimeHandlers(server) {
  const wss = new WebSocketServer({ server, path: "/ws" });
  const registry = createConnectionRegistry();

  wss.on("connection", (socket, request) => {
    const url = new URL(request.url, "http://localhost");
    const userId = url.searchParams.get("userId");
    const displayName = url.searchParams.get("displayName") || "You";

    if (!userId) {
      socket.close(1008, "Missing userId");
      return;
    }

    socket.data = { userId, displayName };
    registry.add(userId, socket);
    socket.send(JSON.stringify({ type: "session:ready", payload: { userId } }));

    socket.on("message", async raw => {
      try {
        const { type, payload } = JSON.parse(String(raw));
        await handleRealtimeEvent({ type, payload, userId, registry, socket });
      } catch (error) {
        socket.send(JSON.stringify({ type: "error", payload: { message: error.message } }));
      }
    });

    socket.on("close", () => {
      registry.remove(userId, socket);
    });
  });
}

function mapCallPayload(message, { author, fromCurrentUser }) {
  const decryptedMessage = decryptMessageDocument(message);
  return {
    id: String(decryptedMessage._id),
    author,
    type: decryptedMessage.type || "text",
    body: decryptedMessage.body || "",
    mediaUrl: decryptedMessage.mediaUrl || "",
    mediaDurationSeconds: Number(decryptedMessage.mediaDurationSeconds || 0),
    callId: decryptedMessage.callId || "",
    callMediaType: decryptedMessage.callMediaType || "",
    callStatus: decryptedMessage.callStatus || "",
    callDurationSeconds: Number(decryptedMessage.callDurationSeconds || 0),
    timestamp: new Date(decryptedMessage.createdAt).toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }),
    fromCurrentUser,
    senderId: decryptedMessage.senderId,
  };
}

async function handleRealtimeEvent({ type, payload, userId, registry, socket }) {
  if (type === "typing:start" || type === "typing:stop") {
    registry.send(payload.peerId, {
      type: "typing:update",
      payload: {
        conversationId: payload.conversationId,
        userId,
        isTyping: type === "typing:start",
      },
    });
    return;
  }

  if (type === "message:send") {
    const conversation = await ensureConversationBetweenUsers(userId, payload.recipientId);
    const messageType = payload.type === "voice_note" ? "voice_note" : "text";
    const message = await Message.create({
      conversationId: String(conversation._id),
      senderId: userId,
      recipientId: payload.recipientId,
      type: messageType,
      ...encryptMessageDocumentFields({
        body: String(payload.body || "").trim(),
        mediaUrl: String(payload.mediaUrl || "").trim(),
      }),
      mediaDurationSeconds: Math.max(0, Number(payload.mediaDurationSeconds) || 0),
    });

    await Conversation.findOneAndUpdate(
      { _id: String(conversation._id) },
      { lastMessageAt: new Date() },
    );

    const event = {
      type: "message:new",
      payload: {
        conversationId: String(conversation._id),
        message: mapRealtimeMessage(message, { author: userId, fromCurrentUser: false }),
      },
    };

    registry.send(payload.recipientId, event);
    socket.send(
      JSON.stringify({
        type: "message:ack",
        payload: {
          conversationId: String(conversation._id),
          clientId: payload.clientId,
          message: mapRealtimeMessage(message, {
            author: "You",
            fromCurrentUser: true,
          }),
        },
      }),
    );
    return;
  }

  if (type === "call:start") {
    const { call, message } = await createCallSessionWithMessage({
      conversationId: payload.conversationId,
      callerId: userId,
      calleeId: payload.calleeId,
      callType: payload.callType,
    });
    socket.send(JSON.stringify({
      type: "call:started",
      payload: {
        callId: String(call._id),
        peerId: payload.calleeId,
        conversationId: call.conversationId,
      },
    }));
    registry.send(payload.calleeId, {
      type: "message:new",
      payload: {
        conversationId: call.conversationId,
        message: mapCallPayload(message, {
          author: payload.callerName || "Call",
          fromCurrentUser: false,
        }),
      },
    });
    socket.send(JSON.stringify({
      type: "message:ack",
      payload: {
        conversationId: call.conversationId,
        clientId: `call-${call.id}`,
        message: mapCallPayload(message, {
          author: "You",
          fromCurrentUser: true,
        }),
      },
    }));
    registry.send(payload.calleeId, {
      type: "call:incoming",
      payload: {
        id: String(call._id),
        conversationId: call.conversationId,
        callerId: userId,
        callerName: payload.callerName,
        type: payload.callType,
      },
    });
    return;
  }

  if (type === "call:answer" || type === "call:reject" || type === "call:end") {
    const statusMap = {
      "call:answer": "accepted",
      "call:reject": "rejected",
      "call:end": "ended",
    };
    const { call, message } = await updateCallSessionWithMessage({
      callId: payload.callId,
      status: statusMap[type],
      actorId: userId,
    });
    if (message) {
      const callerAuthor = call.callerId === userId ? "You" : payload.actorName || "Call";
      const calleeAuthor = call.calleeId === userId ? "You" : payload.actorName || "Call";
      registry.send(call.callerId, {
        type: "message:new",
        payload: {
          conversationId: call.conversationId,
          message: mapCallPayload(message, {
            author: callerAuthor,
            fromCurrentUser: call.callerId === userId,
          }),
        },
      });
      registry.send(call.calleeId, {
        type: "message:new",
        payload: {
          conversationId: call.conversationId,
          message: mapCallPayload(message, {
            author: calleeAuthor,
            fromCurrentUser: call.calleeId === userId,
          }),
        },
      });
    }
    registry.send(payload.peerId, { type, payload: { ...payload, actorId: userId } });
    return;
  }

  if (type === "webrtc:offer" || type === "webrtc:answer" || type === "webrtc:ice-candidate") {
    registry.send(payload.peerId, { type, payload: { ...payload, fromUserId: userId } });
    return;
  }

  if (type === "swipe:action") {
    const result = await registerSwipe({
      actorId: userId,
      targetId: String(payload.targetId),
      action: payload.action,
    });
    socket.send(JSON.stringify({ type: "swipe:result", payload: result }));
  }
}

function mapRealtimeMessage(message, { author, fromCurrentUser }) {
  const decryptedMessage = decryptMessageDocument(message);
  return {
    id: String(decryptedMessage._id),
    author,
    type: decryptedMessage.type || "text",
    body: decryptedMessage.body || "",
    mediaUrl: decryptedMessage.mediaUrl || "",
    mediaDurationSeconds: Number(decryptedMessage.mediaDurationSeconds || 0),
    callId: decryptedMessage.callId || "",
    callMediaType: decryptedMessage.callMediaType || "",
    callStatus: decryptedMessage.callStatus || "",
    callDurationSeconds: Number(decryptedMessage.callDurationSeconds || 0),
    timestamp: new Date(decryptedMessage.createdAt).toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }),
    fromCurrentUser,
    senderId: decryptedMessage.senderId,
  };
}

module.exports = {
  registerRealtimeHandlers,
};
