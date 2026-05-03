-- =========================================================================
-- TradingGrove — Pre-Session checklist refactor
-- Removes legacy date-bound presession structures and introduces a
-- normalized, decoupled checklist system: sets (config) + items (definitions)
-- + state (resettable runtime).
--
-- Run in Supabase SQL editor (or via `supabase db push`).
-- Idempotent: safe to re-run.
-- =========================================================================

-- ─────────────────────────────────────────────────────────────────────────
-- 1) DROP LEGACY OBJECTS
--    Old presessions / presession_settings tables, triggers, indexes are
--    tightly coupled to session_date and no longer match the design.
-- ─────────────────────────────────────────────────────────────────────────
DROP TABLE IF EXISTS public.presessions          CASCADE;
DROP TABLE IF EXISTS public.presession_settings  CASCADE;

-- The legacy implementation also stashed checklist data on journal_settings.
-- Drop those columns so all checklist data lives in the new tables.
ALTER TABLE public.journal_settings
  DROP COLUMN IF EXISTS trade_rules,
  DROP COLUMN IF EXISTS checklist_items;


-- ─────────────────────────────────────────────────────────────────────────
-- 2) presession_checklist_sets — persistent configuration per group
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.presession_checklist_sets (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL REFERENCES auth.users(id)         ON DELETE CASCADE,
  journal_id      uuid        NOT NULL REFERENCES public.journals(id)    ON DELETE CASCADE,
  name            text        NOT NULL,
  description     text        NOT NULL DEFAULT '',
  reset_enabled   boolean     NOT NULL DEFAULT true,
  reset_time      time        NOT NULL DEFAULT '00:00',
  position        integer     NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS presession_checklist_sets_journal_idx
  ON public.presession_checklist_sets (journal_id, position);

CREATE INDEX IF NOT EXISTS presession_checklist_sets_user_idx
  ON public.presession_checklist_sets (user_id);


-- ─────────────────────────────────────────────────────────────────────────
-- 3) presession_checklist_items — persistent item definitions
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.presession_checklist_items (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  set_id      uuid        NOT NULL REFERENCES public.presession_checklist_sets(id) ON DELETE CASCADE,
  label       text        NOT NULL,
  order_index integer     NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS presession_checklist_items_set_idx
  ON public.presession_checklist_items (set_id, order_index);


-- ─────────────────────────────────────────────────────────────────────────
-- 4) presession_checklist_state — transient per-item state (the bit that
--    "resets"). One row per item; we mutate is_checked + last_reset_at.
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.presession_checklist_state (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  set_id          uuid        NOT NULL REFERENCES public.presession_checklist_sets(id)  ON DELETE CASCADE,
  item_id         uuid        NOT NULL REFERENCES public.presession_checklist_items(id) ON DELETE CASCADE,
  user_id         uuid        NOT NULL REFERENCES auth.users(id)                        ON DELETE CASCADE,
  is_checked      boolean     NOT NULL DEFAULT false,
  last_reset_at   timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (item_id)
);

CREATE INDEX IF NOT EXISTS presession_checklist_state_set_idx
  ON public.presession_checklist_state (set_id);


-- ─────────────────────────────────────────────────────────────────────────
-- 5) presession_checklist_set_state — transient set-level state
--    Holds session_mood / market_bias (resettable) plus reset bookkeeping
--    and the one-shot logs prompt timestamp.
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.presession_checklist_set_state (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  set_id            uuid        NOT NULL REFERENCES public.presession_checklist_sets(id) ON DELETE CASCADE,
  user_id           uuid        NOT NULL REFERENCES auth.users(id)                       ON DELETE CASCADE,
  session_mood      text,
  market_bias       text,
  last_reset_at     timestamptz NOT NULL DEFAULT now(),
  last_prompted_at  timestamptz,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (set_id)
);


-- ─────────────────────────────────────────────────────────────────────────
-- 6) updated_at maintenance trigger
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tz_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pcs_touch ON public.presession_checklist_sets;
CREATE TRIGGER trg_pcs_touch
  BEFORE UPDATE ON public.presession_checklist_sets
  FOR EACH ROW EXECUTE FUNCTION public.tz_touch_updated_at();

