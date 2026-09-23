-- =====================================================================
-- Sky Team Ife — "send an announcement" (email everyone in the app)
--
-- Adds one feature flag for the broadcast tool in Admin -> Features:
-- a Super Admin writes a subject and a message and sends it to
-- everyone, or to just offices, just Directors, or just Super Admins.
--
-- This reuses supabase/functions/notify, which you already have if you
-- ran the September feature work — only the flag is new here. If you
-- have NOT deployed notify yet (or set RESEND_API_KEY / NOTIFY_FROM),
-- do that first; turning this flag on without it just makes the button
-- fail with a clear error instead of doing nothing.
--
-- Run in the Supabase SQL editor. Safe to run twice.
-- =====================================================================
begin;

insert into app_settings (key, value) values
  ('feature_broadcast_email', 'false')
on conflict (key) do nothing;

commit;

-- ---------------------------------------------------------------------
-- After this: redeploy the function (it has the new broadcast logic
-- in it now), then turn the flag on when you are ready to use it:
--
--   supabase functions deploy notify
--
-- Then in the app: Admin -> Features -> "Send an announcement" -> on.
-- ---------------------------------------------------------------------
