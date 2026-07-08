# Pre-Launch TODO

Fixes already applied in code are marked ✅. Items below require manual action before going live.

---

## 🔴 Critical — Do Before Any Real Users

### PayPal Production Setup
- [ ] Run `supabase db push` to apply the rate limiting migration (`2026-05-17_rate_limiting_column.sql`)
- [ ] Set PayPal to live mode: `supabase secrets set PAYPAL_MODE=live`
- [ ] Create live PayPal billing plans (PayPal Business Dashboard → Subscriptions → Plans)
- [ ] Set live plan IDs: `supabase secrets set PAYPAL_MONTHLY_PLAN_ID=P-xxx PAYPAL_ANNUAL_PLAN_ID=P-xxx`
- [ ] Verify PayPal app has "Live" status in [PayPal Developer Dashboard](https://developer.paypal.com)
- [ ] Test full flow end-to-end with real PayPal credentials: sign up → upgrade → cancel

### Error Monitoring
- [ ] Create a free [Sentry](https://sentry.io) project
- [ ] Add Sentry init snippet to every page's `<head>` (shared across all HTML files)
- [ ] Confirm errors appear in Sentry dashboard before launch

### R2 Image Storage
- [ ] Confirm all R2 secrets are set in Supabase: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_ENDPOINT`, `R2_PUBLIC_URL`
- [ ] Test a trade screenshot upload in the production environment

### Social Share Image
- [ ] Create `/src/assets/og-home.png` (1200×630px) for homepage social previews
  - Referenced by the `og:image` and `twitter:image` tags added to `index.html`

---

## 🟠 High Priority — Within First Week of Launch

### Transactional Emails
- [ ] Integrate [Resend](https://resend.com) or Postmark
- [ ] Send welcome email on signup
- [ ] Send Pro upgrade confirmation (trigger from `paypal-webhook` on `BILLING.SUBSCRIPTION.ACTIVATED`)
- [ ] Send payment failure alert (trigger from `paypal-webhook` on `BILLING.SUBSCRIPTION.PAYMENT.FAILED`)
- [ ] Send renewal reminder 7 days before `subscription_expires_at`

### Logs Page Pagination (before any user hits 200+ trades)
- [ ] Refactor `logs.js` initial load to use `getTradesPage(jid, { limit: 100, offset: 0 })`
- [ ] Add "Load More" button that increments offset and appends rows to `trades[]`
- [ ] Keep `getTrades()` (full fetch) only for analytics stats and export — load those separately
- [ ] Test with 500+ trades

### Legal Review
- [ ] Confirm `src/terms.html` content has been legally reviewed
- [ ] Confirm `src/privacy.html` content has been legally reviewed
- [ ] Verify both are accurate for PayPal and Google OAuth merchant requirements

---

## 🟡 Nice to Have — Within First Month

- [ ] Add analytics platform (Plausible or Posthog) — track `signup`, `upgrade`, `referral_share`
- [ ] Set up GitHub Actions CI/CD (push to `main` → Vercel deploy + `supabase functions deploy --all`)
- [ ] Add JS/CSS minification to `build.js` (esbuild or terser)
- [ ] Replace `ca-pub-XXXXXXXXXXXXXXXX` in `calendar.html`, `notes.html`, `analytics.js` with real AdSense publisher ID and re-enable `adsbygoogle.push({})` calls
- [ ] Tighten CORS on edge functions from `*` to `https://tradinggrove.com`
- [ ] Set up structured logging (Axiom or Cloudflare Logpush) for edge functions

---

## ✅ Already Fixed in Code

- [x] Removed `window._testRewardModal` from `subscription.js` and `profile.js`
- [x] Disabled broken AdSense `push()` calls in `calendar.js`, `notes.js`, `analytics.js`
- [x] Created `src/robots.txt` (disallows auth/dashboard routes, references sitemap)
- [x] Created `src/sitemap.xml` (all 7 public pages)
- [x] Added `og:image` + `twitter:image` to `index.html` (points to `/assets/og-home.png`)
- [x] Added 60-second rate limiting to `create-paypal-subscription` edge function
- [x] Added `2026-05-17_rate_limiting_column.sql` migration for `last_checkout_attempt` column
- [x] Added 2000-row safety cap to `getTrades()` and new `getTradesPage()` function for future pagination
