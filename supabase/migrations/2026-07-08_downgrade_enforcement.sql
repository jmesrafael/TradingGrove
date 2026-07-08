-- ─────────────────────────────────────────────────────────────────────────────
-- Downgrade enforcement — grace period + read-only journals for lapsed Pro users
--
-- Client-side gating (dashboard.js / journal.js / logs.js / notes.js) already
-- keeps the UI honest, but it can be bypassed from the browser console. This
-- migration adds the server-side guarantee:
--   1. Two new profile columns to track downgrade state.
--   2. effective_is_pro() / is_journal_locked() helpers mirroring the 3-day
--      grace window computed client-side in getSubscriptionStatus()
--      (src/js/lib/supabase-client.js — GRACE_DAYS).
--   3. Write-guard policies on journals/trades/trade_images/journal_settings.
--
-- Existing tables each had a single blanket "_all" USING (auth.uid()=user_id)
-- policy (verified via pg_policies before writing this migration — there was
-- no prior migration file for these tables). We replace each with an
-- unrestricted SELECT policy (locked journals must stay visible/read-only,
-- never hidden) plus separate INSERT/UPDATE/DELETE policies that add the
-- lock/cap guard on top of the original own-row check.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. New profile columns ──────────────────────────────────────────────────
-- Not part of protect_subscription_fields()'s revert list (2026-04-30 migration),
-- so the client can write them directly.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS free_active_journal_id uuid REFERENCES journals(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS downgrade_ack_at timestamptz;


-- ── 2. Helper functions ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.effective_is_pro(uid uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT plan = 'pro' AND (
       plan_type = 'lifetime'
       OR subscription_expires_at + interval '3 days' > now()
     )
     FROM profiles WHERE id = uid),
    false
  );
$$;

-- A journal is locked when its owner's Pro plan has fully lapsed (past the
-- 3-day grace period) AND the owner has chosen a different journal to keep
-- active. If no choice has been made yet (free_active_journal_id is null —
-- e.g. a user with only one journal was never asked to choose), nothing is
-- locked. Keep the grace interval identical to GRACE_DAYS in supabase-client.js.
CREATE OR REPLACE FUNCTION public.is_journal_locked(j_id uuid, uid uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT plan = 'pro'
       AND plan_type <> 'lifetime'
       AND subscription_expires_at + interval '3 days' < now()
       AND free_active_journal_id IS NOT NULL
       AND j_id IS DISTINCT FROM free_active_journal_id
     FROM profiles WHERE id = uid),
    false
  );
$$;


-- ── 3. journals ──────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "journals_all" ON journals;

CREATE POLICY "journals_select_own" ON journals
  FOR SELECT USING (auth.uid() = user_id);

-- Server-side 1-journal cap for the Free plan (mirrors dashboard.js openCreate).
CREATE POLICY "journals_insert_own" ON journals
  FOR INSERT WITH CHECK (
    auth.uid() = user_id
    AND (
      effective_is_pro(auth.uid())
      OR (SELECT count(*) FROM journals WHERE user_id = auth.uid()) < 1
    )
  );

CREATE POLICY "journals_update_own" ON journals
  FOR UPDATE
  USING     (auth.uid() = user_id AND NOT is_journal_locked(id, auth.uid()))
  WITH CHECK(auth.uid() = user_id AND NOT is_journal_locked(id, auth.uid()));

CREATE POLICY "journals_delete_own" ON journals
  FOR DELETE USING (auth.uid() = user_id AND NOT is_journal_locked(id, auth.uid()));


-- ── 4. trades ────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "trades_all" ON trades;

CREATE POLICY "trades_select_own" ON trades
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "trades_insert_own" ON trades
  FOR INSERT WITH CHECK (auth.uid() = user_id AND NOT is_journal_locked(journal_id, auth.uid()));

CREATE POLICY "trades_update_own" ON trades
  FOR UPDATE
  USING     (auth.uid() = user_id AND NOT is_journal_locked(journal_id, auth.uid()))
  WITH CHECK(auth.uid() = user_id AND NOT is_journal_locked(journal_id, auth.uid()));

CREATE POLICY "trades_delete_own" ON trades
  FOR DELETE USING (auth.uid() = user_id AND NOT is_journal_locked(journal_id, auth.uid()));


-- ── 5. trade_images (no journal_id column — join through trades) ────────────
DROP POLICY IF EXISTS "images_all" ON trade_images;

CREATE POLICY "trade_images_select_own" ON trade_images
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "trade_images_insert_own" ON trade_images
  FOR INSERT WITH CHECK (
    auth.uid() = user_id
    AND NOT is_journal_locked((SELECT journal_id FROM trades WHERE id = trade_id), auth.uid())
  );

CREATE POLICY "trade_images_update_own" ON trade_images
  FOR UPDATE
  USING     (auth.uid() = user_id AND NOT is_journal_locked((SELECT journal_id FROM trades WHERE id = trade_id), auth.uid()))
  WITH CHECK(auth.uid() = user_id AND NOT is_journal_locked((SELECT journal_id FROM trades WHERE id = trade_id), auth.uid()));

CREATE POLICY "trade_images_delete_own" ON trade_images
  FOR DELETE USING (
    auth.uid() = user_id
    AND NOT is_journal_locked((SELECT journal_id FROM trades WHERE id = trade_id), auth.uid())
  );


-- ── 6. journal_settings ──────────────────────────────────────────────────────
DROP POLICY IF EXISTS "settings_all" ON journal_settings;

CREATE POLICY "journal_settings_select_own" ON journal_settings
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "journal_settings_insert_own" ON journal_settings
  FOR INSERT WITH CHECK (auth.uid() = user_id AND NOT is_journal_locked(journal_id, auth.uid()));

CREATE POLICY "journal_settings_update_own" ON journal_settings
  FOR UPDATE
  USING     (auth.uid() = user_id AND NOT is_journal_locked(journal_id, auth.uid()))
  WITH CHECK(auth.uid() = user_id AND NOT is_journal_locked(journal_id, auth.uid()));

CREATE POLICY "journal_settings_delete_own" ON journal_settings
  FOR DELETE USING (auth.uid() = user_id AND NOT is_journal_locked(journal_id, auth.uid()));


-- ── 7. custom_notes (Notes tab — Pro feature, also journal-lock guarded) ─────
DROP POLICY IF EXISTS "Users manage own custom notes" ON custom_notes;

CREATE POLICY "custom_notes_select_own" ON custom_notes
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "custom_notes_insert_own" ON custom_notes
  FOR INSERT WITH CHECK (auth.uid() = user_id AND NOT is_journal_locked(journal_id, auth.uid()));

CREATE POLICY "custom_notes_update_own" ON custom_notes
  FOR UPDATE
  USING     (auth.uid() = user_id AND NOT is_journal_locked(journal_id, auth.uid()))
  WITH CHECK(auth.uid() = user_id AND NOT is_journal_locked(journal_id, auth.uid()));

CREATE POLICY "custom_notes_delete_own" ON custom_notes
  FOR DELETE USING (auth.uid() = user_id AND NOT is_journal_locked(journal_id, auth.uid()));
