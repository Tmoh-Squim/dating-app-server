const mongoose = require("mongoose");

const callSessionSchema = new mongoose.Schema(
  {
    conversationId: { type: String, required: true, index: true },
    callerId: { type: String, required: true, index: true },
    calleeId: { type: String, required: true, index: true },
    type: {
      type: String,
      enum: ["voice", "video"],
      required: true,
    },
    status: {
      type: String,
      enum: ["pending", "accepted", "rejected", "ended", "missed"],
      default: "pending",
    },
    startedAt: { type: Date, default: Date.now },
    endedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

module.exports =
  mongoose.models.CallSession || mongoose.model("CallSession", callSessionSchema);
