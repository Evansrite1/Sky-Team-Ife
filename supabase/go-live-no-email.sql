-- =====================================================================
-- Sky Team Ife — GO LIVE (everything except the email features)
--
-- Paste this whole file into the Supabase SQL editor and press Run.
-- One transaction, safe to run twice, changes no existing data.
--
-- Adds:
--   1. Feature switches (all OFF) for Admin -> Features
--   2. activity_log      (admin action history)
--   3. goals             (an office's own monthly target)
--   4. feedback          (answers from the "What's new" popup)
--   5. issue_solutions   (Directors' solutions to offices' issues)
--   6. push_subscriptions (devices that turned notifications on)
--
-- Leaves out on purpose: renewal / receipt / digest / announcement
-- emails, and the estimate backfill (that one edits report data).
-- =====================================================================
begin;

-- 1. Feature switches ------------------------------------------------
insert into app_settings (key, value) values
  ('feature_streaks',         'false'),
  ('feature_csv_import',      'false'),
  ('feature_goals',           'false'),
  ('feature_csv_export',      'false'),
  ('feature_activity_log',    'false'),
  ('feature_renewal_emails',  'false'),
  ('feature_receipt_emails',  'false'),
  ('feature_monthly_digest',  'false'),
  ('feature_whatsapp',        'false'),
  ('feature_sms',             'false')
on conflict (key) do nothing;

-- 2. Activity log ----------------------------------------------------
create table if not exists activity_log (
  id          uuid primary key default gen_random_uuid(),
  actor_id    uuid references profiles(id) on delete set null,
  actor_name  text not null default '',
  action      text not null,
  target_kind text not null default '',
  target_id   uuid,
  target_name text not null default '',
  detail      text not null default '',
  created_at  timestamptz not null default now()
);
create index if not exists activity_log_created_idx on activity_log(created_at desc);
alter table activity_log enable row level security;
drop policy if exists activity_log_read on activity_log;
create policy activity_log_read on activity_log
  for select to authenticated using (is_admin());
drop policy if exists activity_log_write on activity_log;
create policy activity_log_write on activity_log
  for insert to authenticated with check (is_admin());

-- 3. Goals -----------------------------------------------------------
create table if not exists goals (
  office_id     uuid not null references offices(id) on delete cascade,
  month_no      integer not null,
  target_orders integer not null default 0 check (target_orders >= 0),
  target_amount numeric(12,2) not null default 0 check (target_amount >= 0),
  updated_at    timestamptz not null default now(),
  primary key (office_id, month_no)
);
alter table goals enable row level security;
drop policy if exists goals_read on goals;
create policy goals_read on goals
  for select to authenticated using (is_admin() or office_id = my_office());
drop policy if exists goals_write on goals;
create policy goals_write on goals
  for all to authenticated
  using (office_id = my_office()) with check (office_id = my_office());

-- 4. Feedback --------------------------------------------------------
create table if not exists feedback (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references profiles(id) on delete cascade,
  name        text not null default '',
  role        text not null default '',
  office_id   uuid references offices(id) on delete set null,
  center_id   uuid references centers(id) on delete set null,
  topic       text not null default '',
  solves      boolean not null,
  price_ngn   integer check (price_ngn is null or price_ngn >= 0),
  features    text not null default '',
  needs       text not null default '',
  created_at  timestamptz not null default now()
);
create index if not exists feedback_created_idx on feedback(created_at desc);
alter table feedback enable row level security;
drop policy if exists feedback_insert on feedback;
create policy feedback_insert on feedback
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists feedback_read on feedback;
create policy feedback_read on feedback
  for select to authenticated using (my_role() = 'super_admin');

-- 5. Issue solutions -------------------------------------------------
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
  for select to authenticated using (is_admin() or office_id = my_office());
drop policy if exists issue_solutions_write on issue_solutions;
create policy issue_solutions_write on issue_solutions
  for all to authenticated using (is_admin()) with check (is_admin());

-- 6. Push notification devices ---------------------------------------
create table if not exists push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references profiles(id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  role        text not null default '',
  office_id   uuid references offices(id) on delete set null,
  center_id   uuid references centers(id) on delete set null,
  user_agent  text not null default '',
  created_at  timestamptz not null default now(),
  last_used   timestamptz
);
create index if not exists push_subscriptions_user_idx on push_subscriptions(user_id);
alter table push_subscriptions enable row level security;
drop policy if exists push_own on push_subscriptions;
create policy push_own on push_subscriptions
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists push_super_read on push_subscriptions;
create policy push_super_read on push_subscriptions
  for select to authenticated using (my_role() = 'super_admin');

commit;

-- Check (should list the 6 tables):
select table_name from information_schema.tables
where table_schema = 'public'
  and table_name in ('activity_log','goals','feedback','issue_solutions','push_subscriptions','app_settings')
order by 1;
