const { WebSocketServer } = require("ws");
const Conversation = require("../models/Conversation");
const Message = require("../models/Message");
const User = require("../models/User");
const { decryptMessageDocument, encryptMessageDocumentFields } = require("../lib/messageCrypto");
const { ensureConversationBetweenUsers } = require("../services/conversation-service");
const { registerSwipe } = require("../services/match-service");
const { chargeForUnmatchedChatMessage } = require("../services/engagement-service");
const {
  createCallSessionWithMessage,
  updateCallSessionWithMessage,
} = require("../services/call-service");

const REALTIME_FANOUT_CHANNEL = "realtime:fanout";
const PRESENCE_GRACE_MS = 60 * 1000;

function activeSocketKey(userId) {
  return `realtime:active:${userId}`;
}

function createConnectionRegistry({ redis, workerId }) {
  const connections = new Map();

  return {
    redis,
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
    sendLocal(userId, payload) {
      const bucket = connections.get(userId);
      if (!bucket) return;
      const serialized = JSON.stringify(payload);
      bucket.forEach(socket => {
        if (socket.readyState === socket.OPEN) {
          socket.send(serialized);
        }
      });
    },
    async dispatch(userId, payload) {
      this.sendLocal(userId, payload);
      if (!redis?.publisher) return;
      await redis.publisher.publish(
        REALTIME_FANOUT_CHANNEL,
        JSON.stringify({
          workerId,
          userId,
          payload,
        }),
      );
    },
  };
}

async function updateUserLastActiveAt(userId) {
  if (!userId) return;
  await User.findByIdAndUpdate(userId, { lastActiveAt: new Date() });
}

async function trackActiveConnection(redis, userId, connectionId) {
  if (!redis?.command || !userId || !connectionId) return 0;
  await redis.command.sAdd(activeSocketKey(userId), connectionId);
  return Number(await redis.command.sCard(activeSocketKey(userId)));
}

async function untrackActiveConnection(redis, userId, connectionId) {
  if (!redis?.command || !userId || !connectionId) return 0;
  await redis.command.sRem(activeSocketKey(userId), connectionId);
  const remaining = Number(await redis.command.sCard(activeSocketKey(userId)));
  if (remaining === 0) {
    await redis.command.del(activeSocketKey(userId));
  }
  return remaining;
}

async function isUserOnline(redis, userId) {
  if (!redis?.command || !userId) return false;
  return Number(await redis.command.sCard(activeSocketKey(userId))) > 0;
}

