# TradingGrove

A professional trading journal and risk management platform for crypto and forex traders. Calculate position sizes, log trades, and uncover patterns that make you consistently profitable.

## What it does

- **Crypto & Forex calculators** — position size, lot size, R:R, pip value. Free, no login.
- **Trading journal** — log trades with entry, exit, PnL, R factor, strategy, mood tags, and screenshots.
- **Analytics** — win rate, streaks, equity curve, breakdown by pair/strategy/timeframe.
- **Calendar** — daily PnL colour-coded at a glance.
- **Notes** — free-form trade notes and ideas.

## Running locally

```bash
node dev-server.js
# → http://localhost:5500
```

No install step needed — the project is vanilla HTML/CSS/JS.

## Project structure

```
src/
  pages/      ← HTML pages
  js/
    lib/      ← supabase-client.js, theme.js (loaded on all pages)
    modules/  ← per-page JavaScript
  styles/
    pages/    ← per-page CSS
  assets/     ← favicon, images
supabase/     ← edge functions, migrations
docs/         ← architecture, development, project overview
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full layout and [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for setup details.

## Tech stack

| | |
|---|---|
| Frontend | Vanilla HTML / CSS / JS |
| Auth & DB | Supabase (Postgres + RLS) |
| Payments | Stripe |
| Hosting | Vercel |

## Pricing

| Plan | Price |
|------|-------|
| Free | $0 — 1 journal, calculators |
| Pro Monthly | $15 / month |
| Pro Annual | $120 / year ($10/mo) |
