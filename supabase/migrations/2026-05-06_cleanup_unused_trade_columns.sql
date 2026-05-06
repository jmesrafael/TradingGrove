-- =========================================================================
-- TradingGrove — Remove Unused Trade Columns
--
-- SAFE TO RUN: These columns are verified to be:
-- ✅ Never populated by createTrade() or updateTrade()
-- ✅ Never selected or queried in TRADES_COLUMNS
-- ✅ Not referenced in supabase.js or any migrations
-- ✅ Not part of the new checklist system (pre-session refactor)
-- ✅ No triggers or functions depend on them
--
-- Run in Supabase SQL editor (or via `supabase db push`).
-- Idempotent: safe to re-run.
-- =========================================================================

BEGIN;

-- Step 1: Verify these columns exist before dropping
-- (informational only; migration will succeed even if columns don't exist)
DO $$
DECLARE
  v_trade_intent_id_exists BOOLEAN;
  v_pre_session_id_exists BOOLEAN;
  v_checklist_score_exists BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'trades' AND column_name = 'trade_intent_id'
  ) INTO v_trade_intent_id_exists;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'trades' AND column_name = 'pre_session_id'
  ) INTO v_pre_session_id_exists;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'trades' AND column_name = 'checklist_score'
  ) INTO v_checklist_score_exists;

  RAISE NOTICE 'Column existence check: trade_intent_id=%, pre_session_id=%, checklist_score=%',
    v_trade_intent_id_exists, v_pre_session_id_exists, v_checklist_score_exists;
END $$;


-- Step 2: Drop any foreign key constraints (if they exist)
-- (These reference pre_sessions and trade_intents tables)
DO $$
DECLARE
  constraint_name TEXT;
BEGIN
  -- Check for trade_intent_id FK
  SELECT tc.constraint_name INTO constraint_name
  FROM information_schema.table_constraints tc
  WHERE tc.table_schema = 'public'
    AND tc.table_name = 'trades'
    AND tc.constraint_type = 'FOREIGN KEY'
    AND tc.constraint_name LIKE '%trade_intent%';

  IF constraint_name IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.trades DROP CONSTRAINT ' || constraint_name;
    RAISE NOTICE 'Dropped foreign key constraint: %', constraint_name;
  END IF;

  -- Check for pre_session_id FK
  SELECT tc.constraint_name INTO constraint_name
  FROM information_schema.table_constraints tc
  WHERE tc.table_schema = 'public'
    AND tc.table_name = 'trades'
    AND tc.constraint_type = 'FOREIGN KEY'
    AND tc.constraint_name LIKE '%pre_session%';

  IF constraint_name IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.trades DROP CONSTRAINT ' || constraint_name;
    RAISE NOTICE 'Dropped foreign key constraint: %', constraint_name;
  END IF;
END $$;


-- Step 3: Drop any indexes on these columns
DO $$
DECLARE
  index_name TEXT;
BEGIN
  FOR index_name IN
    SELECT pi.indexname FROM pg_indexes pi
    WHERE pi.schemaname = 'public' AND pi.tablename = 'trades'
      AND (pi.indexdef LIKE '%trade_intent_id%'
           OR pi.indexdef LIKE '%pre_session_id%'
           OR pi.indexdef LIKE '%checklist_score%')
  LOOP
    EXECUTE 'DROP INDEX IF EXISTS public.' || index_name;
    RAISE NOTICE 'Dropped index: %', index_name;
  END LOOP;
END $$;


-- Step 4: Drop the unused columns from trades table
-- Using IF EXISTS for idempotency
ALTER TABLE public.trades
  DROP COLUMN IF EXISTS checklist_score,
  DROP COLUMN IF EXISTS trade_intent_id,
  DROP COLUMN IF EXISTS pre_session_id;


-- Step 5: Verify the cleanup (informational)
DO $$
DECLARE
  trade_intent_id_still_exists BOOLEAN;
  pre_session_id_still_exists BOOLEAN;
  checklist_score_still_exists BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'trades' AND column_name = 'trade_intent_id'
  ) INTO trade_intent_id_still_exists;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'trades' AND column_name = 'pre_session_id'
  ) INTO pre_session_id_still_exists;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'trades' AND column_name = 'checklist_score'
  ) INTO checklist_score_still_exists;

  IF NOT trade_intent_id_still_exists AND NOT pre_session_id_still_exists AND NOT checklist_score_still_exists THEN
    RAISE NOTICE '✅ Cleanup successful: All unused columns removed from trades';
  ELSE
    RAISE WARNING '⚠️ Some columns still exist: trade_intent_id=%, pre_session_id=%, checklist_score=%',
      trade_intent_id_still_exists, pre_session_id_still_exists, checklist_score_still_exists;
  END IF;
END $$;

COMMIT;
