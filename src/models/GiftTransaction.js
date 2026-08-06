const mongoose = require("mongoose");

const giftTransactionSchema = new mongoose.Schema(
  {
    senderId: { type: String, required: true, index: true },
    recipientId: { type: String, required: true, index: true },
    giftId: { type: String, required: true },
    giftName: { type: String, required: true },
    coinCost: { type: Number, required: true, min: 0 },
    conversationId: { type: String, default: "" },
  },
  { timestamps: true },
);

module.exports =
  mongoose.models.GiftTransaction || mongoose.model("GiftTransaction", giftTransactionSchema);
