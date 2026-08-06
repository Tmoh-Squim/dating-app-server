const Conversation = require("../models/Conversation");
const GiftTransaction = require("../models/GiftTransaction");
const Match = require("../models/Match");
const User = require("../models/User");
const { AppError } = require("./auth-service");

const UNMATCHED_CHAT_MESSAGE_COST = 5;

const COIN_PACKAGES = [
  {
    id: "bronze_50",
    name: "Bronze",
    coins: 50,
    bonusCoins: 0,
    effect: "Mistletoe effect",
    priceLabel: "Bronze starter",
  },
  {
    id: "silver_150",
    name: "Silver",
    coins: 150,
    bonusCoins: 20,
    effect: "Ice effect",
    priceLabel: "Silver boost",
  },
  {
    id: "gold_500",
    name: "Gold",
    coins: 500,
    bonusCoins: 100,
    effect: "Golden effect",
    priceLabel: "Gold vault",
  },
];

const SUBSCRIPTION_PLANS = [
  {
    id: "premium_monthly",
    name: "Premium",
    coinCost: 300,
    description: "Unlock premium actions and future paid perks.",
    grantsPremium: true,
    grantsVerification: false,
  },
  {
    id: "gold_verification",
    name: "Gold verification",
    coinCost: 180,
    description: "Show the verified badge beside your name.",
    grantsPremium: false,
    grantsVerification: true,
  },
];

const GIFT_CATALOG = [
  { id: "royal_wings", name: "Royal", coinCost: 80 },
  { id: "follow_heart", name: "Follow", coinCost: 20 },
  { id: "gold_room", name: "Golden", coinCost: 50 },
  { id: "love_wings", name: "Love", coinCost: 60 },
  { id: "royal_cats", name: "Royal Cats", coinCost: 100 },
  { id: "angel", name: "Angel", coinCost: 45 },
  { id: "heart", name: "Heart", coinCost: 15 },
  { id: "crown", name: "Crown", coinCost: 70 },
];

function walletSummary(user) {
  return {
    userId: String(user._id),
    balance: Number(user.balance || 0),
    isPremimum: Boolean(user.isPremimum),
    isVeried: Boolean(user.isVeried),
  };
}

function getCatalogPayload() {
  return {
    unmatchedChatMessageCost: UNMATCHED_CHAT_MESSAGE_COST,
    coinPackages: COIN_PACKAGES,
    subscriptionPlans: SUBSCRIPTION_PLANS,
    gifts: GIFT_CATALOG,
  };
}

async function getWallet(userId) {
  const user = await User.findById(String(userId));
  if (!user) {
    throw new AppError(404, "User account not found");
  }
  return walletSummary(user);
}

async function purchaseCoins(userId, packageId) {
  const user = await User.findById(String(userId));
  if (!user) {
    throw new AppError(404, "User account not found");
  }
  const coinPackage = COIN_PACKAGES.find(entry => entry.id === String(packageId));
  if (!coinPackage) {
    throw new AppError(400, "Coin package not found");
  }
  user.balance = Number(user.balance || 0) + coinPackage.coins + coinPackage.bonusCoins;
  await user.save();
  return {
    ...walletSummary(user),
    packageId: coinPackage.id,
    message: `${coinPackage.name} coins added successfully`,
  };
}

async function purchaseSubscription(userId, planId) {
  const user = await User.findById(String(userId));
  if (!user) {
    throw new AppError(404, "User account not found");
  }
  const plan = SUBSCRIPTION_PLANS.find(entry => entry.id === String(planId));
  if (!plan) {
    throw new AppError(400, "Subscription plan not found");
  }
  const currentBalance = Number(user.balance || 0);
  if (currentBalance < plan.coinCost) {
    throw new AppError(400, `You need ${plan.coinCost - currentBalance} more coins for ${plan.name}`);
  }
  user.balance = currentBalance - plan.coinCost;
  if (plan.grantsPremium) user.isPremimum = true;
  if (plan.grantsVerification) user.isVeried = true;
  await user.save();
  return {
    ...walletSummary(user),
    planId: plan.id,
    message: `${plan.name} activated`,
  };
}

