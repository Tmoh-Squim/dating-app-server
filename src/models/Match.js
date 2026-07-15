const mongoose = require("mongoose");

const matchSchema = new mongoose.Schema(
  {
    userIds: {
      type: [String],
      required: true,
      validate: value => Array.isArray(value) && value.length === 2,
    },
    lastMessageAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

matchSchema.index({ userIds: 1 }, { unique: true });

module.exports = mongoose.models.Match || mongoose.model("Match", matchSchema);
