const Conversation = require("../models/Conversation");
const Message = require("../models/Message");
const User = require("../models/User");
const { conversations, messagesByConversation, profiles } = require("../data/sampleData");

async function ensureSeedData(userId, displayName) {
  await User.findOneAndUpdate(
    { _id: userId },
    {
      _id: userId,
      displayName,
      age: 25,
      city: "Nairobi",
      bio: "Intentional dating, strong coffee, and clear communication.",
      interests: ["Product", "Travel", "Music", "Design"],
      lastActiveAt: new Date(),
    },
    { upsert: true, setDefaultsOnInsert: true },
  );

  for (const profile of profiles) {
    await User.findOneAndUpdate(
      { _id: profile.id },
      {
        _id: profile.id,
        displayName: profile.name,
        age: profile.age,
        city: profile.city,
        bio: profile.bio,
        interests: profile.interests,
        lastActiveAt: new Date(),
      },
      { upsert: true, setDefaultsOnInsert: true },
    );
  }

  for (const conversation of conversations) {
    await Conversation.findOneAndUpdate(
      { _id: conversation.id },
      {
        _id: conversation.id,
        participantIds: [userId, conversation.recipientId].sort(),
        lastMessageAt: new Date(),
      },
      { upsert: true, setDefaultsOnInsert: true },
    );

    const existingCount = await Message.countDocuments({ conversationId: conversation.id });
    if (existingCount > 0) continue;

    const seedMessages = messagesByConversation[conversation.id] || [];
    for (let index = 0; index < seedMessages.length; index += 1) {
      const seed = seedMessages[index];
      await Message.create({
        conversationId: conversation.id,
        senderId: seed.fromCurrentUser ? userId : conversation.recipientId,
        recipientId: seed.fromCurrentUser ? conversation.recipientId : userId,
        body: seed.body,
        deliveredAt: new Date(Date.now() - (seedMessages.length - index) * 60000),
      });
    }
  }
}

async function buildBootstrapPayload(userId) {
  const records = [];
  for (const conversation of conversations) {
    const dbMessages = await Message.find({ conversationId: conversation.id }).sort({ createdAt: 1 }).lean();
    const messages = dbMessages.map(message => ({
      id: String(message._id),
      author: message.senderId === userId ? "You" : conversation.name,
      body: message.body,
      timestamp: formatTimestamp(message.createdAt),
      fromCurrentUser: message.senderId === userId,
    }));
    records.push({
      id: conversation.id,
      name: conversation.name,
      status: conversation.status,
      recipientId: conversation.recipientId,
      gradientStart: conversation.gradientStart,
      gradientEnd: conversation.gradientEnd,
      unreadCount: 0,
      lastMessage: messages[messages.length - 1]?.body || "",
      messages,
    });
  }

  return {
    profiles,
    conversations: records.map(({ messages, ...conversation }) => conversation),
    messagesByConversation: Object.fromEntries(records.map(record => [record.id, record.messages])),
  };
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
