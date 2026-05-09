# Supabase Edge Functions

> ⚠️ **Do not nest these in subfolders.** Supabase CLI deploys functions based on the folder name **directly** under `supabase/functions/`. Moving any of these into a subdirectory like `billing/create-checkout/` would prevent the CLI from finding them, and the frontend already calls them by exact name (e.g. `/functions/v1/create-checkout`). The categorisation below is **conceptual only**.

## Functions by Category

### Billing (Stripe)

| Function | Purpose | Caller |
|---|---|---|
| [`create-checkout/`](create-checkout/) | Creates a Stripe Checkout session for Pro upgrade. Reuses existing customer if available, sets metadata for webhook fallbacks. | `pricing.js`, `subscription.js` |
| [`billing-portal/`](billing-portal/) | Generates a Stripe Customer Portal URL for managing/cancelling subscriptions. Falls back to dashboard for referral-Pro users (no Stripe customer). | `subscription.js` |

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
| [`stripe-webhook/`](stripe-webhook/) | Handles Stripe events: `checkout.session.completed`, `invoice.payment_succeeded`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`. Resolves user via metadata → client_reference_id → email lookup. Triggers referral reward on first paid subscription. | Stripe (configured webhook endpoint) |

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
| `STRIPE_SECRET_KEY` | create-checkout, billing-portal, stripe-webhook | Stripe API |
| `STRIPE_WEBHOOK_SECRET` | stripe-webhook | Verify webhook signatures |
| `APP_URL` | create-checkout, billing-portal | Build redirect URLs (defaults to `https://tradinggrove.vercel.app`) |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_ENDPOINT` | generate-r2-upload-url | Cloudflare R2 credentials |
| `R2_PUBLIC_URL` (optional) | generate-r2-upload-url | Custom public domain for uploaded images |

## Deploying

```bash
# Single function
supabase functions deploy create-checkout

# All functions
supabase functions deploy

# Function that should not require JWT (handled internally)
supabase functions deploy create-checkout --no-verify-jwt
supabase functions deploy delete-account --no-verify-jwt
```

See [`/docs/API.md`](../../docs/API.md) for request/response shapes and [`/docs/DEPLOYMENT.md`](../../docs/DEPLOYMENT.md) for the full deploy workflow.
