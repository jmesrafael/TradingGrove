-- Adds a per-journal toggle for showing the equity-curve sparkline on the
-- dashboard journal card. Mirrors the existing show_pnl / show_capital flags.
ALTER TABLE public.journals
  ADD COLUMN IF NOT EXISTS show_equity boolean NOT NULL DEFAULT true;
