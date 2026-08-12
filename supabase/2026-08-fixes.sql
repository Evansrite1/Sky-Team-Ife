-- =====================================================================
-- Sky Team Ife — the August 2026 corrections
--
-- Run this ONCE, whole, in the Supabase SQL editor:
--   Supabase -> SQL editor -> paste -> Run.
--
-- It is wrapped in a transaction. If any step fails, nothing is applied
-- and you can fix the cause and run it again. Every step is written to
-- be safe to run twice.
--
-- READ FIRST: step 2 DELETES reports. Step 5 DELETES an account. Neither
-- can be undone. Take a backup before you run this — Supabase -> Database
-- -> Backups — and read the SELECTs in step 0, which show you exactly
-- what the destructive steps are about to touch.
-- =====================================================================
begin;

-- ---------------------------------------------------------------------
-- 0. LOOK BEFORE YOU CUT
--    Run the file once with everything below step 0 commented out if you
--    want to see these first. They change nothing.
-- ---------------------------------------------------------------------
-- Every week that currently holds a report, oldest first:
--   select week_start, count(*) as reports, sum(orders) as orders
--     from reports group by week_start order by week_start;
--
-- The account about to be removed, and what hangs off it:
--   select id, email, role, full_name from profiles
--    where lower(email) = 'piusekeneorji@gmail.com';

-- ---------------------------------------------------------------------
-- 1. THE TWO FILLED WEEKS BECOME WEEK 31 AND WEEK 32
--
--    Weeks are Thursday-anchored and the app names them by ISO week, so
--    week 31 of 2026 is the Thursday of 30 July and week 32 the Thursday
--    of 6 August. Whatever dates the two rounds of filling actually
--    landed on, the earliest becomes 31 and the next becomes 32.
--
--    Reports are keyed (office_id, week_start), so moving a week onto a
--    date that already holds a report for the same office would collide.
--    The moves are ordered latest-first for that reason.
-- ---------------------------------------------------------------------
do $$
declare
  v_w31 date := date '2026-07-30';   -- Thursday, ISO week 31
  v_w32 date := date '2026-08-06';   -- Thursday, ISO week 32
  v_first  date;
  v_second date;
begin
  select min(week_start) into v_first from reports;
  if v_first is null then
    raise notice 'No reports at all — nothing to renumber.';
    return;
  end if;

  select min(week_start) into v_second from reports where week_start > v_first;

  -- Already done? Then there is nothing to move.
  if v_first = v_w31 and (v_second is null or v_second = v_w32) then
    raise notice 'Weeks are already 31 and 32.';
    return;
  end if;

  -- Latest first, so the two never try to occupy the same date.
  if v_second is not null and v_second <> v_w32 then
    update reports set week_start = v_w32 where week_start = v_second;
    update events  set week_start = v_w32 where week_start = v_second;
    raise notice 'Second week % -> % (week 32)', v_second, v_w32;
  end if;

  if v_first <> v_w31 then
    update reports set week_start = v_w31 where week_start = v_first;
    update events  set week_start = v_w31 where week_start = v_first;
    raise notice 'First week % -> % (week 31)', v_first, v_w31;
  end if;

  -- The two trainings sit at fixed places in the week: the Distributor
  -- Training on the Friday that opens it, the Senior Manager Training on
  -- the Wednesday that closes it.
  update events set event_date = week_start + 1 where type = 'DT';
  update events set event_date = week_start + 6 where type = 'SM';
end $$;

-- ---------------------------------------------------------------------
-- 2. THE RECORD NOW STARTS AT WEEK 31  ** DELETES DATA **
--
--    Everything filed against a week earlier than 30 July 2026 goes, so
--    the reports, the rankings and the monthly summary all begin there.
-- ---------------------------------------------------------------------
delete from reports where week_start < date '2026-07-30';

-- Attendance for those same dead weeks. Scans go with their event, by
-- the foreign key's on delete cascade.
delete from events where week_start < date '2026-07-30';

