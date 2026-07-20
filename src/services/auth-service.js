const crypto = require("crypto");
const { OAuth2Client } = require("google-auth-library");
const {
  googleClientId,
  otpLength,
  otpMessageTemplate,
  otpProvider,
  otpTtlSeconds,
} = require("../config");
const OtpVerification = require("../models/OtpVerification");
const User = require("../models/User");
const { sendOtpMessage } = require("../lib/advantaSms");
const { hashPassword, verifyPassword } = require("../lib/password");
const { formatPhone, normalizePhone } = require("../utils/phone");

const googleClient = new OAuth2Client(googleClientId || undefined);

class AppError extends Error {
  constructor(status, publicMessage, internalMessage = publicMessage) {
    super(internalMessage);
    this.status = status;
    this.publicMessage = publicMessage;
  }
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function normalizeDisplayName(name) {
  return String(name || "").trim().replace(/\s+/g, " ");
}

function normalizeInterests(interests) {
  if (Array.isArray(interests)) {
    return interests.map(value => String(value || "").trim()).filter(Boolean).slice(0, 12);
  }
  return [];
}

function normalizeImageUrls(imageUrls) {
  if (Array.isArray(imageUrls)) {
    return imageUrls.map(value => String(value || "").trim()).filter(Boolean).slice(0, 6);
  }
  return [];
}

function normalizeOptionalString(value) {
  const normalized = String(value || "").trim();
  return normalized;
}

function normalizeAge(value) {
  if (value == null || value === "") return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 18 || numeric > 99) {
    throw new AppError(400, "Enter a valid age between 18 and 99");
  }
  return Math.round(numeric);
}

function publicUser(user) {
  return {
    id: user._id,
    displayName: user.displayName,
    email: user.email || "",
    phone: user.phone ? formatPhone(user.phone) : "",
    authProvider: user.authProvider,
    onboardingCompleted: Boolean(user.onboardingCompleted),
  };
}

function generateOtpCode(length = otpLength) {
  const normalizedLength = Math.max(4, Math.min(8, Number(length) || 6));
  let output = "";
  for (let index = 0; index < normalizedLength; index += 1) {
    output += crypto.randomInt(0, 10).toString();
  }
  return output;
}

function hashValue(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function buildOtpMessage(code) {
  const minutes = Math.max(1, Math.ceil((Number(otpTtlSeconds) || 300) / 60));
  return String(otpMessageTemplate)
    .replace(/\{\{\s*code\s*\}\}/gi, code)
    .replace(/\{\{\s*minutes\s*\}\}/gi, String(minutes))
    .replace(/\{\{\s*brand\s*\}\}/gi, "Proximo");
}

async function consumeVerifiedOtp({ phone, purpose, verificationId, verificationToken }) {
  if (!verificationId || !verificationToken) {
    return false;
  }

  const record = await OtpVerification.findOne({
    _id: verificationId,
    phone,
    purpose,
    verifiedAt: { $ne: null },
    consumedAt: null,
    expiresAt: { $gt: new Date() },
  });

  if (!record || record.verificationTokenHash !== hashValue(verificationToken)) {
    return false;
  }

  record.consumedAt = new Date();
  await record.save();
  return true;
}

function requireStrongEnoughPassword(password) {
  if (String(password || "").length < 6) {
    throw new AppError(400, "Password must be at least 6 characters");
  }
}

function requireDisplayName(displayName) {
  if (!displayName) {
    throw new AppError(400, "Display name is required");
  }
}

function assertEmailLoginCompatible(user) {
  if (user?.authProvider === "google" && !user.passwordHash) {
    throw new AppError(409, "This account uses Google sign-in");
  }
}

function assertPhoneLoginCompatible(user) {
  if (user?.authProvider === "google" && !user.passwordHash) {
    throw new AppError(409, "This account uses Google sign-in");
  }
}

async function registerAccount(payload = {}) {
  const email = normalizeEmail(payload.email);
  const displayName = normalizeDisplayName(payload.displayName);
  requireDisplayName(displayName);
  requireStrongEnoughPassword(payload.password);

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new AppError(400, "Enter a valid email address");
  }

  const existing = await User.findOne({ email }).lean();
  if (existing) {
    throw new AppError(409, "Email already registered");
  }

  const user = await User.create({
    _id: crypto.randomUUID(),
    email,
    passwordHash: hashPassword(payload.password),
    displayName,
    age: normalizeAge(payload.age),
    city: normalizeOptionalString(payload.city),
    headline: normalizeOptionalString(payload.headline),
    bio: normalizeOptionalString(payload.bio),
    interests: normalizeInterests(payload.interests),
    avatarUrl: normalizeImageUrls(payload.imageUrls)[0] || "",
    imageUrls: normalizeImageUrls(payload.imageUrls),
    latitude: payload.latitude ?? null,
    longitude: payload.longitude ?? null,
    authProvider: "email",
    onboardingCompleted: Boolean(payload.onboardingCompleted),
    lastActiveAt: new Date(),
  });

  return publicUser(user);
}

