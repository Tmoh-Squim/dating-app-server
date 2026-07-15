const mongoose = require("mongoose");

const swipeSchema = new mongoose.Schema(
  {
    actorId: { type: String, required: true, index: true },
    targetId: { type: String, required: true, index: true },
    action: {
      type: String,
      enum: ["like", "pass", "boost"],
      required: true,
    },
  },
  { timestamps: true },
);

swipeSchema.index({ actorId: 1, targetId: 1 }, { unique: true });

module.exports = mongoose.models.Swipe || mongoose.model("Swipe", swipeSchema);
