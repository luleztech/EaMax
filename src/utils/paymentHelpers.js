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
    'USERCANCELLED',
    'USER_CANCELLED',
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
  if (response.paymentVerified === false) return false;

  const status = String(response.status || '').toUpperCase().trim();
  const pending = !status || [
    'PENDING', 'PROCESSING', 'INPROGRESS', 'IN_PROGRESS', 'UNKNOWN',
    'INITIATED', 'WAITING', 'SUCCESS', 'OK',
  ].includes(status);
  const failed = [
    'FAILED', 'CANCELLED', 'CANCELED', 'REJECTED', 'DECLINED', 'EXPIRED',
    'TIMEOUT', 'ERROR', 'USERCANCELLED', 'USER_CANCELLED', 'VOID',
  ].includes(status) || /INSUFFICIENT|NO_BALANCE|NO_FUNDS|LOW_BALANCE/.test(status);
  if (pending || failed) return false;

  const user = userPayloadFromPaymentResponse(response);
  const userPremium = !!(user && resolvePremiumFromUserData(user).premium);
  if (!userPremium) return false;

  const granted = response.premiumGranted === true || response.premium_granted === true;
  return granted || status === 'COMPLETED' || status === 'PAID' || status === 'SUCCESSFUL';
};
