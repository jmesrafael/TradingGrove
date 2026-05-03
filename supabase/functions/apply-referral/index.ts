// supabase/functions/apply-referral/index.ts
// Deploy: supabase functions deploy apply-referral

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body    = await req.json();
    const refCode = (body.referral_code || body.refCode || "").trim().toUpperCase();

    if (!refCode) {
      return new Response(JSON.stringify({ error: "Missing referral_code" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // ── 1. Verify JWT ─────────────────────────────────────
    const token = req.headers.get("Authorization")?.replace("Bearer ", "");
    if (!token) {
      return new Response(JSON.stringify({ error: "Missing Authorization" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError || !userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const user = userData.user;
    console.log(`[apply-referral] User ${user.id} applying code: ${refCode}`);

    // ── 2. Wait for profile row to exist (created by trigger) ──
    // On fresh signups the profile trigger may not have fired yet
    let profileExists = false;
    for (let attempt = 0; attempt < 5; attempt++) {
      const { data: profileCheck } = await supabase
        .from("profiles")
        .select("id, referred_by")
        .eq("id", user.id)
        .maybeSingle();

      if (profileCheck) {
        profileExists = true;
        // Already has a referrer — skip
        if (profileCheck.referred_by) {
          console.log(`[apply-referral] User ${user.id} already has referred_by — skipping`);
          return new Response(JSON.stringify({ skipped: true, reason: "already_referred" }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        break;
      }
      // Profile not yet created — wait 800ms and retry
      console.log(`[apply-referral] Profile not found yet, attempt ${attempt + 1}/5 — waiting...`);
      await new Promise(r => setTimeout(r, 800));
    }

    if (!profileExists) {
      // Create a minimal profile so we can proceed
      const { error: insertProfileErr } = await supabase
        .from("profiles")
        .upsert({ id: user.id, name: user.user_metadata?.name || null, plan: "free" }, { onConflict: "id" });
      if (insertProfileErr) {
        console.error("[apply-referral] Could not create profile:", insertProfileErr);
        return new Response(JSON.stringify({ error: "Profile not ready, try again later" }), {
          status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // ── 3. Check referral row doesn't already exist ────────
    const { data: existing } = await supabase
      .from("referrals")
      .select("id")
      .eq("referred_user_id", user.id)
      .maybeSingle();

    if (existing) {
      console.log(`[apply-referral] Referral row already exists for user ${user.id}`);
      return new Response(JSON.stringify({ skipped: true, reason: "already_referred" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── 4. Find referrer by code ───────────────────────────
    const { data: referrer, error: refErr } = await supabase
      .from("profiles")
      .select("id")
      .eq("referral_code", refCode)
      .single();

    if (refErr || !referrer) {
      console.warn(`[apply-referral] Invalid code: ${refCode}`);
      return new Response(JSON.stringify({ error: "Invalid referral code" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── 5. Prevent self-referral ───────────────────────────
    if (referrer.id === user.id) {
      return new Response(JSON.stringify({ error: "Cannot refer yourself" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── 6. Update new user's profile with referred_by ──────
    const { error: profileErr } = await supabase
      .from("profiles")
      .update({ referred_by: referrer.id })
      .eq("id", user.id);

    if (profileErr) {
      console.error("[apply-referral] Profile update failed:", profileErr);
      return new Response(JSON.stringify({ error: "Profile update failed" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── 7. Insert referral row ─────────────────────────────
    const { error: insertErr } = await supabase
      .from("referrals")
      .insert({
        referrer_id:      referrer.id,
        referred_user_id: user.id,
        status:           "pending",
        reward_granted:   false,
      });

    if (insertErr) {
      console.error("[apply-referral] Insert failed:", insertErr);
      // Don't fail — referred_by is already set
    }

    // referral_count is incremented by grant-referral-reward when the reward
    // is actually paid out — do NOT increment here or it double-counts.

    console.log(`[apply-referral] ✅ Referral recorded: referrer=${referrer.id}, referred=${user.id}`);

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("[apply-referral] Unexpected error:", err);
    return new Response(JSON.stringify({ error: "Server error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