-- ---------------------------------------------------------------------
-- 3. ONE ENTRY, FIVE NICHES
--
--    Somebody typed the whole list into a single box, so it is sitting
--    in the catalogue and on the reports as one long product. Split it
--    wherever it appears, keep every other niche on the report, and drop
--    the run-on entry from the catalogue.
--
--    The five, exactly as they should read:
-- ---------------------------------------------------------------------
do $$
declare
  v_parts text[] := array['AI video', 'GHL landing page', 'A2P',
                          'Social media management', 'VA'];
  v_joined text;
begin
  -- Match the run-on entry however it was punctuated or capitalised:
  -- anything holding all five names in one string.
  for v_joined in
    select name from niches
     where name ilike '%ai video%' and name ilike '%ghl%'
       and name ilike '%a2p%' and name ilike '%social media%'
  loop
    raise notice 'Splitting niche: %', v_joined;

    -- On every report that carries it: drop the run-on, add the five.
    update reports
       set niches = (
         select array_agg(distinct n order by n)
           from unnest(array_remove(niches, v_joined) || v_parts) as n)
     where v_joined = any(niches);

    update reports
       set new_niches = (
         select array_agg(distinct n order by n)
           from unnest(array_remove(new_niches, v_joined) || v_parts) as n)
     where v_joined = any(new_niches);

    delete from niches where name = v_joined;
  end loop;

  -- And make sure all five stand on their own in the catalogue.
  insert into niches (name)
  select unnest(v_parts)
  on conflict (name) do nothing;
end $$;

-- ---------------------------------------------------------------------
-- 4. ONE PLAN, ONE DATE  —  ₦6,500 every 30 days from 3 September 2026
--
--    Every office runs free until the 3rd whenever it joined, and the
--    whole estate falls due together from then. The 30-day cycle after
--    that is Paystack's to run; this only sets where it starts.
-- ---------------------------------------------------------------------
update subscriptions
   set amount_ngn  = 6500,
       trial_ends  = date '2026-09-03',
       next_charge = date '2026-09-03',
       status      = case when status = 'active' then 'active' else 'trial' end,
       updated_at  = now();

-- New offices from here on get the same date rather than a 16-day trial
-- counted from the day they joined.
insert into app_settings (key, value) values ('plan_amount_ngn', '6500')
  on conflict (key) do update set value = excluded.value;
insert into app_settings (key, value) values ('billing_starts', '2026-09-03')
  on conflict (key) do update set value = excluded.value;

create or replace function start_trial()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_start date := coalesce(nullif(setting('billing_starts'), '')::date,
                           current_date + coalesce(nullif(setting('trial_days'), '')::integer, 16));
begin
  insert into subscriptions (office_id, status, amount_ngn, trial_ends, next_charge)
  values (new.id, 'trial',
          coalesce(nullif(setting('plan_amount_ngn'), '')::integer, 6500),
          -- Never behind us: an office joining after the start date gets
          -- its first charge on the next cycle rather than immediately.
          greatest(v_start, current_date),
          greatest(v_start, current_date))
  on conflict (office_id) do nothing;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- 5. REMOVE piusekeneorji@gmail.com  ** DELETES AN ACCOUNT **
--
--    Deleting the auth user cascades to the profile, and from there to
--    whatever it owned. Reports and distributors it created are kept —
--    those belong to the office, not to the person — their submitted_by
--    simply goes null.
-- ---------------------------------------------------------------------
delete from auth.users where lower(email) = 'piusekeneorji@gmail.com';

-- Belt and braces, in case a profile row outlived its auth user.
delete from profiles where lower(email) = 'piusekeneorji@gmail.com';

commit;

-- ---------------------------------------------------------------------
-- AFTERWARDS — what you should see
-- ---------------------------------------------------------------------
-- Two weeks, 30 July and 6 August, and nothing before them:
--   select week_start, count(*) from reports group by week_start order by week_start;
--
-- The five niches standing separately:
--   select name from niches
--    where name in ('AI video','GHL landing page','A2P','Social media management','VA');
--
-- Every office due on the same day:
--   select status, trial_ends, next_charge, count(*)
--     from subscriptions group by 1,2,3;
--
-- Gone:
--   select count(*) from profiles where lower(email) = 'piusekeneorji@gmail.com';
