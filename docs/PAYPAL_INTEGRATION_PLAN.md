# PayPal Integration Plan — TradingGrove

> Generated: 2026-05-11  
> Status: Living document — update STATUS markers as SQL runs and code ships

---

## Section 1: Current Progress Summary

### Stripe — What's Working (reference implementation)

| Feature | File | Status |
|---|---|---|
| Checkout session creation | `supabase/functions/create-checkout/index.ts` | COMPLETE |
| Webhook handler (all events) | `supabase/functions/stripe-webhook/index.ts` | COMPLETE |
| Referral reward trigger | `supabase/functions/grant-referral-reward/index.ts` | COMPLETE (HTTP POST from stripe-webhook) |
| Apply referral on signup | `supabase/functions/apply-referral/index.ts` | COMPLETE |
| Billing portal | `supabase/functions/billing-portal/index.ts` | COMPLETE (with referral-Pro branch) |
| Plan enforcement trigger | `protect_subscription_fields_trigger` on `profiles` | COMPLETE |
| Frontend gateway selector | `src/payment-method.html` + `payment-method.js` | COMPLETE (both Stripe and PayPal cards exist) |

### PayPal — Current State

| Feature | File | Status |
|---|---|---|
| Subscription creation (PayPal API call + approval URL) | `create-paypal-subscription/index.ts` | COMPLETE |
| Capture/confirm step after user approves | N/A — PayPal handles server-to-server | N/A |
| Webhook handler (event routing) | `paypal-webhook/index.ts` | COMPLETE |
| **Webhook signature verification** | `paypal-webhook/index.ts` | **NOT STARTED — security gap** |
| BILLING.SUBSCRIPTION.ACTIVATED handler | `paypal-webhook/index.ts` | COMPLETE (logic correct) |
| BILLING.SUBSCRIPTION.RE-ACTIVATED handler | `paypal-webhook/index.ts` | COMPLETE |
| BILLING.SUBSCRIPTION.RENEWED handler | `paypal-webhook/index.ts` | COMPLETE |
| BILLING.SUBSCRIPTION.CANCELLED handler | `paypal-webhook/index.ts` | COMPLETE |
| BILLING.SUBSCRIPTION.EXPIRED handler | `paypal-webhook/index.ts` | COMPLETE |
| BILLING.SUBSCRIPTION.SUSPENDED handler | `paypal-webhook/index.ts` | PARTIAL — missing `plan_type='none'` |
| BILLING.SUBSCRIPTION.PAYMENT.FAILED handler | `paypal-webhook/index.ts` | PARTIAL — missing `plan_type='none'` |
| Referral reward | `paypal-webhook/index.ts` | PARTIAL — inline duplicate logic (diverges from canonical `grant-referral-reward`) |
| DB column: `paypal_subscription_id` | `profiles` table | EXISTS |
| DB column: `payment_gateway` | `profiles` table | **MISSING** |
| Frontend gateway selector UI | `src/payment-method.html` | COMPLETE |
| Frontend PayPal billing portal link | `src/js/modules/subscription.js` | COMPLETE (links to paypal.com/myaccount/autopay/) |

---

## Section 2: How Stripe Works — Full Reference Record

This section is the permanent reference record for replicating the Stripe integration in any future payment gateway.

### 2.1 Subscription Creation Flow (user click → DB write)

