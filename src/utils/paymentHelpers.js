import { resolvePremiumFromUserData } from './premiumStatus';

const COMPLETED_STATUSES = new Set([
  'COMPLETED',
  'PAID',
  'COMPLETE',
  'SUCCEEDED',
  'APPROVED',
  'SETTLED',
  'CONFIRMED',
  'SUCCESSFUL',
  'COLLECTED',
  'PAYMENT_COMPLETED',
  'TRANSACTION_SUCCESS',
  'PAYMENT_SUCCESS',
]);

export const normalizedPaymentStatus = (status) =>
  String(status || '').toUpperCase().trim();

export const isPaymentCompleted = (status) =>
  COMPLETED_STATUSES.has(normalizedPaymentStatus(status));

export const isPaymentTerminalFailure = (status) => {
  const s = normalizedPaymentStatus(status);
  if (!s) return false;
  return new Set([
    'FAILED',
    'CANCELLED',
    'CANCELED',
    'REJECTED',
    'EXPIRED',
    'DECLINED',
    'VOID',
    'CANCEL',
    'ERROR',
  ]).has(s);
};

export const userPayloadFromPaymentResponse = (response = {}) => {
  const user = response.user;
  return user && typeof user === 'object' ? user : null;
};

/** Keep polling while the server is still applying premium after gateway confirmation. */
export const isPaymentStillApplying = (response = {}) => response.applying === true;

/**
 * True when payment succeeded AND premium is active (or explicitly granted).
 * Never treat gateway COMPLETED alone as unlock — entitlements must be live.
 */
export const isPaymentSuccessResponse = (response = {}) => {
  if (isPaymentStillApplying(response)) return false;

  const user = userPayloadFromPaymentResponse(response);
  if (user) {
    const { premium } = resolvePremiumFromUserData(user);
    if (premium) return true;
  }

  if (response.premiumGranted === true || response.premium_granted === true) {
    return true;
  }

  return false;
};