function formatLastActiveAt(date = new Date()) {
  return date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

async function publishPresenceToPeers(registry, redis, userId, status, lastActiveAtDate = new Date()) {
  if (!userId) return;
  const conversations = await Conversation.find({ participantIds: userId }).select("participantIds").lean();
  const peers = new Set();
  conversations.forEach(conversation => {
    (conversation.participantIds || []).forEach(participantId => {
      if (participantId && participantId !== userId) {
        peers.add(participantId);
      }
    });
  });
  const payload = {
    type: "presence:update",
    payload: {
      userId,
      status,
      lastActiveAt: formatLastActiveAt(lastActiveAtDate),
      lastActiveEpochMs: lastActiveAtDate.getTime(),
    },
  };
  await Promise.all(Array.from(peers, peerId => registry.dispatch(peerId, payload)));
}

async function registerRealtimeHandlers(server, redis) {
  const wss = new WebSocketServer({ server, path: "/ws" });
  const workerId = `${process.pid}:${Math.random().toString(36).slice(2, 10)}`;
  const registry = createConnectionRegistry({ redis, workerId });
  const offlineTimers = new Map();

  if (redis?.subscriber) {
    await redis.subscriber.subscribe(REALTIME_FANOUT_CHANNEL, rawMessage => {
      try {
        const message = JSON.parse(String(rawMessage));
        if (message.workerId === workerId) return;
        registry.sendLocal(message.userId, message.payload);
      } catch (error) {
        console.error(`[realtime] fanout subscribe error message=${error.message}`);
      }
    });
  }

  wss.on("connection", async (socket, request) => {
    const url = new URL(request.url, "http://localhost");
    const userId = url.searchParams.get("userId");
    const displayName = url.searchParams.get("displayName") || "You";

    if (!userId) {
      socket.close(1008, "Missing userId");
      return;
    }

    const connectionId = `${process.pid}:${Date.now()}:${Math.random().toString(36).slice(2, 12)}`;
    socket.data = { userId, displayName, connectionId };
    const existingTimer = offlineTimers.get(userId);
    if (existingTimer) {
      clearTimeout(existingTimer);
      offlineTimers.delete(userId);
    }
    registry.add(userId, socket);
    await trackActiveConnection(redis, userId, connectionId);
    await updateUserLastActiveAt(userId);
    await publishPresenceToPeers(registry, redis, userId, "online");
    console.log(`[realtime] connected userId=${userId} displayName=${displayName}`);
    socket.send(JSON.stringify({ type: "session:ready", payload: { userId } }));

    socket.on("message", async raw => {
      try {
        const { type, payload } = JSON.parse(String(raw));
        console.log(`[realtime] received type=${type} userId=${userId} payload=${JSON.stringify(payload || {})}`);
        await handleRealtimeEvent({ type, payload, userId, registry, socket });
      } catch (error) {
        console.error(`[realtime] handler error userId=${userId} message=${error.message}`);
        socket.send(JSON.stringify({ type: "error", payload: { message: error.message } }));
      }
    });

    socket.on("close", async () => {
      console.log(`[realtime] disconnected userId=${userId}`);
      registry.remove(userId, socket);
      const stillOnline = await untrackActiveConnection(redis, userId, connectionId);
      const disconnectedAt = new Date();
      await updateUserLastActiveAt(userId);
      if (stillOnline > 0) {
        await publishPresenceToPeers(registry, redis, userId, "online", disconnectedAt);
        return;
      }
      await publishPresenceToPeers(registry, redis, userId, "recently_active", disconnectedAt);
      const timer = setTimeout(async () => {
        offlineTimers.delete(userId);
        if (await isUserOnline(redis, userId)) return;
        await publishPresenceToPeers(registry, redis, userId, "offline", disconnectedAt);
      }, PRESENCE_GRACE_MS);
      offlineTimers.set(userId, timer);
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
    timestamp: new Date(decryptedMessage.createdAt).toISOString(),
    fromCurrentUser,
    senderId: decryptedMessage.senderId,
  };
}

async function handleRealtimeEvent({ type, payload, userId, registry, socket }) {
  await updateUserLastActiveAt(userId);

  if (type === "presence:ping") {
    const status = await isUserOnline(registry.redis || null, userId) ? "online" : "offline";
    await publishPresenceToPeers(registry, registry.redis || null, userId, status, new Date());
    return;
  }

  if (type === "typing:start" || type === "typing:stop") {
    await registry.dispatch(payload.peerId, {
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
    const wallet = await chargeForUnmatchedChatMessage({
      senderId: userId,
      recipientId: payload.recipientId,
      conversation,
    });
    console.log(`[realtime] message:send resolved conversationId=${String(conversation._id)} senderId=${userId} recipientId=${payload.recipientId} messageType=${payload.type}`);
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
    console.log(`[realtime] message persisted messageId=${String(message._id)} conversationId=${String(conversation._id)} senderId=${userId}`);

    const event = {
      type: "message:new",
      payload: {
        conversationId: String(conversation._id),
        message: mapRealtimeMessage(message, { author: userId, fromCurrentUser: false }),
      },
    };

    await registry.dispatch(payload.recipientId, event);
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
    if (wallet) {
      socket.send(
        JSON.stringify({
          type: "wallet:update",
          payload: wallet,
        }),
      );
    }
    return;
  }

  if (type === "call:start") {
    const { call, message } = await createCallSessionWithMessage({
      conversationId: payload.conversationId,
      callerId: userId,
      calleeId: payload.calleeId,
      callType: payload.callType,
    });
    console.log(`[realtime] call:start created callId=${String(call._id)} conversationId=${call.conversationId} callerId=${userId} calleeId=${payload.calleeId} callType=${payload.callType}`);
    socket.send(JSON.stringify({
      type: "call:started",
      payload: {
        callId: String(call._id),
        peerId: payload.calleeId,
        conversationId: call.conversationId,
      },
    }));
    await registry.dispatch(payload.calleeId, {
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
    await registry.dispatch(payload.calleeId, {
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
    console.log(`[realtime] ${type} updated callId=${payload.callId} conversationId=${call.conversationId} actorId=${userId} status=${statusMap[type]}`);
    if (message) {
      const callerAuthor = call.callerId === userId ? "You" : payload.actorName || "Call";
      const calleeAuthor = call.calleeId === userId ? "You" : payload.actorName || "Call";
      await registry.dispatch(call.callerId, {
        type: "message:new",
        payload: {
          conversationId: call.conversationId,
          message: mapCallPayload(message, {
            author: callerAuthor,
            fromCurrentUser: call.callerId === userId,
          }),
        },
      });
      await registry.dispatch(call.calleeId, {
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
    await registry.dispatch(payload.peerId, { type, payload: { ...payload, actorId: userId } });
    return;
  }

  if (type === "webrtc:offer" || type === "webrtc:answer" || type === "webrtc:ice-candidate") {
    console.log(`[realtime] forwarding ${type} fromUserId=${userId} peerId=${payload.peerId} conversationId=${payload.conversationId}`);
    await registry.dispatch(payload.peerId, { type, payload: { ...payload, fromUserId: userId } });
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
    timestamp: new Date(decryptedMessage.createdAt).toISOString(),
    fromCurrentUser,
    senderId: decryptedMessage.senderId,
  };
}

module.exports = {
  registerRealtimeHandlers,
};
