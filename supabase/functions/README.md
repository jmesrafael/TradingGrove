# Supabase Edge Functions

> ⚠️ **Do not nest these in subfolders.** Supabase CLI deploys functions based on the folder name **directly** under `supabase/functions/`. Moving any of these into a subdirectory like `billing/create-checkout/` would prevent the CLI from finding them, and the frontend already calls them by exact name (e.g. `/functions/v1/create-checkout`). The categorisation below is **conceptual only**.

## Functions by Category

### Billing (PayPal — active)

| Function | Purpose | Caller |
|---|---|---|
| [`create-paypal-subscription/`](create-paypal-subscription/) | Creates a PayPal billing subscription and returns the approval URL. 60-second per-user rate limit. Queues new subs if user already has active Pro. | `payment-method.js`, `subscription.js` |
| [`paypal-setup-plans/`](paypal-setup-plans/) | One-time helper to provision the Product + Monthly/Annual plans via REST API. Must be run with the same credentials that create subscriptions. | manual (curl) |
| [`billing-portal/`](billing-portal/) | Generates a portal URL for managing/cancelling subscriptions. Falls back to dashboard for referral-Pro users (no provider customer). | `subscription.js` |

### Billing (Stripe — disabled, code retained)

| Function | Purpose | Caller |
|---|---|---|
| [`create-checkout/`](create-checkout/) | Stripe Checkout session for Pro upgrade. Currently unused — UI calls PayPal instead. | (none — disabled) |

### Auth

| Function | Purpose | Caller |
|---|---|---|
| [`delete-account/`](delete-account/) | Deletes user data across all tables (trade_images, trades, journal_settings, custom_notes, journals, referrals, profiles) then deletes the auth user. | `profile.js`, `dashboard.js` |

### Referrals

| Function | Purpose | Caller |
|---|---|---|
| [`apply-referral/`](apply-referral/) | Records a referral when a new user signs up with a code. Validates code, prevents self-referral, waits for profile-creation trigger. | `supabase-client.js` (on signup) |
| [`grant-referral-reward/`](grant-referral-reward/) | Grants the referrer +30 days of Pro. Internal-only (requires service-role auth). Idempotent — won't double-reward. | `stripe-webhook` (after first payment) |

### Webhooks

| Function | Purpose | Caller |
|---|---|---|
| [`paypal-webhook/`](paypal-webhook/) | Handles PayPal events: `BILLING.SUBSCRIPTION.ACTIVATED`, `UPDATED`, `CANCELLED`, `EXPIRED`, `PAYMENT.FAILED`, `PAYMENT.SALE.COMPLETED`. Resolves user via `custom_id`. Triggers referral reward and activates queued subscriptions. | PayPal (configured webhook endpoint) |
| [`stripe-webhook/`](stripe-webhook/) | Handles Stripe events: `checkout.session.completed`, `invoice.payment_succeeded`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`. Resolves user via metadata → client_reference_id → email lookup. Triggers referral reward on first paid subscription. | Stripe (only if endpoint registered — currently disabled) |

### Storage (Cloudflare R2)

| Function | Purpose | Caller |
|---|---|---|
| [`generate-r2-upload-url/`](generate-r2-upload-url/) | Generates a presigned PUT URL for trade screenshot upload. Validates file type (png/jpg/jpeg/webp), trade_id (UUID), and namespaces uploads under `trades/{user_id}/{trade_id}/`. | `supabase-client.js` (on screenshot upload) |

## Required Secrets

| Secret | Used by | Purpose |
|---|---|---|
| `SUPABASE_URL` | All | Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | All | Admin DB access |
| `SUPABASE_ANON_KEY` / `ANON_KEY` | billing-portal, delete-account | User token verification |
| `PAYPAL_MODE` | create-paypal-subscription, paypal-webhook, paypal-setup-plans | `live` or `sandbox` (defaults to `sandbox` — **set to `live` for production**) |
| `PAYPAL_CLIENT_ID` | All PayPal functions | PayPal REST API client ID |
| `PAYPAL_CLIENT_SECRET` | All PayPal functions | PayPal REST API client secret |
| `PAYPAL_WEBHOOK_ID` | paypal-webhook | Verify webhook signatures via PayPal verify-signature API |
| `PAYPAL_MONTHLY_PLAN_ID`, `PAYPAL_ANNUAL_PLAN_ID` | create-paypal-subscription | PayPal billing plan IDs (created via `paypal-setup-plans`) |
| `STRIPE_SECRET_KEY` | create-checkout, billing-portal, stripe-webhook | Stripe API (only if re-enabling Stripe) |
| `STRIPE_WEBHOOK_SECRET` | stripe-webhook | Verify Stripe webhook signatures |
| `APP_URL` | create-checkout, create-paypal-subscription, billing-portal | Build redirect URLs (defaults to `https://tradinggrove.com`) |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_ENDPOINT` | generate-r2-upload-url | Cloudflare R2 credentials |
| `R2_PUBLIC_URL` (optional) | generate-r2-upload-url | Custom public domain for uploaded images |

## Deploying

```bash
# Single function
supabase functions deploy create-checkout

# All functions
supabase functions deploy

# Functions that should not require JWT (auth is handled internally)
supabase functions deploy create-checkout --no-verify-jwt
supabase functions deploy create-paypal-subscription --no-verify-jwt
supabase functions deploy delete-account --no-verify-jwt
supabase functions deploy paypal-setup-plans --no-verify-jwt

# Webhook functions use config.toml to disable JWT (they verify signatures instead)
supabase functions deploy stripe-webhook
supabase functions deploy paypal-webhook
```

See [`/docs/API.md`](../../docs/API.md) for request/response shapes and [`/docs/DEPLOYMENT.md`](../../docs/DEPLOYMENT.md) for the full deploy workflow.
