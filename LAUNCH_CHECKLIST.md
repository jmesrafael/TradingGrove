# TradingGrove — Pre-Launch Checklist

**Status:** Ready for final verification before go-live  
**Last Updated:** 2026-05-15

---

## 🔴 CRITICAL (Block Launch)

These MUST be complete and verified before deploying to production.

- [ ] **PayPal URLs fixed** — Production URLs active in `dashboard.js` & `subscription.js`
  - [x] Code changes merged
  - [ ] Tested in staging environment
  - [ ] Verified users see `www.paypal.com/myaccount/autopay/` (not sandbox)

- [ ] **PayPal referral rewards working** — Both Stripe and PayPal subscribers get rewards
  - [x] Code changes merged (grant-referral-reward bug fixed)
  - [ ] Tested with PayPal test subscriber
  - [ ] Verified referrer gets +30 days Pro credit

- [ ] **Test functions removed** — `_testRewardModal()` no longer accessible
  - [x] Code removed from `profile.js` & `subscription.js`
  - [ ] Build/deploy to staging
  - [ ] Verify `window._testRewardModal` is undefined in browser console

- [ ] **PayPal Production Configuration** — All secrets set in Supabase
  - [ ] `PAYPAL_MODE=live` (not `sandbox`)
  - [ ] `PAYPAL_MONTHLY_PLAN_ID` = live plan ID (not `P-90B...`)
  - [ ] `PAYPAL_ANNUAL_PLAN_ID` = live plan ID (not `P-9A1...`)
  - [ ] `PAYPAL_CLIENT_ID` = production credentials
  - [ ] `PAYPAL_CLIENT_SECRET` = production credentials
  - [ ] `PAYPAL_WEBHOOK_ID` = live webhook ID from PayPal

- [ ] **PayPal Live App Approved** — Verified at developer.paypal.com
  - [ ] App status shows "Live" (not Sandbox)
  - [ ] Business verification complete
  - [ ] Terms of Service URL registered
  - [ ] Privacy Policy URL registered

- [ ] **Stripe Secrets (if re-enabling)** — Verified in Supabase
  - [ ] `STRIPE_SECRET_KEY` = live key (sk_live_...)
  - [ ] `STRIPE_WEBHOOK_SECRET` = live webhook secret
  - OR
  - [ ] Stripe code remains commented out (PayPal-only launch confirmed)

- [ ] **Cloudflare R2 Configured** — All secrets in Supabase
  - [ ] `R2_ACCOUNT_ID` set
  - [ ] `R2_ACCESS_KEY_ID` set
  - [ ] `R2_SECRET_ACCESS_KEY` set
  - [ ] `R2_BUCKET_NAME=trade-images` confirmed
  - [ ] `R2_ENDPOINT` points to production
  - [ ] `R2_PUBLIC_URL` points to production domain

- [ ] **Supabase Production Database Ready**
  - [ ] All migrations applied
  - [ ] RLS policies enabled on all user-data tables
  - [ ] Service role key securely stored (for edge functions only)
  - [ ] Backups enabled and tested

---

## 🟠 HIGH PRIORITY (Fix Before Real Users Pay)

Complete these before accepting paying customers.

- [ ] **Error Monitoring (Sentry)** — Zero visibility to production errors currently
  - [ ] Create free Sentry project
  - [ ] Add Sentry init code to shared script loaded on every page
  - [ ] Set release version (e.g., `v1.0.0`)
  - [ ] Test error reporting with console error
  - [ ] Dashboard accessible and alerting configured

- [ ] **Terms of Service Page** — Required for PayPal & Google OAuth
  - [ ] Create `/terms` static HTML page
  - [ ] Legal review completed
  - [ ] Linked from footer on every page
  - [ ] PayPal live app approval references this URL

- [ ] **Privacy Policy Page** — Required for compliance
  - [ ] Create `/privacy` static HTML page
  - [ ] Legal review completed
  - [ ] Linked from footer on every page
  - [ ] Covers data collection, third-party services (Stripe/PayPal), retention

- [ ] **Trade Pagination** — Performance issue with large journals
  - [ ] Implement `.range(offset, limit)` in `getTrades()`
  - [ ] Add "Load More" UI button or infinite scroll
  - [ ] Test with 500+ trades
  - [ ] Verify Supabase read quota doesn't spike

- [ ] **Rate Limiting on Payment Functions** — Prevent subscription spam
  - [ ] Add per-user cooldown check (e.g., 60 sec minimum between attempts)
  - [ ] Test with rapid clicks on upgrade button
  - [ ] Verify error toast shown on rate limit hit

---

## 🟡 MEDIUM PRIORITY (Soon After Launch)

Nice to have at launch, but can be added in first post-launch sprint.

- [ ] **Transactional Emails** — Users need payment/upgrade confirmations
  - [ ] Integrate Resend or Postmark
  - [ ] Welcome email on signup
  - [ ] Pro upgrade confirmation
  - [ ] Subscription renewal reminder (7 days before expiry)
  - [ ] Payment failure notification
  - [ ] Test emails with real addresses

