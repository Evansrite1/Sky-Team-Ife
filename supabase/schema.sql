-- =====================================================================
-- Sky Team Ife — database schema
-- ---------------------------------------------------------------------
-- Paste this whole file into the Supabase SQL editor and run it once.
-- It is idempotent: running it a second time will not destroy data.
--
-- Roles
--   super_admin     creates centers, approves accounts, sees everything
--   platform_admin  a Leader — sees every center, runs the Wednesday evaluation
--   office          files one weekly report, manages its own distributors
--   pending         signed up, waiting on the Super Admin
--
-- Sign-up is open. Anyone can create an account, say whether they are an
-- office or a leader, and that lands as a request. Until the Super Admin
-- approves it the account is 'pending' and can see nothing at all.
--
-- A week runs Wednesday -> Tuesday. The evaluation sits on the Wednesday
-- after the week closes, at 2:45pm. Every report and event is stamped with
-- week_start, the Wednesday that opens its week.
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------
do $$ begin
  create type user_role as enum ('super_admin', 'platform_admin', 'office', 'pending');
exception when duplicate_object then null; end $$;

do $$ begin
  create type distributor_status as enum
    ('Distributor', 'Senior Manager', 'Executive Manager', 'Director', 'Emerald Director');
exception when duplicate_object then null; end $$;

do $$ begin
  create type event_kind as enum ('training', 'event');
exception when duplicate_object then null; end $$;

