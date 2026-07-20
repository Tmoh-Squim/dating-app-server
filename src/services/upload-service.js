const User = require("../models/User");
const { buildPublicUploadUrl, deleteLocalUploadByUrl } = require("../lib/uploads");
const { AppError } = require("./auth-service");

function toBoolean(value) {
  return String(value || "").trim().toLowerCase() === "true";
}

function dedupe(values) {
  return Array.from(new Set((values || []).filter(Boolean)));
}

async function uploadProfileImages({ userId, files = [], replaceAll = false, replaceAvatar = false }) {
  const normalizedUserId = String(userId || "").trim();
  if (!normalizedUserId) {
    throw new AppError(400, "User id is required");
  }

  const user = await User.findById(normalizedUserId);
  if (!user) {
    files.forEach(file => deleteLocalUploadByUrl(buildPublicUploadUrl(file.path)));
    throw new AppError(404, "Account not found");
  }

  if (!Array.isArray(files) || files.length === 0) {
    throw new AppError(400, "Select at least one image to upload");
  }

  const newUrls = files.map(file => buildPublicUploadUrl(file.path));
  const previousUrls = Array.isArray(user.imageUrls) ? [...user.imageUrls] : [];
  const nextUrls = replaceAll ? newUrls : dedupe([...previousUrls, ...newUrls]).slice(0, 6);

  if (replaceAll) {
    previousUrls.forEach(deleteLocalUploadByUrl);
  }

  if (replaceAvatar && user.avatarUrl && user.avatarUrl !== nextUrls[0] && !nextUrls.includes(user.avatarUrl)) {
    deleteLocalUploadByUrl(user.avatarUrl);
  }

  user.imageUrls = nextUrls;
  user.avatarUrl = nextUrls[0] || "";
  user.lastActiveAt = new Date();
  await user.save();

  return {
    userId: user._id,
    avatarUrl: user.avatarUrl,
    imageUrls: user.imageUrls,
    uploaded: newUrls,
    replaceAll,
  };
}

async function removeProfileImages({ userId, imageUrls = [] }) {
  const normalizedUserId = String(userId || "").trim();
  if (!normalizedUserId) {
    throw new AppError(400, "User id is required");
  }

  const user = await User.findById(normalizedUserId);
  if (!user) {
    throw new AppError(404, "Account not found");
  }

  const removalSet = new Set((imageUrls || []).map(value => String(value || "").trim()).filter(Boolean));
  if (removalSet.size === 0) {
    throw new AppError(400, "Select at least one image to remove");
  }

  const currentUrls = Array.isArray(user.imageUrls) ? [...user.imageUrls] : [];
  const nextUrls = currentUrls.filter(url => !removalSet.has(url));

  for (const url of currentUrls) {
    if (removalSet.has(url)) {
      deleteLocalUploadByUrl(url);
    }
  }

  user.imageUrls = nextUrls;
  user.avatarUrl = nextUrls[0] || "";
  user.lastActiveAt = new Date();
  await user.save();

  return {
    userId: user._id,
    avatarUrl: user.avatarUrl,
    imageUrls: user.imageUrls,
  };
}

module.exports = {
  removeProfileImages,
  uploadProfileImages,
  toBoolean,
};
