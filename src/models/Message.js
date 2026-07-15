const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema(
  {
    conversationId: { type: String, required: true, index: true },
    senderId: { type: String, required: true, index: true },
    recipientId: { type: String, required: true, index: true },
    body: { type: String, required: true, trim: true },
    deliveredAt: { type: Date, default: Date.now },
    seenAt: { type: Date, default: null },
  },
  { timestamps: true },
);

module.exports = mongoose.models.Message || mongoose.model("Message", messageSchema);
