const crypto = require("crypto");
const Conversation = require("../models/Conversation");
const Message = require("../models/Message");
const User = require("../models/User");
const { messagesByConversation, profiles } = require("../data/sampleData");
const { hashPassword, verifyPassword } = require("../lib/password");

async function ensureSeedData() {
  for (const profile of profiles) {
    await User.findOneAndUpdate(
      { _id: profile.id },
      {
        _id: profile.id,
        email: `${profile.id}@proximo.app`,
        phone: "",
        googleId: "",
        authProvider: "email",
        passwordHash: hashPassword("password123"),
        displayName: profile.name,
        age: profile.age,
        city: profile.city,
        headline: profile.headline,
        bio: profile.bio,
        interests: profile.interests,
        avatarUrl: profile.imageUrls?.[0] || "",
        imageUrls: profile.imageUrls || [],
        latitude: profile.latitude,
        longitude: profile.longitude,
        onboardingCompleted: true,
        lastActiveAt: new Date(),
      },
      { upsert: true, setDefaultsOnInsert: true },
    );
  }
}

async function registerAccount(payload) {
  const existing = await User.findOne({ email: payload.email.toLowerCase() }).lean();
  if (existing) {
    throw new Error("Email already registered");
  }

  const userId = crypto.randomUUID();
  const user = await User.create({
    _id: userId,
    email: payload.email.toLowerCase(),
    passwordHash: hashPassword(payload.password),
    displayName: payload.displayName,
    age: payload.age,
    city: payload.city,
    headline: payload.headline,
    bio: payload.bio,
    interests: payload.interests || [],
    avatarUrl: payload.imageUrls?.[0] || "",
    imageUrls: payload.imageUrls || [],
    latitude: payload.latitude ?? null,
    longitude: payload.longitude ?? null,
    onboardingCompleted: true,
    lastActiveAt: new Date(),
  });

  return {
    id: user.id,
    displayName: user.displayName,
    email: user.email,
  };
}

async function loginAccount(email, password) {
  const user = await User.findOne({ email: email.toLowerCase() });
  if (!user || !verifyPassword(password, user.passwordHash)) {
    throw new Error("Invalid email or password");
  }
  return {
    id: user.id,
    displayName: user.displayName,
    email: user.email,
  };
}

async function buildBootstrapPayload(userId) {
  await ensureSeedData();
  const currentUser = await User.findById(userId).lean();
  if (!currentUser) {
    return {
      user: { id: "", displayName: "" },
      transport: { websocketUrl: "/ws" },
      needsOnboarding: true,
      profiles: [],
      conversations: [],
      messagesByConversation: {},
    };
  }

  const discoverUsers = await User.find({
    _id: { $ne: userId },
    onboardingCompleted: true,
  })
    .sort({ createdAt: -1 })
    .lean();

  const profileCards = discoverUsers.map(user => ({
    id: user._id,
    name: user.displayName,
    age: user.age || 18,
    city: user.city || "Unknown",
    distance: formatDistanceKm(distanceKm(currentUser, user)),
    headline: user.headline || "New here",
    bio: user.bio || "",
    gradientStart: profileGradient(user._id).start,
    gradientEnd: profileGradient(user._id).end,
    interests: user.interests || [],
    imageUrls: user.imageUrls || [],
  }));

  const dbConversations = await Conversation.find({
    participantIds: userId,
  })
    .sort({ updatedAt: -1 })
    .lean();

  const conversationRecords = [];
  for (const conversation of dbConversations) {
    const peerId = conversation.participantIds.find(id => id !== userId);
    if (!peerId) continue;
    const peer = await User.findById(peerId).lean();
    if (!peer) continue;
    const dbMessages = await Message.find({ conversationId: conversation._id }).sort({ createdAt: 1 }).lean();
    const messages = dbMessages.map(message => ({
      id: String(message._id),
      author: message.senderId === userId ? "You" : peer.displayName,
      body: message.body,
      timestamp: formatTimestamp(message.createdAt),
      fromCurrentUser: message.senderId === userId,
      senderId: message.senderId,
    }));
    conversationRecords.push({
      id: String(conversation._id),
      name: peer.displayName,
      status: "Active nearby",
      recipientId: peerId,
      gradientStart: profileGradient(peerId).start,
      gradientEnd: profileGradient(peerId).end,
      unreadCount: 0,
      lastMessage: messages[messages.length - 1]?.body || "",
      messages,
    });
  }

  seedStarterConversationsIfEmpty(userId, conversationRecords);

  return {
    user: {
      id: currentUser._id,
      displayName: currentUser.displayName,
    },
    transport: {
      websocketUrl: "/ws",
    },
    needsOnboarding: false,
    profiles: profileCards,
    conversations: conversationRecords.map(({ messages, ...conversation }) => conversation),
    messagesByConversation: Object.fromEntries(conversationRecords.map(record => [record.id, record.messages])),
  };
}

function seedStarterConversationsIfEmpty(userId, conversationRecords) {
  if (conversationRecords.length > 0) return;
  const starterProfiles = profiles.slice(0, 3);
  starterProfiles.forEach(profile => {
    const messages = (messagesByConversation[profile.id] || []).map((message, index) => ({
      id: `${profile.id}-${index}`,
      author: message.fromCurrentUser ? "You" : profile.name,
      body: message.body,
      timestamp: message.timestamp,
      fromCurrentUser: message.fromCurrentUser,
      senderId: message.fromCurrentUser ? userId : profile.id,
    }));
    conversationRecords.push({
      id: profile.id,
      name: profile.name,
      status: "Nearby now",
      recipientId: profile.id,
      gradientStart: profile.gradientStart,
      gradientEnd: profile.gradientEnd,
      unreadCount: 0,
      lastMessage: messages[messages.length - 1]?.body || "",
      messages,
    });
  });
}

function profileGradient(id) {
  const fallback = [
    { start: "#F76B8A", end: "#2D1E2F" },
    { start: "#FD9E6A", end: "#281515" },
    { start: "#F2D53C", end: "#3A1808" },
    { start: "#7FD1B9", end: "#1A2336" },
  ];
  const charCode = id.charCodeAt(0) || 0;
  return fallback[charCode % fallback.length];
}

function distanceKm(currentUser, otherUser) {
  if (currentUser?.latitude == null || currentUser?.longitude == null || otherUser?.latitude == null || otherUser?.longitude == null) {
    return null;
  }
  const toRadians = value => (value * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const latitudeDelta = toRadians(otherUser.latitude - currentUser.latitude);
  const longitudeDelta = toRadians(otherUser.longitude - currentUser.longitude);
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(toRadians(currentUser.latitude)) *
      Math.cos(toRadians(otherUser.latitude)) *
      Math.sin(longitudeDelta / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusKm * c;
}

function formatDistanceKm(distance) {
  if (distance == null || Number.isNaN(distance)) return "Nearby";
  const rounded = Math.max(1, Math.round(distance));
  return `${rounded} km away`;
}

function formatTimestamp(dateValue) {
  const date = new Date(dateValue);
  return date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

module.exports = {
  ensureSeedData,
  buildBootstrapPayload,
};
