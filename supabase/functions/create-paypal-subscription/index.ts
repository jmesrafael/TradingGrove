// supabase/functions/create-paypal-subscription/index.ts
// Deploy: supabase functions deploy create-paypal-subscription --no-verify-jwt

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

const PAYPAL_MODE = Deno.env.get("PAYPAL_MODE") || "sandbox";
const PAYPAL_API = PAYPAL_MODE === "live"
  ? "https://api-m.paypal.com"
  : "https://api-m.sandbox.paypal.com";

function ok(data: unknown) {
  return new Response(JSON.stringify(data), { status: 200, headers: CORS });
}
function fail(msg: string, status = 500) {
  console.error("ERROR", status, msg);
  return new Response(JSON.stringify({ error: msg }), { status, headers: CORS });
}

async function getPayPalToken(clientId: string, clientSecret: string): Promise<string> {
  const res = await fetch(`${PAYPAL_API}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      "Authorization": "Basic " + btoa(`${clientId}:${clientSecret}`),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials&scope=https://api.paypal.com/v1/payments/.* https://api.paypal.com/v1/billing/.*",
  });
  const data = await res.json();
  if (!data.access_token) throw new Error("PayPal auth failed: " + JSON.stringify(data));
  return data.access_token;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  console.log("create-paypal-subscription called");

  try {
    const supabaseUrl   = Deno.env.get("SUPABASE_URL");
    const serviceKey    = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const clientId      = Deno.env.get("PAYPAL_CLIENT_ID");
    const clientSecret  = Deno.env.get("PAYPAL_CLIENT_SECRET");
    const monthlyPlanId = Deno.env.get("PAYPAL_MONTHLY_PLAN_ID");
    const annualPlanId  = Deno.env.get("PAYPAL_ANNUAL_PLAN_ID");
    const appUrl        = Deno.env.get("APP_URL") || "https://tradinggrove.com";

    if (!supabaseUrl)   return fail("SUPABASE_URL not set");
    if (!serviceKey)    return fail("SUPABASE_SERVICE_ROLE_KEY not set");
    if (!clientId)      return fail("PAYPAL_CLIENT_ID not set");
    if (!clientSecret)  return fail("PAYPAL_CLIENT_SECRET not set");
    if (!monthlyPlanId) return fail("PAYPAL_MONTHLY_PLAN_ID not set");
    if (!annualPlanId)  return fail("PAYPAL_ANNUAL_PLAN_ID not set");

    // ── Auth ──────────────────────────────────────────────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return fail("No Authorization header", 401);

    const token = authHeader.replace("Bearer ", "").trim();
    const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { "Authorization": `Bearer ${token}`, "apikey": serviceKey },
    });
    const userData = await userRes.json();
    if (!userData.id) return fail("Auth failed: " + (userData.message || "invalid token"), 401);

    const userId    = userData.id as string;
    const userEmail = userData.email as string;
    console.log("User:", userId, userEmail);

    // ── Parse body ────────────────────────────────────────────
    let plan = "monthly";
    try {
      const body = await req.json();
      if (body.plan === "annual" || body.plan === "yearly") plan = "annual";
    } catch (_) { /* default to monthly */ }

    const planId   = plan === "annual" ? annualPlanId : monthlyPlanId;
    const planType = plan === "annual" ? "yearly" : "monthly";
    console.log("Plan:", planType, "PlanId:", planId);

    // ── Profile check ─────────────────────────────────────────
    const profRes = await fetch(
      `${supabaseUrl}/rest/v1/profiles?id=eq.${userId}&select=plan,subscription_expires_at,plan_type`,
      { headers: { "Authorization": `Bearer ${serviceKey}`, "apikey": serviceKey } }
    );
    const profRows = await profRes.json();
    const profile  = Array.isArray(profRows) ? profRows[0] : null;

    if (profile?.plan === "pro") {
      const isLifetime = profile.plan_type === "lifetime";
      const isActive   = profile.subscription_expires_at && new Date(profile.subscription_expires_at) > new Date();
      if (isLifetime || isActive) return fail("Already on an active Pro plan", 400);
    }

    // ── Get PayPal access token ───────────────────────────────
    const accessToken = await getPayPalToken(clientId, clientSecret);

    // ── Create PayPal subscription ────────────────────────────
    const subBody = {
      plan_id: planId,
      custom_id: userId,
      subscriber: { email_address: userEmail },
      application_context: {
        brand_name: "TradingGrove",
        locale: "en-US",
        shipping_preference: "NO_SHIPPING",
        user_action: "SUBSCRIBE_NOW",
        payment_method: {
          payer_selected: "PAYPAL",
          payee_preferred: "IMMEDIATE_PAYMENT_REQUIRED",
        },
        return_url: `${appUrl}/subscription?upgraded=1&provider=paypal`,
        cancel_url: `${appUrl}/payment-method?cancelled=1`,
      },
    };

    const subRes = await fetch(`${PAYPAL_API}/v1/billing/subscriptions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "Prefer": "return=representation",
      },
      body: JSON.stringify(subBody),
    });

    const sub = await subRes.json();
    console.log("PayPal subscription response:", subRes.status, sub.id || "no-id");

    if (!sub.id) {
      return fail("PayPal subscription failed: " + (sub.message || JSON.stringify(sub)), 500);
    }

    // Find approval URL in links array
    const approvalLink = (sub.links || []).find((l: any) => l.rel === "approve");
    if (!approvalLink?.href) return fail("No PayPal approval URL in response", 500);

    // Save subscription ID + plan_type to profile NOW so the webhook can
    // look up this user when BILLING.SUBSCRIPTION.ACTIVATED fires.
    await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${userId}`, {
      method: "PATCH",
      headers: {
        "Authorization": `Bearer ${serviceKey}`,
        "apikey": serviceKey,
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
      },
      body: JSON.stringify({
        paypal_subscription_id: sub.id,
        plan_type: planType,
        payment_gateway: "paypal",
      }),
    });
    console.log("Saved paypal_subscription_id:", sub.id, "plan_type:", planType, "payment_gateway: paypal");

    return ok({ url: approvalLink.href });

  } catch (e: any) {
    console.error("EXCEPTION:", e.message);
    return fail(e.message || "Internal server error");
  }
});
