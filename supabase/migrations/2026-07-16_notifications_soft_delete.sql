-- =============================================================
-- Admin -> user notifications + soft-delete accounts
-- Date: 2026-07-16
--
-- 1) notifications  - messages sent by the admin tool to a user,
--    surfaced as a bell/inbox on the user dashboard.
--      * INSERT: service role only (local admin tool). No client
--        insert policy on purpose.
--      * SELECT: users read their own rows.
--      * UPDATE: users may ONLY set read_at on their own rows
--        (column-level grant; title/body are immutable to clients).
--      * Realtime enabled so the dashboard badge updates live.
--
-- 2) profiles.deleted_at - soft-delete marker. Set by the
--    delete-account edge function (service role) instead of erasing
--    data. Deleted accounts are banned in auth and hidden from the
--    admin Users view; they appear in the admin "Deleted" view until
--    permanently purged from there.
-- =============================================================

-- -------------------------------------------------------------
-- notifications
-- -------------------------------------------------------------
create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  title       text not null check (char_length(title) between 1 and 120),
  body        text not null check (char_length(body) between 1 and 2000),
  read_at     timestamptz,          -- null = unread
  created_at  timestamptz not null default now()
);

create index if not exists notifications_user_created_idx
  on public.notifications (user_id, created_at desc);

alter table public.notifications enable row level security;

-- Users can read their own notifications
drop policy if exists notifications_select_own on public.notifications;
create policy notifications_select_own
  on public.notifications for select
  to authenticated
  using (auth.uid() = user_id);

-- Users can update their own rows, but the column-level grant below
-- restricts client writes to read_at only (mark-as-read).
drop policy if exists notifications_update_own on public.notifications;
create policy notifications_update_own
  on public.notifications for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

revoke update on public.notifications from authenticated;
grant  update (read_at) on public.notifications to authenticated;

-- Deliberately NO insert/delete policies: rows are created exclusively
-- by the service role (local admin tool) and removed via user cascade.

-- Realtime publication so the dashboard bell updates without reload
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END IF;
END $$;

-- -------------------------------------------------------------
-- profiles.deleted_at (soft delete)
-- -------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- Update the protection trigger so clients cannot set/clear deleted_at
-- themselves. Full body copied from 2026-05-12_paypal_integration.sql
-- (the latest definition) with only deleted_at added to the revert list.
CREATE OR REPLACE FUNCTION public.protect_subscription_fields()
  RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  caller_role text;
BEGIN
  BEGIN
    caller_role := current_setting('request.jwt.claims', true)::jsonb->>'role';
  EXCEPTION WHEN OTHERS THEN
    caller_role := NULL;
  END;

  IF caller_role IS DISTINCT FROM 'service_role' THEN
    NEW.plan                    := OLD.plan;
    NEW.plan_type               := OLD.plan_type;
    NEW.subscription_expires_at := OLD.subscription_expires_at;
    NEW.stripe_customer_id      := OLD.stripe_customer_id;
    NEW.stripe_subscription_id  := OLD.stripe_subscription_id;
    NEW.paypal_subscription_id  := OLD.paypal_subscription_id;
    NEW.payment_gateway         := OLD.payment_gateway;
    NEW.referred_by             := OLD.referred_by;
    NEW.referral_code           := OLD.referral_code;
    NEW.referral_count          := OLD.referral_count;
    NEW.deleted_at              := OLD.deleted_at;
  END IF;
  RETURN NEW;
END;
$$;
