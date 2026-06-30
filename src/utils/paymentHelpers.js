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

/** True when status or embedded user payload means premium should unlock. */
export const isPaymentSuccessResponse = (response = {}) => {
  const status =
    response.status || response.raw?.data?.[0]?.payment_status || response.raw?.data?.[0]?.status;
  if (isPaymentCompleted(status)) return true;
  const user = userPayloadFromPaymentResponse(response);
  if (user) {
    const { premium } = resolvePremiumFromUserData(user);
    if (premium) return true;
  }
  return false;
};

export const isPaymentStillApplying = (response = {}) => response.applying === true;
