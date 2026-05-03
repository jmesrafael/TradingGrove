-- ─────────────────────────────────────────────────────────────────────────────
-- Profiles RLS + subscription field protection
--
-- Goals:
--   1. Enable RLS so unauthenticated callers cannot read profiles at all.
--   2. Let authenticated users read and update only their own row.
--   3. Block direct writes to subscription/billing fields from the client.
--      Only service-role callers (edge functions) may change these fields.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Drop any stale policies before re-creating so this migration is idempotent
DROP POLICY IF EXISTS "profiles_select_own"  ON profiles;
DROP POLICY IF EXISTS "profiles_update_own"  ON profiles;

-- Users can only read their own row
CREATE POLICY "profiles_select_own" ON profiles
  FOR SELECT USING (auth.uid() = id);

-- Users can update their own row (trigger below silently reverts protected columns)
CREATE POLICY "profiles_update_own" ON profiles
  FOR UPDATE
  USING     (auth.uid() = id)
  WITH CHECK (auth.uid() = id);


-- ── Trigger: protect subscription fields ──────────────────────────────────────
-- When an authenticated (non-service-role) caller tries to UPDATE protected
-- columns, this trigger silently reverts them to their current values.
-- Service-role callers (Stripe webhook, edge functions) are unaffected because
-- they use the service_role JWT claim, which is checked via request.jwt.claims.

CREATE OR REPLACE FUNCTION protect_subscription_fields()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  caller_role text;
BEGIN
  -- Read the role from the PostgREST JWT claims; default to 'authenticated'
  -- if the header is absent (belt-and-suspenders for direct DB access).
  caller_role := coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::json->>'role',
    'authenticated'
  );

  IF caller_role != 'service_role' THEN
    -- Revert all subscription / billing fields to their stored values
    NEW.plan                    := OLD.plan;
    NEW.plan_type               := OLD.plan_type;
    NEW.subscription_expires_at := OLD.subscription_expires_at;
    NEW.stripe_customer_id      := OLD.stripe_customer_id;
    NEW.stripe_subscription_id  := OLD.stripe_subscription_id;
    NEW.referred_by             := OLD.referred_by;
    NEW.referral_code           := OLD.referral_code;
    NEW.referral_count          := OLD.referral_count;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_subscription_fields_trigger ON profiles;
CREATE TRIGGER protect_subscription_fields_trigger
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION protect_subscription_fields();
