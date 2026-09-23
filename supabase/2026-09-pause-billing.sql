-- =====================================================================
-- Sky Team Ife — pause billing until 1 November 2026
--
-- config.js already has billingEnabled: false, which stops the app
-- from ever showing a locked screen or a pay button, client side. This
-- is the belt-and-braces other half: it turns off the same lock at the
-- database level (row level security calls office_locked(), which
-- reads billing_enabled from here), so a report cannot be blocked even
-- by a direct request that bypassed the UI.
--
-- It also pushes every subscription's trial_ends and next_charge to
-- 1 November. Not required for the pause itself — billing_enabled off
-- means nothing is locked regardless of those dates — but it matters
-- for afterwards: without this, an office whose trial technically ran
-- out in October would be locked out the instant billing_enabled goes
-- back to 'true', with no warning and no runway. Pushing every date to
-- November now means turning billing back on later is not itself a
-- surprise lockout for anyone.
--
-- Run the whole thing in the Supabase SQL editor. Wrapped in one
-- transaction; safe to run twice.
-- =====================================================================
begin;

-- Look first if you want to see what is about to move:
--   select status, trial_ends, next_charge, count(*)
--     from subscriptions group by 1,2,3 order by 1,2;

-- ---------------------------------------------------------------------
-- 1. Turn the lock off
-- ---------------------------------------------------------------------
insert into app_settings (key, value) values ('billing_enabled', 'false')
  on conflict (key) do update set value = excluded.value;

-- ---------------------------------------------------------------------
-- 2. Everyone gets the same runway: 1 November
-- ---------------------------------------------------------------------
insert into app_settings (key, value) values ('billing_starts', '2026-11-01')
  on conflict (key) do update set value = excluded.value;

update subscriptions
   set status      = case when status = 'active' then 'active' else 'trial' end,
       trial_ends  = '2026-11-01',
       next_charge = '2026-11-01',
       updated_at  = now()
 where status <> 'active';

-- New signups between now and November land on the same date rather
-- than a rolling 14-day trial that would run out before billing does.
create or replace function start_trial()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_start date := coalesce(nullif(setting('billing_starts'), '')::date,
                           current_date + coalesce(nullif(setting('trial_days'), '')::integer, 14));
begin
  insert into subscriptions (office_id, status, amount_ngn, trial_ends, next_charge)
  values (new.id, 'trial',
          coalesce(nullif(setting('plan_amount_ngn'), '')::integer, 4000),
          greatest(v_start, current_date),
          greatest(v_start, current_date))
  on conflict (office_id) do nothing;
  return new;
end $$;

commit;

-- ---------------------------------------------------------------------
-- AFTERWARDS — every non-active office on the same date:
--   select status, trial_ends, next_charge, count(*)
--     from subscriptions group by 1,2,3 order by 1,2;
-- =====================================================================


-- =====================================================================
-- WHEN YOU ARE READY TO TURN BILLING BACK ON (around 1 November) —
-- run this block on its own, separately, once you have also set
-- billingEnabled back to true in config.js and pushed that:
--
--   update app_settings set value = 'true' where key = 'billing_enabled';
--
--   -- Back to a plain rolling trial from whenever an office actually
--   -- joins, the same as before the pause — new signups after this
--   -- point should not all land on 1 November forever.
--   create or replace function start_trial()
--   returns trigger language plpgsql security definer set search_path = public as $$
--   declare v_days integer := coalesce(nullif(setting('trial_days'), '')::integer, 14);
--   begin
--     insert into subscriptions (office_id, status, amount_ngn, trial_ends, next_charge)
--     values (new.id, 'trial',
--             coalesce(nullif(setting('plan_amount_ngn'), '')::integer, 4000),
--             current_date + v_days, current_date + v_days)
--     on conflict (office_id) do nothing;
--     return new;
--   end $$;
--
--   delete from app_settings where key = 'billing_starts';
-- =====================================================================
