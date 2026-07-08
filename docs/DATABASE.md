# Database Schema

> Authoritative schema lives in [`supabase/migrations/`](../supabase/migrations/). This document is a high-level overview, not a generated reference — the migrations are the source of truth.

## Core Tables

### `profiles`

One row per authenticated user. Created by a Postgres trigger on `auth.users` insert. RLS enabled — users can read/update their own row only.

| Column | Type | Purpose |
|---|---|---|
| `id` | uuid (PK, FK → auth.users.id) | Supabase user ID |
| `name` | text | Display name |
| `plan` | text | `free` / `pro` (default: `free`) |
| `plan_type` | text | `none` / `monthly` / `yearly` / `lifetime` (default: `none`) |
| `stripe_customer_id` | text | Stripe customer (null if Pro via referral only) |
| `stripe_subscription_id` | text | Active Stripe subscription |
| `paypal_subscription_id` | text | Active PayPal subscription |
| `payment_gateway` | text | `stripe` / `paypal` (which gateway user is subscribed via) |
| `subscription_expires_at` | timestamp | Pro access cutoff |
| `referral_code` | text | This user's shareable code |
| `referred_by` | uuid (FK → profiles.id) | Who referred this user |
| `referral_count` | integer | Successful paid referrals (default: 0) |
| `queued_subscription` | jsonb | Pending upgrade to activate when current sub expires `{plan_type, payment_gateway, subscription_id, starts_at}` |
| `last_checkout_attempt` | timestamptz | Last subscription-creation attempt; used by 60s rate limiter |
| `color_theme` | text | UI theme preference (default: `dark`) |
| `font_theme` | text | Font preference (default: `default`) |
| `created_at` | timestamptz | Account creation timestamp |
| `updated_at` | timestamptz | Last update timestamp |

**Subscription field protection:** all of `plan`, `plan_type`, `stripe_*`, `paypal_subscription_id`, `subscription_expires_at`, `referred_by`, `referral_code`, and `referral_count` are **silently reverted** by a Postgres trigger if updated by a non-`service_role` caller. Only edge functions (which use the service-role key) can change billing state. See [`2026-04-30_profiles_rls_subscription_protection.sql`](../supabase/migrations/2026-04-30_profiles_rls_subscription_protection.sql) and the PayPal extension in [`2026-05-12_paypal_integration.sql`](../supabase/migrations/2026-05-12_paypal_integration.sql).

### `journals`

User-created trading journals. Free users get 1; Pro users unlimited.

| Column | Type | Purpose |
|---|---|---|
| `id` | uuid (PK) | |
| `user_id` | uuid (FK → profiles.id) | Owner |
| `name` | text | "Forex", "Crypto", etc. |
| `capital` | numeric | Initial account balance |
| `pin_hash` | text | Optional Pro PIN protection |
| `show_pnl` | boolean | Display PnL in UI (default: true) |
| `show_capital` | boolean | Display capital in UI (default: true) |
| `position` | integer | Sort order for journals list |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

### `journal_settings`

Per-user UI preferences for the journal (display options, mood colours, custom tags).

### `trades`

The main trade execution log. RLS scoped to `user_id`. Records actual executed trades with outcome metrics.

| Column | Type | Purpose |
|---|---|---|
| `id` | uuid (PK) | |
| `journal_id` | uuid (FK) | Associated journal |
| `user_id` | uuid (FK) | Owner |
| `trade_date` | date | Trade execution date |
| `trade_time` | time | Trade execution time |
| `pair` | text | Currency/asset pair (e.g. "EURUSD") |
| `position` | text | Position type (long/short) |
| `strategy` | text[] | Applied strategies (array) |
| `timeframe` | text[] | Used timeframes (array) |
| `pnl` | numeric | Profit/loss amount |
| `r_factor` | numeric | Risk/reward ratio |
| `confidence` | smallint | Confidence level (1-10) |
| `mood` | text[] | Trading mood(s) during trade |
| `notes` | text | Trade notes/observations |
| `pinned` | boolean | Pinned for quick review (default: false) |
| `created_at`, `updated_at` | timestamptz | |

### `trade_images`

One-to-many with `trades`. Stores image URLs and metadata. Pro feature.

| Column | Type | Purpose |
|---|---|---|
| `id` | uuid (PK) | |
| `trade_id` | uuid (FK → trades.id) | Associated trade |
| `user_id` | uuid (FK → profiles.id) | Owner |
| `url` | text | R2/cloud public URL |
| `thumbnail_url` | text | Thumbnail URL for quick load |
| `storage_url` | text | Storage backend URL |
| `data` | text | Legacy: embedded image data (deprecated) |
| `size_bytes` | integer | File size in bytes |
| `mime_type` | text | Image MIME type (e.g. "image/png") |
| `created_at` | timestamptz | |

### `custom_notes`

Free-form notes panel inside journals. Supports pinning, tags, and embedded images.

