// supabase/functions/create-checkout/index.ts
// Deploy: supabase functions deploy create-checkout --no-verify-jwt

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

// Price lookup keys → Price IDs
const PRICE_MAP: Record<string, string> = {
  tradinggrove_pro_monthly: "price_1THxzd2M4x5JbTTvTRiX7Yys",
  tradinggrove_pro_annual:  "price_1TI1CV2M4x5JbTTvnBjbMF51",
};

function ok(data: unknown) {
  return new Response(JSON.stringify(data), { status: 200, headers: CORS });
}
function fail(msg: string, status = 500) {
  console.error("ERROR", status, msg);
  return new Response(JSON.stringify({ error: msg }), { status, headers: CORS });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  console.log("create-checkout called");

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const stripeKey   = Deno.env.get("STRIPE_SECRET_KEY");
    const appUrl      = Deno.env.get("APP_URL") || "https://tradinggrove.vercel.app";

    if (!supabaseUrl) return fail("SUPABASE_URL not set");
    if (!serviceKey)  return fail("SUPABASE_SERVICE_ROLE_KEY not set");
    if (!stripeKey)   return fail("STRIPE_SECRET_KEY not set");

    // ── Auth ──────────────────────────────────────────────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return fail("No Authorization header", 401);

    const token = authHeader.replace("Bearer ", "").trim();
    const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { "Authorization": `Bearer ${token}`, "apikey": serviceKey },
    });
    const userData = await userRes.json();
    if (!userData.id) return fail("Auth failed: " + (userData.message || "invalid token"), 401);

    const userId    = userData.id;
    const userEmail = userData.email;
    console.log("User:", userId, userEmail);

    // ── Parse body: get lookup_key or plan ───────────────────
    let lookupKey = "tradinggrove_pro_monthly";
    try {
      const body = await req.json();
      if (body.lookup_key && PRICE_MAP[body.lookup_key]) {
        lookupKey = body.lookup_key;
      } else if (body.plan === "annual" || body.plan === "yearly") {
        lookupKey = "tradinggrove_pro_annual";
      }
    } catch (_) { /* default to monthly */ }

    const priceId  = PRICE_MAP[lookupKey];
    const planType = lookupKey === "tradinggrove_pro_annual" ? "yearly" : "monthly";
    console.log("Plan:", planType, "Price:", priceId);

    // ── Profile ───────────────────────────────────────────────
    const profRes = await fetch(
      `${supabaseUrl}/rest/v1/profiles?id=eq.${userId}&select=plan,stripe_customer_id,subscription_expires_at,plan_type`,
      { headers: { "Authorization": `Bearer ${serviceKey}`, "apikey": serviceKey } }
    );
    const profRows = await profRes.json();
    const profile  = Array.isArray(profRows) ? profRows[0] : null;

    if (profile?.plan === "pro") {
      // Only block if the subscription is currently active (not expired and not null-expiry)
      const planType  = profile.plan_type || "none";
      const expiresAt = profile.subscription_expires_at;
      const isLifetime = planType === "lifetime";
      const isActive   = expiresAt && new Date(expiresAt) > new Date();
      if (isLifetime || isActive) {
        return fail("Already on an active Pro plan", 400);
      }
      // Expired pro — fall through and let them re-subscribe
    }

    let customerId = profile?.stripe_customer_id || null;

    // ── Create or reuse Stripe customer ───────────────────────
    if (!customerId) {
      const custRes = await fetch("https://api.stripe.com/v1/customers", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${stripeKey}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        // Store supabase_user_id in Stripe customer metadata too — used as fallback in webhook
        body: `email=${encodeURIComponent(userEmail)}&metadata[supabase_user_id]=${userId}`,
      });
      const cust = await custRes.json();
      if (!cust.id) return fail("Stripe customer error: " + (cust.error?.message || "unknown"), 500);
      customerId = cust.id;
      console.log("Created Stripe customer:", customerId);

      // Save stripe_customer_id to profile immediately so invoice events can match it
      await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${userId}`, {
        method: "PATCH",
        headers: {
          "Authorization": `Bearer ${serviceKey}`,
          "apikey": serviceKey,
          "Content-Type": "application/json",
          "Prefer": "return=minimal",
        },
        body: JSON.stringify({ stripe_customer_id: customerId }),
      });
      console.log("Saved stripe_customer_id to profile");
    } else {
      console.log("Reusing existing Stripe customer:", customerId);
    }

    // ── Create Checkout Session ───────────────────────────────
    const checkoutBody = new URLSearchParams({
      "customer":                   customerId,
      "client_reference_id":        userId,          // ← ADDED: webhook fallback #2
      "mode":                       "subscription",
      "line_items[0][price]":       priceId,
      "line_items[0][quantity]":    "1",
      "success_url":                `${appUrl}/subscription?upgraded=1`,
      "cancel_url":                 `${appUrl}/subscription?cancelled=1`,
      "metadata[supabase_user_id]": userId,          // ← webhook fallback #1
      "metadata[plan_type]":        planType,
      "metadata[lookup_key]":       lookupKey,
      "allow_promotion_codes":      "true",
    });

    const sessRes = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${stripeKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: checkoutBody.toString(),
    });
    const sess = await sessRes.json();
    console.log("Session status:", sessRes.status, sess.url ? "url:ok" : "url:MISSING");

    if (!sess.url) return fail("Stripe session failed: " + (sess.error?.message || JSON.stringify(sess)), 500);

    return ok({ url: sess.url });

  } catch (e: any) {
    console.error("EXCEPTION:", e.message);
    return fail(e.message || "Internal server error");
  }
});