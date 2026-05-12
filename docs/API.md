# API Reference

All endpoints are Supabase Edge Functions hosted at `${SUPABASE_URL}/functions/v1/{function-name}`. Unless stated otherwise, the caller must include the user's session token:

```
Authorization: Bearer ${session.access_token}
Content-Type:  application/json
```

---

## `POST /functions/v1/create-checkout`

Creates a Stripe Checkout session for upgrading to Pro. Reuses existing Stripe customer if the profile already has one. Sets `metadata.supabase_user_id` and `client_reference_id` so the webhook can resolve the user even if a Stripe email differs.

**Request body**
```json
{ "lookup_key": "tradinggrove_pro_monthly" }
// or
{ "lookup_key": "tradinggrove_pro_annual" }
// or
{ "plan": "yearly" }
```

**Response (200)**
```json
{ "url": "https://checkout.stripe.com/c/pay/..." }
```

**Errors:** 401 (no auth header / invalid token) · 400 (already on active Pro plan) · 500 (Stripe API failure)

**Caller:** [`pricing.js:38`](../src/js/modules/pricing.js#L38), [`subscription.js:43`](../src/js/modules/subscription.js#L43)

---

## `POST /functions/v1/billing-portal`

Returns a Stripe Customer Portal URL for managing/cancelling the subscription. If the user is Pro via referral reward (no `stripe_customer_id`), redirects them to the dashboard's referral section instead.

**Request body**
```json
{ "return_url": "https://tradinggrove.com/subscription" }  // optional
```

**Response (200)**
```json
{ "url": "https://billing.stripe.com/p/session/..." }
// OR (referral-Pro user)
{ "url": "https://tradinggrove.com/dashboard#referral",
  "message": "Your Pro access is from referral rewards. ..." }
```

**Errors:** 401 (no auth) · 404 (no profile) · 500 (config error)

**Caller:** [`subscription.js:73`](../src/js/modules/subscription.js#L73)

---

## `POST /functions/v1/delete-account`

Permanently deletes the authenticated user's data and the auth user record itself. Cascade order: `trade_images` → `trades` → `journal_settings` → `custom_notes` → `journals` → `referrals` (both `referrer_id` and `referred_user_id` columns) → `profiles` → `auth.users`.

**Request body:** none

**Response (200)**
```json
{ "success": true }
```

**Errors:** 401 (no/invalid auth) · 500 (auth user deletion failed)

**Caller:** [`profile.js:343`](../src/js/modules/profile.js#L343), [`dashboard.js:206`](../src/js/modules/dashboard.js#L206)

---

## `POST /functions/v1/apply-referral`

Records a referral when a new user signs up with a referral code. Waits up to 4 seconds for the profile-creation trigger to fire, then creates a profile if missing. Validates the code, prevents self-referral, and inserts a row into the `referrals` table with `status='pending'`.

**Request body**
```json
{ "referral_code": "ABC123" }
```

**Response (200)**
```json
{ "success": true }
// OR (idempotent skip)
{ "skipped": true, "reason": "already_referred" }
```

**Errors:** 400 (missing/invalid code, self-referral) · 401 (no auth) · 503 (profile not ready)

**Caller:** [`supabase-client.js:301`](../src/js/lib/supabase-client.js#L301) (on signup)

---

## `POST /functions/v1/grant-referral-reward`

**Internal only.** Grants the referrer +30 days of Pro when the referred user makes their first paid subscription. Verifies the referred user is genuinely Stripe-paid (not free or referral-Pro), preventing referral-Pro chains. Idempotent: returns `{skipped: true}` if already rewarded.

The base for the new expiry is the later of `now` or the referrer's existing expiry, **capped at 30 days from now** so accumulated rewards can't exceed 30 days at a time.

**Auth:** Requires `Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}` — not callable from the client.

**Request body**
```json
{ "referred_user_id": "uuid" }
```

**Response (200)**
```json
{ "success": true,
  "referrer_id": "uuid",
  "days_granted": 30,
  "new_expiry": "2026-06-08T..." }
```

**Caller:** [`stripe-webhook/index.ts`](../supabase/functions/stripe-webhook/index.ts) → `triggerReferralReward()` (after `checkout.session.completed`)

---

## `POST /functions/v1/stripe-webhook`

**Stripe-only.** Receives Stripe events. Verifies signature using `STRIPE_WEBHOOK_SECRET`.

**Handled events:**

| Event | Behaviour |
|---|---|
| `checkout.session.completed` | Resolves Supabase user (metadata → `client_reference_id` → email lookup). Upgrades to Pro. Triggers referral reward. |
| `invoice.payment_succeeded` | Refreshes expiry on renewal. Backup path for new subscriptions if `checkout.session.completed` is missed. |
| `customer.subscription.updated` | Syncs plan/expiry. Preserves any referral-extended expiry that exceeds the Stripe period. |
| `customer.subscription.deleted` | Downgrades user to Free; clears stripe_subscription_id and expiry. |
| `invoice.payment_failed` | Logged only — Stripe handles retries; downgrade happens via `customer.subscription.deleted` if all retries fail. |

**Response (200)** `{ "received": true }`

**Errors:** 400 (signature verification failed) · 500 (DB error)

---

## `POST /functions/v1/generate-r2-upload-url`

Returns a presigned Cloudflare R2 PUT URL (S3-compatible) for uploading a trade screenshot. URL expires in 5 minutes.

**Request body**
```json
{
  "file_name": "EURUSD-2025-09-15.png",
  "file_type": "image/png",
  "trade_id":  "550e8400-e29b-41d4-a716-446655440000"
}
```

**Validation:**
- `file_type` must be `png`, `jpg`, `jpeg`, or `webp` (10 MB cap enforced client-side)
- `trade_id` must be a valid UUID
- `file_name` is sanitised (no path separators, only `[a-zA-Z0-9._-]`)

**Object key pattern:** `trades/{user_id}/{trade_id}/{timestamp}-{8-byte-random-hex}-{sanitised-name}.{ext}`

**Response (200)**
```json
{
  "upload_url": "https://...r2.cloudflarestorage.com/...?X-Amz-Signature=...",
  "public_url": "https://media.tradinggrove.com/trades/.../...png",
  "key":        "trades/<user>/<trade>/<ts>-<rnd>-<name>.png"
}
```

**Errors:** 400 (invalid input) · 401 (missing/invalid token) · 405 (non-POST) · 500 (R2 misconfigured)

**Caller:** [`supabase-client.js:568`](../src/js/lib/supabase-client.js#L568)

---

## Production Webhook Endpoint

Stripe is configured to POST events to:

```
https://{project-ref}.supabase.co/functions/v1/stripe-webhook
```

This endpoint must be deployed **without** JWT verification (Stripe doesn't send a Supabase auth token; it sends a `stripe-signature` header instead). The function uses [`stripe-webhook/config.toml`](../supabase/functions/stripe-webhook/config.toml) to declare this.