| Column | Type | Purpose |
|---|---|---|
| `id` | uuid (PK) | |
| `user_id` | uuid (FK) | Owner |
| `journal_id` | uuid (FK) | Associated journal |
| `title` | text | Note title |
| `body` | text | Note content |
| `tags` | text[] | Custom tags |
| `color_label` | text | UI color label |
| `pinned` | boolean | Pinned to top (default: false) |
| `images` | jsonb | Embedded image metadata |
| `created_at`, `updated_at` | timestamptz | |

### `pre_sessions`

Pre-trading session checklists and planning. Tracks mood, bias, key levels, rules, and reflection notes.

| Column | Type | Purpose |
|---|---|---|
| `id` | uuid (PK) | |
| `journal_id` | uuid (FK) | Associated journal |
| `user_id` | uuid (FK) | Owner |
| `session_date` | date | Session date |
| `bias` | text | Market bias (bullish/bearish/neutral) |
| `bias_reason` | text | Why this bias? |
| `key_levels` | jsonb | Important price levels |
| `session_goals` | text | Trading goals for session |
| `rules` | jsonb | Rules to follow |
| `checklist_state` | jsonb | Serialized checklist checkbox states |
| `checklist_score` | integer | Checklist completion score |
| `checklist_snapshot` | text | Serialized checklist snapshot |
| `reflect_mood` | text | Post-session mood |
| `reflect_well` | text | What went well |
| `reflect_wrong` | text | What went wrong |
| `reflect_lesson` | text | Key lesson learned |
| `rules_broken` | jsonb | Which rules were violated |
| `created_at`, `updated_at` | timestamptz | |

### `presession_checklist_sets`

Custom checklist templates for pre-session planning.

| Column | Type | Purpose |
|---|---|---|
| `id` | uuid (PK) | |
| `user_id` | uuid (FK) | Owner |
| `journal_id` | uuid (FK) | Associated journal |
| `name` | text | Checklist set name |
| `description` | text | Description |
| `reset_enabled` | boolean | Auto-reset after certain time |
| `reset_time` | time | Time of day to reset |
| `position` | integer | Sort order |
| `mood_options` | jsonb | Available mood emoji options |
| `created_at`, `updated_at` | timestamptz | |

### `presession_checklist_items`

Individual checklist items within a set.

| Column | Type | Purpose |
|---|---|---|
| `id` | uuid (PK) | |
| `set_id` | uuid (FK → presession_checklist_sets.id) | Parent checklist set |
| `label` | text | Item label |
| `order_index` | integer | Position in list |
| `created_at`, `updated_at` | timestamptz | |

### `presession_checklist_state`

User's checkbox state for each checklist item (tracks if completed).

| Column | Type | Purpose |
|---|---|---|
| `id` | uuid (PK) | |
| `set_id` | uuid (FK) | Parent set |
| `item_id` | uuid (FK) | Checklist item |
| `user_id` | uuid (FK) | Owner |
| `is_checked` | boolean | Checkbox state |
| `last_reset_at` | timestamptz | Last reset timestamp |
| `updated_at` | timestamptz | |

### `presession_checklist_set_state`

Aggregate state for a checklist set (mood, market bias, reset tracking).

| Column | Type | Purpose |
|---|---|---|
| `id` | uuid (PK) | |
| `set_id` | uuid (FK) | Parent checklist set |
| `user_id` | uuid (FK) | Owner |
| `session_mood` | text | Selected mood emoji |
| `market_bias` | text | Market bias selection |
| `last_reset_at` | timestamptz | Last reset time |
| `last_prompted_at` | timestamptz | Last user prompt time |
| `updated_at` | timestamptz | |

### `trade_intents`

Pre-trade setup planning—captures intent before execution (entry price, stop loss, take profit, why trade).

| Column | Type | Purpose |
|---|---|---|
| `id` | uuid (PK) | |
| `pre_session_id` | uuid (FK) | Associated pre-session |
| `journal_id` | uuid (FK) | Associated journal |
| `user_id` | uuid (FK) | Owner |
| `setup_name` | text | Trade setup name |
| `direction` | text | "Long" or "Short" |
| `why_trade` | text | Rationale for trade |
| `entry_price` | numeric | Intended entry price |
| `stop_loss` | numeric | Stop loss level |
| `take_profit` | numeric | Take profit level |
| `invalidation` | text | Invalidation level (when setup breaks) |
| `checklist_score` | integer | Pre-trade checklist score |
| `checklist_snapshot` | text | Checklist state snapshot |
| `trade_id` | uuid (FK → trades.id) | Linked actual trade (null until executed) |
| `created_at`, `updated_at` | timestamptz | |

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
| `2026-05-12_paypal_integration.sql` | Add `payment_gateway` + `paypal_subscription_id` columns, PayPal indexes, update subscription protection trigger |
| `20260512120000_queued_subscriptions.sql` | Add `queued_subscription` jsonb column for upgrade stacking |
| `2026-05-17_rate_limiting_column.sql` | Add `last_checkout_attempt` for payment rate limiting (60s cooldown) |

Apply with:

```bash
supabase db push
```
