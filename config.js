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

  /* Shows the pay button, and is what billing.locked() in api.js checks
     first — false here means nobody is ever locked out, client side,
     full stop, regardless of what any subscription row says. The lock
     itself, when this is true, is switched on separately by setting
     billing_enabled to 'true' in app_settings.

     PAUSED from 23 Sept 2026 to 1 Nov 2026 — every office can file its
     report with no payment screen in the way, whatever its trial or
     subscription status. supabase/2026-09-pause-billing.sql does the
     same thing on the database side (belt and braces: RLS stops
     enforcing the lock too, not just the UI), and pushes every
     subscription's clock to 1 Nov so re-enabling this later does not
     retroactively lock out an office whose trial happened to run out
     during the pause.

     To resume billing: set this back to true, and run the "turn it
     back on" block at the bottom of that SQL file. */
  billingEnabled: false,

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
