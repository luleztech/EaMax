/**
 * A busy SonicPesa API is not the same thing as one phone already having a
 * USSD prompt. Under a crowd, the API answers 429 / "too many requests".
 * That must be retried. Only a real USSD session on that SIM should wait.
 */

const isPhoneUssdBusyMessage = (rawMessage, rawCode) => {
  const code = String(rawCode ?? '').trim();
  if (code === '103') return true;
  const combined = `${rawMessage || ''} ${rawCode || ''}`.toLowerCase();
  return /too many attempt|too many prompt|attempt limit|ongoing ussd|ussd session|active ussd/i.test(
    combined,
  );
};

const isGatewayBusyFailure = (rawMessage, rawCode, httpStatus) => {
  if (isPhoneUssdBusyMessage(rawMessage, rawCode)) return false;
  const status = Number(httpStatus) || 0;
  if (status === 429 || status === 502 || status === 503 || status === 504) return true;
  const combined = `${rawMessage || ''} ${rawCode || ''}`.toLowerCase();
  return /too many request|rate limit|throttl|temporar(?:y|ily)|timeout|timed out|gateway busy|service unavailable|econnreset|socket hang|\babort(?:ed)?\b/i.test(
    combined,
  );
};

/** Short pause so a burst of checkouts does not retry on the same instant. */
const gatewayBusyRetryDelayMs = (attempt) => {
  const base = attempt <= 1 ? 350 : 800;
  return base + Math.floor(Math.random() * 500);
};

module.exports = {
  isPhoneUssdBusyMessage,
  isGatewayBusyFailure,
  gatewayBusyRetryDelayMs,
};
