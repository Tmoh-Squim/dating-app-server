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
      enum: ["pending", "accepted", "rejected", "ended", "missed", "cancelled"],
      default: "pending",
    },
    acceptedAt: { type: Date, default: null },
    startedAt: { type: Date, default: Date.now },
    endedAt: { type: Date, default: null },
    durationSeconds: { type: Number, default: 0, min: 0 },
    callMessageId: { type: String, default: "" },
    recordingStatus: {
      type: String,
      enum: ["none", "uploaded", "partial", "failed"],
      default: "none",
    },
    recordings: [
      {
        kind: {
          type: String,
          enum: ["audio", "video"],
          required: true,
        },
        url: { type: String, required: true },
        mimeType: { type: String, default: "" },
        durationSeconds: { type: Number, default: 0, min: 0 },
        uploadedAt: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true },
);

module.exports =
  mongoose.models.CallSession || mongoose.model("CallSession", callSessionSchema);
