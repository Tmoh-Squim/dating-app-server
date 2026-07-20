function normalizePhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return "";

  if (digits.startsWith("254") && digits.length === 12) return digits;
  if (digits.startsWith("263") && digits.length === 12) return digits;
  if (digits.startsWith("0") && digits.length === 10) return `254${digits.slice(1)}`;
  if (digits.length === 9) return `254${digits}`;

  throw new Error("Invalid phone number");
}

function formatPhone(phone) {
  const normalized = normalizePhone(phone);
  return `+${normalized}`;
}

module.exports = {
  normalizePhone,
  formatPhone,
};
