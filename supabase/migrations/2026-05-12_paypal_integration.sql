-- Add payment_gateway column to track which payment service a subscription uses
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS payment_gateway text
  CHECK (payment_gateway IN ('stripe', 'paypal'));

-- Index for PayPal subscription lookups
CREATE INDEX IF NOT EXISTS idx_profiles_paypal_subscription_id
  ON public.profiles (paypal_subscription_id)
  WHERE paypal_subscription_id IS NOT NULL;

-- Index for payment gateway queries
CREATE INDEX IF NOT EXISTS idx_profiles_payment_gateway
  ON public.profiles (payment_gateway)
  WHERE payment_gateway IS NOT NULL;

-- Update trigger to protect subscription fields including PayPal columns
CREATE OR REPLACE FUNCTION public.protect_subscription_fields()
  RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $
DECLARE
  caller_role text;
BEGIN
  BEGIN
    caller_role := current_setting('request.jwt.claims', true)::jsonb->>'role';
  EXCEPTION WHEN OTHERS THEN
    caller_role := NULL;
  END;

  IF caller_role IS DISTINCT FROM 'service_role' THEN
    NEW.plan                    := OLD.plan;
    NEW.plan_type               := OLD.plan_type;
    NEW.subscription_expires_at := OLD.subscription_expires_at;
    NEW.stripe_customer_id      := OLD.stripe_customer_id;
    NEW.stripe_subscription_id  := OLD.stripe_subscription_id;
    NEW.paypal_subscription_id  := OLD.paypal_subscription_id;
    NEW.payment_gateway         := OLD.payment_gateway;
    NEW.referred_by             := OLD.referred_by;
    NEW.referral_code           := OLD.referral_code;
    NEW.referral_count          := OLD.referral_count;
  END IF;
  RETURN NEW;
END;
$;
