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
-- Times are UTC. Lagos is UTC+1, so these are 2:00pm and 3:05pm Lagos
-- on Wednesdays (day 3).
-- =====================================================================
select cron.schedule('sti-wed-code-2pm', '0 13 * * 3', $$
  select net.http_post(
    url := 'https://sky-team-ife.vercel.app/api/code-push',
    headers := jsonb_build_object('content-type', 'application/json',
                                  'x-cron-secret', 'PUT-YOUR-CRON-SECRET-HERE'),
    body := '{}'::jsonb
  );
$$);

select cron.schedule('sti-wed-code-305pm', '5 14 * * 3', $$
  select net.http_post(
    url := 'https://sky-team-ife.vercel.app/api/code-push',
    headers := jsonb_build_object('content-type', 'application/json',
                                  'x-cron-secret', 'PUT-YOUR-CRON-SECRET-HERE'),
    body := '{}'::jsonb
  );
$$);

-- To stop them later:
--   select cron.unschedule('sti-wed-code-2pm');
--   select cron.unschedule('sti-wed-code-305pm');
