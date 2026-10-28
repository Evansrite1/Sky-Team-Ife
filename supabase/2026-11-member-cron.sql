-- =====================================================================
-- Sky Team Ife - push the Wednesday code to Directors on a schedule
--
-- Do this AFTER 2026-11-members.sql, and after /api/code-push is
-- deployed with its three environment variables (see api/code-push.js).
--
-- 1. Supabase dashboard -> Database -> Extensions: switch on  pg_cron
--    and  pg_net.
-- 2. In the two places below, replace  PUT-YOUR-CRON-SECRET-HERE  with
--    the same string you saved as CRON_SECRET in Vercel.
-- 3. Run this file.
--
-- Times are UTC. Lagos is UTC+1, so these are 8:00, 9:00, 12:00, 14:00
-- and 15:05 Lagos on Wednesdays (day 3).
-- =====================================================================
select cron.schedule('sti-wed-code-main', '0 7,8,11,13 * * 3', $$
  select net.http_post(
    url := 'https://sky-team-ife.vercel.app/api/code-push',
    headers := jsonb_build_object('content-type', 'application/json',
                                  'x-cron-secret', 'PUT-YOUR-CRON-SECRET-HERE'),
    body := '{}'::jsonb
  );
$$);

select cron.schedule('sti-wed-code-late', '5 14 * * 3', $$
  select net.http_post(
    url := 'https://sky-team-ife.vercel.app/api/code-push',
    headers := jsonb_build_object('content-type', 'application/json',
                                  'x-cron-secret', 'PUT-YOUR-CRON-SECRET-HERE'),
    body := '{}'::jsonb
  );
$$);

-- To stop them later:
--   select cron.unschedule('sti-wed-code-main');
--   select cron.unschedule('sti-wed-code-late');
