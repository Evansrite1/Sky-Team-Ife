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

  /* One plan, the same for every office: ₦6,500 every 30 days. Nobody is
     charged before firstChargeOn — every office runs free until that day
     whenever it joined, so the whole estate falls due together. Moving
     the date here only changes what the app says; the dates the charges
     actually run from live in the subscriptions table, which
     supabase/2026-08-fixes.sql sets to match. */
  plan: {
    amountNgn: 6500, days: 30, trialDays: 16, name: 'Office plan',
    firstChargeOn: '2026-09-03'
  }
};

/* The app checks this before it tries to talk to the database, so a site
   with the placeholders still in it explains itself instead of hanging. */
window.CONFIG.ready = /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(window.CONFIG.supabaseUrl.trim())
  && window.CONFIG.supabaseAnonKey.trim().length > 40;
