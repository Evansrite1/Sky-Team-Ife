/* =====================================================================
   paystack-init — start a subscription for the signed-in office.

   The browser cannot be trusted to say who it is or what it should pay,
   so everything is decided here: the caller's JWT is verified, their
   office is looked up, and the amount comes from app_settings rather
   than from the request body.

   Returns { url } — send the browser there and Paystack takes over.

   Secrets (Supabase dashboard -> Edge Functions -> Manage secrets):
     PAYSTACK_SECRET_KEY   sk_live_... from Paystack -> Settings -> API Keys
     PAYSTACK_PLAN_CODE    PLN_...     from Paystack -> Plans
     SITE_URL              https://sky-team-ife.vercel.app
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
  const plan = Deno.env.get('PAYSTACK_PLAN_CODE');
  const site = Deno.env.get('SITE_URL') ?? '';
  if (!secret) return json({ error: 'Paystack is not configured yet.' }, 500);

  const auth = req.headers.get('Authorization') ?? '';
  if (!auth.startsWith('Bearer ')) return json({ error: 'Not signed in.' }, 401);

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

  /* The price lives in the database, never in the request. */
  const { data: setting } = await asAdmin
    .from('app_settings').select('value').eq('key', 'plan_amount_ngn').maybeSingle();
  const naira = Number(setting?.value ?? 6500);

  const body: Record<string, unknown> = {
    email: profile.email,
    amount: naira * 100,                 // Paystack counts kobo
    currency: 'NGN',
    callback_url: site ? site + '/index.html#/subscriptions' : undefined,
    metadata: { office_id: profile.office_id, profile_id: profile.id }
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
