# TradingGrove — Project Overview

## Mission

TradingGrove is a professional trading journal and risk management platform for crypto and forex traders. It combines free position-size calculators with a full trading journal, helping traders calculate risk precisely before every trade and log results to discover patterns that make them consistently profitable.

**Core philosophy:** Position sizing and risk management are the foundation of sustainable trading. Most traders fail because they don't calculate risk before entering, leading to over-leverage and blown accounts. TradingGrove eliminates guesswork and emotion by providing exact calculations instantly.

## Target Users

- Cryptocurrency traders (Bitcoin, altcoins, major digital assets)
- Forex traders (currency pairs, commodities, indices)
- Beginners building proper habits through to professionals optimising workflow

## Features

### Free — Calculators

**Crypto Position Size Calculator**
- Inputs: account capital, risk %, entry price, stop loss, take profit, leverage (1×–500×)
- Outputs: max loss, target profit, margin required, R:R ratio
- No account required; results saved to `localStorage`

**Forex Lot Size Calculator**
- Inputs: currency pair (30+), account currency, balance, risk %, entry, SL/TP
- Outputs: money at risk, lot size (micro/mini/standard), pip value, target profit
- Automatic pip detection per pair; handles exotics and cross pairs

### Pro — Trading Journal

| Feature | Free | Pro |
|---------|------|-----|
| Journals | 1 | Unlimited |
| Trade logging (pair, direction, entry, SL, TP, PnL, R, strategy, mood, notes) | ✅ | ✅ |
| Analytics dashboard | ✅ | ✅ |
| Trade calendar | ✅ | ✅ |
| Screenshot attachments | — | ✅ |
| CSV export | — | ✅ |
| JSON backup (with images) | — | ✅ |
| Journal PIN protection | — | ✅ |
| Premium themes & fonts | — | ✅ |
| Risk calculator (in-journal) | — | ✅ |

**Referral programme:** Refer a friend who subscribes → earn 30 free Pro days, no cap.

## Technical Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Vanilla HTML, CSS, JavaScript (no framework) |
| Auth & Database | Supabase (PostgreSQL + row-level security) |
| Storage | Supabase Storage (trade screenshots) |
| Payments | Stripe (monthly $15/mo · annual $10/mo billed $120/yr) |
| Hosting | Vercel |
| Edge Functions | Supabase Deno functions (checkout, webhooks, referrals) |

## Business Model

- **Free tier:** Calculators (unlimited) + 1 journal — drives adoption
- **Pro tier:** Full journal features — $15/mo or $120/yr
- **Revenue:** Subscriptions + potential affiliate/broker partnerships

## Supported Markets

**Crypto:** Any crypto/USD pair, leverage 1×–500×

**Forex:** All majors (EUR/USD, GBP/USD, AUD/USD, NZD/USD, USD/CAD, USD/CHF, USD/JPY), all cross pairs, exotics (XAU/USD, XAG/USD), indices (US30, NAS100). Account currencies: USD, EUR, GBP, JPY, CHF, AUD, CAD, NZD.

## Why Traders Fail (and how TradingGrove helps)

| Root cause | TradingGrove solution |
|---|---|
| No pre-trade risk calculation | Calculator gives exact position size in seconds |
| Emotional position sizing | Pre-calculated sizes remove emotion from entry |
| Over-leverage | Shows exact margin requirement before entering |
| No trade records | Journal logs every trade with strategy, mood, R factor |
| No performance awareness | Analytics reveals win rate, streaks, best pairs/strategies |
| Accountability gaps | Calendar view shows every trading day at a glance |
