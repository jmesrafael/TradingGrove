CHECKLIST.md
**Public URL**: `https://pub-adf0874a733e42a3bcdfc2bb285c6fac.r2.dev`

| Task | Status |
|------|--------|
| R2 bucket created & set PRIVATE | ✅ |
| API token generated (R2:Read, R2:Write) | ✅ |
| CORS configured | ✅ |
| Credentials added to Supabase Secrets | ✅ |
| Test upload verified | ✅ |

---

### Phase 3 — Edge Function & R2 Upload Migration
**Status**: ✅ DONE

**What was built:**

| Component | Path | Lines |
|-----------|------|-------|
| Edge Function | `supabase/functions/generate-r2-upload-url/index.ts` | 650 |
| Client Library | `lib/r2-upload-client.ts` | 450 |
| React Component (example) | `components/R2UploadForm.example.tsx` | 400 |
| Function Docs | `supabase/functions/generate-r2-upload-url/README.md` | 400 |

**Edge Function behaviour:**
- Authenticates via Supabase JWT
- Validates file types: PNG, JPG, JPEG, WebP only
- Object key pattern: `trades/{user_id}/{trade_id}/{timestamp}-{random}.ext`
- Signed PUT URLs expire in 300s
- Returns `{ upload_url, public_url, key }`

**Deploy command:**
```bash
supabase functions deploy generate-r2-upload-url --no-verify-jwt
```

| Task | Status |
|------|--------|
| Edge Function implemented | ✅ |
| JWT authentication fixed | ✅ |
| Client library built | ✅ |
| Frontend integration (logs page) | ✅ |
| End-to-end production testing | ✅ |

---

## Performance & Egress Optimization

### Tier 1 — Read-Path Egress Reduction

| # | Task | Files | Status |
|---|------|-------|--------|
| 1 | `getTrades` explicit column list — replaced `select('*')` with 14 columns `dbToTrade` actually reads. ~40–70% less data per read. | `supabase.js:117-127` | ✅ |
| 2 | `getTradesLight` for analytics — returns `id, trade_date, pnl, r_factor` only. Calendar wired. ~25% of previous payload. | `supabase.js:131-138`, `calendar.html:222,257` | ✅ |
| 3 | Realtime delta-merging — `applyTradeDelta()` applies INSERT/UPDATE/DELETE in place instead of refetching full list. Steady-state egress drops >90%. | `supabase.js:932-973`, `logs/logs.js:62,236-265,311-339`, `notes.html:847-882`, `calendar.html:217-234` | ✅ |
| 4 | `getTradeImages` excludes legacy `data` column — on-demand fetch via `_fetchLegacyImageData(id)` for pre-R2 rows only. No base64 on hot reads. | `supabase.js:889-903,691-722,759-786` | ✅ |
| 5 | Lazy-load all trade `<img>` tags — `loading="lazy"` + `decoding="async"`. ~70–90% less initial image traffic. | `logs/logs.js:1191-1192`, `notes.html` (4 places) | ✅ |
| 1f | Analytics no longer hard-reloads on every save — `tz_trades_changed` now gated behind active tab + visible tab checks, 300ms coalesced. 50+ reloads/session → 1. | `analytics.html:97-135`, `journal.html:1322-1346` | ✅ |

### Tier 2 — First-Paint Weight & Cache

| # | Task | Files | Status |
|---|------|-------|--------|
| 7 | Font Awesome subset — dropped `regular` + `brands` stylesheets. `fa-brands fa-bitcoin` replaced with `.ico-btc` `₿` glyph. ~150 KB cut from cold first paint. | `theme.js:309-320`, `journal.html`, `logs/index.html`, `index.html`, `calculatorpage.html`, `pages/calculator.html`, `pages/crypto-calculator.html`, `notes.html`, `logs/logs.js:696` | ✅ |
| 8 | `_cache` promoted to `sessionStorage` — profile persists across navigations. 1 round-trip per session instead of per page. | `supabase.js:13-40` | ✅ |
| 9 | Vercel cache headers — HTML: `s-maxage=300, swr=86400`. Static assets: `max-age=86400, s-maxage=604800`. | `vercel.json` | ✅ |

