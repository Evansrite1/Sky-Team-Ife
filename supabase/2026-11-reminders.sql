-- =====================================================================
-- Sky Team Ife - reminders: before the meeting, and for weekly reports
--
-- Needs pg_cron and pg_net switched on (Database -> Extensions), and the
-- two Vercel functions deployed with their environment variables
-- (api/code-push.js and api/report-push.js; same three variables).
--
-- 1. Replace  PUT-YOUR-CRON-SECRET-HERE  below (4 places) with the same
--    string you saved as CRON_SECRET in Vercel.
-- 2. Paste the whole file into the Supabase SQL editor and Run.
--
-- Times are UTC. Lagos is UTC+1.
--
-- WEDNESDAY (day 3), all before the 2:45pm meeting:
--   1:00pm  check-in opens: Directors get the code, Senior Managers a nudge
--   2:00pm  same again
--   2:30pm  last call, fifteen minutes before the meeting
-- MONDAY TO THURSDAY, 10:00am:
--   offices (and their Senior Managers) who have not filed last week's or
--   this week's report are told. Offices that are up to date hear nothing.
--
-- Safe to run twice: scheduling a name that already exists replaces it.
-- =====================================================================

-- The old 3:05pm job came AFTER the meeting started. Gone.
select cron.unschedule('sti-wed-code-305pm')
 where exists (select 1 from cron.job where jobname = 'sti-wed-code-305pm');

select cron.schedule('sti-wed-code-1pm', '0 12 * * 3', $$
  select net.http_post(
    url := 'https://sky-team-ife.vercel.app/api/code-push',
    headers := jsonb_build_object('content-type', 'application/json', 'x-cron-secret', 'PUT-YOUR-CRON-SECRET-HERE'),
    body := '{}'::jsonb);
$$);

select cron.schedule('sti-wed-code-2pm', '0 13 * * 3', $$
  select net.http_post(
    url := 'https://sky-team-ife.vercel.app/api/code-push',
    headers := jsonb_build_object('content-type', 'application/json', 'x-cron-secret', 'PUT-YOUR-CRON-SECRET-HERE'),
    body := '{}'::jsonb);
$$);

select cron.schedule('sti-wed-code-230pm', '30 13 * * 3', $$
  select net.http_post(
    url := 'https://sky-team-ife.vercel.app/api/code-push',
    headers := jsonb_build_object('content-type', 'application/json', 'x-cron-secret', 'PUT-YOUR-CRON-SECRET-HERE'),
    body := '{}'::jsonb);
$$);

select cron.schedule('sti-report-reminder', '0 9 * * 1-4', $$
  select net.http_post(
    url := 'https://sky-team-ife.vercel.app/api/report-push',
    headers := jsonb_build_object('content-type', 'application/json', 'x-cron-secret', 'PUT-YOUR-CRON-SECRET-HERE'),
    body := '{}'::jsonb);
$$);

-- Check: four jobs.
select jobname, schedule from cron.job where jobname like 'sti-%' order by jobname;

-- To stop one later:  select cron.unschedule('sti-report-reminder');
