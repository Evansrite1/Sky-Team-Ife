-- =====================================================================
-- Sky Team Ife — issues one by one, with a solution from the Directors
--
-- Offices now list what slowed them down one issue at a time (still
-- kept in reports.issues, one issue per line — nothing to migrate).
-- This adds the table that holds a Director's or Super Admin's solution
-- to each one, and the office sees the solution under its issue.
--
-- Who can do what:
--   * Super Admins and Directors read and write every solution.
--   * An office reads the solutions to its own issues, and nothing else.
--
-- Run in the Supabase SQL editor. Safe to run twice.
-- =====================================================================
begin;

create table if not exists issue_solutions (
  id             uuid primary key default gen_random_uuid(),
  report_id      uuid not null references reports(id) on delete cascade,
  issue          text not null,
  office_id      uuid not null references offices(id) on delete cascade,
  center_id      uuid not null references centers(id) on delete cascade,
  week_start     date not null,
  solution       text not null default '',
  solved_by      uuid references profiles(id) on delete set null,
  solved_by_name text not null default '',
  updated_at     timestamptz not null default now(),
  unique (report_id, issue)
);
create index if not exists issue_solutions_office_idx on issue_solutions(office_id);
create index if not exists issue_solutions_week_idx   on issue_solutions(week_start);

alter table issue_solutions enable row level security;

drop policy if exists issue_solutions_read on issue_solutions;
create policy issue_solutions_read on issue_solutions
  for select to authenticated
  using (is_admin() or office_id = my_office());

drop policy if exists issue_solutions_write on issue_solutions;
create policy issue_solutions_write on issue_solutions
  for all to authenticated
  using (is_admin())
  with check (is_admin());

commit;

-- Check it worked (should return 0 rows, no error):
-- select * from issue_solutions limit 5;
