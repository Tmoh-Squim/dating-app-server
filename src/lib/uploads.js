const fs = require("fs");
const path = require("path");
const multer = require("multer");
const { publicBaseUrl, uploadDir } = require("../config");

const absoluteUploadDir = path.resolve(uploadDir);
const profileUploadDir = path.join(absoluteUploadDir, "profiles");

fs.mkdirSync(profileUploadDir, { recursive: true });

function sanitizeFilename(value) {
  return String(value || "file")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "file";
}

const storage = multer.diskStorage({
  destination: (_request, _file, callback) => {
    callback(null, profileUploadDir);
  },
  filename: (request, file, callback) => {
    const extension = path.extname(file.originalname || "").toLowerCase() || ".jpg";
    const basename = path.basename(file.originalname || "image", extension);
    const userId = sanitizeFilename(request.params.userId || request.body.userId || "guest");
    const timestamp = Date.now();
    callback(null, `${userId}-${timestamp}-${sanitizeFilename(basename)}${extension}`);
  },
});

function fileFilter(_request, file, callback) {
  if (!file.mimetype?.startsWith("image/")) {
    callback(new Error("Only image uploads are allowed"));
    return;
  }
  callback(null, true);
}

const profileImageUpload = multer({
  storage,
  fileFilter,
  limits: {
    files: 6,
    fileSize: 8 * 1024 * 1024,
  },
});

function normalizePublicBaseUrl() {
  return String(publicBaseUrl || "").trim().replace(/\/+$/, "");
}

function buildPublicUploadUrl(filePath) {
  const relativePath = path.relative(absoluteUploadDir, filePath).split(path.sep).join("/");
  return `${normalizePublicBaseUrl()}/uploads/${relativePath}`;
}

function getUploadPathFromUrl(fileUrl) {
  const base = normalizePublicBaseUrl();
  const uploadPrefix = `${base}/uploads/`;
  if (!fileUrl || !fileUrl.startsWith(uploadPrefix)) {
    return null;
  }
  const relativePath = fileUrl.slice(uploadPrefix.length).replace(/\//g, path.sep);
  const resolved = path.resolve(absoluteUploadDir, relativePath);
  if (!resolved.startsWith(absoluteUploadDir)) {
    return null;
  }
  return resolved;
}

function deleteLocalUploadByUrl(fileUrl) {
  const filePath = getUploadPathFromUrl(fileUrl);
  if (!filePath) return false;
  if (!fs.existsSync(filePath)) return false;
  fs.unlinkSync(filePath);
  return true;
}

module.exports = {
  absoluteUploadDir,
  buildPublicUploadUrl,
  deleteLocalUploadByUrl,
  profileImageUpload,
};
