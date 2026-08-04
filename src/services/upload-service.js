const User = require("../models/User");
const { buildPublicUploadUrl, deleteLocalUploadByUrl } = require("../lib/uploads");
const { AppError } = require("./auth-service");
const { attachCallRecording } = require("./call-service");

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

async function uploadVoiceNote({ userId, file, durationSeconds = 0 }) {
  const normalizedUserId = String(userId || "").trim();
  if (!normalizedUserId) {
    throw new AppError(400, "User id is required");
  }

  const user = await User.findById(normalizedUserId);
  if (!user) {
    if (file?.path) {
      deleteLocalUploadByUrl(buildPublicUploadUrl(file.path));
    }
    throw new AppError(404, "Account not found");
  }

  if (!file?.path) {
    throw new AppError(400, "Select a voice note to upload");
  }

  const mediaDurationSeconds = Math.max(0, Number(durationSeconds) || 0);
  user.lastActiveAt = new Date();
  await user.save();

  return {
    userId: user._id,
    voiceNoteUrl: buildPublicUploadUrl(file.path),
    mediaDurationSeconds,
  };
}

async function uploadCallRecording({ callId, file, kind, mimeType, durationSeconds = 0 }) {
  try {
    const call = await attachCallRecording({
      callId,
      file,
      kind,
      mimeType,
      durationSeconds,
      buildPublicUploadUrl,
    });

    return {
      callId: call.id,
      recordingStatus: call.recordingStatus,
      recordings: call.recordings.map(recording => ({
        kind: recording.kind,
        url: recording.url,
        mimeType: recording.mimeType || "",
        durationSeconds: Number(recording.durationSeconds || 0),
      })),
    };
  } catch (error) {
    if (error.message === "Call session not found") {
      if (file?.path) {
        deleteLocalUploadByUrl(buildPublicUploadUrl(file.path));
      }
      throw new AppError(404, "Call session not found");
    }
    if (error.message === "Select a call recording to upload") {
      throw new AppError(400, error.message);
    }
    throw error;
  }
}

module.exports = {
  removeProfileImages,
  uploadCallRecording,
  uploadProfileImages,
  uploadVoiceNote,
  toBoolean,
};
