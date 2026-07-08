# Deployment

TradingGrove deploys in two halves:

1. **Frontend** → Vercel (auto-deploy from GitHub)
2. **Backend** → Supabase Edge Functions + Postgres migrations (manual via CLI)

---

## Frontend (Vercel)

Pushing to `main` triggers a Vercel deploy automatically. Vercel runs `node build.js` (which copies `src/` → `public/`) and serves the `public/` directory. Routing is controlled by [`vercel.json`](../vercel.json) — every clean URL has an explicit rewrite to its `{name}.html` file at `src/` root.

**Manual deploy:**
```bash
vercel --prod
```

**Production URL:** `https://tradinggrove.com` (set as `APP_URL` secret on Supabase functions).

**Adding a new page:** see [DEVELOPMENT.md → Adding a New Page](DEVELOPMENT.md#adding-a-new-page). The `vercel.json` rewrite must be added or Vercel will 404 on the clean URL even though the file exists.

---

## Backend (Supabase)

### Initial setup (once)

```bash
supabase login                       # authenticate CLI
supabase link --project-ref <ref>    # link this folder to the project
```

### Deploy edge functions

Deploy a single function:
```bash
supabase functions deploy create-paypal-subscription
```

Deploy all of them at once:
```bash
supabase functions deploy
```

**Special flags** (also noted inline in each function header):

| Function | Deploy command |
|---|---|
| `create-checkout` | `supabase functions deploy create-checkout --no-verify-jwt` |
| `create-paypal-subscription` | `supabase functions deploy create-paypal-subscription --no-verify-jwt` |
| `delete-account` | `supabase functions deploy delete-account --no-verify-jwt` |
| `paypal-setup-plans` | `supabase functions deploy paypal-setup-plans --no-verify-jwt` |
| `stripe-webhook` | uses [`config.toml`](../supabase/functions/stripe-webhook/config.toml) to disable JWT verification |
| `paypal-webhook` | uses `config.toml` to disable JWT verification |
| Everything else | default — JWT required |

> ⚠️ **Don't move function folders.** Supabase deploys based on the folder name directly under `supabase/functions/`. Nesting (e.g. `billing/create-checkout/`) breaks discovery, and the frontend hard-codes the URLs (`/functions/v1/create-checkout`).

### Set or update secrets

```bash
# Core
supabase secrets set APP_URL=https://tradinggrove.com

# PayPal (active)
supabase secrets set PAYPAL_MODE=live
supabase secrets set PAYPAL_CLIENT_ID=A...
supabase secrets set PAYPAL_CLIENT_SECRET=...
supabase secrets set PAYPAL_WEBHOOK_ID=...
supabase secrets set PAYPAL_MONTHLY_PLAN_ID=P-...
supabase secrets set PAYPAL_ANNUAL_PLAN_ID=P-...

# Stripe (only when re-enabling — currently disabled)
supabase secrets set STRIPE_SECRET_KEY=sk_live_...
supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...

# Cloudflare R2
supabase secrets set R2_ACCOUNT_ID=... R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=...
supabase secrets set R2_BUCKET_NAME=trade-images R2_ENDPOINT=https://<acct>.r2.cloudflarestorage.com
supabase secrets set R2_PUBLIC_URL=https://media.tradinggrove.com
```

Full list of required secrets: [supabase/functions/README.md](../supabase/functions/README.md#required-secrets) and [.env.example](../.env.example).

### Apply database migrations

```bash
supabase db push
```

Migrations live in [`supabase/migrations/`](../supabase/migrations/) and run in filename order. The most recent migration adds `last_checkout_attempt` to `profiles` for payment rate limiting — make sure it's applied before deploying the updated `create-paypal-subscription` function.

---

## PayPal webhook configuration

In the PayPal Developer Dashboard → My Apps & Credentials → (your app) → Add Webhook:

- **URL:** `https://{project-ref}.supabase.co/functions/v1/paypal-webhook`
- **Events:**
  - `BILLING.SUBSCRIPTION.ACTIVATED`
  - `BILLING.SUBSCRIPTION.UPDATED`
  - `BILLING.SUBSCRIPTION.CANCELLED`
  - `BILLING.SUBSCRIPTION.EXPIRED`
  - `BILLING.SUBSCRIPTION.PAYMENT.FAILED`
  - `PAYMENT.SALE.COMPLETED`
- Copy the webhook ID → `supabase secrets set PAYPAL_WEBHOOK_ID=<id>`

The function verifies each request by POSTing to PayPal's `/v1/notifications/verify-webhook-signature` endpoint using the saved webhook ID.

### Creating PayPal plans (one-time per environment)

Plans **must** be created via the REST API using the same credentials the subscription-creation function uses (sandbox-vs-live and dashboard-vs-API account mismatches will otherwise cause `404 INVALID_RESOURCE_ID`). Use the helper:

```bash
supabase functions deploy paypal-setup-plans --no-verify-jwt
curl -X POST https://{project-ref}.supabase.co/functions/v1/paypal-setup-plans
```

It returns the generated monthly and annual plan IDs — copy those into the `PAYPAL_MONTHLY_PLAN_ID` / `PAYPAL_ANNUAL_PLAN_ID` secrets and redeploy `create-paypal-subscription`.

---

## Stripe webhook configuration *(only when re-enabling Stripe)*

In the Stripe dashboard → Developers → Webhooks → Add endpoint:

- **URL:** `https://{project-ref}.supabase.co/functions/v1/stripe-webhook`
- **Events:**
  - `checkout.session.completed`
  - `invoice.payment_succeeded`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `invoice.payment_failed`
- Copy the signing secret → `supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...`

While Stripe is disabled at the UI level, do **not** register this endpoint in the Stripe dashboard — otherwise stray live events will hit the function. Verify by checking the Stripe Webhooks page is empty.

---

## Environment matrix

| Variable | Where it lives |
|---|---|
| Supabase URL + anon key | Hardcoded in [`src/js/lib/supabase-client.js`](../src/js/lib/supabase-client.js) (safe — RLS enforces isolation) |
| Stripe price IDs | Hardcoded in [`create-checkout/index.ts`](../supabase/functions/create-checkout/index.ts) |
| PayPal plan IDs | Stored as Supabase secrets (`PAYPAL_MONTHLY_PLAN_ID`, `PAYPAL_ANNUAL_PLAN_ID`) |
| All other secrets | Supabase function secrets (set via CLI) — never committed |

---

## Rollback

**Frontend:** Vercel → Deployments → previous deploy → "Promote to Production".

**Edge function:** Supabase doesn't keep function-version history. To roll back, `git checkout <prev-sha> -- supabase/functions/{name}/` and redeploy.

**Migration:** Hand-write a reverse migration. Supabase doesn't auto-rollback.

---

## Pre-launch verification

Before going live, walk through [LAUNCH_CHECKLIST.md](../LAUNCH_CHECKLIST.md) and resolve any outstanding items in [TODO.md](../TODO.md).
