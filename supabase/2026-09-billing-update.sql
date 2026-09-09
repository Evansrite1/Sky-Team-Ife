-- =====================================================================
-- Sky Team Ife — new trial length, new price, three plan lengths
--
-- What this does:
--   1. Trial length becomes 14 days (was 16, briefly pinned to a fixed
--      shared date before that).
--   2. The monthly price drops from ₦6,500 to ₦4,000, and two longer
--      options are added: 3 months for ₦9,000, a year for ₦30,000.
--   3. start_trial() is put back to a plain rolling trial — 14 days
--      from whenever an office signs up — undoing the fixed shared
--      date (3 Sept 2026) that supabase/2026-08-fixes.sql set up.
--   4. Every subscription NOT already active is given a fresh 14-day
--      trial from today. Offices that have actually paid are left
--      alone — this only resets the ones still waiting.
--
-- Run the whole thing in the Supabase SQL editor. Wrapped in one
-- transaction; safe to run twice.
--
-- IMPORTANT — this is the database half only. Two more things need
-- doing outside the SQL editor for the new prices to actually take
-- effect on a real charge:
--   a. Deploy the updated Edge Functions:
--        supabase functions deploy paystack-init
--        supabase functions deploy paystack-webhook
--      Pushing this repo to GitHub updates the static site on Vercel;
--      it does NOT touch these functions. They only update when you
--      run the command above (or redeploy them by hand in the
--      Supabase dashboard).
--   b. If you want the 3-month and yearly plans to renew themselves
--      automatically through Paystack rather than being a single
--      charge each time, create two more Plans on Paystack
--      (Settings -> Plans) at ₦9,000/90 days and ₦30,000/365 days,
--      and set PAYSTACK_PLAN_CODE_QUARTERLY / PAYSTACK_PLAN_CODE_YEARLY
--      as Edge Function secrets alongside the existing
--      PAYSTACK_PLAN_CODE (which now covers the monthly plan only,
--      referenced as PAYSTACK_PLAN_CODE_MONTHLY or the old name as a
--      fallback). Leaving a code unset still charges the right amount
--      once — Paystack just does not re-bill it on its own.
-- =====================================================================
begin;

-- Look first if you want to see the shape of what is about to change:
--   select status, trial_ends, next_charge, amount_ngn, count(*)
--     from subscriptions group by 1,2,3,4 order by 1,2;

-- ---------------------------------------------------------------------
-- 1 & 2. Settings
-- ---------------------------------------------------------------------
insert into app_settings (key, value) values
  ('trial_days',                 '14'),
  ('plan_amount_ngn',            '4000'),
  ('plan_days',                  '30'),
  ('plan_amount_ngn_quarterly',  '9000'),
  ('plan_days_quarterly',        '90'),
  ('plan_amount_ngn_yearly',     '30000'),
  ('plan_days_yearly',           '365')
on conflict (key) do update set value = excluded.value;

-- The fixed shared billing-start date from 2026-08-fixes.sql is no
-- longer used now that trials are rolling again — remove it so nothing
-- reads a stale date by accident.
delete from app_settings where key = 'billing_starts';

-- ---------------------------------------------------------------------
-- 3. Back to a plain rolling trial
-- ---------------------------------------------------------------------
create or replace function start_trial()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_days integer := coalesce(nullif(setting('trial_days'), '')::integer, 14);
begin
  insert into subscriptions (office_id, status, amount_ngn, trial_ends, next_charge)
  values (new.id, 'trial',
          coalesce(nullif(setting('plan_amount_ngn'), '')::integer, 4000),
          current_date + v_days, current_date + v_days)
  on conflict (office_id) do nothing;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- 4. Fourteen fresh days for every office not already paying
-- ---------------------------------------------------------------------
update subscriptions
   set status      = 'trial',
       trial_ends  = current_date + 14,
       next_charge = current_date + 14,
       amount_ngn  = 4000,
       updated_at  = now()
 where status <> 'active';

commit;

-- ---------------------------------------------------------------------
-- AFTERWARDS — every non-active office on the same fresh countdown:
--   select status, trial_ends, next_charge, amount_ngn, count(*)
--     from subscriptions group by 1,2,3,4 order by 1,2;
-- Offices that had already paid (status = 'active') should be untouched
-- — check their next_charge is whatever it already was, not today+14.
-- =====================================================================
