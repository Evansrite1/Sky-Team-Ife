/* =====================================================================
   Sky Team Ife - configuration
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

  /* Push notifications. The public half of the key pair - safe to
     publish. The private half is VAPID_PRIVATE_KEY in Vercel's
     environment variables, read only by api/push.js. */
  vapidPublicKey: 'BE9-3jwbOU921KXzV_GpUL9MrlfmpS3LSM1C_tvFqsOEe_j2w9KymfUYJFkOerll1ibphAn9RshSmEnPz4JpIeg',

  /* Where this site is served from - used to build the QR links that
     distributors scan. Left alone it works the origin out by itself. */
  appUrl: window.location.origin + window.location.pathname.replace(/\/(index|scan)\.html$/, '').replace(/\/$/, ''),

  /* How many weeks of history the pickers and charts offer. */
  weeksShown: 12,

};

/* The app checks this before it tries to talk to the database, so a site
   with the placeholders still in it explains itself instead of hanging. */
window.CONFIG.ready = /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(window.CONFIG.supabaseUrl.trim())
  && window.CONFIG.supabaseAnonKey.trim().length > 40;