async function sendGift({ senderId, recipientId, giftId, conversationId = "" }) {
  const [sender, recipient] = await Promise.all([
    User.findById(String(senderId)),
    User.findById(String(recipientId)),
  ]);
  if (!sender) throw new AppError(404, "Sender account not found");
  if (!recipient) throw new AppError(404, "Recipient account not found");

  const gift = GIFT_CATALOG.find(entry => entry.id === String(giftId));
  if (!gift) {
    throw new AppError(400, "Gift not found");
  }
  if (sender._id === recipient._id) {
    throw new AppError(400, "You cannot send a gift to yourself");
  }

  const currentBalance = Number(sender.balance || 0);
  if (currentBalance < gift.coinCost) {
    throw new AppError(400, `You need ${gift.coinCost - currentBalance} more coins to send ${gift.name}`);
  }

  sender.balance = currentBalance - gift.coinCost;
  await sender.save();
  await GiftTransaction.create({
    senderId: String(sender._id),
    recipientId: String(recipient._id),
    giftId: gift.id,
    giftName: gift.name,
    coinCost: gift.coinCost,
    conversationId: String(conversationId || ""),
  });

  return {
    ...walletSummary(sender),
    giftId: gift.id,
    recipientId: String(recipient._id),
    recipientName: recipient.displayName,
    message: `${gift.name} sent to ${recipient.displayName}`,
  };
}

async function fetchMatches(userId) {
  const matches = await Match.find({ userIds: String(userId) }).sort({ updatedAt: -1 }).lean();
  const items = [];
  for (const match of matches) {
    const peerId = (match.userIds || []).find(id => id !== String(userId));
    if (!peerId) continue;
    const [peer, conversation] = await Promise.all([
      User.findById(peerId).lean(),
      Conversation.findOne({ participantIds: { $all: [String(userId), peerId] } }).lean(),
    ]);
    if (!peer) continue;
    items.push({
      id: peer._id,
      name: peer.displayName,
      age: peer.age || 18,
      city: peer.city || "",
      headline: peer.headline || "New match",
      bio: peer.bio || "",
      imageUrls: peer.imageUrls || [],
      avatarUrl: peer.avatarUrl || "",
      conversationId: conversation ? String(conversation._id) : "",
      matchedAt: match.createdAt ? new Date(match.createdAt).toISOString() : "",
    });
  }
  return { matches: items };
}

async function chargeForUnmatchedChatMessage({ senderId, recipientId, conversation }) {
  if (!conversation) return null;
  if (conversation.matchId) return null;

  const userIds = Array.isArray(conversation.participantIds) ? conversation.participantIds : [senderId, recipientId];
  const match = await Match.findOne({ userIds: { $all: userIds, $size: 2 } }).lean();
  if (match) {
    if (!conversation.matchId) {
      await Conversation.findByIdAndUpdate(String(conversation._id), { matchId: String(match._id) });
    }
    return null;
  }

  const sender = await User.findById(String(senderId));
  if (!sender) {
    throw new AppError(404, "Sender account not found");
  }
  if (sender.isPremimum) {
    return walletSummary(sender);
  }

  const currentBalance = Number(sender.balance || 0);
  if (currentBalance < UNMATCHED_CHAT_MESSAGE_COST) {
    throw new AppError(
      400,
      `You need ${UNMATCHED_CHAT_MESSAGE_COST} coins to message someone you haven't matched with yet`,
    );
  }

  sender.balance = currentBalance - UNMATCHED_CHAT_MESSAGE_COST;
  await sender.save();
  return walletSummary(sender);
}

module.exports = {
  UNMATCHED_CHAT_MESSAGE_COST,
  getCatalogPayload,
  getWallet,
  purchaseCoins,
  purchaseSubscription,
  sendGift,
  fetchMatches,
  chargeForUnmatchedChatMessage,
};
