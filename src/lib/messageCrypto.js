const crypto = require("crypto");
const config = require("../config");

const MESSAGE_CIPHER_PREFIX = "enc:v1:";
const MESSAGE_KEY_SOURCE = String(
  config.messageEncryptionKey ||
    "proximo-dev-message-key-change-me",
);
const MESSAGE_KEY = crypto.createHash("sha256").update(MESSAGE_KEY_SOURCE).digest();

function encryptMessageValue(value) {
  const normalized = String(value || "");
  if (!normalized) return "";
  if (normalized.startsWith(MESSAGE_CIPHER_PREFIX)) return normalized;

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", MESSAGE_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(normalized, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${MESSAGE_CIPHER_PREFIX}${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

function decryptMessageValue(value) {
  const normalized = String(value || "");
  if (!normalized) return "";
  if (!normalized.startsWith(MESSAGE_CIPHER_PREFIX)) return normalized;

  const payload = normalized.slice(MESSAGE_CIPHER_PREFIX.length);
  const [ivPart, tagPart, encryptedPart] = payload.split(".");
  if (!ivPart || !tagPart || !encryptedPart) {
    return "";
  }

  try {
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      MESSAGE_KEY,
      Buffer.from(ivPart, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encryptedPart, "base64url")),
      decipher.final(),
    ]);
    return decrypted.toString("utf8");
  } catch (_error) {
    return "";
  }
}

function encryptMessageDocumentFields(fields = {}) {
  return {
    ...fields,
    body: encryptMessageValue(fields.body),
    mediaUrl: encryptMessageValue(fields.mediaUrl),
  };
}

function decryptMessageDocument(message) {
  if (!message) return message;
  return {
    ...message,
    body: decryptMessageValue(message.body),
    mediaUrl: decryptMessageValue(message.mediaUrl),
  };
}

module.exports = {
  decryptMessageDocument,
  decryptMessageValue,
  encryptMessageDocumentFields,
  encryptMessageValue,
  MESSAGE_CIPHER_PREFIX,
};
