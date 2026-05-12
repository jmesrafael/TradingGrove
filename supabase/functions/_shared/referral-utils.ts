import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.0";

interface GrantReferralRewardParams {
  referrerId: string;
  referralId: string;
}

export async function grantReferralReward(
  supabase: ReturnType<typeof createClient>,
  params: GrantReferralRewardParams
): Promise<void> {
  const { referrerId, referralId } = params;

  // Check if reward already granted (idempotent)
  const { data: referral, error: fetchError } = await supabase
    .from("referrals")
    .select("reward_granted")
    .eq("id", referralId)
    .single();

  if (fetchError) {
    throw new Error(`Failed to fetch referral: ${fetchError.message}`);
  }

  if (referral.reward_granted) {
    // Reward already granted, idempotent return
    return;
  }

  // Calculate 30 days from now
  const now = new Date();
  const thirtyDaysLater = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  // Grant 30 days of Pro access to referrer
  const { error: updateProfileError } = await supabase
    .from("profiles")
    .update({
      plan: "pro",
      plan_type: "referral",
      subscription_expires_at: thirtyDaysLater.toISOString(),
    })
    .eq("id", referrerId);

  if (updateProfileError) {
    throw new Error(`Failed to grant pro access: ${updateProfileError.message}`);
  }

  // Mark referral as rewarded
  const { error: updateReferralError } = await supabase
    .from("referrals")
    .update({ reward_granted: true, status: "rewarded" })
    .eq("id", referralId);

  if (updateReferralError) {
    throw new Error(`Failed to mark referral rewarded: ${updateReferralError.message}`);
  }

  // Increment referral_count
  const { data: profile, error: fetchProfileError } = await supabase
    .from("profiles")
    .select("referral_count")
    .eq("id", referrerId)
    .single();

  if (fetchProfileError) {
    throw new Error(`Failed to fetch referrer profile: ${fetchProfileError.message}`);
  }

  const newCount = (profile.referral_count || 0) + 1;

  const { error: incrementError } = await supabase
    .from("profiles")
    .update({ referral_count: newCount })
    .eq("id", referrerId);

  if (incrementError) {
    throw new Error(`Failed to increment referral count: ${incrementError.message}`);
  }
}
