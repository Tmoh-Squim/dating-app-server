const Conversation = require("../models/Conversation");
const { sortPair } = require("./match-service");

async function ensureConversationBetweenUsers(firstUserId, secondUserId) {
  const participantIds = sortPair(String(firstUserId), String(secondUserId));
  const existing = await Conversation.findOne({ participantIds });
  if (existing) {
    return existing;
  }

  const conversationId = `dm:${participantIds.join(":")}`;
  return Conversation.findOneAndUpdate(
    { participantIds },
    {
      _id: conversationId,
      participantIds,
      lastMessageAt: new Date(),
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
}

module.exports = {
  ensureConversationBetweenUsers,
};
