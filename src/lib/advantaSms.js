const axios = require("axios");
const https = require("https");
const {
  advantaApiKey,
  advantaBaseUrl,
  advantaPartnerId,
  advantaShortcode,
} = require("../config");

const ipv4HttpsAgent = new https.Agent({
  keepAlive: true,
  family: 4,
});

function normalizeBaseUrl(value) {
  return String(value || "https://quicksms.advantasms.com").trim().replace(/\/+$/, "");
}

function hasRealCredentials() {
  return Boolean(advantaApiKey && advantaPartnerId && advantaShortcode);
}

async function sendOtpMessage({ phone, message }) {
  const mobile = String(phone || "").trim();
  const text = String(message || "").trim();
  if (!mobile || !text) {
    throw new Error("Advanta OTP payload is incomplete");
  }

  if (!hasRealCredentials()) {
    const messageId = `mock-${Date.now()}`;
    console.log(`[advanta/mock] OTP to +${mobile}: ${text}`);
    return {
      providerResponse: { mocked: true },
      messageId,
      networkId: null,
    };
  }

  const response = await axios.post(
    `${normalizeBaseUrl(advantaBaseUrl)}/api/services/sendotp`,
    {
      apikey: advantaApiKey,
      partnerID: advantaPartnerId,
      mobile,
      message: text,
      shortcode: advantaShortcode,
    },
    {
      timeout: 15000,
      headers: { "Content-Type": "application/json" },
      httpsAgent: ipv4HttpsAgent,
      family: 4,
    },
  );

  const primaryResponse = Array.isArray(response.data?.responses)
    ? response.data.responses[0]
    : response.data;
  const responseCode = Number(primaryResponse?.["response-code"] ?? response.data?.["response-code"] ?? 0);
  if (responseCode && responseCode !== 200) {
    throw new Error(primaryResponse?.["response-description"] || "Advanta OTP send failed");
  }

  return {
    providerResponse: response.data,
    messageId: String(primaryResponse?.messageid || ""),
    networkId: primaryResponse?.networkid ?? null,
  };
}

module.exports = {
  sendOtpMessage,
};