do $$ begin
  create type event_status as enum ('scheduled', 'open', 'closed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type eligibility as enum ('all', 'sm');
exception when duplicate_object then null; end $$;

do $$ begin
  create type scan_status as enum ('accepted', 'rejected');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- Settings — organisation-wide values, editable by the super admin
-- ---------------------------------------------------------------------
create table if not exists app_settings (
  key   text primary key,
  value text not null
);

insert into app_settings (key, value) values
  ('organisation',      'Sky Team Ife'),
  ('bootstrap_admin',   'ademiluaolufemi@gmail.com'),
  ('training_time',     '2:45pm')
on conflict (key) do nothing;

-- Sign-up used to be locked behind two access codes. It is approval-based
-- now, so the codes mean nothing and are cleared out.
delete from app_settings where key in ('office_join_code', 'admin_join_code');

create or replace function setting(p_key text)
returns text language sql stable security definer set search_path = public as $$
  select value from app_settings where key = p_key;
$$;

-- ---------------------------------------------------------------------
-- Centers
-- ---------------------------------------------------------------------
create table if not exists centers (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  area           text not null,
  address        text not null default '',
  leader_name    text not null default '',
  assistant_name text not null default '',
  created_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Offices
-- ---------------------------------------------------------------------
create table if not exists offices (
  id           uuid primary key default gen_random_uuid(),
  center_id    uuid not null references centers(id) on delete restrict,
  name         text not null,
  code         text not null unique,
  manager_name text not null default '',
  email        text not null default '',
  area         text not null default '',
  address      text not null default '',
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);
create index if not exists offices_center_idx on offices(center_id);

-- Collected when the office signs up. start_size is the headcount it
-- opened with; the weekly report tracks office_size from then on.
alter table offices add column if not exists phone      text not null default '';
alter table offices add column if not exists start_size integer not null default 0;

-- ---------------------------------------------------------------------
-- Profiles — one row per auth user
-- ---------------------------------------------------------------------
create table if not exists profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text not null,
  full_name  text not null default '',
  role       user_role not null default 'pending',
  office_id  uuid references offices(id) on delete set null,
  center_id  uuid references centers(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists profiles_office_idx on profiles(office_id);

alter table profiles add column if not exists phone text not null default '';

-- The access request that sits on a profile until it is approved. These
-- columns are only ever meaningful while role = 'pending'; approving
-- copies what it needs onto the new office and clears them.
--   req_status  none | pending | declined
--   req_kind    office | leader
-- A leader fills in nothing beyond their name and phone, which live on
-- the profile itself. Everything below is what an office has to give.
alter table profiles add column if not exists req_status      text not null default 'none';
alter table profiles add column if not exists req_kind        text;
alter table profiles add column if not exists req_center_id   uuid references centers(id) on delete set null;
alter table profiles add column if not exists req_office_name text;
alter table profiles add column if not exists req_office_code text;
alter table profiles add column if not exists req_area        text;
alter table profiles add column if not exists req_address     text;
alter table profiles add column if not exists req_size        integer;
alter table profiles add column if not exists req_note        text not null default '';
alter table profiles add column if not exists req_at          timestamptz;
create index if not exists profiles_req_idx on profiles(req_status) where req_status <> 'none';

-- The bootstrap address becomes super admin the moment it signs up.
create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    case when lower(coalesce(new.email, '')) = lower(coalesce(setting('bootstrap_admin'), ''))
         then 'super_admin'::user_role else 'pending'::user_role end
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ---------------------------------------------------------------------
-- Role helpers. SECURITY DEFINER so RLS policies can call them without
-- recursing back into the profiles policies.
-- ---------------------------------------------------------------------
create or replace function my_role()
returns user_role language sql stable security definer set search_path = public as $$
  select coalesce((select role from profiles where id = auth.uid()), 'pending'::user_role);
$$;

create or replace function my_office()
returns uuid language sql stable security definer set search_path = public as $$
  select office_id from profiles where id = auth.uid();
$$;

create or replace function my_center()
returns uuid language sql stable security definer set search_path = public as $$
  select center_id from profiles where id = auth.uid();
$$;

create or replace function is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select my_role() in ('super_admin', 'platform_admin');
$$;

-- Anyone may sign up now, so the row a signed-up account can already write
-- to — its own profile — has to be nailed down. Row level security cannot
-- protect single columns, so this does it: whoever you are, you may change
-- your name and your access request and nothing else. Only the Super Admin
-- (and the SQL editor, where auth.uid() is null) can move role, office or
-- center, and approve_access_request runs as the Super Admin who called it.
create or replace function guard_profile_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or my_role() = 'super_admin' then return new; end if;
  new.id        := old.id;
  new.email     := old.email;
  new.role      := old.role;
  new.office_id := old.office_id;
  new.center_id := old.center_id;
  return new;
end $$;

drop trigger if exists profiles_guard on profiles;
create trigger profiles_guard
  before update on profiles
  for each row execute function guard_profile_update();

-- ---------------------------------------------------------------------
-- Distributors
-- ---------------------------------------------------------------------
create table if not exists distributors (
  id         uuid primary key default gen_random_uuid(),
  office_id  uuid not null references offices(id) on delete cascade,
  center_id  uuid not null references centers(id) on delete cascade,
  full_name  text not null,
  status     distributor_status not null default 'Distributor',
  phone      text not null default '',
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists distributors_office_idx on distributors(office_id);
create index if not exists distributors_center_idx on distributors(center_id);

-- Keep center_id in step with the office it belongs to.
create or replace function sync_distributor_center()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select center_id into new.center_id from offices where id = new.office_id;
  return new;
end $$;

drop trigger if exists distributors_center_sync on distributors;
create trigger distributors_center_sync
  before insert or update of office_id on distributors
  for each row execute function sync_distributor_center();

-- ---------------------------------------------------------------------
-- Weeks — Wednesday to Tuesday, derived rather than stored
-- ---------------------------------------------------------------------
create or replace function week_start(p_day date default current_date)
returns date language sql immutable as $$
  select p_day - ((extract(dow from p_day)::int - 3 + 7) % 7);
$$;

-- ---------------------------------------------------------------------
-- Niches — the products orders are written on. Any office may add one.
-- ---------------------------------------------------------------------
create table if not exists niches (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Weekly reports — one per office per week
-- ---------------------------------------------------------------------
create table if not exists reports (
  id           uuid primary key default gen_random_uuid(),
  office_id    uuid not null references offices(id) on delete cascade,
  center_id    uuid not null references centers(id) on delete cascade,
  week_start   date not null,
  orders       integer not null check (orders >= 0),
  amount       numeric(12,2) not null check (amount >= 0),
  niches       text[] not null default '{}',
  new_niches   text[] not null default '{}',
  office_size  integer not null default 0,
  total_office integer not null default 0,
  issues       text not null default '',
  submitted_by uuid references profiles(id) on delete set null,
  submitted_at timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (office_id, week_start)
);
create index if not exists reports_week_idx on reports(week_start);
create index if not exists reports_center_week_idx on reports(center_id, week_start);

create or replace function sync_report_center()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select center_id into new.center_id from offices where id = new.office_id;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists reports_center_sync on reports;
create trigger reports_center_sync
  before insert or update on reports
  for each row execute function sync_report_center();

-- ---------------------------------------------------------------------
-- Events — the two weekly trainings plus anything a center puts on
-- ---------------------------------------------------------------------
create table if not exists events (
  id          uuid primary key default gen_random_uuid(),
  center_id   uuid not null references centers(id) on delete cascade,
  kind        event_kind not null default 'training',
  type        text not null default 'CUSTOM',           -- SM | DT | CUSTOM
  name        text not null,
  elig        eligibility not null default 'all',
  week_start  date not null,
  event_date  date not null,
  event_time  text not null default '2:45pm',
  code        text not null unique,
  status      event_status not null default 'scheduled',
  created_by  uuid references profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists events_center_week_idx on events(center_id, week_start);
create index if not exists events_code_idx on events(code);

-- ---------------------------------------------------------------------
-- Scans — one row per attempt, accepted or rejected, with the device
-- ---------------------------------------------------------------------
create table if not exists scans (
  id             uuid primary key default gen_random_uuid(),
  event_id       uuid not null references events(id) on delete cascade,
  distributor_id uuid not null references distributors(id) on delete cascade,
  office_id      uuid not null references offices(id) on delete cascade,
  device_id      text not null default '',
  status         scan_status not null default 'accepted',
  reason         text not null default '',
  scanned_at     timestamptz not null default now()
);
create index if not exists scans_event_idx on scans(event_id);
create unique index if not exists scans_one_accept_idx
  on scans(event_id, distributor_id) where status = 'accepted';

-- ---------------------------------------------------------------------
-- Billing (phase 2 — tables exist so nothing has to be migrated later)
-- ---------------------------------------------------------------------
create table if not exists subscriptions (
  office_id    uuid primary key references offices(id) on delete cascade,
  status       text not null default 'trial',    -- trial | active | past_due | cancelled
  amount_ngn   integer not null default 6500,
  trial_ends   date,
  next_charge  date,
  started_on   date,
  method_brand text,
  method_last4 text,
  updated_at   timestamptz not null default now()
);

create table if not exists payments (
  id         uuid primary key default gen_random_uuid(),
  office_id  uuid not null references offices(id) on delete cascade,
  amount_ngn integer not null,
  status     text not null default 'paid',       -- paid | failed | refunded
  reference  text not null unique,
  method     text not null default '',
  reason     text not null default '',
  paid_at    timestamptz not null default now()
);
create index if not exists payments_office_idx on payments(office_id);

-- Every new office starts on a 30-day trial.
create or replace function start_trial()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into subscriptions (office_id, status, trial_ends, next_charge)
  values (new.id, 'trial', current_date + 30, current_date + 30)
  on conflict (office_id) do nothing;
  return new;
end $$;

drop trigger if exists offices_start_trial on offices;
create trigger offices_start_trial
  after insert on offices
  for each row execute function start_trial();

-- =====================================================================
-- Row level security
-- =====================================================================
alter table app_settings  enable row level security;
alter table centers       enable row level security;
alter table offices       enable row level security;
alter table profiles      enable row level security;
alter table distributors  enable row level security;
alter table niches        enable row level security;
alter table reports       enable row level security;
alter table events        enable row level security;
alter table scans         enable row level security;
alter table subscriptions enable row level security;
alter table payments      enable row level security;

-- settings ------------------------------------------------------------
drop policy if exists settings_read on app_settings;
create policy settings_read on app_settings
  for select to authenticated using (true);

drop policy if exists settings_write on app_settings;
create policy settings_write on app_settings
  for all to authenticated
  using (my_role() = 'super_admin') with check (my_role() = 'super_admin');

-- profiles ------------------------------------------------------------
drop policy if exists profiles_self on profiles;
create policy profiles_self on profiles
  for select to authenticated using (id = auth.uid() or is_admin());

drop policy if exists profiles_self_update on profiles;
create policy profiles_self_update on profiles
  for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid() and role = my_role());

drop policy if exists profiles_admin_write on profiles;
create policy profiles_admin_write on profiles
  for all to authenticated
  using (my_role() = 'super_admin') with check (my_role() = 'super_admin');

-- centers -------------------------------------------------------------
drop policy if exists centers_read on centers;
create policy centers_read on centers
  for select to authenticated using (true);

drop policy if exists centers_write on centers;
create policy centers_write on centers
  for all to authenticated
  using (my_role() = 'super_admin') with check (my_role() = 'super_admin');

-- offices -------------------------------------------------------------
-- Sign-up is open, so an account waiting on approval must not be able to
-- read the office list — it carries manager names and email addresses.
drop policy if exists offices_read on offices;
create policy offices_read on offices
  for select to authenticated
  using (is_admin() or id = my_office() or center_id = my_center());

drop policy if exists offices_admin_write on offices;
create policy offices_admin_write on offices
  for all to authenticated using (is_admin()) with check (is_admin());

drop policy if exists offices_self_update on offices;
create policy offices_self_update on offices
  for update to authenticated
  using (id = my_office()) with check (id = my_office());

-- distributors --------------------------------------------------------
drop policy if exists distributors_read on distributors;
create policy distributors_read on distributors
  for select to authenticated
  using (is_admin() or office_id = my_office() or center_id = my_center());

drop policy if exists distributors_office_write on distributors;
create policy distributors_office_write on distributors
  for all to authenticated
  using (is_admin() or office_id = my_office())
  with check (is_admin() or office_id = my_office());

-- niches --------------------------------------------------------------
drop policy if exists niches_read on niches;
create policy niches_read on niches for select to authenticated using (true);

drop policy if exists niches_insert on niches;
create policy niches_insert on niches for insert to authenticated with check (true);

-- reports -------------------------------------------------------------
drop policy if exists reports_read on reports;
create policy reports_read on reports
  for select to authenticated
  using (is_admin() or office_id = my_office() or center_id = my_center());

drop policy if exists reports_office_write on reports;
create policy reports_office_write on reports
  for all to authenticated
  using (is_admin() or office_id = my_office())
  with check (is_admin() or office_id = my_office());

-- events --------------------------------------------------------------
drop policy if exists events_read on events;
create policy events_read on events
  for select to authenticated
  using (is_admin() or center_id = my_center());

drop policy if exists events_write on events;
create policy events_write on events
  for all to authenticated
  using (is_admin() or center_id = my_center())
  with check (is_admin() or center_id = my_center());

-- scans ---------------------------------------------------------------
drop policy if exists scans_read on scans;
create policy scans_read on scans
  for select to authenticated
  using (is_admin() or office_id = my_office()
         or exists (select 1 from events e where e.id = scans.event_id and e.center_id = my_center()));

drop policy if exists scans_admin_write on scans;
create policy scans_admin_write on scans
  for all to authenticated
  using (is_admin() or office_id = my_office())
  with check (is_admin() or office_id = my_office());

-- billing -------------------------------------------------------------
drop policy if exists subs_read on subscriptions;
create policy subs_read on subscriptions
  for select to authenticated using (is_admin() or office_id = my_office());

drop policy if exists subs_write on subscriptions;
create policy subs_write on subscriptions
  for all to authenticated using (is_admin()) with check (is_admin());

drop policy if exists payments_read on payments;
create policy payments_read on payments
  for select to authenticated using (is_admin() or office_id = my_office());

drop policy if exists payments_write on payments;
create policy payments_write on payments
  for all to authenticated using (is_admin()) with check (is_admin());

-- =====================================================================
-- Sign-up: you ask, the Super Admin approves
-- ---------------------------------------------------------------------
-- The old access codes are gone. Anyone may create an account; it starts
-- as 'pending', which can see nothing. They say what they are joining as,
-- the Super Admin approves, and only then does the office get created and
-- the role handed over.
-- =====================================================================
drop function if exists claim_office(text, text, text, uuid, text, text, text);
drop function if exists claim_admin(text, text);
drop function if exists check_join_code(text, text);
drop function if exists submit_access_request(text, text, uuid, text, text);

-- Called by the applicant, on their own account. An office has to give
-- everything the office record needs; a leader gives a name and a phone.
create or replace function submit_access_request(
  p_kind        text,
  p_full_name   text,
  p_phone       text,
  p_center_id   uuid,
  p_office_name text,
  p_office_code text,
  p_area        text,
  p_address     text,
  p_size        integer
) returns void
language plpgsql security definer set search_path = public as $$
declare v_role user_role;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  select role into v_role from profiles where id = auth.uid();
  if v_role is distinct from 'pending' then
    raise exception 'This account has already been approved.';
  end if;
  if coalesce(p_kind, '') not in ('office', 'leader') then
    raise exception 'Say whether you are joining as an office or as a leader.';
  end if;
  if coalesce(trim(p_full_name), '') = '' then
    raise exception 'Please give your name.';
  end if;
  if coalesce(trim(p_phone), '') = '' then
    raise exception 'Please give a phone number.';
  end if;

  if p_kind = 'office' then
    if p_center_id is null then
      raise exception 'Pick the center your office belongs to.';
    end if;
    if coalesce(trim(p_office_name), '') = '' then
      raise exception 'Your office needs a name.';
    end if;
    if coalesce(trim(p_office_code), '') = '' then
      raise exception 'Your office needs a short code.';
    end if;
    if coalesce(trim(p_area), '') = '' then
      raise exception 'Say which area your office is in.';
    end if;
    if coalesce(trim(p_address), '') = '' then
      raise exception 'Give the address of your office.';
    end if;
    if coalesce(p_size, 0) < 0 then
      raise exception 'Office size cannot be negative.';
    end if;
    if exists (select 1 from offices where lower(code) = lower(trim(p_office_code))) then
      raise exception 'An office is already using the code %.', upper(trim(p_office_code));
    end if;
    if exists (select 1 from profiles
                where id <> auth.uid() and req_status = 'pending'
                  and lower(coalesce(req_office_code, '')) = lower(trim(p_office_code))) then
      raise exception 'Someone else is already waiting on the code %.', upper(trim(p_office_code));
    end if;
  end if;

  update profiles set
    full_name       = trim(p_full_name),
    phone           = trim(p_phone),
    req_kind        = p_kind,
    req_center_id   = case when p_kind = 'office' then p_center_id end,
    req_office_name = case when p_kind = 'office' then trim(p_office_name) end,
    req_office_code = case when p_kind = 'office' then upper(trim(p_office_code)) end,
    req_area        = case when p_kind = 'office' then trim(p_area) end,
    req_address     = case when p_kind = 'office' then trim(p_address) end,
    req_size        = case when p_kind = 'office' then greatest(coalesce(p_size, 0), 0) end,
    req_status      = 'pending',
    req_note        = '',
    req_at          = now()
  where id = auth.uid();
end $$;

-- Super Admin only. Creates the office if that is what was asked for, then
-- moves the account onto its real role and clears the request.
create or replace function approve_access_request(p_user uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  r        profiles%rowtype;
  v_office uuid;
begin
  if my_role() <> 'super_admin' then
    raise exception 'Only the Super Admin can approve an account.';
  end if;
  select * into r from profiles where id = p_user;
  if not found then
    raise exception 'No such account.';
  end if;
  if r.role <> 'pending' or r.req_status <> 'pending' then
    raise exception 'There is nothing waiting on that account.';
  end if;

  if r.req_kind = 'office' then
    if r.req_center_id is null then
      raise exception 'That request does not say which center.';
    end if;
    if exists (select 1 from offices where lower(code) = lower(r.req_office_code)) then
      raise exception 'An office is already using the code %.', r.req_office_code;
    end if;

    insert into offices (center_id, name, code, manager_name, email, phone,
                         area, address, start_size)
    select r.req_center_id, r.req_office_name, upper(r.req_office_code),
           r.full_name, r.email, r.phone,
           coalesce(nullif(r.req_area, ''), c.area, ''),
           coalesce(r.req_address, ''), coalesce(r.req_size, 0)
      from centers c where c.id = r.req_center_id
    returning id into v_office;

    if v_office is null then
      raise exception 'That center no longer exists. Ask them to pick another one.';
    end if;

    update profiles
       set role = 'office', office_id = v_office, center_id = r.req_center_id,
           req_status = 'none', req_note = ''
     where id = p_user;

  elsif r.req_kind = 'leader' then
    update profiles
       set role = 'platform_admin', req_status = 'none', req_note = ''
     where id = p_user;

  else
    raise exception 'That request does not say what it is for.';
  end if;
end $$;

-- Super Admin only. The account stays pending and can put in a fresh
-- request; the reason is shown to them so they know what to change.
create or replace function decline_access_request(p_user uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if my_role() <> 'super_admin' then
    raise exception 'Only the Super Admin can decline an account.';
  end if;
  update profiles
     set req_status = 'declined',
         req_note   = coalesce(nullif(trim(p_reason), ''), 'No reason was given.')
   where id = p_user and role = 'pending' and req_status = 'pending';
  if not found then
    raise exception 'There is nothing waiting on that account.';
  end if;
end $$;

-- =====================================================================
-- The two weekly trainings create themselves, per center, per week
-- =====================================================================
create or replace function ensure_week_events(p_week date default null)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_week  date := coalesce(p_week, week_start());
  v_made  integer := 0;
  c       record;
begin
  if auth.uid() is null then
    return 0;
  end if;

  for c in select id, name from centers loop
    -- Senior Manager Training, the Wednesday that opens the week
    if not exists (select 1 from events
                    where center_id = c.id and week_start = v_week and type = 'SM') then
      insert into events (center_id, kind, type, name, elig, week_start, event_date, event_time, code, status)
      values (c.id, 'training', 'SM', 'Senior Manager Training', 'sm', v_week, v_week,
              coalesce(setting('training_time'), '2:45pm'),
              'SM-' || upper(left(replace(c.id::text, '-', ''), 6)) || '-' || to_char(v_week, 'IYYYIW'),
              case when v_week > current_date then 'scheduled' else 'closed' end);
      v_made := v_made + 1;
    end if;

    -- Distributor Training, the Friday of the same week
    if not exists (select 1 from events
                    where center_id = c.id and week_start = v_week and type = 'DT') then
      insert into events (center_id, kind, type, name, elig, week_start, event_date, event_time, code, status)
      values (c.id, 'training', 'DT', 'Distributor Training', 'all', v_week, v_week + 2,
              coalesce(setting('training_time'), '2:45pm'),
              'DT-' || upper(left(replace(c.id::text, '-', ''), 6)) || '-' || to_char(v_week, 'IYYYIW'),
              case when v_week + 2 > current_date then 'scheduled' else 'closed' end);
      v_made := v_made + 1;
    end if;
  end loop;

  return v_made;
end $$;

-- =====================================================================
-- The public scan page. A distributor has no account, so both calls are
-- SECURITY DEFINER and reachable by anon — they read nothing but the
-- names needed to pick yourself out of a list.
-- =====================================================================
create or replace function scan_lookup(p_code text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_event  record;
  v_center record;
  v_offs   jsonb;
  v_dists  jsonb;
begin
  select * into v_event from events where upper(code) = upper(trim(p_code));
  if v_event is null then
    return jsonb_build_object('ok', false, 'error', 'That code does not match any session.');
  end if;

  select * into v_center from centers where id = v_event.center_id;

  select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name, 'code', o.code)
                            order by o.name), '[]'::jsonb)
    into v_offs
    from offices o where o.center_id = v_event.center_id and o.active;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', d.id, 'name', d.full_name, 'status', d.status, 'office_id', d.office_id)
           order by d.full_name), '[]'::jsonb)
    into v_dists
    from distributors d
   where d.center_id = v_event.center_id and d.active
     and (v_event.elig = 'all' or d.status in
          ('Senior Manager', 'Executive Manager', 'Director', 'Emerald Director'));

  return jsonb_build_object(
    'ok', true,
    'event', jsonb_build_object(
      'id', v_event.id, 'name', v_event.name, 'code', v_event.code,
      'status', v_event.status, 'elig', v_event.elig,
      'date', v_event.event_date, 'time', v_event.event_time),
    'center', jsonb_build_object('id', v_center.id, 'name', v_center.name, 'area', v_center.area),
    'offices', v_offs,
    'distributors', v_dists
  );
end $$;

create or replace function record_scan(p_code text, p_distributor uuid, p_device text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_event record;
  v_dist  record;
begin
  select * into v_event from events where upper(code) = upper(trim(p_code));
  if v_event is null then
    return jsonb_build_object('ok', false, 'error', 'That code does not match any session.');
  end if;
  if v_event.status <> 'open' then
    return jsonb_build_object('ok', false,
      'error', 'Scanning is not open for this session yet. Ask the office to open it.');
  end if;

  select * into v_dist from distributors where id = p_distributor and active;
  if v_dist is null then
    return jsonb_build_object('ok', false, 'error', 'We could not find you on the list.');
  end if;
  if v_dist.center_id <> v_event.center_id then
    return jsonb_build_object('ok', false, 'error', 'You belong to a different center.');
  end if;
  if v_event.elig = 'sm' and v_dist.status = 'Distributor' then
    return jsonb_build_object('ok', false,
      'error', 'This session is for Senior Managers and above.');
  end if;

  -- same person, already in
  if exists (select 1 from scans
              where event_id = v_event.id and distributor_id = p_distributor and status = 'accepted') then
    return jsonb_build_object('ok', false, 'error', 'You are already scanned in for this session.');
  end if;

  -- one device, one person
  if p_device <> '' and exists (select 1 from scans
        where event_id = v_event.id and device_id = p_device and status = 'accepted') then
    insert into scans (event_id, distributor_id, office_id, device_id, status, reason)
    values (v_event.id, p_distributor, v_dist.office_id, p_device, 'rejected',
            'Device already used for this session');
    return jsonb_build_object('ok', false,
      'error', 'This phone has already scanned someone in for this session.');
  end if;

  insert into scans (event_id, distributor_id, office_id, device_id, status)
  values (v_event.id, p_distributor, v_dist.office_id, p_device, 'accepted');

  return jsonb_build_object('ok', true, 'name', v_dist.full_name, 'event', v_event.name);
end $$;

-- One QR per center. It opens the scan page with the center id, this
-- call lists that center's sessions for the current week, and the
-- distributor picks the one happening now.
create or replace function center_lookup(p_center uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_center record;
  v_evs    jsonb;
begin
  select * into v_center from centers where id = p_center;
  if v_center is null then
    return jsonb_build_object('ok', false, 'error', 'That QR code does not match any center.');
  end if;

  perform ensure_week_events_for(p_center, week_start());

  select coalesce(jsonb_agg(jsonb_build_object(
           'name', e.name, 'code', e.code, 'status', e.status, 'elig', e.elig,
           'date', e.event_date, 'time', e.event_time)
           order by e.status = 'open' desc, e.event_date), '[]'::jsonb)
    into v_evs
    from events e
   where e.center_id = p_center and e.week_start = week_start();

  return jsonb_build_object(
    'ok', true,
    'center', jsonb_build_object('id', v_center.id, 'name', v_center.name, 'area', v_center.area),
    'events', v_evs
  );
end $$;

-- The per-center half of ensure_week_events, callable without a session
-- so the center QR still works for a distributor with no account.
create or replace function ensure_week_events_for(p_center uuid, p_week date)
returns void
language plpgsql security definer set search_path = public as $$
declare
  c record;
begin
  select id into c from centers where id = p_center;
  if c is null then return; end if;

  if not exists (select 1 from events where center_id = p_center and week_start = p_week and type = 'SM') then
    insert into events (center_id, kind, type, name, elig, week_start, event_date, event_time, code, status)
    values (p_center, 'training', 'SM', 'Senior Manager Training', 'sm', p_week, p_week,
            coalesce(setting('training_time'), '2:45pm'),
            'SM-' || upper(left(replace(p_center::text, '-', ''), 6)) || '-' || to_char(p_week, 'IYYYIW'),
            case when p_week > current_date then 'scheduled' else 'closed' end);
  end if;

  if not exists (select 1 from events where center_id = p_center and week_start = p_week and type = 'DT') then
    insert into events (center_id, kind, type, name, elig, week_start, event_date, event_time, code, status)
    values (p_center, 'training', 'DT', 'Distributor Training', 'all', p_week, p_week + 2,
            coalesce(setting('training_time'), '2:45pm'),
            'DT-' || upper(left(replace(p_center::text, '-', ''), 6)) || '-' || to_char(p_week, 'IYYYIW'),
            case when p_week + 2 > current_date then 'scheduled' else 'closed' end);
  end if;
end $$;

revoke all on function scan_lookup(text)               from public;
revoke all on function record_scan(text, uuid, text)   from public;
revoke all on function center_lookup(uuid)             from public;
revoke all on function ensure_week_events_for(uuid, date) from public;
revoke all on function submit_access_request(text, text, text, uuid, text, text, text, text, integer) from public;
revoke all on function approve_access_request(uuid)    from public;
revoke all on function decline_access_request(uuid, text) from public;
grant execute on function scan_lookup(text)             to anon, authenticated;
grant execute on function record_scan(text, uuid, text) to anon, authenticated;
grant execute on function center_lookup(uuid)           to anon, authenticated;
grant execute on function ensure_week_events(date)      to authenticated;
grant execute on function week_start(date)              to anon, authenticated;
grant execute on function submit_access_request(text, text, text, uuid, text, text, text, text, integer) to authenticated;
grant execute on function approve_access_request(uuid)  to authenticated;
grant execute on function decline_access_request(uuid, text) to authenticated;

-- The sign-up screen has to list centers before the user has a role.
drop policy if exists centers_public_read on centers;
create policy centers_public_read on centers
  for select to anon using (true);

-- =====================================================================
-- Done. Sign up at your site with ademiluaolufemi@gmail.com and you land
-- as Super Admin. Create your centers, then send people the site address.
-- They sign up, ask to join, and you approve them from Centers & admins.
-- =====================================================================
