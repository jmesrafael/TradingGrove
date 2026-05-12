// supabase/functions/stripe-webhook/index.ts
// Deploy: supabase functions deploy stripe-webhook
// Required secrets: STRIPE_WEBHOOK_SECRET, STRIPE_SECRET_KEY

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@12.18.0?target=deno&no-check";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { upgradePlan, downgradePlan } from "../_shared/plan-utils.ts";
import { grantReferralReward } from "../_shared/referral-utils.ts";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
  apiVersion: "2023-10-16",
  httpClient: Stripe.createFetchHttpClient(),
});

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

// ── Helpers ───────────────────────────────────────────────

function detectPlanType(sub: Stripe.Subscription): "monthly" | "yearly" {
  const interval = sub.items?.data?.[0]?.price?.recurring?.interval;
  return interval === "year" ? "yearly" : "monthly";
}

function calcExpiresAt(sub: Stripe.Subscription): string {
  if (sub.current_period_end) {
    return new Date(sub.current_period_end * 1000).toISOString();
  }
  const d = new Date();
  d.setDate(d.getDate() + 30);
  return d.toISOString();
}

/**
 * Resolve Supabase user ID from a checkout session.
 * Priority order:
 *  1. session.metadata.supabase_user_id  (set by create-checkout function)
 *  2. client_reference_id               (another common convention)
 *  3. Email lookup via admin API
 */
async function resolveUserId(session: Stripe.CheckoutSession): Promise<string | null> {
  // 1. Explicit metadata — most reliable
  if (session.metadata?.supabase_user_id) {
    console.log("[webhook] resolveUserId: found in metadata →", session.metadata.supabase_user_id);
    return session.metadata.supabase_user_id;
  }

  // 2. client_reference_id — set this in create-checkout if not already
  if (session.client_reference_id) {
    console.log("[webhook] resolveUserId: found in client_reference_id →", session.client_reference_id);
    return session.client_reference_id;
  }

  // 3. Email fallback
  const email = session.customer_details?.email ?? session.customer_email;
  if (email) {
    console.log("[webhook] resolveUserId: falling back to email lookup →", email);
    const { data, error } = await supabase.auth.admin.listUsers();
    if (error) {
      console.error("[webhook] listUsers error:", error);
      return null;
    }
    const match = data?.users?.find(u => u.email?.toLowerCase() === email.toLowerCase());
    if (match) {
      console.log("[webhook] resolveUserId: email match found →", match.id);
      return match.id;
    }
    console.error("[webhook] resolveUserId: no user found with email:", email);
  }

  console.error("[webhook] resolveUserId: all strategies failed. Session:", JSON.stringify({
    metadata: session.metadata,
    client_reference_id: session.client_reference_id,
    customer_details: session.customer_details,
    customer_email: session.customer_email,
  }));
  return null;
}

/**
 * Resolve Supabase user ID from a Stripe customer ID.
 * Used for invoice/subscription events where we only have customer ID.
 */
async function resolveUserIdFromCustomer(customerId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();

  if (error) {
    console.error("[webhook] resolveUserIdFromCustomer DB error:", error);
    return null;
  }

  if (data?.id) return data.id;

  // Fallback: look up email from Stripe customer, then match in Supabase
  try {
    const customer = await stripe.customers.retrieve(customerId);
    if (customer.deleted) return null;
    const email = (customer as Stripe.Customer).email;
    if (email) {
      const { data: users } = await supabase.auth.admin.listUsers();
      const match = users?.users?.find(u => u.email?.toLowerCase() === email.toLowerCase());
      if (match) {
        console.log("[webhook] resolveUserIdFromCustomer: email fallback matched →", match.id);
        return match.id;
      }
    }
  } catch (e) {
    console.error("[webhook] resolveUserIdFromCustomer Stripe lookup error:", e);
  }

  return null;
}

async function grantReferralRewardForUser(userId: string): Promise<void> {
  try {
    const { data: profile } = await supabase
      .from("profiles")
      .select("referred_by")
      .eq("id", userId)
      .single();

    if (profile?.referred_by) {
      const { data: referral } = await supabase
        .from("referrals")
        .select("id")
        .eq("referred_user_id", userId)
        .eq("referrer_id", profile.referred_by)
        .single();

      if (referral) {
        await grantReferralReward(supabase, {
          referrerId: profile.referred_by,
          referralId: referral.id,
        });
      }
    }
  } catch (e) {
    console.error(`[webhook] grantReferralReward failed:`, e);
  }
}

// ── Main ──────────────────────────────────────────────────

