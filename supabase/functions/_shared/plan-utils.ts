import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.0";

interface PlanUpgradeParams {
  userId: string;
  subscriptionId: string;
  gateway: "stripe" | "paypal";
  planType: "monthly" | "yearly";
  currentExpiresAt?: string;
}

interface PlanDowngradeParams {
  userId: string;
  gateway: "stripe" | "paypal";
}

export async function upgradePlan(
  supabase: ReturnType<typeof createClient>,
  params: PlanUpgradeParams
): Promise<void> {
  const { userId, subscriptionId, gateway, planType, currentExpiresAt } =
    params;

  const now = new Date();
  let subscriptionExpiresAt: Date;

  if (currentExpiresAt) {
    const expiresDate = new Date(currentExpiresAt);
    if (expiresDate > now) {
      subscriptionExpiresAt = new Date(expiresDate.getTime());
      subscriptionExpiresAt.setMonth(
        subscriptionExpiresAt.getMonth() + (planType === "yearly" ? 12 : 1)
      );
    } else {
      subscriptionExpiresAt = new Date(now.getTime());
      subscriptionExpiresAt.setMonth(
        subscriptionExpiresAt.getMonth() + (planType === "yearly" ? 12 : 1)
      );
    }
  } else {
    subscriptionExpiresAt = new Date(now.getTime());
    subscriptionExpiresAt.setMonth(
      subscriptionExpiresAt.getMonth() + (planType === "yearly" ? 12 : 1)
    );
  }

  const updateData: Record<string, unknown> = {
    plan: "pro",
    plan_type: planType,
    subscription_expires_at: subscriptionExpiresAt.toISOString(),
    payment_gateway: gateway,
  };

  if (gateway === "stripe") {
    updateData.stripe_subscription_id = subscriptionId;
  } else if (gateway === "paypal") {
    updateData.paypal_subscription_id = subscriptionId;
  }

  const { error } = await supabase
    .from("profiles")
    .update(updateData)
    .eq("id", userId);

  if (error) {
    throw new Error(`Failed to upgrade plan: ${error.message}`);
  }
}

export async function downgradePlan(
  supabase: ReturnType<typeof createClient>,
  params: PlanDowngradeParams
): Promise<void> {
  const { userId, gateway } = params;

  const updateData: Record<string, unknown> = {
    plan: "free",
    plan_type: "none",
    subscription_expires_at: null,
  };

  if (gateway === "stripe") {
    updateData.stripe_subscription_id = null;
  } else if (gateway === "paypal") {
    updateData.paypal_subscription_id = null;
  }

  const { error } = await supabase
    .from("profiles")
    .update(updateData)
    .eq("id", userId);

  if (error) {
    throw new Error(`Failed to downgrade plan: ${error.message}`);
  }
}