DROP TRIGGER IF EXISTS trg_pci_touch ON public.presession_checklist_items;
CREATE TRIGGER trg_pci_touch
  BEFORE UPDATE ON public.presession_checklist_items
  FOR EACH ROW EXECUTE FUNCTION public.tz_touch_updated_at();

DROP TRIGGER IF EXISTS trg_pcst_touch ON public.presession_checklist_state;
CREATE TRIGGER trg_pcst_touch
  BEFORE UPDATE ON public.presession_checklist_state
  FOR EACH ROW EXECUTE FUNCTION public.tz_touch_updated_at();

DROP TRIGGER IF EXISTS trg_pcsst_touch ON public.presession_checklist_set_state;
CREATE TRIGGER trg_pcsst_touch
  BEFORE UPDATE ON public.presession_checklist_set_state
  FOR EACH ROW EXECUTE FUNCTION public.tz_touch_updated_at();


-- ─────────────────────────────────────────────────────────────────────────
-- 7) Row-Level Security
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE public.presession_checklist_sets       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.presession_checklist_items      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.presession_checklist_state      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.presession_checklist_set_state  ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  -- sets: owner-only
  DROP POLICY IF EXISTS pcs_select_own ON public.presession_checklist_sets;
  DROP POLICY IF EXISTS pcs_insert_own ON public.presession_checklist_sets;
  DROP POLICY IF EXISTS pcs_update_own ON public.presession_checklist_sets;
  DROP POLICY IF EXISTS pcs_delete_own ON public.presession_checklist_sets;
END $$;

CREATE POLICY pcs_select_own ON public.presession_checklist_sets
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY pcs_insert_own ON public.presession_checklist_sets
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY pcs_update_own ON public.presession_checklist_sets
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY pcs_delete_own ON public.presession_checklist_sets
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- items: scoped via parent set ownership
DO $$
BEGIN
  DROP POLICY IF EXISTS pci_select_own ON public.presession_checklist_items;
  DROP POLICY IF EXISTS pci_insert_own ON public.presession_checklist_items;
  DROP POLICY IF EXISTS pci_update_own ON public.presession_checklist_items;
  DROP POLICY IF EXISTS pci_delete_own ON public.presession_checklist_items;
END $$;

CREATE POLICY pci_select_own ON public.presession_checklist_items
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.presession_checklist_sets s
            WHERE s.id = set_id AND s.user_id = auth.uid())
  );
CREATE POLICY pci_insert_own ON public.presession_checklist_items
  FOR INSERT TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM public.presession_checklist_sets s
            WHERE s.id = set_id AND s.user_id = auth.uid())
  );
CREATE POLICY pci_update_own ON public.presession_checklist_items
  FOR UPDATE TO authenticated USING (
    EXISTS (SELECT 1 FROM public.presession_checklist_sets s
            WHERE s.id = set_id AND s.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM public.presession_checklist_sets s
            WHERE s.id = set_id AND s.user_id = auth.uid())
  );
CREATE POLICY pci_delete_own ON public.presession_checklist_items
  FOR DELETE TO authenticated USING (
    EXISTS (SELECT 1 FROM public.presession_checklist_sets s
            WHERE s.id = set_id AND s.user_id = auth.uid())
  );

-- state: owner-only
DO $$
BEGIN
  DROP POLICY IF EXISTS pcst_select_own ON public.presession_checklist_state;
  DROP POLICY IF EXISTS pcst_insert_own ON public.presession_checklist_state;
  DROP POLICY IF EXISTS pcst_update_own ON public.presession_checklist_state;
  DROP POLICY IF EXISTS pcst_delete_own ON public.presession_checklist_state;
END $$;

CREATE POLICY pcst_select_own ON public.presession_checklist_state
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY pcst_insert_own ON public.presession_checklist_state
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY pcst_update_own ON public.presession_checklist_state
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY pcst_delete_own ON public.presession_checklist_state
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- set state: owner-only
DO $$
BEGIN
  DROP POLICY IF EXISTS pcsst_select_own ON public.presession_checklist_set_state;
  DROP POLICY IF EXISTS pcsst_insert_own ON public.presession_checklist_set_state;
  DROP POLICY IF EXISTS pcsst_update_own ON public.presession_checklist_set_state;
  DROP POLICY IF EXISTS pcsst_delete_own ON public.presession_checklist_set_state;