1. User clicks "Credit or Debit Card" on `payment-method.html`
2. `payWithStripe()` in `payment-method.js` calls `POST /functions/v1/create-checkout` with `{ lookup_key: "tradinggrove_pro_monthly" | "tradinggrove_pro_annual" }`
3. `create-checkout/index.ts` executes:
   - Validates JWT via `GET ${SUPABASE_URL}/auth/v1/user`
   - Reads `profiles` for `plan`, `stripe_customer_id`, `subscription_expires_at`, `plan_type`
   - Returns 400 if `plan='pro'` AND (`plan_type='lifetime'` OR `subscription_expires_at` is future)
   - If `stripe_customer_id` is null: creates Stripe customer with `email` + `metadata.supabase_user_id`; immediately PATCH `profiles SET stripe_customer_id=? WHERE id=?` (saves before session creation so invoice webhooks can resolve the user)
   - Creates Stripe Checkout Session with:
     - `customer = stripe_customer_id`
     - `client_reference_id = userId` (webhook fallback #2)
     - `mode = subscription`
     - `line_items[0].price` = from hardcoded `PRICE_MAP` object (not env vars)
     - `metadata.supabase_user_id = userId` (webhook fallback #1)
     - `metadata.plan_type = "monthly" | "yearly"`
     - `metadata.lookup_key = "tradinggrove_pro_monthly" | "tradinggrove_pro_annual"`
     - `allow_promotion_codes = true`
     - `success_url = ${APP_URL}/subscription?upgraded=1`
     - `cancel_url = ${APP_URL}/subscription?cancelled=1`
   - Returns `{ url: stripeCheckoutSessionUrl }`
4. Frontend redirects to Stripe's hosted checkout
5. On completion, Stripe fires `checkout.session.completed` → stripe-webhook upgrades profile

### 2.2 Webhook Event Map

| Event | Handler Action | DB Writes | Guard Logic |
|---|---|---|---|
| `checkout.session.completed` | Upgrade to Pro; trigger referral reward if upgrade succeeds | `plan='pro'`, `plan_type`, `stripe_customer_id`, `stripe_subscription_id`, `subscription_expires_at` | Resolves `userId` via 3-tier fallback: `metadata.supabase_user_id` → `client_reference_id` → email lookup via `listUsers()`. Referral only fires if `upgradeUserToPro()` returns `true` |
| `invoice.payment_succeeded` | Upgrade/renew Pro | Same columns; if renewal branch: update WHERE `stripe_customer_id=?` (skips `stripe_customer_id` rewrite). If new-sub branch: resolves user then upgrades | Skips if `sub.status` not `active` or `trialing`. Does NOT trigger referral reward (only `checkout.session.completed` does) |
| `customer.subscription.updated` | Update plan status (active or inactive) | `plan`, `plan_type`, `subscription_expires_at`, `stripe_subscription_id` | Referral-extension guard: if stored `subscription_expires_at` > Stripe's computed expiry, keeps the longer value |
| `customer.subscription.deleted` | Downgrade to free | `plan='free'`, `plan_type='none'`, `stripe_subscription_id=null`, `subscription_expires_at=null` | None — unconditional |
| `invoice.payment_failed` | Log only — no DB write | None | Explicitly defers to Stripe retry logic; `customer.subscription.deleted` fires if all retries exhausted |

### 2.3 Referral Reward Flow

- **Trigger:** `checkout.session.completed` only, and only if `upgradeUserToPro()` returns `true`
- **Invocation:** HTTP POST from `stripe-webhook` to `${SUPABASE_URL}/functions/v1/grant-referral-reward` with header `Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}` and body `{ referred_user_id: userId }`
- **Idempotency guard:** `grant-referral-reward` checks `referrals.reward_granted === true` at Step 2 — skips if already rewarded. This is the only deduplication; there is no event-ID deduplication in the webhook.
- **DB writes in `grant-referral-reward`:**
  - `referrals SET status='rewarded', reward_granted=true WHERE id=referral.id`
  - `profiles SET plan='pro', plan_type=<keep or 'monthly'>, subscription_expires_at=<base+30d capped>, referral_count=referral_count+1 WHERE id=referrer_id`
- **Expiry capping logic:** `baseDate = referrer.subscription_expires_at` if set, else `now`. `baseDate` is capped to `now + 30 days`. `newExpiry = baseDate + 30 days`. Maximum possible reward: `now + 60 days`.
- **Critical bug for PayPal:** Step 0 of `grant-referral-reward` checks `stripe_subscription_id IS NOT NULL`. PayPal subscribers never have this field set, so they always hit `{ skipped: true, reason: "referred_user_not_paid" }`. This guard must be fixed.

### 2.4 apply-referral vs grant-referral-reward

| | `apply-referral` | `grant-referral-reward` |
|---|---|---|
| **When called** | At signup, when user submits a referral code | At first successful payment |
| **DB writes** | `profiles SET referred_by=referrer.id`; `referrals INSERT (status='pending', reward_granted=false)` | `referrals SET status='rewarded', reward_granted=true`; `profiles SET plan='pro', referral_count+1` for referrer |
| **Who calls it** | Frontend (user submits referral code form) | `stripe-webhook` via HTTP POST; `paypal-webhook` via inline function |
| **PayPal needs it** | No change — already fires at signup for all users | Yes — but Stripe-only guard must be removed first |

### 2.5 Plan Enforcement

- `protect_subscription_fields_trigger` (BEFORE UPDATE on `profiles`) silently reverts the following columns to `OLD` values if the caller is not `service_role`:
  `plan`, `plan_type`, `subscription_expires_at`, `stripe_customer_id`, `stripe_subscription_id`, `referred_by`, `referral_code`, `referral_count`
- `paypal_subscription_id` is NOT currently in the guard list — a client can overwrite it
- `payment_gateway` does not exist yet — must be added to the guard list when created
- All edge functions use `SUPABASE_SERVICE_ROLE_KEY` so the trigger allows their writes

### 2.6 Security Model

| Column | Protection |
|---|---|
| `plan`, `plan_type`, `subscription_expires_at` | Trigger guard (non-service_role reverted) |
| `stripe_customer_id`, `stripe_subscription_id` | Trigger guard |
| `referred_by`, `referral_code`, `referral_count` | Trigger guard |
| `paypal_subscription_id` | **No trigger protection** — RLS only; fix needed |
| `payment_gateway` | Column does not exist yet |

---

## Section 3: Shared Logic Architecture

### 3.1 Current State

The `supabase/functions/_shared/` folder **does not exist**. Every function is self-contained with no shared utilities. The two webhook handlers implement overlapping logic independently:

**Plan upgrade/downgrade:**
- `stripe-webhook` has `upgradeUserToPro()` and inline downgrade logic
- `paypal-webhook` has inline upgrade/downgrade logic
- These are functionally identical but separately maintained — drift risk

**Referral reward:**
- `stripe-webhook` calls `grant-referral-reward` via HTTP (correct, deployed function)
- `paypal-webhook` has an inline `grantReferralReward()` that:
  - Uses different expiry capping (no `maxBase` clamping — referrers with years of time get +30d from that far-future date)
  - Uses `supabase.rpc('increment_referral_count')` instead of inline `referral_count + 1`
  - Does NOT call the deployed `grant-referral-reward` function at all
  - Has divergent behavior that will produce different results for the same scenario

### 3.2 Target: `supabase/functions/_shared/`

Create this folder with two files:

#### `supabase/functions/_shared/plan-utils.ts`

```typescript
import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export async function upgradePlan(
  userId: string,
  planType: "monthly" | "yearly" | "lifetime",
  expiresAt: string | null,
  gateway: "stripe" | "paypal",
  gatewaySubscriptionId: string,
  stripeCustomerId: string | null,
  supabase: SupabaseClient
): Promise<boolean> {
  const update: Record<string, unknown> = {
    plan: "pro",
    plan_type: planType,
    subscription_expires_at: expiresAt,
    payment_gateway: gateway,
    stripe_subscription_id: gateway === "stripe" ? gatewaySubscriptionId : null,
    paypal_subscription_id: gateway === "paypal" ? gatewaySubscriptionId : null,
  };
  if (stripeCustomerId) update.stripe_customer_id = stripeCustomerId;

  const { error } = await supabase
    .from("profiles")
    .update(update)
    .eq("id", userId);

  if (error) { console.error("upgradePlan error:", error); return false; }
  return true;
}

export async function downgradePlan(
  userId: string,
  gateway: "stripe" | "paypal",
  supabase: SupabaseClient
): Promise<boolean> {
  const update: Record<string, unknown> = {
    plan: "free",
    plan_type: "none",
    subscription_expires_at: null,
    stripe_subscription_id: gateway === "stripe" ? null : undefined,
    paypal_subscription_id: gateway === "paypal" ? null : undefined,
  };

  const { error } = await supabase
    .from("profiles")
    .update(update)
    .eq("id", userId);

  if (error) { console.error("downgradePlan error:", error); return false; }
  return true;
}

export async function getUserBySubscriptionId(
  gateway: "stripe" | "paypal",
  subscriptionId: string,
  supabase: SupabaseClient
) {
  const column = gateway === "stripe" ? "stripe_subscription_id" : "paypal_subscription_id";
  const { data, error } = await supabase
    .from("profiles")
    .select("id, plan, plan_type, referred_by, subscription_expires_at")
    .eq(column, subscriptionId)
    .maybeSingle();
  if (error) console.error("getUserBySubscriptionId error:", error);
  return data;
}
```

#### `supabase/functions/_shared/referral-utils.ts`

```typescript
import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const REWARD_DAYS = 30;

export async function grantReferralReward(
  referredUserId: string,
  supabase: SupabaseClient
): Promise<{ skipped: boolean; reason?: string } | { success: true }> {
  // Find the pending referral row
  const { data: referral, error: refErr } = await supabase
    .from("referrals")
    .select("id, referrer_id, reward_granted")
    .eq("referred_user_id", referredUserId)
    .maybeSingle();

  if (refErr || !referral) return { skipped: true, reason: "no_referral_found" };
  if (referral.reward_granted) return { skipped: true, reason: "already_rewarded" };

  // Read referrer profile
  const { data: referrer } = await supabase
    .from("profiles")
    .select("id, plan, plan_type, subscription_expires_at, referral_count")
    .eq("id", referral.referrer_id)
    .single();

  if (!referrer) return { skipped: true, reason: "referrer_not_found" };

  // Calculate expiry with capping (canonical logic from grant-referral-reward)
  const now = new Date();
  const maxBase = new Date(now.getTime() + REWARD_DAYS * 86400000);
  let baseDate = referrer.subscription_expires_at
    ? new Date(referrer.subscription_expires_at)
    : now;
  if (baseDate > maxBase) baseDate = maxBase; // cap
  const newExpiry = new Date(baseDate.getTime() + REWARD_DAYS * 86400000);

  // Upgrade referrer
  await supabase.from("profiles").update({
    plan: "pro",
    plan_type: referrer.plan_type === "none" ? "monthly" : referrer.plan_type,
    subscription_expires_at: newExpiry.toISOString(),
    referral_count: (referrer.referral_count || 0) + 1,
  }).eq("id", referral.referrer_id);

  // Mark referral rewarded
  await supabase.from("referrals").update({
    status: "rewarded",
    reward_granted: true,
  }).eq("id", referral.id);

  return { success: true };
}
```

### 3.3 Before/After for Each Webhook

**BEFORE (current):**

```
stripe-webhook:
  upgradeUserToPro() — inline, writes plan/plan_type/stripe cols
  triggerReferralReward() — HTTP POST to grant-referral-reward function

paypal-webhook:
  inline upgrade writes — no shared function
  inline grantReferralReward() — local function, different capping, different referral_count method
```

**AFTER (target):**

```
stripe-webhook:
  import { upgradePlan, downgradePlan } from "../_shared/plan-utils.ts"
  import { grantReferralReward } from "../_shared/referral-utils.ts"
  → parse Stripe event → call shared functions

paypal-webhook:
  import { upgradePlan, downgradePlan } from "../_shared/plan-utils.ts"
  import { grantReferralReward } from "../_shared/referral-utils.ts"
  → parse PayPal event → call same shared functions

grant-referral-reward (HTTP endpoint):
  → wraps _shared/referral-utils.grantReferralReward()
  → remove the stripe_subscription_id guard from Step 0
```

### 3.4 Shared Logic Audit Table

| Logic | Currently In | Should Be In | Action |
|---|---|---|---|
| Plan upgrade writes | `stripe-webhook` inline `upgradeUserToPro()` | `_shared/plan-utils.upgradePlan()` | Extract; update both webhooks |
| Plan downgrade writes | `stripe-webhook` inline | `_shared/plan-utils.downgradePlan()` | Extract; update both webhooks |
| Referral reward | `grant-referral-reward` (HTTP) + `paypal-webhook` (inline duplicate) | `_shared/referral-utils.grantReferralReward()` | Extract canonical logic; remove paypal-webhook inline |
| User lookup by subscription ID | Ad-hoc in each webhook | `_shared/plan-utils.getUserBySubscriptionId()` | Extract |
| Subscription status validation | Inline per event in each handler | Per-gateway (field shapes differ) | Keep in each webhook |

---

## Section 4: PayPal Implementation Plan — Gaps to Fill

### Phase 1 — Environment & SDK Setup

| Variable | Referenced In | Status | Action |
|---|---|---|---|
| `PAYPAL_CLIENT_ID` | `create-paypal-subscription` | Confirm set | Verify in Supabase secrets |
| `PAYPAL_CLIENT_SECRET` | `create-paypal-subscription` | Confirm set | Also add to `paypal-webhook` for signature verification |
| `PAYPAL_WEBHOOK_ID` | Not currently read | **Not set** | Add to `paypal-webhook`; set in Supabase secrets |
| `PAYPAL_MONTHLY_PLAN_ID` | `create-paypal-subscription` | Confirm set | Verify |
| `PAYPAL_ANNUAL_PLAN_ID` | `create-paypal-subscription` | Confirm set | Verify |
| `PAYPAL_MODE` | Not referenced | **Not set** | Add `sandbox`/`live` toggle; set in Supabase secrets |

### Phase 2 — Database Changes

```sql
-- STATUS: NOT RUN
-- Add explicit payment_gateway column
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS payment_gateway text
  CHECK (payment_gateway IN ('stripe', 'paypal'));
```

```sql
-- STATUS: NOT RUN
-- Index for PayPal webhook lookups (webhook queries profiles WHERE paypal_subscription_id = ?)
CREATE INDEX IF NOT EXISTS idx_profiles_paypal_subscription_id
  ON public.profiles (paypal_subscription_id)
  WHERE paypal_subscription_id IS NOT NULL;
```

```sql
-- STATUS: NOT RUN
-- Index for payment_gateway queries
CREATE INDEX IF NOT EXISTS idx_profiles_payment_gateway
  ON public.profiles (payment_gateway)
  WHERE payment_gateway IS NOT NULL;
```

```sql
-- STATUS: ALREADY RUN — paypal_subscription_id column exists (confirmed by create-paypal-subscription writes and paypal-webhook reads)
-- paypal_subscription_id text column in profiles: EXISTS
```

```sql
-- STATUS: NOT RUN
-- Extend protect_subscription_fields() trigger to guard paypal_subscription_id and payment_gateway
-- Current trigger file: supabase/migrations/2026-04-30_profiles_rls_subscription_protection.sql
-- Replace the function body:

CREATE OR REPLACE FUNCTION public.protect_subscription_fields()
  RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
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
    NEW.paypal_subscription_id  := OLD.paypal_subscription_id;   -- ADD
    NEW.payment_gateway         := OLD.payment_gateway;           -- ADD
    NEW.referred_by             := OLD.referred_by;
    NEW.referral_code           := OLD.referral_code;
    NEW.referral_count          := OLD.referral_count;
  END IF;
  RETURN NEW;
END;
$$;
```

### Phase 3 — create-paypal-subscription Gaps

| Item | Status | Change Needed |
|---|---|---|
| PayPal Subscriptions API call | COMPLETE | None |
| Approval URL returned to frontend | COMPLETE | None |
| Capture/confirm step | N/A | None |
| `custom_id = userId` passed to PayPal | COMPLETE | None |
| Plan type passed correctly | COMPLETE | None |
| `payment_gateway='paypal'` written to profile | **MISSING** | Add `payment_gateway: 'paypal'` to the PATCH that saves `paypal_subscription_id` |
| `PAYPAL_MODE` / sandbox toggle | **MISSING** | Read `PAYPAL_MODE` env var; switch API base URL between `api-m.sandbox.paypal.com` and `api-m.paypal.com` |
| Referral info passed to PayPal | N/A — not needed | None (webhook uses DB lookup via `paypal_subscription_id`) |

### Phase 4 — paypal-webhook Gaps

#### 4.1 Add PayPal Webhook Signature Verification (SECURITY — must fix first)

PayPal provides a verification endpoint. Call it before processing any event:

```
POST https://api-m.paypal.com/v1/notifications/verify-webhook-signature
Authorization: Basic base64(PAYPAL_CLIENT_ID:PAYPAL_CLIENT_SECRET)
Content-Type: application/json

{
  "auth_algo":         <PayPal-Auth-Algo header>,
  "cert_url":          <PayPal-Cert-Url header>,
  "transmission_id":   <PayPal-Transmission-Id header>,
  "transmission_sig":  <PayPal-Transmission-Sig header>,
  "transmission_time": <PayPal-Transmission-Time header>,
  "webhook_id":        <PAYPAL_WEBHOOK_ID env var>,
  "webhook_event":     <parsed JSON body>
}
```

If response body `{ verification_status }` is not `"SUCCESS"` → return HTTP 400.

Required new env vars: `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID`

#### 4.2 Replace Inline Referral Logic with Shared Utility

Remove the entire inline `grantReferralReward` function at the bottom of `paypal-webhook/index.ts`.  
Replace the call site with:

```typescript
import { grantReferralReward } from "../_shared/referral-utils.ts";

// In BILLING.SUBSCRIPTION.ACTIVATED handler:
if (profile.referred_by) {
  await grantReferralReward(profile.id, supabase);
}
```

#### 4.3 Fix SUSPENDED and PAYMENT.FAILED Handlers

Current (missing `plan_type`):
```typescript
{ plan: "free", subscription_expires_at: now.toISOString() }
```

Corrected:
```typescript
{ plan: "free", plan_type: "none", subscription_expires_at: now.toISOString() }
```

#### 4.4 Fix grant-referral-reward Stripe-Only Guard

In `supabase/functions/grant-referral-reward/index.ts`, Step 0 currently:
```typescript
if (profile.plan !== "pro" || !profile.stripe_subscription_id) {
  return { skipped: true, reason: "referred_user_not_paid" };
}
```

Replace with gateway-agnostic check:
```typescript
if (profile.plan !== "pro") {
  return { skipped: true, reason: "referred_user_not_paid" };
}
```

Or ideally, refactor this function to be a thin wrapper around `_shared/referral-utils.grantReferralReward()`.

### Phase 5 — Frontend

**No new frontend work is needed.**

`payment-method.html` already has both Stripe and PayPal cards. The routing in `payment-method.js` is:
```javascript
function payWithStripe()  { /* POST /functions/v1/create-checkout */ }
function payWithPayPal()  { /* POST /functions/v1/create-paypal-subscription */ }
```

To add a future third gateway: add one card to `payment-method.html` and one function in `payment-method.js`. Nothing else changes.

---

## Section 5: SQL Queries — Full Reference

### GROUP A — Schema Changes

```sql
-- STATUS: NOT RUN
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS payment_gateway text
  CHECK (payment_gateway IN ('stripe', 'paypal'));
```

### GROUP B — Index Creation

```sql
-- STATUS: NOT RUN
CREATE INDEX IF NOT EXISTS idx_profiles_paypal_subscription_id
  ON public.profiles (paypal_subscription_id)
  WHERE paypal_subscription_id IS NOT NULL;

-- STATUS: NOT RUN
CREATE INDEX IF NOT EXISTS idx_profiles_payment_gateway
  ON public.profiles (payment_gateway)
  WHERE payment_gateway IS NOT NULL;

-- STATUS: ALREADY RUN — stripe_customer_id used in webhook WHERE clauses (implied index exists or Postgres scans are acceptable at current user count)
-- Verify with: SELECT indexname FROM pg_indexes WHERE tablename='profiles' AND indexdef ILIKE '%stripe_customer_id%';
```

### GROUP C — Trigger Review and Fixes

**Existing trigger (confirmed):** `protect_subscription_fields_trigger` on `public.profiles`, BEFORE UPDATE  
**Location:** `supabase/migrations/2026-04-30_profiles_rls_subscription_protection.sql`  
**Does it block service_role?** No — trigger explicitly exempts `service_role`  
**Does it block `paypal_subscription_id` writes from non-service_role?** **No** — column absent from revert block

```sql
-- STATUS: NOT RUN
-- Add paypal_subscription_id and payment_gateway to the trigger's revert block
-- Full replacement function body in Phase 2 above
```

**Triggers that do NOT exist** (were queried but absent from codebase):
- `trg_prevent_plan_tampering` — does not exist
- `trg_prevent_sensitive_updates` — does not exist

### GROUP D — RLS Policy Changes

```sql
-- STATUS: REVIEW NEEDED
-- Confirm existing UPDATE policy on profiles does not allow
-- authenticated role to SET payment_gateway or paypal_subscription_id.
-- The trigger fix in Group C handles this once the columns are added to the revert block.
-- If RLS UPDATE policy is broad (allows any column), consider restricting it.
-- Query to check:
SELECT policyname, cmd, qual, with_check
FROM pg_policies
WHERE tablename = 'profiles' AND schemaname = 'public' AND cmd = 'UPDATE';
```

---

## Section 6: Environment Variables — Full Reference

| Variable | Used In | Expose to Frontend? | Status |
|---|---|---|---|
| `STRIPE_SECRET_KEY` | `create-checkout`, `stripe-webhook`, `billing-portal` | No | Confirmed set |
| `STRIPE_WEBHOOK_SECRET` | `stripe-webhook` | No | Confirmed set |
| `SUPABASE_URL` | All functions | No | Auto-set by Supabase runtime |
| `SUPABASE_SERVICE_ROLE_KEY` | All functions | No | Auto-set by Supabase runtime |
| `SUPABASE_ANON_KEY` | `billing-portal` | No | Auto-set by Supabase runtime |
| `APP_URL` | `create-checkout`, `create-paypal-subscription`, `billing-portal` | No | Confirmed (defaults to tradinggrove.vercel.app) |
| Price IDs (Stripe) | Hardcoded in `create-checkout/index.ts` PRICE_MAP | No | Hardcoded — not env vars |
| `PAYPAL_CLIENT_ID` | `create-paypal-subscription`; add to `paypal-webhook` for signature verification | **Yes** — Client ID only (PayPal JS SDK needs it in frontend) | Confirm set in Supabase secrets |
| `PAYPAL_CLIENT_SECRET` | `create-paypal-subscription`; add to `paypal-webhook` | No | Confirm set |
| `PAYPAL_WEBHOOK_ID` | Not currently read — **must add to `paypal-webhook`** | No | **Not set** — must add |
| `PAYPAL_MONTHLY_PLAN_ID` | `create-paypal-subscription` | No | Confirm set |
| `PAYPAL_ANNUAL_PLAN_ID` | `create-paypal-subscription` | No | Confirm set |
| `PAYPAL_MODE` | Not referenced anywhere | No | **Not set** — must add (`sandbox` or `live`) |

---

## Section 7: Testing Checklist

| Test Case | Stripe | PayPal |
|---|---|---|
| New subscription — monthly | Working | To test after gaps closed |
| New subscription — yearly | Working | To test after gaps closed |
| New subscription — lifetime | Working (one-time payment) | N/A (PayPal recurring only) |
| Referral reward on first payment | Working | To test — requires grant-referral-reward guard fix + _shared integration |
| Webhook signature verification | Working | To implement (Phase 4.1) |
| Cancel subscription → plan=free | Working | To test |
| Resubscribe after cancel | Working | To test |
| Plan downgrade on payment failure | Working (subscription.deleted fires after retries) | To test (SUSPENDED/PAYMENT.FAILED handlers) |
| `plan_type` written correctly | Working | Working (set in create-paypal-subscription) |
| `subscription_expires_at` written | Working | Working (set in paypal-webhook) |
| `payment_gateway` column written | After `payment_gateway='stripe'` added | After `payment_gateway='paypal'` added |
| Shared `upgradePlan()` called by both | After refactor | After refactor |
| Shared `downgradePlan()` called by both | After refactor | After refactor |
| Shared `grantReferralReward()` called by both | After refactor | After refactor |
| `protect_subscription_fields` blocks `paypal_subscription_id` tampering | N/A | After SQL trigger fix |
| Billing portal — Stripe users | Working | N/A |
| Billing portal — PayPal users | N/A | Working (links to paypal.com/myaccount/autopay/) |
| Billing portal — referral-Pro users | Working (dashboard#referral redirect) | Same |

---

## Section 8: Future Gateway Checklist

Contract any new gateway must satisfy to reach feature parity:

### Backend

- [ ] Create `supabase/functions/create-{gateway}-subscription/index.ts`
  - Authenticate user via JWT
  - Guard: block if already on active Pro
  - Call gateway API to create subscription
  - Immediately save `{gateway}_subscription_id` and `payment_gateway='{gateway}'` to profiles
  - Return approval/redirect URL to frontend
- [ ] Create `supabase/functions/{gateway}-webhook/index.ts`
  - Implement gateway-specific signature verification
  - Parse gateway event shapes
  - Map events to shared functions:
    - "subscription activated" → `_shared/plan-utils.upgradePlan(userId, planType, expiresAt, '{gateway}', subscriptionId, null, supabase)`
    - "subscription cancelled/expired" → `_shared/plan-utils.downgradePlan(userId, '{gateway}', supabase)`
    - "first activation" → `_shared/referral-utils.grantReferralReward(userId, supabase)`
    - "payment failed" → `downgradePlan()` or implement grace period
  - Do NOT write new referral or plan logic — call the shared functions

### Database

- [ ] `ALTER TABLE profiles ADD COLUMN IF NOT EXISTS {gateway}_subscription_id text;`
- [ ] `CREATE INDEX idx_profiles_{gateway}_subscription_id ON profiles ({gateway}_subscription_id) WHERE {gateway}_subscription_id IS NOT NULL;`
- [ ] `ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_payment_gateway_check; ALTER TABLE profiles ADD CONSTRAINT profiles_payment_gateway_check CHECK (payment_gateway IN ('stripe', 'paypal', '{gateway}'));`
- [ ] Update `protect_subscription_fields()` trigger to revert `{gateway}_subscription_id` for non-service_role callers
- [ ] Add `'{gateway}'` case to `_shared/plan-utils.ts` `getUserBySubscriptionId()` and `upgradePlan()`/`downgradePlan()`

### Frontend (`payment-method.html` / `payment-method.js`)

- [ ] Add one gateway card to the selector UI in `payment-method.html`
- [ ] Add one function `payWith{Gateway}()` in `payment-method.js`
- [ ] No other changes needed

### Referral Parity

- [ ] Identify which event maps to "first payment / subscription activation"
- [ ] Call `_shared/referral-utils.grantReferralReward(userId, supabase)` at that event
- [ ] Do NOT write new referral logic — the shared function handles everything

---

## Implementation Order (Recommended)

| Step | Task | Estimated Time |
|---|---|---|
| 1 | Run SQL: `payment_gateway` column + indexes | 30 min |
| 2 | Run SQL: update `protect_subscription_fields()` trigger | 30 min |
| 3 | Create `supabase/functions/_shared/plan-utils.ts` | 1 hr |
| 4 | Create `supabase/functions/_shared/referral-utils.ts` | 1 hr |
| 5 | Fix `grant-referral-reward/index.ts` — remove Stripe-only guard | 15 min |
| 6 | Refactor `stripe-webhook/index.ts` — use `_shared/`; add `payment_gateway='stripe'` | 1 hr |
| 7 | Fix `paypal-webhook/index.ts` — add signature verification; use `_shared/`; fix SUSPENDED handler | 2 hrs |
| 8 | Fix `create-paypal-subscription/index.ts` — add `payment_gateway='paypal'`; add `PAYPAL_MODE` | 30 min |
| 9 | Set Supabase secrets: `PAYPAL_WEBHOOK_ID`, `PAYPAL_MODE` | 15 min |
| 10 | Deploy all updated functions | 15 min |
| 11 | Test full matrix in PayPal sandbox mode | 2 hrs |
