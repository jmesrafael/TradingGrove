// supabase/functions/paypal-setup-plans/index.ts
// One-shot setup: creates TradingGrove Pro product + monthly + annual plans
// in PayPal using the SAME credentials the subscription function uses.
// This guarantees the plans belong to the correct account.
//
// Deploy: supabase functions deploy paypal-setup-plans --no-verify-jwt
// Run:    curl -X POST https://<PROJECT>.supabase.co/functions/v1/paypal-setup-plans

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

const PAYPAL_MODE = Deno.env.get("PAYPAL_MODE") || "sandbox";
const PAYPAL_API = PAYPAL_MODE === "live"
  ? "https://api-m.paypal.com"
  : "https://api-m.sandbox.paypal.com";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data, null, 2), { status, headers: CORS });
}

async function getToken(clientId: string, clientSecret: string): Promise<string> {
  const res = await fetch(`${PAYPAL_API}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      "Authorization": "Basic " + btoa(`${clientId}:${clientSecret}`),
      "Content-Type": "application/x-www-form-urlencoded",
      "Accept": "application/json",
    },
    body: "grant_type=client_credentials",
  });
  const data = await res.json();
  if (!data.access_token) throw new Error("PayPal auth failed: " + JSON.stringify(data));
  return data.access_token;
}

async function createProduct(token: string) {
  const res = await fetch(`${PAYPAL_API}/v1/catalogs/products`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      "PayPal-Request-Id": `tg-product-${Date.now()}`,
    },
    body: JSON.stringify({
      name: "TradingGrove Pro",
      description: "TradingGrove Pro subscription — unlimited journals, full analytics, screenshots, export, themes.",
      type: "SERVICE",
      category: "SOFTWARE",
      home_url: "https://tradinggrove.com",
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error("Product create failed: " + JSON.stringify(data));
  return data;
}

async function createMonthlyPlan(token: string, productId: string) {
  const res = await fetch(`${PAYPAL_API}/v1/billing/plans`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      "PayPal-Request-Id": `tg-monthly-${Date.now()}`,
      "Prefer": "return=representation",
    },
    body: JSON.stringify({
      product_id: productId,
      name: "TradingGrove Pro — Monthly",
      description: "$15/month Pro access. Unlimited journals, full analytics, screenshots, export, themes.",
      status: "ACTIVE",
      billing_cycles: [
        {
          frequency: { interval_unit: "MONTH", interval_count: 1 },
          tenure_type: "REGULAR",
          sequence: 1,
          total_cycles: 0,
          pricing_scheme: {
            fixed_price: { value: "15", currency_code: "USD" },
          },
        },
      ],
      payment_preferences: {
        auto_bill_outstanding: true,
        setup_fee: { value: "0", currency_code: "USD" },
        setup_fee_failure_action: "CONTINUE",
        payment_failure_threshold: 1,
      },
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error("Monthly plan create failed: " + JSON.stringify(data));
  return data;
}

async function createAnnualPlan(token: string, productId: string) {
  const res = await fetch(`${PAYPAL_API}/v1/billing/plans`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      "PayPal-Request-Id": `tg-annual-${Date.now()}`,
      "Prefer": "return=representation",
    },
    body: JSON.stringify({
      product_id: productId,
      name: "TradingGrove Pro — Annual",
      description: "$120/year Pro subscription (saves $60). Unlimited journals, analytics, screenshots, export, themes.",
      status: "ACTIVE",
      billing_cycles: [
        {
          frequency: { interval_unit: "YEAR", interval_count: 1 },
          tenure_type: "REGULAR",
          sequence: 1,
          total_cycles: 0,
          pricing_scheme: {
            fixed_price: { value: "120", currency_code: "USD" },
          },
        },
      ],
      payment_preferences: {
        auto_bill_outstanding: true,
        setup_fee: { value: "0", currency_code: "USD" },
        setup_fee_failure_action: "CONTINUE",
        payment_failure_threshold: 1,
      },
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error("Annual plan create failed: " + JSON.stringify(data));
  return data;
}

async function listExistingPlans(token: string) {
  const res = await fetch(`${PAYPAL_API}/v1/billing/plans?page_size=20&total_required=true`, {
    headers: { "Authorization": `Bearer ${token}` },
  });
  const data = await res.json();
  return data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const clientId     = Deno.env.get("PAYPAL_CLIENT_ID");
    const clientSecret = Deno.env.get("PAYPAL_CLIENT_SECRET");

    if (!clientId)     return json({ error: "PAYPAL_CLIENT_ID not set" }, 500);
    if (!clientSecret) return json({ error: "PAYPAL_CLIENT_SECRET not set" }, 500);

    console.log("Using PayPal mode:", PAYPAL_MODE);
    console.log("Using PayPal API:", PAYPAL_API);

    const token = await getToken(clientId, clientSecret);
    console.log("Got PayPal token OK");

    // First, list what these credentials can see — this proves account ownership
    const existing = await listExistingPlans(token);
    console.log("Existing plans visible to these credentials:", JSON.stringify(existing, null, 2));

    // Create new product
    const product = await createProduct(token);
    console.log("Product created:", product.id);

    // Create both plans
    const monthly = await createMonthlyPlan(token, product.id);
    console.log("Monthly plan created:", monthly.id);

    const annual = await createAnnualPlan(token, product.id);
    console.log("Annual plan created:", annual.id);

    return json({
      success: true,
      mode: PAYPAL_MODE,
      product_id: product.id,
      monthly_plan_id: monthly.id,
      annual_plan_id: annual.id,
      existing_plans_seen: existing,
      next_steps: [
        `supabase secrets set PAYPAL_MONTHLY_PLAN_ID=${monthly.id}`,
        `supabase secrets set PAYPAL_ANNUAL_PLAN_ID=${annual.id}`,
        "supabase functions deploy create-paypal-subscription --no-verify-jwt",
      ],
    });

  } catch (e: any) {
    console.error("Setup failed:", e.message);
    return json({ error: e.message }, 500);
  }
});
