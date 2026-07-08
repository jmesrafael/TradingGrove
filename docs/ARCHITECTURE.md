# Architecture

## Folder Structure

```
TradingGrove/
├── src/                                # All deployable assets (copied to public/ at build)
│   ├── index.html                      # Landing page
│   ├── dashboard.html                  # User dashboard (journal grid)
│   ├── journal.html                    # Journal-level settings & data tools
│   ├── logs.html                       # Trade log table (inline-edit)
│   ├── analytics.html                  # Analytics & charts
│   ├── calendar.html                   # Monthly PnL heatmap
│   ├── notes.html                      # Free-form trading notes
│   ├── presession.html                 # Pre-market checklist
│   ├── profile.html                    # Account settings
│   ├── subscription.html               # Billing & subscription
│   ├── payment-method.html             # Payment provider selection
│   ├── pricing.html                    # Public pricing page
│   ├── help.html                       # FAQ & help centre
│   ├── auth.html                       # Sign in / sign up
│   ├── confirm.html                    # Email confirmation
│   ├── reset-password.html             # Password reset
│   ├── terms.html                      # Terms of service
│   ├── privacy.html                    # Privacy policy
│   ├── refund.html                     # Refund policy
│   ├── 404.html                        # Not-found page
│   ├── robots.txt                      # SEO crawl rules
│   ├── sitemap.xml                     # SEO sitemap
│   │
│   ├── calculators/
│   │   ├── position-calculator.html    # Full calculator page (/calculator)
│   │   ├── calculator.html             # Calculator tab fragment
│   │   ├── crypto-calculator.html      # Crypto calculator fragment
│   │   └── forex-calculator.html       # Forex calculator fragment
│   │
│   ├── js/
│   │   ├── lib/                        # Shared globals loaded on every page
│   │   │   ├── supabase-client.js      # Supabase init, auth, profile cache,
│   │   │   │                           # trades CRUD, R2 image upload helpers
│   │   │   └── theme.js                # Theme/font application from profile
│   │   │
│   │   ├── loss-vignette.js            # Loss-limit screen vignette overlay
│   │   │
│   │   └── modules/                    # Per-page JavaScript (one file per page)
│   │       ├── landing.js
│   │       ├── dashboard.js
│   │       ├── journal.js
│   │       ├── logs.js
│   │       ├── analytics.js
│   │       ├── calendar.js
│   │       ├── notes.js
│   │       ├── presession.js
│   │       ├── profile.js
│   │       ├── subscription.js
│   │       ├── payment-method.js
│   │       ├── pricing.js
│   │       ├── help.js
│   │       ├── auth.js
│   │       ├── confirm.js
│   │       ├── reset-password.js
│   │       └── position-calculator.js
│   │
│   ├── styles/                         # Per-page CSS (one file per page)
│   │   ├── index.css
│   │   ├── dashboard.css
│   │   ├── journal.css
│   │   ├── logs.css
│   │   ├── analytics.css
│   │   ├── calendar.css
│   │   ├── notes.css
│   │   ├── presession.css
│   │   ├── profile.css
│   │   ├── subscription.css
│   │   ├── payment-method.css
│   │   ├── pricing.css
│   │   ├── help.css
│   │   ├── auth.css
│   │   ├── confirm.css
│   │   ├── reset-password.css
│   │   ├── terms.css
│   │   ├── privacy.css
│   │   ├── refund.css
│   │   └── position-calculator.css
│   │
│   └── assets/
│       ├── favicon.svg
│       └── images/                     # brandlogo.webp, paypal-logo.png, etc.
│
├── supabase/                           # Backend (Edge Functions + DB migrations)
│   ├── config.toml
│   ├── functions/                      # Deno edge functions
│   │   ├── _shared/
│   │   │   ├── plan-utils.ts           # Plan-type helpers shared across fns
│   │   │   └── referral-utils.ts       # Referral reward helpers
│   │   ├── apply-referral/             # Records referrer→referred on signup
│   │   ├── grant-referral-reward/      # +30 days Pro on referred upgrade
│   │   ├── create-checkout/            # Stripe checkout (currently disabled)
│   │   ├── create-paypal-subscription/ # PayPal subscription creation
│   │   ├── billing-portal/             # PayPal/Stripe billing portal link
│   │   ├── stripe-webhook/             # Stripe event handler
│   │   ├── paypal-webhook/             # PayPal event handler
│   │   ├── paypal-setup-plans/         # One-time PayPal plan provisioning
│   │   ├── generate-r2-upload-url/     # Signed Cloudflare R2 upload URL
│   │   └── delete-account/             # GDPR account deletion
│   │
│   └── migrations/                     # SQL migrations (chronological)
│       ├── 2026-04-25_notes_pin_and_images.sql
│       ├── 2026-04-26_presession_checklist_refactor.sql
│       ├── 2026-04-26_presession_mood_options.sql
│       ├── 2026-04-30_profiles_rls_subscription_protection.sql
│       ├── 2026-05-06_cleanup_unused_trade_columns.sql
│       ├── 2026-05-12_paypal_integration.sql
│       ├── 20260512120000_queued_subscriptions.sql
│       └── 2026-05-17_rate_limiting_column.sql
│
├── docs/                               # Architecture & deploy docs
├── public/                             # Build output (generated, gitignored)
│
├── build.js                            # Build script: copies src/ → public/
├── dev-server.js                       # Local dev server (applies vercel.json rewrites)
├── favicon.js                          # Global favicon loader (loaded on all pages)
├── vercel.json                         # Vercel routing rewrites & cache headers
├── package.json
├── .env.example                        # Secrets template (no real secrets)
├── LAUNCH_CHECKLIST.md                 # Pre-launch verification checklist
├── TODO.md                             # Outstanding launch tasks
└── README.md
```

