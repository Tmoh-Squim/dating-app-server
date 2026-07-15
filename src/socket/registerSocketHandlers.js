const { v4: uuid } = require("uuid");
const CallSession = require("../models/CallSession");
const Conversation = require("../models/Conversation");
const Message = require("../models/Message");
const User = require("../models/User");
const { registerSwipe, sortPair } = require("../services/match-service");

function userRoom(userId) {
  return `user:${userId}`;
}

function conversationRoom(conversationId) {
  return `conversation:${conversationId}`;
}

function typingKey(conversationId, userId) {
  return `typing:${conversationId}:${userId}`;
}

async function publishPresence(redis, userId, status) {
  await redis.publisher.publish(
    "presence",
    JSON.stringify({
      userId,
      status,
      updatedAt: new Date().toISOString(),
    }),
  );
}

async function markOnline(redis, userId, socketId) {
  await Promise.all([
    redis.command.sAdd(`user:sockets:${userId}`, socketId),
    redis.command.set(`presence:${userId}`, "online", { EX: 90 }),
  ]);
  await publishPresence(redis, userId, "online");
}

async function markOffline(redis, userId, socketId) {
  const key = `user:sockets:${userId}`;
  await redis.command.sRem(key, socketId);
  const socketsLeft = await redis.command.sCard(key);
  if (socketsLeft === 0) {
    await redis.command.set(`presence:${userId}`, "offline", { EX: 90 });
    await publishPresence(redis, userId, "offline");
  }
}

function registerSocketHandlers(io, redis) {
  redis.subscriber.subscribe("presence", payload => {
    const update = JSON.parse(payload);
    io.to(userRoom(update.userId)).emit("presence:update", update);
  });

  io.use(async (socket, next) => {
    const { userId } = socket.handshake.auth || {};
    if (!userId) {
      return next(new Error("Missing userId in socket auth payload"));
    }

    socket.data.userId = String(userId);
    await User.findOneAndUpdate(
      { _id: socket.data.userId },
      {
        _id: socket.data.userId,
        displayName: socket.handshake.auth.displayName || "New user",
        lastActiveAt: new Date(),
      },
      { upsert: true, setDefaultsOnInsert: true },
    );

    return next();
  });

  io.on("connection", async socket => {
    const userId = socket.data.userId;
    socket.join(userRoom(userId));
    await markOnline(redis, userId, socket.id);

    socket.on("presence:watch", async ({ userIds = [] }) => {
      const pipeline = redis.command.multi();
      userIds.forEach(id => pipeline.get(`presence:${id}`));
      const statuses = await pipeline.exec();
      const snapshot = userIds.map((watchedId, index) => ({
        userId: watchedId,
        status: statuses?.[index] || "offline",
      }));
      socket.emit("presence:snapshot", snapshot);
    });

    socket.on("swipe:action", async payload => {
      const result = await registerSwipe({
        actorId: userId,
        targetId: String(payload.targetId),
        action: payload.action,
      });

      socket.emit("swipe:result", {
        targetId: payload.targetId,
        action: payload.action,
        matched: result.matched,
        conversationId: result.conversation?.id || null,
      });

      if (result.matched) {
        const [firstUserId, secondUserId] = sortPair(userId, String(payload.targetId));
        io.to(userRoom(firstUserId)).emit("match:created", result);
        io.to(userRoom(secondUserId)).emit("match:created", result);
      }
    });

    socket.on("conversation:join", async ({ conversationId }) => {
      socket.join(conversationRoom(conversationId));
      const messages = await Message.find({ conversationId })
        .sort({ createdAt: 1 })
        .limit(50)
        .lean();
      socket.emit("conversation:history", { conversationId, messages });
    });

    socket.on("message:send", async payload => {
      const message = await Message.create({
        conversationId: payload.conversationId,
        senderId: userId,
        recipientId: payload.recipientId,
        body: payload.body,
      });

      await Conversation.findOneAndUpdate(
        { _id: payload.conversationId },
        { lastMessageAt: new Date() },
      );

      await redis.command.hIncrBy(`unread:${payload.recipientId}`, payload.conversationId, 1);

      io.to(conversationRoom(payload.conversationId)).emit("message:new", message.toObject());
      io.to(userRoom(payload.recipientId)).emit("conversation:unread", {
        conversationId: payload.conversationId,
        unreadDelta: 1,
      });
    });

    socket.on("typing:start", async ({ conversationId }) => {
      await redis.command.set(typingKey(conversationId, userId), "1", { EX: 5 });
      socket.to(conversationRoom(conversationId)).emit("typing:update", {
        conversationId,
        userId,
        isTyping: true,
      });
    });

    socket.on("typing:stop", async ({ conversationId }) => {
      await redis.command.del(typingKey(conversationId, userId));
      socket.to(conversationRoom(conversationId)).emit("typing:update", {
        conversationId,
        userId,
        isTyping: false,
      });
    });

    socket.on("call:start", async payload => {
      const call = await CallSession.create({
        conversationId: payload.conversationId,
        callerId: userId,
        calleeId: payload.calleeId,
        type: payload.type,
      });

      io.to(userRoom(payload.calleeId)).emit("call:incoming", {
        id: call.id,
        conversationId: payload.conversationId,
        callerId: userId,
        calleeId: payload.calleeId,
        type: payload.type,
      });
    });

    socket.on("call:answer", async payload => {
      await CallSession.findByIdAndUpdate(payload.callId, { status: "accepted" });
      io.to(userRoom(payload.callerId)).emit("call:accepted", payload);
    });

    socket.on("call:reject", async payload => {
      await CallSession.findByIdAndUpdate(payload.callId, {
        status: "rejected",
        endedAt: new Date(),
      });
      io.to(userRoom(payload.callerId)).emit("call:rejected", payload);
    });

    socket.on("call:end", async payload => {
      await CallSession.findByIdAndUpdate(payload.callId, {
        status: "ended",
        endedAt: new Date(),
      });
      io.to(userRoom(payload.peerId)).emit("call:ended", payload);
    });

    socket.on("webrtc:offer", payload => {
      io.to(userRoom(payload.peerId)).emit("webrtc:offer", {
        offerId: uuid(),
        fromUserId: userId,
        conversationId: payload.conversationId,
        sdp: payload.sdp,
      });
    });

    socket.on("webrtc:answer", payload => {
      io.to(userRoom(payload.peerId)).emit("webrtc:answer", {
        fromUserId: userId,
        conversationId: payload.conversationId,
        sdp: payload.sdp,
      });
    });

    socket.on("webrtc:ice-candidate", payload => {
      io.to(userRoom(payload.peerId)).emit("webrtc:ice-candidate", {
        fromUserId: userId,
        conversationId: payload.conversationId,
        candidate: payload.candidate,
      });
    });

    socket.on("disconnect", async () => {
      await User.findByIdAndUpdate(userId, { lastActiveAt: new Date() });
      await markOffline(redis, userId, socket.id);
    });
  });
}

module.exports = {
  registerSocketHandlers,
};
