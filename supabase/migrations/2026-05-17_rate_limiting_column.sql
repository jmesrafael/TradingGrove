-- Add last_checkout_attempt column to profiles for payment rate limiting (60s cooldown)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS last_checkout_attempt timestamptz;
