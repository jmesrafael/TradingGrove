# Deployment

TradingGrove deploys in two halves:

1. **Frontend** → Vercel (auto-deploy from GitHub)
2. **Backend** → Supabase Edge Functions + Postgres migrations (manual via CLI)

---

## Frontend (Vercel)

Pushing to `main` triggers a Vercel deploy automatically. Routing is controlled by [`vercel.json`](../vercel.json) — every clean URL has an explicit rewrite to its `src/pages/{name}.html` file.

**Manual deploy:**
```bash
vercel --prod
```

**Production URL:** `https://tradinggrove.vercel.app` (set as `APP_URL` secret on Supabase functions).

**Adding a new page:** see [DEVELOPMENT.md → Adding a New Page](DEVELOPMENT.md#adding-a-new-page). The `vercel.json` rewrite must be added or Vercel will 404 on the clean URL even though the file exists.

---

## Backend (Supabase)

### Initial setup (once)

```bash
supabase login                # authenticate CLI
supabase link --project-ref <ref>   # link this folder to the project
```

### Deploy edge functions

Deploy a single function:
```bash
supabase functions deploy create-checkout
```

Deploy all of them at once:
```bash
supabase functions deploy
```

**Special flags** (already documented inline in each function header):

| Function | Deploy command |
|---|---|
| `create-checkout` | `supabase functions deploy create-checkout --no-verify-jwt` |
| `delete-account` | `supabase functions deploy delete-account --no-verify-jwt` |
| `stripe-webhook` | uses [`config.toml`](../supabase/functions/stripe-webhook/config.toml) to disable JWT verification |
| Everything else | default — JWT required |

> ⚠️ **Don't move function folders.** Supabase deploys based on the folder name directly under `supabase/functions/`. Nesting (e.g. `billing/create-checkout/`) breaks discovery, and the frontend hard-codes the URLs (`/functions/v1/create-checkout`).

### Set/update secrets

```bash
supabase secrets set STRIPE_SECRET_KEY=sk_live_...
supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...
supabase secrets set APP_URL=https://tradinggrove.vercel.app
# R2 (Cloudflare)
supabase secrets set R2_ACCOUNT_ID=... R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=...
supabase secrets set R2_BUCKET_NAME=... R2_ENDPOINT=https://<acct>.r2.cloudflarestorage.com
supabase secrets set R2_PUBLIC_URL=https://media.tradinggrove.com
```

Full list of required secrets: [supabase/functions/README.md](../supabase/functions/README.md#required-secrets).

### Apply database migrations

```bash
supabase db push
```

Migrations live in [`supabase/migrations/`](../supabase/migrations/) and run in filename order.

---

## Stripe webhook configuration

In the Stripe dashboard → Developers → Webhooks → Add endpoint:

- **URL:** `https://{project-ref}.supabase.co/functions/v1/stripe-webhook`
- **Events:**
  - `checkout.session.completed`
  - `invoice.payment_succeeded`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `invoice.payment_failed`
- Copy the signing secret → `supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...`

---

## Environment matrix

| Variable | Where it lives |
|---|---|
| Supabase URL + anon key | Hardcoded in [`src/js/lib/supabase-client.js`](../src/js/lib/supabase-client.js) (safe — RLS enforces isolation) |
| Stripe price IDs | Hardcoded in [`create-checkout/index.ts`](../supabase/functions/create-checkout/index.ts) `PRICE_MAP` |
| All other secrets | Supabase function secrets (set via CLI) — never committed |

---

## Rollback

**Frontend:** Vercel → Deployments → previous deploy → "Promote to Production".

**Edge function:** Supabase doesn't keep function-version history. To roll back, `git checkout <prev-sha> -- supabase/functions/{name}/` and redeploy.

**Migration:** Hand-write a reverse migration. Supabase doesn't auto-rollback.