END $$;

CREATE POLICY pcsst_select_own ON public.presession_checklist_set_state
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY pcsst_insert_own ON public.presession_checklist_set_state
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY pcsst_update_own ON public.presession_checklist_set_state
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY pcsst_delete_own ON public.presession_checklist_set_state
  FOR DELETE TO authenticated USING (user_id = auth.uid());


-- ─────────────────────────────────────────────────────────────────────────
-- 8) Default seed for new journals
--    Each journal automatically gets a starter checklist set with the
--    default items + a friendly description. Fully editable / deletable
--    by the user afterwards.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tz_seed_default_presession_set()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_set_id uuid;
BEGIN
  INSERT INTO public.presession_checklist_sets (user_id, journal_id, name, description, reset_enabled, reset_time, position)
  VALUES (
    NEW.user_id,
    NEW.id,
    'Daily Pre-Session',
    'Run through this checklist before every session. Items reset on the configured schedule; the description and items themselves persist. Edit, reorder, or replace anything below to fit your routine.',
    true,
    '00:00',
    0
  )
  RETURNING id INTO v_set_id;

  INSERT INTO public.presession_checklist_items (set_id, label, order_index) VALUES
    (v_set_id, 'Reviewed higher-timeframe market structure',  0),
    (v_set_id, 'Identified key levels & liquidity zones',     1),
    (v_set_id, 'Checked high-impact news for the session',    2),
    (v_set_id, 'Confirmed today''s bias & invalidation',      3),
    (v_set_id, 'Defined max risk & daily loss limit',         4),
    (v_set_id, 'Mindset: calm, focused, no revenge trading',  5);

  INSERT INTO public.presession_checklist_set_state (set_id, user_id)
  VALUES (v_set_id, NEW.user_id);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_seed_presession_on_journal ON public.journals;
CREATE TRIGGER trg_seed_presession_on_journal
  AFTER INSERT ON public.journals
  FOR EACH ROW EXECUTE FUNCTION public.tz_seed_default_presession_set();


-- ─────────────────────────────────────────────────────────────────────────
-- 9) Backfill: every existing journal that has no set yet gets the seed
-- ─────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  rec RECORD;
  v_set_id uuid;
BEGIN
  FOR rec IN
    SELECT jr.id AS journal_id, jr.user_id AS user_id
    FROM public.journals jr
    LEFT JOIN public.presession_checklist_sets s ON s.journal_id = jr.id
    WHERE s.id IS NULL
  LOOP
    INSERT INTO public.presession_checklist_sets (user_id, journal_id, name, description, reset_enabled, reset_time, position)
    VALUES (
      rec.user_id, rec.journal_id,
      'Daily Pre-Session',
      'Run through this checklist before every session. Items reset on the configured schedule; the description and items themselves persist. Edit, reorder, or replace anything below to fit your routine.',
      true, '00:00', 0
    )
    RETURNING id INTO v_set_id;

    INSERT INTO public.presession_checklist_items (set_id, label, order_index) VALUES
      (v_set_id, 'Reviewed higher-timeframe market structure',  0),
      (v_set_id, 'Identified key levels & liquidity zones',     1),
      (v_set_id, 'Checked high-impact news for the session',    2),
      (v_set_id, 'Confirmed today''s bias & invalidation',      3),
      (v_set_id, 'Defined max risk & daily loss limit',         4),
      (v_set_id, 'Mindset: calm, focused, no revenge trading',  5);

    INSERT INTO public.presession_checklist_set_state (set_id, user_id)
    VALUES (v_set_id, rec.user_id);
  END LOOP;
END $$;


-- ─────────────────────────────────────────────────────────────────────────
-- 10) Realtime publication so the UI can subscribe to checklist changes
-- ─────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.presession_checklist_sets;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.presession_checklist_items;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.presession_checklist_state;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.presession_checklist_set_state;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END IF;
END $$;