async function loginAccount(emailInput, password) {
  const email = normalizeEmail(emailInput);
  const user = await User.findOne({ email });
  assertEmailLoginCompatible(user);
  if (!user || !verifyPassword(password, user.passwordHash)) {
    throw new AppError(401, "Invalid email or password");
  }

  user.lastActiveAt = new Date();
  await user.save();
  return publicUser(user);
}

async function loginWithGoogle(credential) {
  if (!credential) {
    throw new AppError(400, "Google credential is required");
  }
  if (!googleClientId) {
    throw new AppError(500, "Google sign-in is not configured");
  }

  const ticket = await googleClient.verifyIdToken({
    idToken: credential,
    audience: googleClientId,
  });
  const payload = ticket.getPayload();
  const email = normalizeEmail(payload?.email);
  const googleId = String(payload?.sub || "");
  const displayName = normalizeDisplayName(payload?.name) || "Proximo User";
  const avatarUrl = String(payload?.picture || "");
  const emailVerified = Boolean(payload?.email_verified);

  if (!email || !emailVerified || !googleId) {
    throw new AppError(400, "Google account could not be verified");
  }

  let user = await User.findOne({
    $or: [{ googleId }, { email }],
  });

  if (!user) {
    user = await User.create({
      _id: crypto.randomUUID(),
      email,
      googleId,
      authProvider: "google",
      displayName,
      avatarUrl,
      imageUrls: avatarUrl ? [avatarUrl] : [],
      onboardingCompleted: false,
      lastActiveAt: new Date(),
    });
  } else {
    user.googleId = user.googleId || googleId;
    user.authProvider = user.authProvider || "google";
    user.displayName = user.displayName || displayName;
    user.avatarUrl = user.avatarUrl || avatarUrl;
    if ((!user.imageUrls || user.imageUrls.length === 0) && avatarUrl) {
      user.imageUrls = [avatarUrl];
    }
    user.lastActiveAt = new Date();
    await user.save();
  }

  return publicUser(user);
}

async function requestOtp(payload = {}) {
  let phone;
  try {
    phone = normalizePhone(payload.phone);
  } catch (_) {
    throw new AppError(400, "Invalid phone number");
  }

  const purpose = String(payload.purpose || "REGISTER").trim().toUpperCase();
  const ttlSeconds = Math.max(60, Math.min(900, Number(otpTtlSeconds) || 300));
  const recentPendingOtp = await OtpVerification.findOne({
    phone,
    purpose,
    verifiedAt: null,
    expiresAt: { $gt: new Date() },
    createdAt: { $gte: new Date(Date.now() - 30 * 1000) },
  }).sort({ createdAt: -1 });

  if (recentPendingOtp) {
    throw new AppError(429, "Please wait 30 seconds before requesting another OTP");
  }

  const code = generateOtpCode(otpLength);
  const message = buildOtpMessage(code);
  const sendResult = await sendOtpMessage({
    phone,
    message,
  });

  const record = await OtpVerification.create({
    phone,
    purpose,
    provider: otpProvider || "ADVANTA",
    codeHash: hashValue(code),
    messageId: sendResult.messageId,
    expiresAt: new Date(Date.now() + ttlSeconds * 1000),
    metadata: {
      networkId: sendResult.networkId,
      providerResponse: sendResult.providerResponse,
    },
  });

  return {
    message: "OTP sent successfully",
    otpRequestId: record._id.toString(),
    phone: formatPhone(phone),
    purpose,
    expiresInSeconds: ttlSeconds,
  };
}

async function verifyOtp(payload = {}) {
  let phone;
  try {
    phone = normalizePhone(payload.phone);
  } catch (_) {
    throw new AppError(400, "Invalid phone number");
  }

  const purpose = String(payload.purpose || "REGISTER").trim().toUpperCase();
  const otpFilter = {
    phone,
    purpose,
  };
  if (payload.otpRequestId) {
    otpFilter._id = String(payload.otpRequestId);
  }

  const record = await OtpVerification.findOne(otpFilter).sort({ createdAt: -1 });
  if (!record) {
    throw new AppError(404, "OTP request not found");
  }
  if (record.consumedAt) {
    throw new AppError(409, "OTP has already been used");
  }
  if (record.verifiedAt) {
    throw new AppError(409, "OTP has already been verified");
  }
  if (record.expiresAt <= new Date()) {
    throw new AppError(410, "OTP has expired");
  }
  if (Number(record.attempts || 0) >= Number(record.maxAttempts || 5)) {
    throw new AppError(429, "OTP verification attempts exceeded");
  }

  const incomingCode = String(payload.code || "").replace(/[{}\s]/g, "").trim();
  if (!incomingCode || record.codeHash !== hashValue(incomingCode)) {
    record.attempts = Number(record.attempts || 0) + 1;
    await record.save();
    throw new AppError(400, "Invalid OTP code");
  }

  const verificationToken = crypto.randomBytes(24).toString("hex");
  const verifiedAt = new Date();
  const verificationExpiresAt = new Date(verifiedAt.getTime() + 15 * 60 * 1000);
  record.attempts = Number(record.attempts || 0) + 1;
  record.verifiedAt = verifiedAt;
  record.expiresAt = verificationExpiresAt;
  record.verificationTokenHash = hashValue(verificationToken);
  await record.save();

  return {
    message: "OTP verified successfully",
    verified: true,
    otpRequestId: record._id.toString(),
    verificationId: record._id.toString(),
    verificationToken,
    phone: formatPhone(phone),
    purpose,
    expiresAt: verificationExpiresAt,
  };
}

