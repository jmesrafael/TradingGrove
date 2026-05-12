-- Migration: Add queued subscription support for plan stacking
-- Allows users to upgrade plans immediately while current subscription is active
-- New plan automatically activates when current subscription expires

-- Add queued_subscription column to store pending subscription details
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS queued_subscription JSONB DEFAULT NULL;

-- JSONB structure for queued_subscription:
-- {
--   "plan_type": "yearly" | "monthly",
--   "payment_gateway": "stripe" | "paypal",
--   "subscription_id": "sub_xxxxx" | "I-XXXXX",
--   "starts_at": "2026-06-12T00:00:00Z"
-- }

-- Create index for finding profiles with queued subscriptions
CREATE INDEX IF NOT EXISTS idx_profiles_queued_subscription
  ON public.profiles USING GIN (queued_subscription)
  WHERE queued_subscription IS NOT NULL;

-- Add comment for clarity
COMMENT ON COLUMN public.profiles.queued_subscription IS
'Stores pending subscription that will activate when current subscription expires.
Schema: {plan_type, payment_gateway, subscription_id, starts_at}';
