// supabase/functions/billing-portal/index.ts
// Deploy: supabase functions deploy billing-portal
//
// Required secrets (already set):
//   STRIPE_SECRET_KEY  — Stripe secret key
//   APP_URL            — your Vercel URL

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@14?target=deno'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    // 1. Authenticate caller
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return new Response(
      JSON.stringify({ error: 'Missing authorization header' }),
      { status: 401, headers: { ...CORS, 'Content-Type': 'application/json' } }
    )

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

    if (!supabaseUrl || !anonKey || !serviceKey) {
      console.error('[billing-portal] Missing env vars')
      return new Response(
        JSON.stringify({ error: 'Server configuration error' }),
        { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } }
      )
    }

    // Extract token from Authorization header
    const token = authHeader.replace('Bearer ', '').trim()
    if (!token) {
      return new Response(
        JSON.stringify({ error: 'Invalid authorization header' }),
        { status: 401, headers: { ...CORS, 'Content-Type': 'application/json' } }
      )
    }

    // Verify token using the public key (anon key)
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } }
    })

    const { data: { user }, error: authErr } = await userClient.auth.getUser()

    if (authErr) {
      console.error('[billing-portal] Auth error:', authErr.message)
      return new Response(
        JSON.stringify({ error: 'Token validation failed: ' + authErr.message }),
        { status: 401, headers: { ...CORS, 'Content-Type': 'application/json' } }
      )
    }

    if (!user?.id) {
      console.error('[billing-portal] No user found in token')
      return new Response(
        JSON.stringify({ error: 'Invalid or expired token' }),
        { status: 401, headers: { ...CORS, 'Content-Type': 'application/json' } }
      )
    }

    console.log('[billing-portal] Auth successful for user:', user.id)

    // 2. Look up the Stripe customer ID from the profile
    const admin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } }
    )

    const { data: profile, error: profileErr } = await admin
      .from('profiles')
      .select('stripe_customer_id,plan')
      .eq('id', user.id)
      .single()

    console.log(`[billing-portal] User: ${user.id}, Profile:`, profile, 'Error:', profileErr)

    if (profileErr) return new Response(
      JSON.stringify({ error: 'Failed to load profile: ' + profileErr.message }),
      { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } }
    )

    if (!profile) return new Response(
      JSON.stringify({ error: 'Profile not found' }),
      { status: 404, headers: { ...CORS, 'Content-Type': 'application/json' } }
    )

    if (!profile?.stripe_customer_id) {
      // User is Pro via referral reward (no Stripe customer)
      // Redirect them to manage referrals instead
      const appUrl = Deno.env.get('APP_URL') ?? 'https://tradinggrove.vercel.app'
      console.log('[billing-portal] User has no Stripe customer - likely Pro via referral')
      return new Response(
        JSON.stringify({
          url: `${appUrl}/dashboard#referral`,
          message: 'Your Pro access is from referral rewards. Visit your dashboard to manage referrals.'
        }),
        { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } }
      )
    }

    // 3. Create billing portal session (for Stripe-paid Pro users)
    const appUrl = Deno.env.get('APP_URL') ?? 'https://tradinggrove.vercel.app'
    let returnUrl: string
    try { returnUrl = (await req.json()).return_url ?? `${appUrl}/subscription` }
    catch (_) { returnUrl = `${appUrl}/subscription` }

    const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', {
      apiVersion: '2023-10-16',
    })

    const portalSession = await stripe.billingPortal.sessions.create({
      customer:   profile.stripe_customer_id,
      return_url: returnUrl,
    })

    return new Response(JSON.stringify({ url: portalSession.url }), {
      status: 200, headers: { ...CORS, 'Content-Type': 'application/json' }
    })

  } catch (err: any) {
    console.error('billing-portal error:', err)
    return new Response(JSON.stringify({ error: err.message ?? 'Internal server error' }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' }
    })
  }
})