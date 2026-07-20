const mongoose = require("mongoose");

const otpVerificationSchema = new mongoose.Schema(
  {
    userId: { type: String, default: "", index: true },
    phone: { type: String, required: true, trim: true, index: true },
    purpose: { type: String, required: true, uppercase: true, trim: true, default: "LOGIN" },
    provider: { type: String, required: true, uppercase: true, trim: true, default: "ADVANTA" },
    codeHash: { type: String, required: true },
    verificationTokenHash: { type: String, trim: true, default: "" },
    messageId: { type: String, trim: true, default: "" },
    attempts: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 5 },
    verifiedAt: { type: Date, default: null },
    consumedAt: { type: Date, default: null },
    expiresAt: { type: Date, required: true },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

otpVerificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
otpVerificationSchema.index({ phone: 1, purpose: 1, createdAt: -1 });

module.exports = mongoose.models.OtpVerification || mongoose.model("OtpVerification", otpVerificationSchema);
