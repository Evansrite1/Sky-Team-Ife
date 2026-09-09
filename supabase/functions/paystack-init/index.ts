/* =====================================================================
   paystack-init — start a subscription for the signed-in office.

   The browser cannot be trusted to say who it is or what it should pay.
   It may say WHICH LENGTH it wants — monthly, quarterly, yearly — but
   the amount and the Paystack plan that goes with that length are both
   looked up here, from app_settings, never taken from the request.

   Returns { url } — send the browser there and Paystack takes over.

   Secrets (Supabase dashboard -> Edge Functions -> Manage secrets):
     PAYSTACK_SECRET_KEY            sk_live_... Paystack -> Settings -> API Keys
     PAYSTACK_PLAN_CODE_MONTHLY     PLN_...     Paystack -> Plans (30 days)
     PAYSTACK_PLAN_CODE_QUARTERLY   PLN_...     Paystack -> Plans (90 days)
     PAYSTACK_PLAN_CODE_YEARLY      PLN_...     Paystack -> Plans (365 days)
     PAYSTACK_PLAN_CODE             the old single name — still read as a
                                     fallback for PAYSTACK_PLAN_CODE_MONTHLY,
                                     so nothing breaks if only that is set.
     SITE_URL                       https://sky-team-ife.vercel.app

   Leaving a period's plan code unset does not stop that period from
   being sold — Paystack still takes the one payment at the right
   amount. It just means Paystack will not re-bill it automatically;
   only supabase/functions/paystack-webhook, reacting to a payment that
   already landed, can grant the next block of time.
   ===================================================================== */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status, headers: { ...CORS, 'content-type': 'application/json' }
  });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const secret = Deno.env.get('PAYSTACK_SECRET_KEY');
  const site = Deno.env.get('SITE_URL') ?? '';
  if (!secret) return json({ error: 'Paystack is not configured yet.' }, 500);

  const auth = req.headers.get('Authorization') ?? '';
  if (!auth.startsWith('Bearer ')) return json({ error: 'Not signed in.' }, 401);

  /* The only thing the browser gets to say: which of the three lengths.
     Anything else in the request body is ignored. An unrecognised or
     missing value falls back to monthly rather than failing outright —
     the amount is still decided below, from the database either way. */
  const PERIODS: Record<string, { amountKey: string; daysKey: string; fallbackAmount: number; fallbackDays: number; planEnv: string[] }> = {
    monthly:   { amountKey: 'plan_amount_ngn',           daysKey: 'plan_days',           fallbackAmount: 4000,  fallbackDays: 30,  planEnv: ['PAYSTACK_PLAN_CODE_MONTHLY', 'PAYSTACK_PLAN_CODE'] },
    quarterly: { amountKey: 'plan_amount_ngn_quarterly', daysKey: 'plan_days_quarterly', fallbackAmount: 9000,  fallbackDays: 90,  planEnv: ['PAYSTACK_PLAN_CODE_QUARTERLY'] },
    yearly:    { amountKey: 'plan_amount_ngn_yearly',    daysKey: 'plan_days_yearly',    fallbackAmount: 30000, fallbackDays: 365, planEnv: ['PAYSTACK_PLAN_CODE_YEARLY'] }
  };
  let period = 'monthly';
  try {
    const reqBody = await req.json().catch(() => ({}));
    if (reqBody && typeof reqBody.period === 'string' && PERIODS[reqBody.period]) period = reqBody.period;
  } catch { /* malformed body, monthly stands */ }
  const chosen = PERIODS[period];
  const plan = chosen.planEnv.map(k => Deno.env.get(k)).find(v => !!v);

  /* Two clients: one as the caller, to find out who they are, and one
     with the service role, to write rows their own policies forbid. */
  const asUser = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: auth } } }
  );
  const asAdmin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const { data: userRes } = await asUser.auth.getUser();
  const user = userRes?.user;
  if (!user) return json({ error: 'Not signed in.' }, 401);

  const { data: profile } = await asAdmin
    .from('profiles').select('id, email, role, office_id').eq('id', user.id).maybeSingle();

  if (!profile) return json({ error: 'No profile for that account.' }, 403);
  if (profile.role !== 'office' || !profile.office_id) {
    return json({ error: 'Only an office has a subscription.' }, 403);
  }

  /* The price and the cycle length both live in the database, never in
     the request — only WHICH period was picked came from the browser,
     and that only chose which two settings rows get read. */
  const { data: rows } = await asAdmin
    .from('app_settings').select('key, value').in('key', [chosen.amountKey, chosen.daysKey]);
  const naira = Number(rows?.find(r => r.key === chosen.amountKey)?.value ?? chosen.fallbackAmount);
  const days = Number(rows?.find(r => r.key === chosen.daysKey)?.value ?? chosen.fallbackDays);

  const body: Record<string, unknown> = {
    email: profile.email,
    amount: naira * 100,                 // Paystack counts kobo
    currency: 'NGN',
    callback_url: site ? site + '/index.html#/subscriptions' : undefined,
    /* period and days travel with the charge so paystack-webhook can
       grant the right amount of time without a second lookup — the
       metadata Paystack hands back on charge.success is the same
       object sent here. */
    metadata: { office_id: profile.office_id, profile_id: profile.id, period, days }
  };
  /* With a plan code Paystack sets up the recurring charge itself. */
  if (plan) body.plan = plan;

  const res = await fetch('https://api.paystack.co/transaction/initialize', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + secret, 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  const out = await res.json();

  if (!res.ok || !out?.status) {
    return json({ error: out?.message ?? 'Paystack refused that request.' }, 400);
  }

  /* Remember the reference so the webhook can be matched to an office
     even if Paystack drops the metadata. */
  await asAdmin.from('subscriptions')
    .update({ paystack_email_token: out.data.reference, updated_at: new Date().toISOString() })
    .eq('office_id', profile.office_id);

  return json({ url: out.data.authorization_url });
});
