-- =========================================================================
-- TradingGrove — Pre-Session: per-set mood_options
-- Adds a configurable list of mood chips to each checklist set so each
-- session can define its own mood defaults (the resettable
-- session_mood lives on presession_checklist_set_state and is unchanged).
-- Idempotent.
-- =========================================================================

ALTER TABLE public.presession_checklist_sets
  ADD COLUMN IF NOT EXISTS mood_options jsonb NOT NULL
  DEFAULT '["😊 Calm","🎯 Focused","😤 Frustrated","😰 Anxious","🤑 Greedy","😴 Tired","💪 Confident"]'::jsonb;

-- Backfill any rows that somehow have NULL (defensive — column is NOT NULL
-- with a default, so this should be a no-op on most installs).
UPDATE public.presession_checklist_sets
   SET mood_options = '["😊 Calm","🎯 Focused","😤 Frustrated","😰 Anxious","🤑 Greedy","😴 Tired","💪 Confident"]'::jsonb
 WHERE mood_options IS NULL;
