/* =====================================================================
   paystack-webhook — the only thing allowed to say an office has paid.

   Paystack POSTs here after every event. The body is signed with your
   secret key, so the signature is checked before a single byte of it is
   believed. An unsigned or wrongly signed request is dropped.

   Point Paystack at it:
     Paystack -> Settings -> API Keys & Webhooks -> Webhook URL
     https://<project-ref>.functions.supabase.co/paystack-webhook

   This function must be deployed with JWT verification OFF, because
   Paystack has no Supabase token. The signature is what authenticates
   it. In the dashboard: Edge Functions -> paystack-webhook -> Details
   -> uncheck "Enforce JWT verification".

   Secrets:
     PAYSTACK_SECRET_KEY   the same sk_live_... as paystack-init
   ===================================================================== */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { createHmac } from 'node:crypto';

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('POST only', { status: 405 });

  const secret = Deno.env.get('PAYSTACK_SECRET_KEY');
  if (!secret) return new Response('not configured', { status: 500 });

  /* Read the body as raw text: the signature is over exactly these
     bytes, so parsing first and re-serialising would break it. */
  const raw = await req.text();
  const sent = req.headers.get('x-paystack-signature') ?? '';
  const mine = createHmac('sha512', secret).update(raw).digest('hex');

  if (sent.length !== mine.length || sent !== mine) {
    return new Response('bad signature', { status: 401 });
  }

  const evt = JSON.parse(raw);
  const data = evt?.data ?? {};
  const db = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  /* Find the office. Metadata is the fast path; the stored reference is
     the fallback for events Paystack raises on its own, like a renewal
     that no browser ever started. */
  const findOffice = async (): Promise<string | null> => {
    const meta = data?.metadata?.office_id ?? data?.customer?.metadata?.office_id;
    if (meta) return meta as string;

    const email = data?.customer?.email;
    if (email) {
      const { data: p } = await db.from('profiles')
        .select('office_id').eq('email', email).not('office_id', 'is', null).maybeSingle();
      if (p?.office_id) return p.office_id;
    }
    const ref = data?.reference ?? data?.subscription_code;
    if (ref) {
      const { data: s } = await db.from('subscriptions')
        .select('office_id')
        .or('paystack_email_token.eq.' + ref + ',paystack_subscription.eq.' + ref)
        .maybeSingle();
      if (s?.office_id) return s.office_id;
    }
    return null;
  };

  const office = await findOffice();
  const days = await db.from('app_settings').select('value').eq('key', 'plan_days').maybeSingle()
    .then(r => Number(r.data?.value ?? 30));

  const nextCharge = () => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  };

  switch (evt?.event) {
    /* Money actually arrived. This is the only event that grants time. */
    case 'charge.success': {
      if (!office) break;
      const naira = Math.round((data.amount ?? 0) / 100);

      await db.from('payments').upsert({
        office_id: office,
        amount_ngn: naira,
        status: 'paid',
        reference: data.reference,
        method: data?.authorization?.channel ?? '',
        paid_at: data.paid_at ?? new Date().toISOString()
      }, { onConflict: 'reference' });

      await db.from('subscriptions').update({
        status: 'active',
        started_on: new Date().toISOString().slice(0, 10),
        next_charge: nextCharge(),
        amount_ngn: naira || undefined,
        method_brand: data?.authorization?.card_type ?? null,
        method_last4: data?.authorization?.last4 ?? null,
        paystack_customer: data?.customer?.customer_code ?? null,
        updated_at: new Date().toISOString()
      }).eq('office_id', office);
      break;
    }

    /* Paystack has set the recurring charge up. Record the code so a
       renewal months from now can still be traced back here. */
    case 'subscription.create': {
      if (!office) break;
      await db.from('subscriptions').update({
        paystack_subscription: data?.subscription_code ?? null,
        paystack_customer: data?.customer?.customer_code ?? null,
        paystack_email_token: data?.email_token ?? null,
        updated_at: new Date().toISOString()
      }).eq('office_id', office);
      break;
    }

    /* A renewal failed, or the office cancelled. Either way they stop
       being active; the lock takes effect when next_charge passes. */
    case 'invoice.payment_failed': {
      if (!office) break;
      await db.from('subscriptions')
        .update({ status: 'past_due', updated_at: new Date().toISOString() })
        .eq('office_id', office);
      await db.from('payments').upsert({
        office_id: office,
        amount_ngn: Math.round((data.amount ?? 0) / 100),
        status: 'failed',
        reference: data?.transaction?.reference ?? ('failed-' + Date.now()),
        reason: 'Renewal failed',
        paid_at: new Date().toISOString()
      }, { onConflict: 'reference' });
      break;
    }

    case 'subscription.disable':
    case 'subscription.not_renew': {
      if (!office) break;
      await db.from('subscriptions')
        .update({ status: 'cancelled', updated_at: new Date().toISOString() })
        .eq('office_id', office);
      break;
    }
  }

  /* Always 200. Paystack retries anything else, and a retry storm over
     an event we simply do not handle helps nobody. */
  return new Response('ok', { status: 200 });
});
