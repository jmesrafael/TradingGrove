# Database Schema

> Authoritative schema lives in [`supabase/migrations/`](../supabase/migrations/). This document is a high-level overview, not a generated reference — the migrations are the source of truth.

## Core Tables

### `profiles`

One row per authenticated user. Created by a Postgres trigger on `auth.users` insert. RLS enabled — users can read/update their own row only.

| Column | Type | Purpose |
|---|---|---|
| `id` | uuid (PK, FK → auth.users.id) | Supabase user ID |
| `name` | text | Display name |
| `plan` | text | `free` / `pro` |
| `plan_type` | text | `none` / `monthly` / `yearly` / `lifetime` |
| `stripe_customer_id` | text | Stripe customer (null if Pro via referral only) |
| `stripe_subscription_id` | text | Active Stripe subscription |
| `subscription_expires_at` | timestamptz | Pro access cutoff |
| `referral_code` | text | This user's shareable code |
| `referred_by` | uuid (FK → profiles.id) | Who referred this user |
| `referral_count` | integer | Successful paid referrals |
| Theme / font fields | various | Persisted UI prefs (applied by [`theme.js`](../src/js/lib/theme.js)) |

**Subscription field protection:** all of `plan`, `plan_type`, `stripe_*`, `subscription_expires_at`, and `referral_count` are **silently reverted** by a Postgres trigger if updated by a non-`service_role` caller. Only edge functions (which use the service-role key) can change billing state. See [`2026-04-30_profiles_rls_subscription_protection.sql`](../supabase/migrations/2026-04-30_profiles_rls_subscription_protection.sql).

### `journals`

User-created trading journals. Free users get 1; Pro users unlimited.

| Column | Type | Purpose |
|---|---|---|
| `id` | uuid (PK) | |
| `user_id` | uuid (FK → profiles.id) | Owner |
| `name` | text | "Forex", "Crypto", etc. |
| `starting_capital` | numeric | Initial account balance |
| `pin_hash`, `pin_salt` | text | Optional Pro PIN protection |
| `created_at` | timestamptz | |

### `journal_settings`

Per-user UI preferences for the journal (display options, mood colours, custom tags).

### `trades`

The main log. RLS scoped to `user_id`.

Key columns: `id`, `user_id`, `journal_id`, `pair`, `direction` (long/short), `entry`, `stop_loss`, `take_profit`, `pnl`, `r_factor`, `strategy`, `timeframe`, `mood`, `notes`, `entry_at`, `exit_at`.

### `trade_images`

One-to-many with `trades`. Stores R2 public URLs, not the image bytes themselves. Pro feature.

| Column | Purpose |
|---|---|
| `id`, `trade_id`, `user_id` | |
| `url` | R2 public URL |
| `key` | R2 object key (for deletion) |
| `created_at` | |

### `custom_notes`

Free-form notes panel inside journals.

### `referrals`

| Column | Purpose |
|---|---|
| `id` | |
| `referrer_id` (FK → profiles.id) | Who shared the code |
| `referred_user_id` (FK → profiles.id) | Who signed up with the code |
| `status` | `pending` / `rewarded` |
| `reward_granted` | boolean — set true by `grant-referral-reward` |
| `created_at` | |

## Row-Level Security (RLS)

RLS is on for every user-data table. Policies follow the same pattern:

```sql
CREATE POLICY "{table}_select_own" ON {table}
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "{table}_modify_own" ON {table}
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
```

Edge functions bypass RLS by using `SUPABASE_SERVICE_ROLE_KEY`.

## Storage

**Trade screenshots** live in **Cloudflare R2**, not Supabase Storage. The flow:

1. Client requests a presigned URL via [`generate-r2-upload-url`](../supabase/functions/generate-r2-upload-url/)
2. Client `PUT`s the file directly to R2
3. Client inserts a row into `trade_images` with the public URL

Object keys follow `trades/{user_id}/{trade_id}/{timestamp}-{random}-{name}.{ext}` for user/trade isolation.

## Migrations

Located in [`supabase/migrations/`](../supabase/migrations/), filenames `YYYY-MM-DD_short_description.sql`:

| File | Purpose |
|---|---|
| `2026-04-25_notes_pin_and_images.sql` | Notes pinning + trade image schema |
| `2026-04-26_presession_checklist_refactor.sql` | Pre-session checklist data model |
| `2026-04-26_presession_mood_options.sql` | Pre-session mood option list |
| `2026-04-30_profiles_rls_subscription_protection.sql` | RLS + trigger to protect billing fields |
| `2026-05-06_cleanup_unused_trade_columns.sql` | Drop unused columns from `trades` |

Apply with:

```bash
supabase db push
```
