// supabase/functions/paypal-webhook/index.ts

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  let body: any
  try {
    body = await req.json()
  } catch {
    return new Response('Invalid JSON', { status: 400 })
  }

  const { event_type, resource } = body
  console.log('PayPal webhook received:', event_type)

  const subscriptionId = resource?.id || resource?.billing_agreement_id
  if (!subscriptionId) {
    return new Response('OK', { status: 200 })
  }

  // Find user by paypal_subscription_id (saved by create-paypal-subscription)
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('id, plan, plan_type, referred_by, subscription_expires_at')
    .eq('paypal_subscription_id', subscriptionId)
    .single()

  if (error || !profile) {
    console.log('Profile not found for subscription:', subscriptionId)
    return new Response('OK', { status: 200 })
  }

  const now = new Date()

  switch (event_type) {

    case 'BILLING.SUBSCRIPTION.ACTIVATED':
    case 'BILLING.SUBSCRIPTION.RE-ACTIVATED': {
      const isYearly = profile.plan_type === 'yearly'
      const expires = new Date(now)
      if (isYearly) {
        expires.setFullYear(expires.getFullYear() + 1)
      } else {
        expires.setMonth(expires.getMonth() + 1)
      }

      await supabase.from('profiles').update({
        plan: 'pro',
        subscription_expires_at: expires.toISOString(),
      }).eq('id', profile.id)

      console.log('User upgraded to pro:', profile.id)

      if (profile.referred_by) {
        await grantReferralReward(profile.id, profile.referred_by)
      }

      break
    }

    case 'BILLING.SUBSCRIPTION.RENEWED': {
      // Extend from the current expiry (not from now) to avoid losing days
      const isYearly = profile.plan_type === 'yearly'
      const base = profile.subscription_expires_at
        ? new Date(profile.subscription_expires_at)
        : now
      const newExpiry = new Date(base)
      if (isYearly) {
        newExpiry.setFullYear(newExpiry.getFullYear() + 1)
      } else {
        newExpiry.setMonth(newExpiry.getMonth() + 1)
      }

      await supabase.from('profiles').update({
        plan: 'pro',
        subscription_expires_at: newExpiry.toISOString(),
      }).eq('id', profile.id)

      console.log('Subscription renewed:', profile.id)
      break
    }

    case 'BILLING.SUBSCRIPTION.CANCELLED':
    case 'BILLING.SUBSCRIPTION.EXPIRED': {
      await supabase.from('profiles').update({
        plan: 'free',
        plan_type: 'none',
        subscription_expires_at: null,
        paypal_subscription_id: null,
      }).eq('id', profile.id)

      console.log('User downgraded to free:', profile.id)
      break
    }

    case 'BILLING.SUBSCRIPTION.SUSPENDED':
    case 'BILLING.SUBSCRIPTION.PAYMENT.FAILED': {
      await supabase.from('profiles').update({
        plan: 'free',
        subscription_expires_at: now.toISOString(),
      }).eq('id', profile.id)

      console.log('User suspended:', profile.id)
      break
    }

    default:
      console.log('Unhandled event type:', event_type)
  }

  return new Response('OK', { status: 200 })
})


// ── Referral Reward ──────────────────────────────────────────
async function grantReferralReward(referredUserId: string, referrerId: string) {
  try {
    const { data: referral } = await supabase
      .from('referrals')
      .select('id, reward_granted')
      .eq('referred_user_id', referredUserId)
      .eq('referrer_id', referrerId)
      .single()

    if (!referral) {
      console.log('No referral row found for:', referredUserId)
      return
    }

    if (referral.reward_granted) {
      console.log('Reward already granted for referral:', referral.id)
      return
    }

    const { data: referrer } = await supabase
      .from('profiles')
      .select('id, plan, plan_type, subscription_expires_at')
      .eq('id', referrerId)
      .single()

    if (!referrer) return

    const baseDate = referrer.subscription_expires_at
      ? new Date(referrer.subscription_expires_at)
      : new Date()

    const newExpiry = new Date(baseDate)
    newExpiry.setDate(newExpiry.getDate() + 30)

    // Update referrer plan + expiry
    await supabase.from('profiles').update({
      plan: 'pro',
      plan_type: referrer.plan === 'pro' ? referrer.plan_type : 'monthly',
      subscription_expires_at: newExpiry.toISOString(),
    }).eq('id', referrerId)

    // Increment referral_count via RPC (separate call — cannot embed rpc() in update body)
    await supabase.rpc('increment_referral_count', { user_id: referrerId })

    // Mark referral as rewarded
    await supabase.from('referrals').update({
      status: 'rewarded',
      reward_granted: true,
    }).eq('id', referral.id)

    console.log(`✅ Referral reward granted: referrer=${referrerId} gets 30 days, referral=${referral.id}`)

  } catch (err) {
    console.error('grantReferralReward error:', err)
    // Don't throw — reward failure must not break subscription activation
  }
}