## Build Pipeline

`build.js` performs a recursive copy of `src/` into `public/`. Vercel serves `public/` as the deployment root, so every path inside `src/` becomes a public URL. The `favicon.js` file at the project root is **not** auto-copied — Vercel serves it from root because `public/` is the output dir; ensure it stays accessible (currently loaded as `/favicon.js`).

```bash
node build.js          # writes everything from src/ into public/
vercel --prod          # deploys public/ to production
```

## Script Loading Order

Every authenticated page loads scripts in this order (taken from `dashboard.html`):

```html
<!-- 1. Favicon handler -->
<script src="/favicon.js"></script>

<!-- 2. CDN: Supabase SDK -->
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"></script>

<!-- 3. Shared lib: theme (must run before body renders) -->
<script src="/js/lib/theme.js"></script>

<!-- 4. Shared lib: Supabase client, auth helpers, profile cache, trades CRUD -->
<script src="/js/lib/supabase-client.js"></script>

<!-- 5. Page module (at end of <body>) -->
<script src="/js/modules/{page}.js"></script>
```

Paths use `/js/...` (no `/src/` prefix) because `build.js` flattens `src/` into the deploy root.

## Routing

Clean URLs are mapped to HTML files via `vercel.json` rewrites (production) and `dev-server.js` (local).

| URL | File served |
|-----|-------------|
| `/` | `src/index.html` |
| `/auth` | `src/auth.html` |
| `/dashboard` | `src/dashboard.html` |
| `/journal` | `src/journal.html` |
| `/logs` | `src/logs.html` |
| `/presession` | `src/presession.html` |
| `/analytics` | `src/analytics.html` |
| `/calendar` | `src/calendar.html` |
| `/notes` | `src/notes.html` |
| `/profile` | `src/profile.html` |
| `/subscription` | `src/subscription.html` |
| `/payment-method` | `src/payment-method.html` |
| `/pricing` | `src/pricing.html` |
| `/help` | `src/help.html` |
| `/calculator` | `src/calculators/position-calculator.html` |
| `/confirm` | `src/confirm.html` |
| `/reset-password` | `src/reset-password.html` |
| `/terms` | `src/terms.html` |
| `/privacy` | `src/privacy.html` |
| `/refund` | `src/refund.html` |

## Iframe Embeds

The journal page (`journal.html`) loads other pages as iframe tabs:

| Frame | Source URL |
|-------|------------|
| Logs tab | `/logs` |
| Pre-session tab | `/presession` |
| Calendar tab | `/calendar` |
| Notes tab | `/notes` |
| Analytics tab | `/analytics` |

## Supabase Edge Functions

