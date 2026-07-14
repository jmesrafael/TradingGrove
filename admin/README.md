# TradingGrove Superadmin (local only)

A local management panel for TradingGrove: every signed-up user, Pro grants with
validity in days (or lifetime), storage usage, product analytics, and support
messages sent from the app.

## Why this is safe to have in the repo

- `build.js` copies **only `src/`** to `public/`, and Vercel serves only `public/`.
  This folder physically cannot deploy.
- The Supabase **service_role key** lives only in `admin/.env`, which is gitignored
  (the repo-root `.gitignore` ignores every `.env`). Never put it anywhere under `src/`.
- The server binds to `127.0.0.1` only; it is not reachable from your network.
- The username/password login is a convenience gate on top of that, not the
  primary defense.

## Setup (one time)

1. Copy the env template and fill it in:

       cp admin/.env.example admin/.env

   - `SUPABASE_SERVICE_ROLE_KEY`: Supabase dashboard -> Project Settings -> API
     -> `service_role` (secret). This bypasses RLS; keep it on this machine.
   - `ADMIN_USER` / `ADMIN_PASS`: the local login (defaults Rafael / admin123 -
     change them).
   - Optional R2 credentials (see Storage below).

2. Run the database migration that creates the `app_events` and
   `support_messages` tables (once, against production):

       npm run deploy:db
       # or paste supabase/migrations/2026-07-14_admin_analytics_support.sql
       # into the Supabase SQL editor

3. Start the panel:

       npm run admin          # from the repo root
       # -> http://127.0.0.1:5600

   Try it without any keys first: set `MOCK=1` in `admin/.env` (or
   `MOCK=1 node admin/server.js`) to explore the UI with fixture data.

## What each tab shows

- **Users** - everyone in `auth.users` joined with `profiles`: email, name, plan
  badge (with 3-day grace, expiring, lifetime), plan type, expiry + days left,
  payment gateway, journals/trades/images counts, joined and last-seen dates.
  - **Grant Pro**: days stack on the current expiry exactly like paid renewals
    (`upgradePlan()` in the payment webhooks). Lifetime sets `plan_type='lifetime'`.
    Grants use `plan_type='gifted'` and fall back to `'referral'` if the DB
    constrains the column.
  - **Revoke**: drops to Free immediately (mirror of `downgradePlan()`); user data
    is never touched.
- **Analytics** - reads `app_events`: daily active users, visits by page, events
  by type, most active users. Events come from `src/js/lib/track.js` (page visits
  deduped per 30 minutes per page) plus key actions: `trade_added`,
  `image_uploaded`, `export_used`, `support_sent`.
- **Reports** - messages from the app's `/support` page with sender name/email
  and a Pro/Free badge. Set status new -> read -> resolved; the user sees the
  status on their support page.

## Storage usage

Trade screenshots live primarily in **Cloudflare R2** (`trades/{userId}/...`),
with Supabase Storage as fallback. Sizes are not recorded in the database, so the
panel computes them on demand (cached 10 min):

- Supabase Storage buckets `trade-images` + `custom-note-images`: always counted.
- R2: only when `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` are in
  `admin/.env` (create an R2 API token with Object Read). Then run `npm install`
  inside `admin/` once (installs `aws4fetch`, the only dependency).
  Without them the Storage column shows Supabase bytes and "R2 n/a".

## Endpoints (all behind the login session)

    POST /api/login | /api/logout
    GET  /api/users            list users (60s cache; ?refresh=1 to force)
    POST /api/users/:id/grant  { days } or { lifetime: true }
    POST /api/users/:id/revoke
    GET  /api/users/:id/storage
    GET  /api/analytics?days=30
    GET  /api/reports
    POST /api/reports/:id/status  { status: new|read|resolved }
