-- =====================================================================
-- One query per migration, to confirm each of the three actually took.
-- Read-only — safe to run any time, changes nothing.
-- =====================================================================

-- 1. Weeks renumbered and pre-August cleared (2026-08-fixes.sql)
--    Expect: only 2026-07-30 and 2026-08-06, nothing earlier.
select week_start, count(*) as reports
  from reports
 group by week_start
 order by week_start;

-- 2. Diamond sits on week 32, not week 33 (2026-08-diamond-week.sql)
--    Expect: one row, week_start = 2026-08-06.
select o.name, r.week_start, r.orders, r.amount
  from reports r join offices o on o.id = r.office_id
 where o.name ilike '%diamond%'
 order by r.week_start;

-- 3. The five niches stand separately, nothing run together
--    (2026-08-fixes.sql), and nothing left with a comma or a case
--    duplicate (2026-08-niche-cleanup.sql)
--    Expect: 5 rows for the first query, 0 rows for the next two.
select name from niches
 where name in ('AI video','GHL landing page','A2P','Social media management','VA');

select name from niches where name like '%,%';

select lower(trim(name)) as key, count(*) as spellings, array_agg(name) as seen
  from niches group by 1 having count(*) > 1;

-- 4. piusekeneorji@gmail.com is gone
--    Expect: 0.
select count(*) from profiles where lower(email) = 'piusekeneorji@gmail.com';

-- 5. Every subscription due on the same day, ₦6,500
--    Expect: one row, or very close to one — status/trial_ends/next_charge
--    the same across every office.
select status, trial_ends, next_charge, amount_ngn, count(*)
  from subscriptions
 group by 1, 2, 3, 4
 order by 1, 2;
