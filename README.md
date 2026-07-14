# TradingGrove

A professional trading journal and risk management platform for crypto and forex traders. Calculate position sizes, log trades, and uncover patterns that make you consistently profitable.

## What it does

- **Crypto & Forex calculators** — position size, lot size, R:R, pip value. Free, no login.
- **Trading journal** — log trades with entry, exit, PnL, R factor, strategy, mood tags, and screenshots.
- **Analytics** — win rate, streaks, equity curve, breakdown by pair/strategy/timeframe.
- **Calendar** — daily PnL colour-coded at a glance.
- **Notes** — free-form trade notes and ideas.
- **Pre-session checklist** — daily routine + market bias capture.

## Running locally

```bash
node dev-server.js
# → http://localhost:5500
```

No install step needed — the project is vanilla HTML/CSS/JS.

## Project structure

```
src/                   ← All deployable assets (HTML + js/ + styles/ + assets/)
  *.html               ← pages at root (index.html, dashboard.html, …)
  js/lib/              ← supabase-client.js, theme.js (loaded on all pages)
  js/modules/          ← per-page JavaScript
  styles/              ← per-page CSS
  assets/              ← favicon, images
  robots.txt, sitemap.xml
supabase/              ← edge functions, migrations
admin/                 ← LOCAL-ONLY superadmin panel (users, analytics, reports) — never deployed, see below
docs/                  ← architecture, API, database, deployment
build.js               ← copies src/ → public/ for Vercel
```

`build.js` flattens `src/` into `public/`, so URLs reference `/js/...` not `/src/js/...`. It only ever copies `src/`, so `admin/` is never part of a deploy.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full layout and [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for setup details.

## Admin panel (local only)

A superadmin tool lives in `admin/` — user list with Pro grant/revoke, storage usage,
product analytics, and support message reports. It is **never deployed**: `build.js`
only ever copies `src/`, and `admin/.env` (holding the Supabase service-role key) is
gitignored.

```bash
cp admin/.env.example admin/.env   # fill in SUPABASE_SERVICE_ROLE_KEY, etc.
npm run admin
# → http://127.0.0.1:5600  (login: Rafael / admin123, change in admin/.env)
```

Run with `MOCK=1` (set in `admin/.env` or `MOCK=1 npm run admin`) to explore the UI
with fixture data before wiring up real credentials. Full setup and security notes
are in [admin/README.md](admin/README.md).

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | Vanilla HTML / CSS / JS |
| Auth & DB | Supabase (Postgres + RLS) |
| Storage | Cloudflare R2 (trade screenshots) |
| Payments | PayPal (Stripe code present but disabled) |
| Hosting | Vercel |

## Pricing

| Plan | Price |
|------|-------|
| Free | $0 — 1 journal, calculators |
| Pro Monthly | $15 / month |
| Pro Annual | $120 / year ($10/mo) |

## Launch status

See [TODO.md](TODO.md) for outstanding pre-launch tasks and [LAUNCH_CHECKLIST.md](LAUNCH_CHECKLIST.md) for the full verification checklist.