- [ ] **`.env.example` File** — Developer onboarding
  - [x] Created `.env.example`
  - [ ] Documented in README with setup instructions
  - [ ] Instructions for copying to `supabase/.env`

- [ ] **Email Verification Enforcement** — Auth step
  - [ ] Verify Supabase Auth requires email confirmation before signup completes
  - [ ] Test with invalid email addresses

---

## 🟢 NICE TO HAVE (Post-Launch OK)

These don't block launch but improve maintainability & performance.

- [ ] **CI/CD Pipeline** — Manual deploys are error-prone
  - [ ] Create GitHub Actions workflow
  - [ ] On push to `main`: run `node build.js`
  - [ ] Deploy to Vercel with `vercel --prod`
  - [ ] Deploy edge functions with `supabase functions deploy`
  - [ ] Run tests (if added)

- [ ] **Build Optimization** — Large inline JS files
  - [ ] Evaluate esbuild or Vite as build tool
  - [ ] Minify HTML/JS/CSS
  - [ ] Split large pages (journal.html ~150KB → smaller chunks)
  - [ ] Bundle Supabase JS locally instead of CDN

- [ ] **Structured Logging** — Currently only `console.log`
  - [ ] Send edge function logs to external service (Datadog, Axiom)
  - [ ] Dashboard analytics on function errors
  - [ ] Alerting on payment function failures

- [ ] **Legacy Image Backfill** — Cleanup
  - [ ] Migrate `trade_images.data` (base64) to R2
  - [ ] Drop legacy column
  - [ ] Saves ~5-10% database storage per user

- [ ] **Analytics** — Understand user behavior
  - [ ] Add Plausible or Fathom analytics (privacy-friendly)
  - [ ] Track key events: signup, first trade logged, upgrade, referral share
  - [ ] Monitor conversion funnel

---

## Testing & QA

Before final deployment:

### Functional Testing
- [ ] **Auth Flow**
  - [ ] Email signup works
  - [ ] Google OAuth works
  - [ ] Email confirmation required
  - [ ] Password reset works
  - [ ] Logout clears session

- [ ] **Journal & Trades**
  - [ ] Create new journal (free & Pro)
  - [ ] Log trade with screenshot (test R2 upload)
  - [ ] Edit trade
  - [ ] Delete trade
  - [ ] View calendar heatmap
  - [ ] View analytics charts

- [ ] **Subscription**
  - [ ] Free plan limitations work (1 journal max)
  - [ ] PayPal upgrade flow completes
  - [ ] Subscription status shows correctly
  - [ ] "Manage Billing" links to PayPal correctly
  - [ ] Renewal date displays correctly

- [ ] **Referrals**
  - [ ] Share referral link
  - [ ] Signup with ref code captures referrer
  - [ ] Referrer gets +30 days Pro after referred user subscribes
  - [ ] Referral count displays correctly

### Performance Testing
- [ ] Load home page: <2 sec (Vercel + CDN)
- [ ] Load journal with 100 trades: <3 sec
- [ ] Trade image upload: <5 sec (R2)
- [ ] No console errors in DevTools

### Security Testing
- [ ] RLS blocks cross-user data access (test with multiple users)
- [ ] Subscription fields protected from user updates
- [ ] Edge functions validate JWT/service role
- [ ] No secrets exposed in HTML/JS (hardcoded anon key is OK per Supabase docs)

### Browser Compatibility
- [ ] Chrome/Edge (latest)
- [ ] Firefox (latest)
- [ ] Safari (latest)
- [ ] Mobile Safari (iOS)
- [ ] Chrome Mobile (Android)

---

## Deployment Steps

Once all ✅ above are complete:

1. **Merge code to `main` branch**
   ```bash
   git checkout main
   git merge development
   git push origin main
   ```

2. **Deploy to Vercel** (if not auto-deployed)
   ```bash
   vercel --prod
   ```

3. **Deploy Supabase edge functions**
   ```bash
   supabase functions deploy
   ```

4. **Verify in production**
   - Visit `https://yourdomain.com`
   - Run through "Functional Testing" checklist above
   - Monitor Sentry dashboard for errors

5. **Post-Launch Monitoring** (Day 1)
   - Check Sentry for any errors
   - Monitor Supabase function logs
   - Watch PayPal webhook delivery status
   - Check R2 image uploads
   - Monitor database read/write usage

---

## Contacts & Links

- **PayPal Developer Dashboard:** https://developer.paypal.com
- **Supabase Dashboard:** https://app.supabase.com
- **Vercel Dashboard:** https://vercel.com/dashboard
- **Sentry Dashboard:** https://sentry.io/organizations/

---

## Notes

- All code changes have been merged (PayPal URLs, referral bug, test functions removed)
- `.env.example` created for developer reference
- Next step: Verify PayPal production configuration in Supabase secrets
- Then: Complete QA testing checklist
- Finally: Deploy to production

**Timeline Estimate:** 1-2 hours for verification + testing
