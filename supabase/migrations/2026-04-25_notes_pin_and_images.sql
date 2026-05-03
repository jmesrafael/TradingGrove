-- =========================================================================
-- TradingGrove — Notes pinning + custom note images
-- Run in Supabase SQL editor (or via `supabase db push`).
-- Idempotent: safe to re-run.
-- =========================================================================

-- 1) Pin support on trades --------------------------------------------------
-- Allows pinning individual trade notes directly from the Logs page.
ALTER TABLE public.trades
  ADD COLUMN IF NOT EXISTS pinned boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS trades_pinned_idx
  ON public.trades (journal_id, pinned)
  WHERE pinned = true;

-- 2) Image support on custom_notes -----------------------------------------
-- Stores an array of { storage_url, path } objects (or plain URLs) so
-- custom notes can carry images just like trade notes do.
ALTER TABLE public.custom_notes
  ADD COLUMN IF NOT EXISTS images jsonb NOT NULL DEFAULT '[]'::jsonb;

-- 3) Storage bucket for custom-note images ---------------------------------
-- Mirrors the existing 'trade-images' bucket. Private; access via signed URLs.
INSERT INTO storage.buckets (id, name, public)
VALUES ('custom-note-images', 'custom-note-images', false)
ON CONFLICT (id) DO NOTHING;

-- 4) RLS policies on the new bucket ----------------------------------------
-- Users can only see/manipulate files under their own user-id prefix:
--   <user_id>/<note_id>/<filename>

DROP POLICY IF EXISTS "custom_note_images_select_own"  ON storage.objects;
DROP POLICY IF EXISTS "custom_note_images_insert_own"  ON storage.objects;
DROP POLICY IF EXISTS "custom_note_images_update_own"  ON storage.objects;
DROP POLICY IF EXISTS "custom_note_images_delete_own"  ON storage.objects;

CREATE POLICY "custom_note_images_select_own"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'custom-note-images'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "custom_note_images_insert_own"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'custom-note-images'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "custom_note_images_update_own"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'custom-note-images'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "custom_note_images_delete_own"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'custom-note-images'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
