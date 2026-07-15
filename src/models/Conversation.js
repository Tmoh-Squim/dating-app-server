const mongoose = require("mongoose");

const conversationSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    participantIds: {
      type: [String],
      required: true,
      validate: value => Array.isArray(value) && value.length >= 2,
    },
    matchId: { type: String, default: null },
    lastMessageAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

conversationSchema.index({ participantIds: 1 }, { unique: true });

module.exports =
  mongoose.models.Conversation || mongoose.model("Conversation", conversationSchema);
