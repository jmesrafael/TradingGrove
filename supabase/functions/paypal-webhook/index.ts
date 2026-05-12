// supabase/functions/paypal-webhook/index.ts

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { upgradePlan, downgradePlan } from '../_shared/plan-utils.ts'
import { grantReferralReward } from '../_shared/referral-utils.ts'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Calculate subscription expiry date based on plan type
function calculateExpiryDate(planType: string): string {
  const now = new Date()
  let expiryDate: Date

  if (planType === 'yearly') {
    expiryDate = new Date(now.getFullYear() + 1, now.getMonth(), now.getDate())
  } else {
    // monthly
    expiryDate = new Date(now.getFullYear(), now.getMonth() + 1, now.getDate())
  }

  return expiryDate.toISOString()
}

async function verifyPayPalSignature(req: Request, body: any): Promise<boolean> {
  try {
    const transmissionId = req.headers.get('Paypal-Transmission-Id')
    const transmissionTime = req.headers.get('Paypal-Transmission-Time')
    const certUrl = req.headers.get('Paypal-Cert-Url')
    const authAlgo = req.headers.get('Paypal-Auth-Algo')
    const signature = req.headers.get('Paypal-Transmission-Sig')

    if (!transmissionId || !transmissionTime || !certUrl || !authAlgo || !signature) {
      console.log('Missing PayPal webhook headers')
      return false
    }

    const clientId = Deno.env.get('PAYPAL_CLIENT_ID')
    const clientSecret = Deno.env.get('PAYPAL_CLIENT_SECRET')
    const webhookId = Deno.env.get('PAYPAL_WEBHOOK_ID')

    if (!clientId || !clientSecret || !webhookId) {
      console.log('Missing PayPal configuration')
      return false
    }

    // Prepare verification payload
    const verifyPayload = {
      transmission_id: transmissionId,
      transmission_time: transmissionTime,
      cert_url: certUrl,
      auth_algo: authAlgo,
      transmission_sig: signature,
      webhook_id: webhookId,
      webhook_event: body,
    }

    const auth = btoa(`${clientId}:${clientSecret}`)
    const paypalMode = Deno.env.get('PAYPAL_MODE') || 'sandbox'
    const apiUrl = paypalMode === 'live'
      ? 'https://api.paypal.com'
      : 'https://api.sandbox.paypal.com'

    const response = await fetch(`${apiUrl}/v1/notifications/verify-webhook-signature`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(verifyPayload),
    })

    const result = await response.json() as Record<string, unknown>
    const isValid = result.verification_status === 'SUCCESS'

    if (!isValid) {
      console.log('PayPal signature verification failed:', result)
    }

    return isValid
  } catch (err) {
    console.error('Signature verification error:', err)
    return false
  }
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

  // Verify webhook signature
  const isValid = await verifyPayPalSignature(req, body)
  if (!isValid) {
    console.log('Invalid webhook signature')
    return new Response('Unauthorized', { status: 401 })
  }

  const { event_type, resource } = body
  console.log('PayPal webhook verified:', event_type)

  const subscriptionId = resource?.id || resource?.billing_agreement_id
  if (!subscriptionId) {
    return new Response('OK', { status: 200 })
  }

  // Find user by paypal_subscription_id (saved by create-paypal-subscription)
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('id, plan_type, referred_by, subscription_expires_at, queued_subscription')
    .eq('paypal_subscription_id', subscriptionId)
    .single()

  if (error || !profile) {
    console.log('Profile not found for subscription:', subscriptionId)
    return new Response('OK', { status: 200 })
  }

  try {
    switch (event_type) {
      case 'BILLING.SUBSCRIPTION.ACTIVATED':
      case 'BILLING.SUBSCRIPTION.RE-ACTIVATED': {
        const planType = profile.plan_type === 'yearly' ? 'yearly' : 'monthly'
        await upgradePlan(supabase, {
          userId: profile.id,
          subscriptionId,
          gateway: 'paypal',
          planType,
        })
        console.log('User upgraded to pro:', profile.id)

        if (profile.referred_by) {
          try {
            const { data: referral } = await supabase
              .from('referrals')
              .select('id')
              .eq('referred_user_id', profile.id)
              .eq('referrer_id', profile.referred_by)
              .single()

            if (referral) {
              await grantReferralReward(supabase, {
                referrerId: profile.referred_by,
                referralId: referral.id,
              })
            }
          } catch (err) {
            console.error('Referral reward error:', err)
          }
        }
        break
      }

      case 'BILLING.SUBSCRIPTION.RENEWED': {
        const planType = profile.plan_type === 'yearly' ? 'yearly' : 'monthly'
        await upgradePlan(supabase, {
          userId: profile.id,
          subscriptionId,
          gateway: 'paypal',
          planType,
          currentExpiresAt: profile.subscription_expires_at?.toString(),
        })
        console.log('Subscription renewed:', profile.id)
        break
      }

      case 'BILLING.SUBSCRIPTION.CANCELLED':
      case 'BILLING.SUBSCRIPTION.EXPIRED': {
        // Check if there's a queued subscription to activate
        if (profile.queued_subscription) {
          const queued = profile.queued_subscription
          console.log('Activating queued subscription for user:', profile.id, 'plan_type:', queued.plan_type)

          // Activate the queued subscription
          await upgradePlan(supabase, {
            userId: profile.id,
            planType: queued.plan_type,
            expiresAt: calculateExpiryDate(queued.plan_type),
            gateway: 'paypal',
            gatewaySubscriptionId: queued.subscription_id,
            stripeCustomerId: null,
          })

          // Clear the queue
          await supabase.from('profiles').update({
            queued_subscription: null
          }).eq('id', profile.id)

          console.log('Queued subscription activated for user:', profile.id)
        } else {
          // No queued subscription, downgrade to free
          await downgradePlan(supabase, {
            userId: profile.id,
            gateway: 'paypal',
          })
          console.log('User downgraded to free:', profile.id)
        }
        break
      }

      case 'BILLING.SUBSCRIPTION.SUSPENDED':
      case 'BILLING.SUBSCRIPTION.PAYMENT.FAILED': {
        await downgradePlan(supabase, {
          userId: profile.id,
          gateway: 'paypal',
        })
        console.log('User suspended:', profile.id)
        break
      }

      default:
        console.log('Unhandled event type:', event_type)
    }
  } catch (err) {
    console.error('Webhook processing error:', err)
  }

  return new Response('OK', { status: 200 })
})
