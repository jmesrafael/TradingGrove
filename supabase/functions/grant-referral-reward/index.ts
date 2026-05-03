// supabase/functions/grant-referral-reward/index.ts
//
// FIXED & ENHANCED — grants the referrer +30 days Pro when their referred
// user first subscribes. Called internally by stripe-webhook.
//
// Deploy: supabase functions deploy grant-referral-reward
// Internal only — requires service role key in Authorization header.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const REWARD_DAYS = 30;

const corsHeaders = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Only callable internally with the service role key
  const authHeader = req.headers.get("Authorization");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  if (authHeader !== `Bearer ${serviceKey}`) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const { referred_user_id } = await req.json();

    if (!referred_user_id) {
      return new Response(JSON.stringify({ error: "Missing referred_user_id" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      serviceKey
    );

    console.log(`[grant-reward] Processing reward for referred_user_id: ${referred_user_id}`);

    // ── 0. Verify referred user has a genuine Stripe-paid subscription ──
    // Prevents: free users triggering rewards, referral-pro chains, abuse.
    const { data: referredProfile, error: referredErr } = await supabase
      .from("profiles")
      .select("plan, stripe_subscription_id, subscription_expires_at")
      .eq("id", referred_user_id)
      .single();

    if (referredErr || !referredProfile) {
      console.error(`[grant-reward] Could not fetch referred user profile:`, referredErr);
      return new Response(JSON.stringify({ error: "Referred user not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (referredProfile.plan !== "pro" || !referredProfile.stripe_subscription_id) {
      console.log(`[grant-reward] Referred user ${referred_user_id} is not a paid Stripe subscriber — skipping`);
      return new Response(JSON.stringify({ skipped: true, reason: "referred_user_not_paid" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── 1. Find pending referral row ─────────────────────
    const { data: referral, error: refErr } = await supabase
      .from("referrals")
      .select("id, referrer_id, reward_granted, status")
      .eq("referred_user_id", referred_user_id)
      .maybeSingle();

    if (refErr) {
      console.error("[grant-reward] DB error:", refErr);
      return new Response(JSON.stringify({ error: "DB error" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!referral) {
      console.log(`[grant-reward] No referral found for ${referred_user_id} — skipping`);
      return new Response(JSON.stringify({ skipped: true, reason: "no_referral_found" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (referral.reward_granted) {
      console.log(`[grant-reward] Reward already granted for referral ${referral.id}`);
      return new Response(JSON.stringify({ skipped: true, reason: "already_rewarded" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── 2. Get referrer's current profile ─────────────────
    const { data: referrerProfile, error: profileErr } = await supabase
      .from("profiles")
      .select("id, plan, plan_type, subscription_expires_at, referral_count")
      .eq("id", referral.referrer_id)
      .single();

    if (profileErr || !referrerProfile) {
      console.error(`[grant-reward] Referrer ${referral.referrer_id} not found:`, profileErr);
      return new Response(JSON.stringify({ error: "Referrer not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── 3. Calculate new expiry ───────────────────────────
    // Base is the later of: now OR the referrer's current expiry (so rewards stack).
    // Cap: base must not be more than REWARD_DAYS ahead of now already — prevents
    // a referrer with a far-future expiry from accumulating unbounded time.
    const now      = new Date();
    const maxBase  = new Date(now.getTime() + REWARD_DAYS * 24 * 60 * 60 * 1000);
    let   baseDate = now;

    if (referrerProfile.subscription_expires_at) {
      const existing = new Date(referrerProfile.subscription_expires_at);
      if (existing > now) {
        // Clamp so the base can never be more than REWARD_DAYS from now,
        // ensuring each referral gives at most REWARD_DAYS of additional time.
        baseDate = existing < maxBase ? existing : maxBase;
      }
    }

    const newExpiry = new Date(baseDate);
    newExpiry.setDate(newExpiry.getDate() + REWARD_DAYS);

    console.log(`[grant-reward] New expiry for ${referral.referrer_id}: ${newExpiry.toISOString()}`);

    // ── 4. Update referrer profile ────────────────────────
    const { error: updateErr } = await supabase
      .from("profiles")
      .update({
        plan:                    "pro",
        plan_type:               referrerProfile.plan_type === "none" ? "monthly" : referrerProfile.plan_type,
        subscription_expires_at: newExpiry.toISOString(),
        referral_count:          (referrerProfile.referral_count || 0) + 1,
      })
      .eq("id", referral.referrer_id);

    if (updateErr) {
      console.error(`[grant-reward] Profile update failed:`, updateErr);
      return new Response(JSON.stringify({ error: "Profile update failed" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── 5. Mark referral as rewarded ──────────────────────
    const { error: markErr } = await supabase
      .from("referrals")
      .update({ status: "rewarded", reward_granted: true })
      .eq("id", referral.id);

    if (markErr) {
      console.error(`[grant-reward] Mark rewarded failed (non-fatal):`, markErr);
    }

    console.log(`[grant-reward] ✅ Granted ${REWARD_DAYS} days Pro to ${referral.referrer_id}. New expiry: ${newExpiry.toISOString()}`);

    return new Response(
      JSON.stringify({
        success:      true,
        referrer_id:  referral.referrer_id,
        days_granted: REWARD_DAYS,
        new_expiry:   newExpiry.toISOString(),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("[grant-reward] Unexpected error:", err);
    return new Response(JSON.stringify({ error: "Server error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});