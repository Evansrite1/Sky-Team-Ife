-- =====================================================================
-- Sky Team Ife — fill every missing office week with an ESTIMATE
--
-- For every active office, every closed week from Week 1 (30 July 2026)
-- up to last week that has no report gets one, built from that
-- office's own average:
--   * orders and amount: the office's average across the weeks it did
--     file, varied by up to 15% either way so the weeks don't all read
--     the same. An office that has filed nothing uses its zone's
--     average; a zone with nothing uses the average of every office.
--   * distributors, senior managers, newbies, niches: copied from the
--     office's most recent real report.
--
-- Nothing an office filed is touched — only empty weeks are filled.
-- The week running now is left alone; that one is the office's to file.
--
-- Every estimate is marked: it has no "submitted by", and its notes
-- start with "Estimated by admin". The app shows it as "Estimate —
-- please update", and when the office files that week for real, its
-- own numbers replace the estimate. Estimates DO count in rankings and
-- totals until then.
--
-- Run in the Supabase SQL editor, one step at a time.
-- =====================================================================


-- ---------------------------------------------------------------------
-- STEP 1 — PREVIEW. Changes nothing. Shows how many weeks each office
-- is missing and roughly what would go in.
-- ---------------------------------------------------------------------
with weeks as (
  select generate_series(date '2026-07-30', week_start(current_date) - 7, interval '7 days')::date as ws
),
real as (
  select office_id, avg(orders) as o, avg(amount) as a
  from reports
  where not (submitted_by is null and issues like 'Estimated by admin%')
  group by office_id
)
select o.name as office,
       count(*) as weeks_missing,
       round(coalesce(r.o, 0)) as avg_orders_filed,
       round(coalesce(r.a, 0), 2) as avg_amount_filed
from offices o
cross join weeks w
left join reports x on x.office_id = o.id and x.week_start = w.ws
left join real r on r.office_id = o.id
where o.active and x.id is null
group by o.name, r.o, r.a
order by o.name;


-- ---------------------------------------------------------------------
-- STEP 2 — FILL. Safe to run twice: a week that already has a report
-- (real or estimate) is skipped.
-- ---------------------------------------------------------------------
begin;

with weeks as (
  select generate_series(date '2026-07-30', week_start(current_date) - 7, interval '7 days')::date as ws
),
real as (
  select * from reports
  where not (submitted_by is null and issues like 'Estimated by admin%')
),
office_avg as (
  select office_id, avg(orders) as o, avg(amount) as a from real group by office_id
),
zone_avg as (
  select center_id, avg(orders) as o, avg(amount) as a from real group by center_id
),
all_avg as (
  select avg(orders) as o, avg(amount) as a from real
),
latest as (
  select distinct on (office_id) office_id, niches, num_distributors,
         num_senior_managers, num_newbies, office_size, total_office
  from real
  order by office_id, week_start desc
),
gaps as (
  select o.id as office_id, o.center_id, w.ws,
         coalesce(oa.o, za.o, aa.o, 8)   as base_orders,
         coalesce(oa.a, za.a, aa.a, 400) as base_amount
  from offices o
  cross join weeks w
  cross join all_avg aa
  left join reports x    on x.office_id = o.id and x.week_start = w.ws
  left join office_avg oa on oa.office_id = o.id
  left join zone_avg za   on za.center_id = o.center_id
  where o.active and x.id is null
)
insert into reports (office_id, center_id, week_start, orders, amount, niches,
                     num_distributors, num_senior_managers, num_newbies,
                     office_size, total_office, issues, submitted_by, submitted_at)
select g.office_id, g.center_id, g.ws,
       greatest(0, round(g.base_orders * (0.85 + random() * 0.30)))::integer,
       greatest(0, round((g.base_amount * (0.85 + random() * 0.30))::numeric, 2)),
       coalesce(l.niches, '{}'),
       coalesce(l.num_distributors, 0),
       coalesce(l.num_senior_managers, 0),
       coalesce(l.num_newbies, 0),
       coalesce(l.office_size, 0),
       coalesce(l.total_office, 0),
       'Estimated by admin — this office had not filed this week. Update it with the real numbers.',
       null,
       g.ws + 6          -- dated the Wednesday the week closed
from gaps g
left join latest l on l.office_id = g.office_id
on conflict (office_id, week_start) do nothing;

-- How many went in:
select count(*) as estimates_now_in_the_app
from reports where submitted_by is null and issues like 'Estimated by admin%';

commit;


-- ---------------------------------------------------------------------
-- UNDO — only if you want every estimate gone again. Removes estimates
-- only; a week an office has since filed for real is not an estimate
-- any more and stays.
-- ---------------------------------------------------------------------
-- delete from reports
-- where submitted_by is null and issues like 'Estimated by admin%';