serve(async (req) => {
  const sig  = req.headers.get("stripe-signature");
  const body = await req.text();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      body, sig!, Deno.env.get("STRIPE_WEBHOOK_SECRET")!
    );
  } catch (err) {
    console.error("[webhook] Signature verification failed:", err.message);
    return new Response(`Webhook Error: ${err.message}`, { status: 400 });
  }

  console.log(`[webhook] ─── Event: ${event.type} ───`);

  try {
    switch (event.type) {

      // ── Checkout completed (new subscription) ─────────────
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.CheckoutSession;
        console.log("[webhook] checkout.session.completed — session id:", session.id);

        const userId = await resolveUserId(session);
        if (!userId) {
          console.error("[webhook] ❌ Cannot resolve user ID — upgrade skipped");
          break;
        }

        let planType: "monthly" | "yearly" = "monthly";
        let expiresAt: string;

        if (session.subscription) {
          try {
            const sub = await stripe.subscriptions.retrieve(session.subscription as string);
            planType  = detectPlanType(sub);
            expiresAt = calcExpiresAt(sub);
          } catch (e) {
            console.error("[webhook] Could not retrieve subscription:", e);
            const meta = session.metadata?.plan_type;
            planType  = meta === "yearly" ? "yearly" : "monthly";
            const d   = new Date();
            d.setDate(d.getDate() + (planType === "yearly" ? 365 : 30));
            expiresAt = d.toISOString();
          }
        } else {
          const d = new Date();
          d.setDate(d.getDate() + 30);
          expiresAt = d.toISOString();
        }

        try {
          // Also store stripe_customer_id and stripe_subscription_id directly
          await supabase.from("profiles").update({
            stripe_customer_id: session.customer as string ?? null,
            stripe_subscription_id: session.subscription as string ?? null,
          }).eq("id", userId);

          await upgradePlan(supabase, {
            userId,
            subscriptionId: (session.subscription as string) ?? "",
            gateway: "stripe",
            planType,
          });

          console.log(`[webhook] ✅ Upgraded user ${userId} → Pro (${planType})`);
          await grantReferralRewardForUser(userId);
        } catch (e) {
          console.error("[webhook] checkout.session.completed error:", e);
        }
        break;
      }

      // ── Invoice paid — handles BOTH first payment and renewals ──
      case "invoice.payment_succeeded": {
        const invoice = event.data.object as Stripe.Invoice;
        console.log("[webhook] invoice.payment_succeeded — billing_reason:", invoice.billing_reason);

        if (!invoice.subscription) break;

        try {
          const sub        = await stripe.subscriptions.retrieve(invoice.subscription as string);
          const customerId = sub.customer as string;
          const planType   = detectPlanType(sub);
          const expiresAt  = calcExpiresAt(sub);

          if (!["active", "trialing"].includes(sub.status)) {
            console.log("[webhook] Subscription not active, skipping:", sub.status);
            break;
          }

          const { data: existingProfile } = await supabase
            .from("profiles")
            .select("id, plan, subscription_expires_at")
            .eq("stripe_customer_id", customerId)
            .maybeSingle();

          if (existingProfile) {
            await upgradePlan(supabase, {
              userId: existingProfile.id,
              subscriptionId: sub.id,
              gateway: "stripe",
              planType,
              currentExpiresAt: existingProfile.subscription_expires_at?.toString(),
            });
            console.log(`[webhook] ✅ Renewed ${customerId} (${planType})`);
          } else if (invoice.billing_reason === "subscription_create") {
            const userId = await resolveUserIdFromCustomer(customerId);
            if (userId) {
              await supabase.from("profiles").update({
                stripe_customer_id: customerId,
              }).eq("id", userId);

              await upgradePlan(supabase, {
                userId,
                subscriptionId: sub.id,
                gateway: "stripe",
                planType,
              });
              console.log(`[webhook] ✅ First payment processed for ${userId}`);
            } else {
              console.warn("[webhook] invoice.payment_succeeded: Could not resolve user for new customer:", customerId);
            }
          } else {
            console.warn("[webhook] invoice.payment_succeeded: No profile found for customer:", customerId);
          }
        } catch (e) {
          console.error("[webhook] invoice.payment_succeeded error:", e);
        }
        break;
      }

      // ── Subscription updated ──────────────────────────────
      case "customer.subscription.updated": {
        const sub        = event.data.object as Stripe.Subscription;
        const customerId = sub.customer as string;
        const isActive   = ["active", "trialing"].includes(sub.status);

        try {
          const { data: profile } = await supabase
            .from("profiles")
            .select("id")
            .eq("stripe_customer_id", customerId)
            .maybeSingle();

          if (!profile) {
            console.warn("[webhook] No profile found for subscription update:", customerId);
            break;
          }

          if (isActive) {
            const planType = detectPlanType(sub);
            await upgradePlan(supabase, {
              userId: profile.id,
              subscriptionId: sub.id,
              gateway: "stripe",
              planType,
            });
            console.log(`[webhook] ✅ Updated ${customerId} → Pro/${planType}`);
          } else {
            await downgradePlan(supabase, {
              userId: profile.id,
              gateway: "stripe",
            });
            console.log(`[webhook] Updated ${customerId} → Free`);
          }
        } catch (e) {
          console.error("[webhook] subscription.updated error:", e);
        }
        break;
      }

      // ── Subscription cancelled ────────────────────────────
      case "customer.subscription.deleted": {
        const sub        = event.data.object as Stripe.Subscription;
        const customerId = sub.customer as string;

        try {
          const { data: profile } = await supabase
            .from("profiles")
            .select("id")
            .eq("stripe_customer_id", customerId)
            .maybeSingle();

          if (profile) {
            await downgradePlan(supabase, {
              userId: profile.id,
              gateway: "stripe",
            });
            console.log(`[webhook] ✅ Downgraded ${customerId} → Free`);
          }
        } catch (e) {
          console.error("[webhook] subscription.deleted error:", e);
        }
        break;
      }

      // ── Payment failed ────────────────────────────────────
      case "invoice.payment_failed": {
        const invoice    = event.data.object as Stripe.Invoice;
        const customerId = invoice.customer as string;
        console.warn(`[webhook] ⚠️ Payment failed for ${customerId}`);
        // Don't downgrade immediately — Stripe retries.
        // customer.subscription.deleted fires if all retries fail.
        break;
      }

      default:
        console.log(`[webhook] Unhandled: ${event.type}`);
    }
  } catch (err) {
    console.error("[webhook] Processing error:", err);
    return new Response("Internal error", { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { "Content-Type": "application/json" },
  });
});