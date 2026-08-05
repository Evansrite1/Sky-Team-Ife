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

  /* Phase 2. Until Paystack is wired up the subscription page says so. */
  billingEnabled: false,
  plan: { amountNgn: 6500, days: 30, trialDays: 16, name: 'Office plan' }
};

/* The app checks this before it tries to talk to the database, so a site
   with the placeholders still in it explains itself instead of hanging. */
window.CONFIG.ready = /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(window.CONFIG.supabaseUrl.trim())
  && window.CONFIG.supabaseAnonKey.trim().length > 40;
