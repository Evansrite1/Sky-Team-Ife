/* =====================================================================
   Sky Team Ife — configuration
   Fill these in with your own Supabase project values, commit, and the
   site works. None of these are secrets: the anon key is designed to be
   public and is only useful alongside the row-level security policies in
   supabase/schema.sql. The service role key must NEVER appear here.
   ===================================================================== */
window.CONFIG = {
  // Supabase → Project Settings → API
  supabaseUrl: 'https://YOUR-PROJECT-REF.supabase.co',
  supabaseAnonKey: 'YOUR-ANON-PUBLIC-KEY',

  // Where this site is served from. Used to build the QR code links.
  // GitHub Pages example: https://yourname.github.io/sky-team-ife
  appUrl: window.location.origin + window.location.pathname.replace(/\/(index|scan)\.html$/, '').replace(/\/$/, ''),

  // Billing. Change these together with PLAN_AMOUNT_KOBO on the edge functions.
  plan: {
    amountNgn: 6500,
    days: 30,
    trialDays: 30,
    name: 'Office plan',
  },

  // How many weeks of history the pickers and charts offer.
  weeksShown: 9,

  organisation: 'Sky Team Ife',
};
