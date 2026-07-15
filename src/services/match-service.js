const Conversation = require("../models/Conversation");
const Match = require("../models/Match");
const Swipe = require("../models/Swipe");

function sortPair(a, b) {
  return [a, b].sort();
}

async function registerSwipe({ actorId, targetId, action }) {
  await Swipe.findOneAndUpdate(
    { actorId, targetId },
    { actorId, targetId, action },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  if (action === "pass") {
    return { matched: false };
  }

  const reciprocal = await Swipe.findOne({
    actorId: targetId,
    targetId: actorId,
    action: { $in: ["like", "boost"] },
  }).lean();

  if (!reciprocal) {
    return { matched: false };
  }

  const userIds = sortPair(actorId, targetId);
  const match = await Match.findOneAndUpdate(
    { userIds },
    { userIds, lastMessageAt: new Date() },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  const conversation = await Conversation.findOneAndUpdate(
    { participantIds: userIds },
    {
      participantIds: userIds,
      matchId: match.id,
      lastMessageAt: new Date(),
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  return {
    matched: true,
    match,
    conversation,
  };
}

module.exports = {
  registerSwipe,
  sortPair,
};
