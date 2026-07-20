const dotenv = require("dotenv");
const path = require("path");

dotenv.config();

module.exports = {
  port: Number(process.env.PORT || 4000),
  clientUrl: process.env.CLIENT_URL || "*",
  mongoUri: process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/proximo",
  redisUrl: process.env.REDIS_URL || "redis://127.0.0.1:6379",
  googleClientId: process.env.GOOGLE_CLIENT_ID || "",
  otpProvider: String(process.env.OTP_PROVIDER || "ADVANTA").trim().toUpperCase(),
  otpMessageTemplate:
    process.env.OTP_MESSAGE_TEMPLATE ||
    "Your Proximo verification code is {{code}}. It expires in {{minutes}} minutes.",
  otpLength: Number(process.env.OTP_LENGTH || 6),
  otpTtlSeconds: Number(process.env.OTP_TTL_SECONDS || 300),
  advantaBaseUrl: process.env.ADVANTA_BASE_URL || "https://quicksms.advantasms.com",
  advantaApiKey: process.env.ADVANTA_API_KEY || "",
  advantaPartnerId: process.env.ADVANTA_PARTNER_ID || "",
  advantaShortcode: process.env.ADVANTA_SHORTCODE || "",
  uploadDir: process.env.UPLOAD_DIR || path.resolve(process.cwd(), "uploads"),
  publicBaseUrl: String(
    process.env.PUBLIC_BASE_URL ||
      process.env.SERVER_PUBLIC_URL ||
      "https://proximo.pushvault.shop",
  ).replace(/\/+$/, ""),
};
