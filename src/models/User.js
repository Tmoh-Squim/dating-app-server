const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    email: { type: String, trim: true, lowercase: true, index: true, sparse: true },
    phone: { type: String, trim: true, index: true, sparse: true, default: "" },
    googleId: { type: String, trim: true, index: true, sparse: true, default: "" },
    authProvider: {
      type: String,
      enum: ["email", "phone", "google"],
      default: "email",
    },
    passwordHash: { type: String, default: "" },
    displayName: { type: String, required: true, trim: true },
    age: { type: Number, min: 18, max: 99 },
    city: { type: String, trim: true },
    headline: { type: String, default: "" },
    bio: { type: String, default: "" },
    interests: { type: [String], default: [] },
    avatarUrl: { type: String, default: "" },
    imageUrls: { type: [String], default: [] },
    latitude: { type: Number, default: null },
    longitude: { type: Number, default: null },
    isPhoneVerified: { type: Boolean, default: false },
    onboardingCompleted: { type: Boolean, default: false },
    lastActiveAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

module.exports = mongoose.models.User || mongoose.model("User", userSchema);
