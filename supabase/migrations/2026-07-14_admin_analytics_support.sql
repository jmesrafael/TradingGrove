-- =============================================================
-- Admin analytics + support messages
-- Date: 2026-07-14
--
-- Adds two tables consumed by the LOCAL admin tool (admin/, never
-- deployed) and written by lightweight client hooks in the app:
--
--   app_events        - product analytics events (page visits, key
--                       actions). Clients can only INSERT their own
--                       rows; nobody but the service role can read.
--   support_messages  - in-app support/feedback messages. Clients
--                       INSERT their own rows and can SELECT their own
--                       (to see sent history + status); only the
--                       service role can read all or update status.
--
-- Rate limiting: intentionally none at the DB level. The client
-- dedupes page visits (30-minute sessionStorage TTL) and the support
-- form is manual. Revisit if abuse appears.
-- =============================================================

-- -------------------------------------------------------------
-- app_events
-- -------------------------------------------------------------
create table if not exists public.app_events (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  event       text not null check (char_length(event) <= 60),
  page        text check (char_length(page) <= 120),
  meta        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists app_events_created_at_idx on public.app_events (created_at);
create index if not exists app_events_user_created_idx on public.app_events (user_id, created_at);
create index if not exists app_events_event_idx on public.app_events (event);

alter table public.app_events enable row level security;

-- Clients may only insert rows for themselves. There is deliberately
-- NO select/update/delete policy: reads happen exclusively through the
-- service role (local admin tool).
drop policy if exists app_events_insert_own on public.app_events;
create policy app_events_insert_own
  on public.app_events for insert
  to authenticated
  with check (auth.uid() = user_id);

-- -------------------------------------------------------------
-- support_messages
-- -------------------------------------------------------------
create table if not exists public.support_messages (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  subject     text not null check (char_length(subject) between 1 and 200),
  message     text not null check (char_length(message) between 1 and 5000),
  status      text not null default 'new' check (status in ('new','read','resolved')),
  created_at  timestamptz not null default now()
);

create index if not exists support_messages_status_created_idx on public.support_messages (status, created_at desc);
create index if not exists support_messages_user_idx on public.support_messages (user_id);

alter table public.support_messages enable row level security;

-- Any authenticated user can send a message (admin UI shows a
-- Pro/Free badge per sender; access is intentionally not Pro-gated).
drop policy if exists support_messages_insert_own on public.support_messages;
create policy support_messages_insert_own
  on public.support_messages for insert
  to authenticated
  with check (auth.uid() = user_id);

-- Users can see their own sent messages (and the status we set), but
-- cannot update or delete them. Status changes are service-role only.
drop policy if exists support_messages_select_own on public.support_messages;
create policy support_messages_select_own
  on public.support_messages for select
  to authenticated
  using (auth.uid() = user_id);
