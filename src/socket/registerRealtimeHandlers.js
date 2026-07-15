const { WebSocketServer } = require("ws");
const CallSession = require("../models/CallSession");
const Message = require("../models/Message");
const { registerSwipe } = require("../services/match-service");

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
    const message = await Message.create({
      conversationId: payload.conversationId,
      senderId: userId,
      recipientId: payload.recipientId,
      body: payload.body,
    });

    const event = {
      type: "message:new",
      payload: {
        conversationId: payload.conversationId,
        message: {
          id: String(message._id),
          author: userId,
          body: message.body,
          timestamp: new Date(message.createdAt).toLocaleTimeString("en-US", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          }),
          fromCurrentUser: false,
          senderId: userId,
        },
      },
    };

    registry.send(payload.recipientId, event);
    socket.send(
      JSON.stringify({
        type: "message:ack",
        payload: {
          conversationId: payload.conversationId,
          clientId: payload.clientId,
          message: {
            id: String(message._id),
            author: "You",
            body: message.body,
            timestamp: event.payload.message.timestamp,
            fromCurrentUser: true,
            senderId: userId,
          },
        },
      }),
    );
    return;
  }

  if (type === "call:start") {
    const call = await CallSession.create({
      conversationId: payload.conversationId,
      callerId: userId,
      calleeId: payload.calleeId,
      type: payload.callType,
    });
    registry.send(payload.calleeId, {
      type: "call:incoming",
      payload: {
        id: String(call._id),
        conversationId: payload.conversationId,
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
    await CallSession.findByIdAndUpdate(payload.callId, {
      status: statusMap[type],
      endedAt: type === "call:end" || type === "call:reject" ? new Date() : null,
    });
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

module.exports = {
  registerRealtimeHandlers,
};
