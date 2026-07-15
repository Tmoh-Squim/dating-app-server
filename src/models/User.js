const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    displayName: { type: String, required: true, trim: true },
    age: { type: Number, min: 18, max: 99 },
    city: { type: String, trim: true },
    bio: { type: String, default: "" },
    interests: { type: [String], default: [] },
    avatarUrl: { type: String, default: "" },
    lastActiveAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

module.exports = mongoose.models.User || mongoose.model("User", userSchema);
