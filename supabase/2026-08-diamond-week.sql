-- =====================================================================
-- Diamond office filed for week 32, and it landed on week 33.
--
-- Run in the Supabase SQL editor. Safe to run twice: once the report is
-- on week 32 there is nothing left on week 33 to move.
--
-- Weeks are Thursday-anchored, so:
--   week 32 = Thursday 6 August 2026   (6 – 12 Aug)
--   week 33 = Thursday 13 August 2026  (13 – 19 Aug)
--
-- Why it happens: the week picker opens on the week running *now*. File
-- on the Thursday for the seven days that just ended and it goes to the
-- new week unless the picker is changed first.
-- =====================================================================
begin;

-- Look first. This is what is about to move:
--   select o.name, r.week_start, r.orders, r.amount, r.submitted_at
--     from reports r join offices o on o.id = r.office_id
--    where o.name ilike '%diamond%'
--    order by r.week_start;

do $$
declare
  v_w32 date := date '2026-08-06';
  v_w33 date := date '2026-08-13';
  v_office uuid;
  v_moved  integer;
begin
  select id into v_office from offices where name ilike '%diamond%' limit 1;

  if v_office is null then
    raise exception 'No office matching "diamond" — check the name and try again.';
  end if;

  -- Refuse rather than overwrite: if week 32 already holds a report for
  -- this office, the two have to be reconciled by hand.
  if exists (select 1 from reports where office_id = v_office and week_start = v_w32)
     and exists (select 1 from reports where office_id = v_office and week_start = v_w33)
  then
    raise exception 'Diamond has a report on BOTH week 32 and week 33. Decide which one is right, delete the other, then run this again.';
  end if;

  update reports
     set week_start = v_w32
   where office_id = v_office
     and week_start = v_w33;

  get diagnostics v_moved = row_count;
  raise notice 'Moved % report(s) from week 33 to week 32.', v_moved;
end $$;

commit;

-- Afterwards — Diamond should show one row, on 2026-08-06:
--   select o.name, r.week_start, r.orders, r.amount
--     from reports r join offices o on o.id = r.office_id
--    where o.name ilike '%diamond%' order by r.week_start;
