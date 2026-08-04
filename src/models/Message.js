const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema(
  {
    conversationId: { type: String, required: true, index: true },
    senderId: { type: String, required: true, index: true },
    recipientId: { type: String, required: true, index: true },
    type: {
      type: String,
      enum: ["text", "voice_note", "call_event"],
      default: "text",
    },
    body: { type: String, default: "", trim: true },
    mediaUrl: { type: String, default: "" },
    mediaDurationSeconds: { type: Number, default: 0, min: 0 },
    callId: { type: String, default: "", index: true },
    callMediaType: {
      type: String,
      enum: ["", "voice", "video"],
      default: "",
    },
    callStatus: {
      type: String,
      enum: ["", "started", "accepted", "rejected", "missed", "cancelled", "completed"],
      default: "",
    },
    callDurationSeconds: { type: Number, default: 0, min: 0 },
    deliveredAt: { type: Date, default: Date.now },
    seenAt: { type: Date, default: null },
  },
  { timestamps: true },
);

module.exports = mongoose.models.Message || mongoose.model("Message", messageSchema);