### Tier 3 — Structural (Pending)

| # | Task | Risk | Status |
|---|------|------|--------|
| 11 | Pagination on `getTrades` — default last 365 days + "Show all" toggle. Users with 5,000+ trades currently pull everything on load. | Medium | ⬜ |
| 6 | Backfill Supabase Storage images → R2, then drop legacy `data` column entirely. | Low | ⬜ |
| 12 | Vite/esbuild build pipeline — enables tree-shaking (~30 KB SDK saving), content-hashed assets, `Cache-Control: immutable`, and extracting inline JS from `journal.html` (152 KB) and `notes.html` (132 KB). | High | ⬜ |
| 13 | Subscribe analytics directly to realtime — removes last `location.reload()` path. Significant rewrite of analytics IIFE. | Medium | ⬜ |
| 14 | Audit `subscribeTrades` realtime payload — `notes` (long text) ships on every change. Configure publication to omit it if measurable. | Low | ⬜ |

---

## Security Summary

| Check | Status |
|-------|--------|
| User isolation — uploads scoped to `trades/{user_id}/` | ✅ |
| Path injection prevention — filenames sanitized, `../` blocked | ✅ |
| File type whitelist — PNG, JPG, JPEG, WebP only | ✅ |
| Signed URL expiry — 300s | ✅ |
| Private R2 bucket — no public access | ✅ |
| Collision prevention — 8-byte random suffix | ✅ |
| JWT required on every request | ✅ |

---

## Rollback Plan

**Immediate** — keep R2, revert uploads:
- Disable R2 upload path in frontend
- Fall back to Supabase Storage temporarily
- Existing R2 URLs in DB remain valid

**Full rollback:**
- Disable Edge Function deployment
- Redirect frontend to old upload flow
- R2 objects persist and can be migrated later

---

## Open Follow-Ups

- `tz_trades_changed` in calendar still triggers a `getTradesLight` refresh on every save in addition to realtime delta — gate it the same way analytics is gated
- Several pages still load Font Awesome from cdnjs at runtime — consider self-hosting the subset for full cache-header control and no third-party DNS hop
- Signed-URL cache `_urlCache` is in-memory only — promote to `sessionStorage` same as `_cache` to skip `createSignedUrl` round-trips on repeat visits

---

## Action Log

| Date | Action | Status |
|------|--------|--------|
| 2025-01-15 | Phase 3 code implemented (Edge Function, Client, Component) | ✅ |
| 2025-01-15 | Tracking files consolidated into DEPLOYMENT_RUNBOOK.md | ✅ |
| 2025-01-15 | `/deployment-phases/` folder system created | ✅ |
| 2026-04-15 | R2 Edge Function deployed | ✅ |
| 2026-04-15 | JWT authentication fixed | ✅ |
| 2026-04-15 | Frontend R2 integration (logs page) | ✅ |
| 2026-04-15 | Production testing passed | ✅ |
| 2026-04-15 | Font Awesome subset applied (~150 KB saved per cold visit) | ✅ |
| 2026-04-15 | Stale doc files removed (`CODE_CHANGES.md`, `IMPROVEMENTS_SUMMARY.md`, `QUICK_START.md`, `README_UPDATES.md`, `VISUAL_GUIDE.md`) | ✅ |
| 2026-04-15 | `_cache` promoted to `sessionStorage` | ✅ |

---

## Document Control

| Field | Value |
|-------|-------|
| Created | 2025-01-15 |
| Last Updated | 2026-04-15 |
| Status | ACTIVE — ALL PHASES COMPLETE ✅ |
| Version | 3.0 |

> ⚠️ DO NOT CREATE OTHER TRACKING FILES — THIS IS THE ONLY SOURCE OF TRUTH