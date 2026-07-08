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
docs/                  ← architecture, API, database, deployment
build.js               ← copies src/ → public/ for Vercel
```

`build.js` flattens `src/` into `public/`, so URLs reference `/js/...` not `/src/js/...`.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full layout and [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for setup details.

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