| Function | Purpose | JWT verified? |
|----------|---------|----------------|
| `apply-referral` | Records referrer→referred on signup | Yes |
| `grant-referral-reward` | +30 days Pro to referrer on upgrade | Yes (service) |
| `create-checkout` | Stripe checkout session (currently disabled) | Manual |
| `create-paypal-subscription` | PayPal subscription creation (60s rate-limited) | Manual |
| `billing-portal` | Returns billing-management URL | Yes |
| `stripe-webhook` | Handles Stripe events (signature-verified) | No (webhook) |
| `paypal-webhook` | Handles PayPal events (signature-verified) | No (webhook) |
| `paypal-setup-plans` | One-time PayPal plan provisioning helper | Manual |
| `generate-r2-upload-url` | Issues signed R2 upload URL for trade screenshots | Yes |
| `delete-account` | Cascading GDPR-compliant account deletion | Manual |

Shared helpers live in `supabase/functions/_shared/`:
- `plan-utils.ts` — plan-type normalization
- `referral-utils.ts` — referral-reward grant logic

## Database

Core tables (all RLS-enabled, scoped to `auth.uid()`):

- `profiles` — plan, subscription state, referral code, theme/font, `last_checkout_attempt` (rate-limiting), `queued_subscription` (upgrade stacking)
- `journals` — user-owned journal containers
- `trades` — trade rows linked to a journal
- `trade_images` — R2 object references for trade screenshots
- `custom_notes` — free-form notes with optional images
- `presession_checklist_sets/items/state` — daily checklist data
- `referrals` — referrer→referred relationships

Subscription-sensitive columns (`plan`, `plan_type`, `subscription_expires_at`, `stripe_customer_id`, `stripe_subscription_id`, `paypal_subscription_id`, `referred_by`, `referral_code`, `referral_count`) are protected by the `protect_subscription_fields()` trigger — only the service role can modify them.

## Supabase Globals (set by `supabase-client.js`)

Functions exposed as globals for use by page modules:

| Global | Type | Description |
|--------|------|-------------|
| `db` | Supabase client | Authenticated Supabase JS client |
| `SUPABASE_URL` | string | Project URL |
| `requireAuth()` | async fn | Redirects to `/auth` if no session |
| `getUser()` | async fn | Returns current auth user or null |
| `getProfile(userId)` | async fn | Returns cached user profile |
| `applyProfileTheme(profile)` | fn | Applies theme/font from profile |
| `getTrades(journalId)` | async fn | All trades for a journal (capped at 2000) |
| `getTradesPage(journalId, {limit, offset})` | async fn | Paginated trades fetch |
| `getTradesLight(journalId)` | async fn | Lightweight columns only (calendar/dashboard) |
| `getJournalsPnl(journalIds)` | async fn | Batched PnL lookup (avoids N+1) |
| `subscribeTrades(jid, cb)` | fn | Realtime subscription with inline deltas |
| `applyTradeDelta(trades, payload, merge)` | fn | Apply realtime change to in-memory list |
| `addTradeImage(...)` | async fn | Upload + persist trade screenshot |
| `getImageCountsForJournal(userId)` | async fn | Batched image-count lookup |
| `buildReferralUrl(code)` | fn | Build `?ref=` invite URL |
| `validateReferralCode(code)` | async fn | RPC validation |

## External Services

| Service | Used for |
|---------|----------|
| **Supabase** | Auth, Postgres DB, edge functions, realtime, storage fallback |
| **Cloudflare R2** | Primary trade-screenshot storage (S3-compatible) |
| **Vercel** | Static hosting + CDN for `public/` build output |
| **PayPal Billing** | Active subscription provider |
| **Stripe** | Code present but disabled (PayPal-only launch) |

## Environment Variables

See `.env.example` for the full template. Set via `supabase secrets set <KEY>=<VALUE>`:

- **Supabase:** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- **PayPal:** `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID`, `PAYPAL_MODE` (`live`/`sandbox`), `PAYPAL_MONTHLY_PLAN_ID`, `PAYPAL_ANNUAL_PLAN_ID`
- **Stripe:** `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` (only when re-enabling)
- **R2:** `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_ENDPOINT`, `R2_PUBLIC_URL`
- **App:** `APP_URL` (e.g. `https://tradinggrove.com`)
