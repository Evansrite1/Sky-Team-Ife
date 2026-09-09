/* =====================================================================
   Sky Team Ife — configuration
   ---------------------------------------------------------------------
   Fill in the two Supabase values below, commit, and the site is live.
   Find them in Supabase -> Project Settings -> Data API / API Keys.

   Neither value is a secret. The anon key is designed to sit in public
   HTML; row level security in supabase/schema.sql is what protects the
   data. The service_role key must NEVER appear in this file.
   ===================================================================== */
window.CONFIG = {
  supabaseUrl: 'https://xuxukwrvyduilmxyswik.supabase.co',
  supabaseAnonKey: 'sb_publishable_t4HoL9y_7ZYAo8xzf1TquA_imDgKZGe',

  organisation: 'Sky Team Ife',

  /* Where this site is served from — used to build the QR links that
     distributors scan. Left alone it works the origin out by itself. */
  appUrl: window.location.origin + window.location.pathname.replace(/\/(index|scan)\.html$/, '').replace(/\/$/, ''),

  /* How many weeks of history the pickers and charts offer. */
  weeksShown: 12,

  /* Shows the pay button. The lock itself is switched on separately, by
     setting billing_enabled to 'true' in app_settings — do that only
     once the two Edge Functions are deployed, or offices will be locked
     out with a button that cannot reach Paystack. */
  billingEnabled: true,

  /* The monthly rate and the trial length, for everything that talks
     about the plan in passing (the locked-out screen, the "not switched
     on yet" notice). Kept in sync by hand with plan_amount_ngn and
     trial_days in app_settings — this is what the app SAYS the price
     is; what it actually CHARGES is decided server-side in
     supabase/functions/paystack-init, from the database, never from
     here. If these two ever disagree, the database wins and an office
     sees one number and pays another — check app_settings first. */
  plan: { amountNgn: 4000, days: 30, trialDays: 14, name: 'Office plan' },

  /* The three lengths an office can pay for. Every field here has a
     matching app_settings row of the same shape
     (plan_amount_ngn / plan_amount_ngn_quarterly / plan_amount_ngn_yearly,
     plan_days / plan_days_quarterly / plan_days_yearly) — same rule as
     above, this is display only. The discount on the longer plans is
     ours to set; change the amount here and in
     supabase/2026-09-billing-update.sql together, or the button will
     promise one price and Paystack will charge another.

     Quarterly and yearly are untouched by the monthly price moving to
     4,000 — they were already set at their own discount, not as a
     multiple of the monthly figure, so only the "vs paying monthly"
     comparison text below changed. */
  plans: {
    monthly:   { period: 'monthly',   label: 'Monthly',   amountNgn: 4000,  days: 30 },
    quarterly: { period: 'quarterly', label: '3 months',  amountNgn: 9000,  days: 90,
      note: 'vs 12,000 paid monthly' },
    yearly:    { period: 'yearly',    label: 'Yearly',    amountNgn: 30000, days: 365,
      note: 'vs 48,000 paid monthly — 4 months free' }
  }
};

/* The app checks this before it tries to talk to the database, so a site
   with the placeholders still in it explains itself instead of hanging. */
window.CONFIG.ready = /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(window.CONFIG.supabaseUrl.trim())
  && window.CONFIG.supabaseAnonKey.trim().length > 40;
