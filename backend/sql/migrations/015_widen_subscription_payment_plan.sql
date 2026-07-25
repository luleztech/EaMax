-- Widen subscription_payments.plan so custom / offer slugs are not truncated.
-- Truncated plan keys previously broke repairCompletedPaymentsMissingPremium.

ALTER TABLE subscription_payments
  ALTER COLUMN plan TYPE VARCHAR(64);