async function registerPhoneAccount(payload = {}) {
  const displayName = normalizeDisplayName(payload.displayName);
  requireDisplayName(displayName);
  requireStrongEnoughPassword(payload.password);

  let phone;
  try {
    phone = normalizePhone(payload.phone);
  } catch (_) {
    throw new AppError(400, "Invalid phone number");
  }

  const existing = await User.findOne({ phone }).lean();
  if (existing) {
    throw new AppError(409, "Phone number already registered");
  }

  const isPhoneVerified = await consumeVerifiedOtp({
    phone,
    purpose: "REGISTER",
    verificationId: payload.verificationId,
    verificationToken: payload.verificationToken,
  });

  if (!isPhoneVerified) {
    throw new AppError(400, "OTP verification is invalid or expired");
  }

  const imageUrls = normalizeImageUrls(payload.imageUrls);
  const user = await User.create({
    _id: crypto.randomUUID(),
    phone,
    passwordHash: hashPassword(payload.password),
    displayName,
    age: normalizeAge(payload.age),
    city: normalizeOptionalString(payload.city),
    headline: normalizeOptionalString(payload.headline),
    bio: normalizeOptionalString(payload.bio),
    interests: normalizeInterests(payload.interests),
    avatarUrl: imageUrls[0] || "",
    imageUrls,
    latitude: payload.latitude ?? null,
    longitude: payload.longitude ?? null,
    authProvider: "phone",
    isPhoneVerified: true,
    onboardingCompleted: Boolean(payload.onboardingCompleted),
    lastActiveAt: new Date(),
  });

  return publicUser(user);
}

async function loginPhoneAccount(phoneInput, password) {
  let phone;
  try {
    phone = normalizePhone(phoneInput);
  } catch (_) {
    throw new AppError(400, "Invalid phone number");
  }

  const user = await User.findOne({ phone });
  assertPhoneLoginCompatible(user);
  if (!user || !verifyPassword(password, user.passwordHash)) {
    throw new AppError(401, "Invalid phone or password");
  }

  user.lastActiveAt = new Date();
  await user.save();
  return publicUser(user);
}

async function loginPhoneWithOtp(payload = {}) {
  let phone;
  try {
    phone = normalizePhone(payload.phone);
  } catch (_) {
    throw new AppError(400, "Invalid phone number");
  }

  const consumed = await consumeVerifiedOtp({
    phone,
    purpose: String(payload.purpose || "LOGIN").trim().toUpperCase(),
    verificationId: payload.verificationId,
    verificationToken: payload.verificationToken,
  });
  if (!consumed) {
    throw new AppError(400, "OTP verification is invalid or expired");
  }

  const user = await User.findOne({ phone });
  if (!user) {
    throw new AppError(404, "Account not found for this phone number");
  }
  user.lastActiveAt = new Date();
  if (!user.isPhoneVerified) {
    user.isPhoneVerified = true;
  }
  await user.save();
  return publicUser(user);
}

async function completeOnboarding(payload = {}) {
  const userId = String(payload.userId || "").trim();
  if (!userId) {
    throw new AppError(400, "User id is required");
  }

  const user = await User.findById(userId);
  if (!user) {
    throw new AppError(404, "Account not found");
  }

  const displayName = normalizeDisplayName(payload.displayName);
  if (displayName) user.displayName = displayName;
  user.age = normalizeAge(payload.age);
  user.city = normalizeOptionalString(payload.city);
  user.headline = normalizeOptionalString(payload.headline);
  user.bio = normalizeOptionalString(payload.bio);
  user.interests = normalizeInterests(payload.interests);
  user.imageUrls = normalizeImageUrls(payload.imageUrls);
  user.avatarUrl = user.imageUrls[0] || user.avatarUrl || "";
  user.latitude = payload.latitude ?? null;
  user.longitude = payload.longitude ?? null;
  user.onboardingCompleted = true;
  user.lastActiveAt = new Date();
  await user.save();

  return publicUser(user);
}

module.exports = {
  AppError,
  completeOnboarding,
  loginAccount,
  loginPhoneAccount,
  loginPhoneWithOtp,
  loginWithGoogle,
  registerAccount,
  registerPhoneAccount,
  requestOtp,
  verifyOtp,
};
