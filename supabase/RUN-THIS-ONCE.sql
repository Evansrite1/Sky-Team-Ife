-- =====================================================================
-- Sky Team Ife - RUN THIS ONCE
--
-- ONE file. Paste the WHOLE thing into the Supabase SQL editor and press
-- Run. It is safe to run again whenever you like, and safe if you already
-- ran any of the older files.
--
-- It sets up, in order:
--   1  Member accounts, each office's own link, the Wednesday check-in
--   2  Sponsor name on sign-up
--   3  One training only: the Wednesday Senior Manager Training
--   4  Directors check in
--   5  Directors see the members in their zone
--   6  Check-in closing time (6:00pm, or later on an extended day)
--   7  No approvals. Senior managers work inside their office
--   8  A Senior Manager signs up and picks an office, and that office
--      accepts. Also a security fix: accounts with no office could
--      manage other people's offices through an unchecked comparison
--   9  The office login checks in too (with the zone's code)
--  10  Reminders: pushes before the 2:45pm meeting, and for weekly
--      reports (needs pg_cron and pg_net, see PART 10)
--
-- Already done on your database before this: supabase/schema.sql and the
-- older dated files (2026-08 to 2026-10). They are not repeated here.
-- =====================================================================


-- ##### PART 1 of 10: Member accounts, office links, Wednesday check-in (2026-11-members.sql) #####
-- =====================================================================
-- Sky Team Ife - member accounts and the Wednesday check-in
--
-- Senior Managers and Executive Managers join through their office's
-- link and get their own login. They can see their whole zone (offices,
-- orders, issues, solutions) but change none of it. Every Wednesday the
-- Senior Manager Training has one code per zone, held by the zone's
-- Director, and a member checks in by typing it. Anyone who has not
-- checked in by the end of the training is counted absent.
--
-- Adds:
--   * the 'member' role
--   * a join code per office (office_join_codes)
--   * a weekly code per zone training (event_codes), Directors only
--   * scans.late, set at check-in (after 2:45pm Lagos time)
--   * member_people, each member's own list of people they follow up
--   * the functions the app calls (join, check in, roster, ...)
--   * one switch: feature_members, OFF until you turn it on
--
-- Run the whole file in the Supabase SQL editor. Safe to run twice.
-- =====================================================================
begin;

alter type user_role add value if not exists 'member';

insert into app_settings (key, value) values ('feature_members', 'false')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------
-- A member belongs to an office but must NOT get profiles.office_id:
-- every "office may write its own rows" policy keys on that column, and a
-- member may only look. center_id is set, which is what lets them read
-- their zone.
alter table profiles add column if not exists member_office_id uuid references offices(id) on delete set null;
alter table profiles add column if not exists rank             text;
alter table profiles add column if not exists distributor_id   uuid references distributors(id) on delete set null;
alter table scans    add column if not exists late             boolean not null default false;

-- Nobody edits these on their own profile; only the join function does.
create or replace function guard_profile_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or my_role() = 'super_admin'
     or coalesce(current_setting('sti.member_join', true), '') = '1' then
    return new;
  end if;
  new.id               := old.id;
  new.email            := old.email;
  new.role             := old.role;
  new.office_id        := old.office_id;
  new.center_id        := old.center_id;
  new.member_office_id := old.member_office_id;
  new.rank             := old.rank;
  new.distributor_id   := old.distributor_id;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- Office join codes
-- ---------------------------------------------------------------------
create or replace function gen_code(n integer default 6)
returns text language plpgsql volatile as $$
declare
  chars constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  out text := '';
begin
  for i in 1..n loop
    out := out || substr(chars, 1 + floor(random() * length(chars))::int, 1);
  end loop;
  return out;
end $$;

create table if not exists office_join_codes (
  office_id  uuid primary key references offices(id) on delete cascade,
  code       text not null unique,
  created_at timestamptz not null default now()
);
alter table office_join_codes enable row level security;

drop policy if exists join_codes_read on office_join_codes;
create policy join_codes_read on office_join_codes
  for select to authenticated
  using (is_admin() or office_id = my_office());

insert into office_join_codes (office_id, code)
select o.id, gen_code(6) from offices o
where not exists (select 1 from office_join_codes c where c.office_id = o.id)
on conflict do nothing;

create or replace function offices_join_code()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into office_join_codes (office_id, code) values (new.id, gen_code(6))
  on conflict do nothing;
  return new;
end $$;
drop trigger if exists offices_join_code_t on offices;
create trigger offices_join_code_t after insert on offices
  for each row execute function offices_join_code();

create or replace function regenerate_join_code(p_office uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v text;
begin
  if not (is_admin() or coalesce(my_office() = p_office, false)) then raise exception 'Not allowed.'; end if;
  loop
    v := gen_code(6);
    exit when not exists (select 1 from office_join_codes where code = v);
  end loop;
  insert into office_join_codes (office_id, code) values (p_office, v)
  on conflict (office_id) do update set code = excluded.code, created_at = now();
  return v;
end $$;

-- ---------------------------------------------------------------------
-- Weekly zone codes. One per Senior Manager Training, same all day.
-- Only Directors and the Super Admin can read them.
-- ---------------------------------------------------------------------
create table if not exists event_codes (
  event_id uuid primary key references events(id) on delete cascade,
  code     text not null
);
alter table event_codes enable row level security;
drop policy if exists event_codes_read on event_codes;
create policy event_codes_read on event_codes
  for select to authenticated using (is_admin());

insert into event_codes (event_id, code)
select e.id, gen_code(5) from events e
where e.type = 'SM'
  and not exists (select 1 from event_codes c where c.event_id = e.id)
on conflict do nothing;

create or replace function events_weekly_code()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.type = 'SM' then
    insert into event_codes (event_id, code) values (new.id, gen_code(5))
    on conflict do nothing;
  end if;
  return new;
end $$;
drop trigger if exists events_weekly_code_t on events;
create trigger events_weekly_code_t after insert on events
  for each row execute function events_weekly_code();

-- ---------------------------------------------------------------------
-- A member only looks. The events policy used to let anyone in the zone
-- write; keep that for offices, never for members.
-- ---------------------------------------------------------------------
drop policy if exists events_write on events;
create policy events_write on events
  for all to authenticated
  using (is_admin() or (center_id = my_center() and my_role()::text <> 'member'))
  with check (is_admin() or (center_id = my_center() and my_role()::text <> 'member' and not my_office_locked()));

-- Members read the solutions to issues in their zone.
drop policy if exists issue_solutions_member_read on issue_solutions;
create policy issue_solutions_member_read on issue_solutions
  for select to authenticated
  using (my_role()::text = 'member' and center_id = my_center());

-- ---------------------------------------------------------------------
-- Each member's own list of people they follow up
-- ---------------------------------------------------------------------
create table if not exists member_people (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references profiles(id) on delete cascade,
  name       text not null,
  phone      text not null default '',
  stage      text not null default 'New number'
             check (stage in ('New number', 'Talking', 'Invited', 'Came to office', 'Joined')),
  note       text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists member_people_owner_idx on member_people(owner_id);
alter table member_people enable row level security;

drop policy if exists member_people_own on member_people;
create policy member_people_own on member_people
  for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- ---------------------------------------------------------------------
-- Joining through the office link (before sign-in: names only)
-- ---------------------------------------------------------------------
create or replace function join_office_info(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_off offices%rowtype; v_names jsonb;
begin
  if coalesce(setting('feature_members'), 'false') <> 'true' then
    return jsonb_build_object('ok', false, 'error', 'Member sign-up is not open yet.');
  end if;
  select o.* into v_off from offices o join office_join_codes c on c.office_id = o.id
   where c.code = upper(trim(p_code)) and o.active;
  if v_off.id is null then
    return jsonb_build_object('ok', false, 'error', 'This link is not valid. Ask your office for a new one.');
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'name', d.full_name, 'status', d.status) order by d.full_name), '[]'::jsonb)
    into v_names
    from distributors d
   where d.office_id = v_off.id and d.active
     and d.status::text in ('Senior Manager', 'Executive Manager')
     and not exists (select 1 from profiles p where p.distributor_id = d.id);
  return jsonb_build_object('ok', true, 'office', v_off.name,
    'zone', (select name from centers where id = v_off.center_id), 'names', v_names);
end $$;

create or replace function member_join(p_code text, p_rank text, p_name text, p_phone text, p_dist uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me  profiles%rowtype;
  v_off offices%rowtype;
  v_did uuid := p_dist;
begin
  if coalesce(setting('feature_members'), 'false') <> 'true' then
    raise exception 'Member sign-up is not open yet.';
  end if;
  select * into v_me from profiles where id = auth.uid();
  if v_me.id is null then raise exception 'Sign in first.'; end if;
  if v_me.role::text <> 'pending' then raise exception 'This account already has a role.'; end if;
  if p_rank not in ('Senior Manager', 'Executive Manager') then
    raise exception 'Pick Senior Manager or Executive Manager.';
  end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Your name is needed.'; end if;
  select o.* into v_off from offices o join office_join_codes c on c.office_id = o.id
   where c.code = upper(trim(p_code)) and o.active;
  if v_off.id is null then raise exception 'This link is not valid.'; end if;

  if v_did is not null then
    if not exists (select 1 from distributors where id = v_did and office_id = v_off.id)
       or exists (select 1 from profiles where distributor_id = v_did) then
      raise exception 'That name is not available. Pick another or add yourself.';
    end if;
    update distributors set status = p_rank::distributor_status,
           phone = case when coalesce(p_phone, '') <> '' then p_phone else phone end
     where id = v_did;
  else
    insert into distributors (office_id, center_id, full_name, status, phone)
    values (v_off.id, v_off.center_id, trim(p_name), p_rank::distributor_status, coalesce(p_phone, ''))
    returning id into v_did;
  end if;

  perform set_config('sti.member_join', '1', true);
  update profiles
     set role = 'member'::user_role,
         center_id = v_off.center_id,
         member_office_id = v_off.id,
         rank = p_rank,
         distributor_id = v_did,
         full_name = trim(p_name),
         phone = coalesce(p_phone, ''),
         req_status = 'none'
   where id = auth.uid();
  return jsonb_build_object('ok', true, 'office', v_off.name);
end $$;

-- ---------------------------------------------------------------------
-- The Wednesday check-in. Lagos time. Open 1:00pm to 6:00pm; late after
-- 2:45pm. Wrong codes are recorded and stop after eight tries.
-- ---------------------------------------------------------------------
create or replace function member_check_in(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me    profiles%rowtype;
  v_local timestamp := now() at time zone 'Africa/Lagos';
  v_week  date;
  v_ev    events%rowtype;
  v_late  boolean;
begin
  if coalesce(setting('feature_members'), 'false') <> 'true' then
    return jsonb_build_object('ok', false, 'error', 'Check-in is not switched on yet.');
  end if;
  select * into v_me from profiles where id = auth.uid();
  if v_me.id is null or v_me.role::text <> 'member' or v_me.distributor_id is null then
    return jsonb_build_object('ok', false, 'error', 'Only members can check in.');
  end if;
  if extract(dow from v_local) <> 3 then
    return jsonb_build_object('ok', false, 'error', 'Check-in is only open on Wednesday.');
  end if;
  if v_local::time < time '13:00' then
    return jsonb_build_object('ok', false, 'error', 'Check-in opens at 1:00pm.');
  end if;
  if v_local::time > time '18:00' then
    return jsonb_build_object('ok', false, 'error', 'The training is over for today.');
  end if;

  v_week := week_start(v_local::date);
  perform ensure_week_events_for(v_me.center_id, v_week);
  select * into v_ev from events
   where center_id = v_me.center_id and week_start = v_week and type = 'SM' limit 1;
  if v_ev.id is null then
    return jsonb_build_object('ok', false, 'error', 'No training found for your zone today.');
  end if;

  if exists (select 1 from scans where event_id = v_ev.id and distributor_id = v_me.distributor_id and status = 'accepted') then
    return jsonb_build_object('ok', true, 'already', true);
  end if;

  if (select count(*) from scans where event_id = v_ev.id and distributor_id = v_me.distributor_id
         and status = 'rejected' and device_id = 'member') >= 8 then
    return jsonb_build_object('ok', false, 'error', 'Too many wrong tries. Ask your Director to check you in.');
  end if;

  if not exists (select 1 from event_codes where event_id = v_ev.id and upper(code) = upper(trim(p_code))) then
    insert into scans (event_id, distributor_id, office_id, device_id, status, reason)
    values (v_ev.id, v_me.distributor_id, v_me.member_office_id, 'member', 'rejected', 'wrong code');
    return jsonb_build_object('ok', false, 'error', 'That code is not right. Ask your Director.');
  end if;

  v_late := v_local::time > time '14:45';
  insert into scans (event_id, distributor_id, office_id, device_id, status, late)
  values (v_ev.id, v_me.distributor_id, v_me.member_office_id, 'member', 'accepted', v_late);
  return jsonb_build_object('ok', true, 'late', v_late, 'at', to_char(v_local, 'HH12:MI am'));
end $$;

-- ---------------------------------------------------------------------
-- For the office leader: the roster, and the names (never the numbers)
-- of the people each member is following up.
-- ---------------------------------------------------------------------
create or replace function office_members(p_office uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_off uuid := coalesce(p_office, my_office());
begin
  if not (is_admin() or coalesce(my_office() = v_off, false)) then raise exception 'Not allowed.'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', p.id, 'name', p.full_name, 'rank', p.rank, 'phone', p.phone,
      'distributor_id', p.distributor_id, 'joined', p.created_at,
      'tracking', (select count(*) from member_people m where m.owner_id = p.id)
    ) order by p.full_name)
    from profiles p
    where p.role::text = 'member' and p.member_office_id = v_off), '[]'::jsonb);
end $$;

create or replace function office_people_names(p_office uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_off uuid := coalesce(p_office, my_office());
begin
  if not (is_admin() or coalesce(my_office() = v_off, false)) then raise exception 'Not allowed.'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('member', p.full_name, 'name', m.name, 'stage', m.stage)
                     order by p.full_name, m.created_at)
    from member_people m join profiles p on p.id = m.owner_id
    where p.role::text = 'member' and p.member_office_id = v_off), '[]'::jsonb);
end $$;

create or replace function remove_member(p_member uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_off uuid;
begin
  select member_office_id into v_off from profiles where id = p_member and role::text = 'member';
  if v_off is null then raise exception 'Not a member.'; end if;
  if not (is_admin() or coalesce(my_office() = v_off, false)) then raise exception 'Not allowed.'; end if;
  perform set_config('sti.member_join', '1', true);
  update profiles
     set role = 'pending'::user_role, center_id = null, member_office_id = null,
         rank = null, distributor_id = null, req_status = 'none'
   where id = p_member;
end $$;

commit;

-- ##### PART 2 of 10: Sponsor name on sign-up (2026-11-members-2.sql) #####
-- =====================================================================
-- Sky Team Ife - members, part 2: the sponsor's name
--
-- Run AFTER 2026-11-members.sql. Safe to run twice.
-- A member now types their own name, their sponsor's name and their
-- phone when they join; nothing has to be picked from a list.
-- =====================================================================
begin;

alter table profiles add column if not exists sponsor_name text not null default '';

drop function if exists member_join(text, text, text, text, uuid);

create or replace function member_join(
  p_code text, p_rank text, p_name text, p_phone text,
  p_dist uuid default null, p_sponsor text default ''
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me  profiles%rowtype;
  v_off offices%rowtype;
  v_did uuid := p_dist;
begin
  if coalesce(setting('feature_members'), 'false') <> 'true' then
    raise exception 'Member sign-up is not open yet.';
  end if;
  select * into v_me from profiles where id = auth.uid();
  if v_me.id is null then raise exception 'Sign in first.'; end if;
  if v_me.role::text <> 'pending' then raise exception 'This account already has a role.'; end if;
  if p_rank not in ('Senior Manager', 'Executive Manager') then
    raise exception 'Pick Senior Manager or Executive Manager.';
  end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Your name is needed.'; end if;
  select o.* into v_off from offices o join office_join_codes c on c.office_id = o.id
   where c.code = upper(trim(p_code)) and o.active;
  if v_off.id is null then raise exception 'This link is not valid.'; end if;

  if v_did is not null then
    if not exists (select 1 from distributors where id = v_did and office_id = v_off.id)
       or exists (select 1 from profiles where distributor_id = v_did) then
      raise exception 'That name is not available. Type your own name instead.';
    end if;
    update distributors set status = p_rank::distributor_status,
           phone = case when coalesce(p_phone, '') <> '' then p_phone else phone end
     where id = v_did;
  else
    insert into distributors (office_id, center_id, full_name, status, phone)
    values (v_off.id, v_off.center_id, trim(p_name), p_rank::distributor_status, coalesce(p_phone, ''))
    returning id into v_did;
  end if;

  perform set_config('sti.member_join', '1', true);
  update profiles
     set role = 'member'::user_role,
         center_id = v_off.center_id,
         member_office_id = v_off.id,
         rank = p_rank,
         distributor_id = v_did,
         full_name = trim(p_name),
         phone = coalesce(p_phone, ''),
         sponsor_name = trim(coalesce(p_sponsor, '')),
         req_status = 'none'
   where id = auth.uid();
  return jsonb_build_object('ok', true, 'office', v_off.name);
end $$;

create or replace function office_members(p_office uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_off uuid := coalesce(p_office, my_office());
begin
  if not (is_admin() or coalesce(my_office() = v_off, false)) then raise exception 'Not allowed.'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', p.id, 'name', p.full_name, 'rank', p.rank, 'phone', p.phone,
      'sponsor', p.sponsor_name,
      'distributor_id', p.distributor_id, 'joined', p.created_at,
      'tracking', (select count(*) from member_people m where m.owner_id = p.id)
    ) order by p.full_name)
    from profiles p
    where p.role::text = 'member' and p.member_office_id = v_off), '[]'::jsonb);
end $$;

commit;

-- ##### PART 3 of 10: One training: the Wednesday Senior Manager Training (2026-11-one-training.sql) #####
-- =====================================================================
-- Sky Team Ife - one training only: the Wednesday Senior Manager Training
--
-- Stops the app creating the Friday Distributor Training. Nothing that
-- already exists is deleted; the app simply no longer shows or makes
-- anything but the Senior Manager Training. Safe to run twice.
-- =====================================================================
begin;

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
    if not exists (select 1 from events
                    where center_id = c.id and week_start = v_week and type = 'SM') then
      insert into events (center_id, kind, type, name, elig, week_start, event_date, event_time, code, status)
      values (c.id, 'training', 'SM', 'Senior Manager Training', 'sm', v_week, v_week + 6,
              coalesce(setting('training_time'), '2:45pm'),
              'SM-' || upper(left(replace(c.id::text, '-', ''), 6)) || '-' || to_char(v_week, 'IYYYIW'),
              case when v_week > current_date then 'scheduled'::event_status else 'closed'::event_status end);
      v_made := v_made + 1;
    end if;
  end loop;

  return v_made;
end $$;

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
    values (p_center, 'training', 'SM', 'Senior Manager Training', 'sm', p_week, p_week + 6,
            coalesce(setting('training_time'), '2:45pm'),
            'SM-' || upper(left(replace(p_center::text, '-', ''), 6)) || '-' || to_char(p_week, 'IYYYIW'),
            case when p_week > current_date then 'scheduled'::event_status else 'closed'::event_status end);
  end if;
end $$;

commit;

-- ##### PART 4 of 10: Directors check in (2026-11-directors.sql) #####
-- =====================================================================
-- Sky Team Ife - Directors check in, and members can apply to become one
--
-- * Directors check in to the Wednesday training from their own
--   dashboard. Late after 3:00pm Lagos time. Open 1:00pm to 6:00pm.
-- * A Senior or Executive Manager can apply to be a Director. Any
--   Director or the Super Admin can approve or decline. Approving makes
--   them a Director of the same zone and moves them off the office list.
--
-- Run after 2026-11-members.sql. Safe to run twice.
-- =====================================================================
begin;

alter table profiles add column if not exists upgrade_status text not null default 'none';
alter table profiles add column if not exists upgrade_at     timestamptz;

-- Same guard as before, plus the application status: nobody can approve
-- themselves by editing their own row.
create or replace function guard_profile_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or my_role() = 'super_admin'
     or coalesce(current_setting('sti.member_join', true), '') = '1' then
    return new;
  end if;
  new.id               := old.id;
  new.email            := old.email;
  new.role             := old.role;
  new.office_id        := old.office_id;
  new.center_id        := old.center_id;
  new.member_office_id := old.member_office_id;
  new.rank             := old.rank;
  new.distributor_id   := old.distributor_id;
  new.upgrade_status   := old.upgrade_status;
  new.upgrade_at       := old.upgrade_at;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- Director attendance
-- ---------------------------------------------------------------------
create table if not exists director_checkins (
  user_id    uuid not null references profiles(id) on delete cascade,
  week_start date not null,
  scanned_at timestamptz not null default now(),
  late       boolean not null default false,
  primary key (user_id, week_start)
);
alter table director_checkins enable row level security;
drop policy if exists director_checkins_read on director_checkins;
create policy director_checkins_read on director_checkins
  for select to authenticated using (user_id = auth.uid() or is_admin());

create or replace function director_check_in()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_local timestamp := now() at time zone 'Africa/Lagos';
  v_week  date;
  v_late  boolean;
begin
  if my_role()::text <> 'platform_admin' then
    return jsonb_build_object('ok', false, 'error', 'Only Directors check in here.');
  end if;
  if extract(dow from v_local) <> 3 then
    return jsonb_build_object('ok', false, 'error', 'Check-in is only open on Wednesday.');
  end if;
  if v_local::time < time '13:00' then
    return jsonb_build_object('ok', false, 'error', 'Check-in opens at 1:00pm.');
  end if;
  if v_local::time > time '18:00' then
    return jsonb_build_object('ok', false, 'error', 'The training is over for today.');
  end if;
  v_week := week_start(v_local::date);
  if exists (select 1 from director_checkins where user_id = auth.uid() and week_start = v_week) then
    return jsonb_build_object('ok', true, 'already', true);
  end if;
  v_late := v_local::time > time '15:00';
  insert into director_checkins (user_id, week_start, late) values (auth.uid(), v_week, v_late);
  return jsonb_build_object('ok', true, 'late', v_late, 'at', to_char(v_local, 'HH12:MI am'));
end $$;

-- ---------------------------------------------------------------------
-- Stepping up: apply, then a Director or the Super Admin decides
-- ---------------------------------------------------------------------
create or replace function apply_director()
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if my_role()::text <> 'member' then
    return jsonb_build_object('ok', false, 'error', 'Only members can apply.');
  end if;
  if (select upgrade_status from profiles where id = auth.uid()) = 'pending' then
    return jsonb_build_object('ok', true, 'already', true);
  end if;
  perform set_config('sti.member_join', '1', true);
  update profiles set upgrade_status = 'pending', upgrade_at = now() where id = auth.uid();
  return jsonb_build_object('ok', true);
end $$;

create or replace function review_director_application(p_user uuid, p_approve boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_p profiles%rowtype;
begin
  if not is_admin() then
    return jsonb_build_object('ok', false, 'error', 'Only a Director or the Super Admin can decide this.');
  end if;
  select * into v_p from profiles where id = p_user;
  if v_p.id is null or v_p.role::text <> 'member' or v_p.upgrade_status <> 'pending' then
    return jsonb_build_object('ok', false, 'error', 'There is no waiting application for this person.');
  end if;
  perform set_config('sti.member_join', '1', true);
  if p_approve then
    if v_p.distributor_id is not null then
      update distributors set status = 'Director' where id = v_p.distributor_id;
    end if;
    update profiles
       set role = 'platform_admin'::user_role, member_office_id = null, rank = null,
           distributor_id = null, upgrade_status = 'approved'
     where id = p_user;
  else
    update profiles set upgrade_status = 'declined' where id = p_user;
  end if;
  return jsonb_build_object('ok', true, 'approved', p_approve);
end $$;

commit;

-- ##### PART 5 of 10: Directors see members in their zone (2026-11-zone-members.sql) #####
-- =====================================================================
-- Sky Team Ife - Directors see the members in their zone
--
-- Gives a Director (or the Super Admin) the list of Senior and Executive
-- Managers in their zone, with HOW MANY people each one is following up.
-- Never the names or phone numbers of those people.
--
-- Run in the Supabase SQL editor. Safe to run twice.
-- =====================================================================
begin;

create or replace function zone_members_summary(p_center uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Not allowed.'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', p.id, 'name', p.full_name, 'rank', p.rank,
      'office_id', p.member_office_id, 'center_id', p.center_id,
      'distributor_id', p.distributor_id, 'joined', p.created_at,
      'tracking', (select count(*) from member_people m where m.owner_id = p.id)
    ) order by p.full_name)
    from profiles p
    where p.role::text = 'member'
      and (p_center is null or p.center_id = p_center)
      and (my_role()::text = 'super_admin' or my_center() is null or p.center_id = my_center())
  ), '[]'::jsonb);
end $$;

commit;

-- ##### PART 6 of 10: Check-in closing time (6:00pm, or later on an extended day) (2026-11-extend-today.sql) #####
-- =====================================================================
-- Sky Team Ife - keep check-in open until 8:00pm, for TODAY ONLY
--
-- Wednesday 28 October 2026. Check-in normally closes at 6:00pm. This
-- lets both Directors and Senior/Executive Managers check in until
-- 8:00pm today, and tomorrow everything goes back to 6:00pm by itself:
-- the extension only applies on the date saved below.
--
-- To use it on another day later, change the date in the first insert.
-- Run in the Supabase SQL editor. Safe to run twice.
-- =====================================================================
begin;

insert into app_settings (key, value) values
  ('checkin_extra_date',  '2026-10-28'),
  ('checkin_extra_until', '20:00')
on conflict (key) do nothing;

-- The closing time for check-in today: 6:00pm unless today is the extended date.
create or replace function checkin_end()
returns time language sql stable as $$
  select case
    when coalesce(setting('checkin_extra_date'), '') = to_char(now() at time zone 'Africa/Lagos', 'YYYY-MM-DD')
      then coalesce(nullif(setting('checkin_extra_until'), '')::time, time '18:00')
    else time '18:00'
  end;
$$;

create or replace function member_check_in(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me    profiles%rowtype;
  v_local timestamp := now() at time zone 'Africa/Lagos';
  v_week  date;
  v_ev    events%rowtype;
  v_late  boolean;
begin
  if coalesce(setting('feature_members'), 'false') <> 'true' then
    return jsonb_build_object('ok', false, 'error', 'Check-in is not switched on yet.');
  end if;
  select * into v_me from profiles where id = auth.uid();
  if v_me.id is null or v_me.role::text <> 'member' or v_me.distributor_id is null then
    return jsonb_build_object('ok', false, 'error', 'Only members can check in.');
  end if;
  if extract(dow from v_local) <> 3 then
    return jsonb_build_object('ok', false, 'error', 'Check-in is only open on Wednesday.');
  end if;
  if v_local::time < time '13:00' then
    return jsonb_build_object('ok', false, 'error', 'Check-in opens at 1:00pm.');
  end if;
  if v_local::time > checkin_end() then
    return jsonb_build_object('ok', false, 'error', 'The training is over for today.');
  end if;

  v_week := week_start(v_local::date);
  perform ensure_week_events_for(v_me.center_id, v_week);
  select * into v_ev from events
   where center_id = v_me.center_id and week_start = v_week and type = 'SM' limit 1;
  if v_ev.id is null then
    return jsonb_build_object('ok', false, 'error', 'No training found for your zone today.');
  end if;

  if exists (select 1 from scans where event_id = v_ev.id and distributor_id = v_me.distributor_id and status = 'accepted') then
    return jsonb_build_object('ok', true, 'already', true);
  end if;

  if (select count(*) from scans where event_id = v_ev.id and distributor_id = v_me.distributor_id
         and status = 'rejected' and device_id = 'member') >= 8 then
    return jsonb_build_object('ok', false, 'error', 'Too many wrong tries. Ask your Director to check you in.');
  end if;

  if not exists (select 1 from event_codes where event_id = v_ev.id and upper(code) = upper(trim(p_code))) then
    insert into scans (event_id, distributor_id, office_id, device_id, status, reason)
    values (v_ev.id, v_me.distributor_id, v_me.member_office_id, 'member', 'rejected', 'wrong code');
    return jsonb_build_object('ok', false, 'error', 'That code is not right. Ask your Director.');
  end if;

  v_late := v_local::time > time '14:45';
  insert into scans (event_id, distributor_id, office_id, device_id, status, late)
  values (v_ev.id, v_me.distributor_id, v_me.member_office_id, 'member', 'accepted', v_late);
  return jsonb_build_object('ok', true, 'late', v_late, 'at', to_char(v_local, 'HH12:MI am'));
end $$;

create or replace function director_check_in()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_local timestamp := now() at time zone 'Africa/Lagos';
  v_week  date;
  v_late  boolean;
begin
  if my_role()::text <> 'platform_admin' then
    return jsonb_build_object('ok', false, 'error', 'Only Directors check in here.');
  end if;
  if extract(dow from v_local) <> 3 then
    return jsonb_build_object('ok', false, 'error', 'Check-in is only open on Wednesday.');
  end if;
  if v_local::time < time '13:00' then
    return jsonb_build_object('ok', false, 'error', 'Check-in opens at 1:00pm.');
  end if;
  if v_local::time > checkin_end() then
    return jsonb_build_object('ok', false, 'error', 'The training is over for today.');
  end if;
  v_week := week_start(v_local::date);
  if exists (select 1 from director_checkins where user_id = auth.uid() and week_start = v_week) then
    return jsonb_build_object('ok', true, 'already', true);
  end if;
  v_late := v_local::time > time '15:00';
  insert into director_checkins (user_id, week_start, late) values (auth.uid(), v_week, v_late);
  return jsonb_build_object('ok', true, 'late', v_late, 'at', to_char(v_local, 'HH12:MI am'));
end $$;

commit;

-- ##### PART 7 of 10: No approvals; senior managers work inside their office (2026-11-office-managers.sql) #####
-- =====================================================================
-- Sky Team Ife - no approvals, and senior managers share their office
--
-- 1. Nobody waits for the Super Admin any more.
--      * Sign up as an office: the office is created at once.
--      * Sign up as a Director: you are a Director at once.
--      * A member who applies to be a Director is one at once.
--      * Anyone already waiting is let in when this file runs.
--
-- 2. Each office has its own link (#/m/CODE). A Senior Manager who joins
--    through it works inside that office with the same view and the same
--    powers as the office login: weekly reports, evaluation, distributors,
--    attendance. Only two things stay with the office login itself:
--    changing the office's own details and its link, and removing people.
--
--      * Rank on the link: Senior Manager or Executive Manager join the
--        office. Director or Emerald Director join as a Director. Anything
--        lower is refused.
--      * Only the office login can remove a senior manager.
--      * A senior manager can leave whenever they like (leave_office).
--
-- Run in the Supabase SQL editor, after RUN-THIS-ONCE.sql. Safe to run twice.
-- =====================================================================
begin;

-- ---------------------------------------------------------------------
-- Who is acting for an office
--   my_office()        the office you work in: your own, or the one you
--                      joined as a senior manager. Every office row-level
--                      rule already uses this, so it widens them all.
--   my_owned_office()  only the office login itself.
-- ---------------------------------------------------------------------
create or replace function my_office()
returns uuid language sql stable security definer set search_path = public as $$
  select coalesce(office_id, member_office_id) from profiles where id = auth.uid();
$$;

create or replace function my_owned_office()
returns uuid language sql stable security definer set search_path = public as $$
  select office_id from profiles where id = auth.uid() and role::text = 'office';
$$;

-- The office's own details and its link belong to the office login only.
drop policy if exists offices_self_update on offices;
create policy offices_self_update on offices
  for update to authenticated
  using (id = my_owned_office()) with check (id = my_owned_office());

drop policy if exists join_codes_read on office_join_codes;
create policy join_codes_read on office_join_codes
  for select to authenticated
  using (is_admin() or office_id = my_owned_office());

-- Zone events: members used to be refused. A senior manager works as the
-- office now, so they are let in on the same terms.
drop policy if exists events_write on events;
create policy events_write on events
  for all to authenticated
  using (is_admin() or center_id = my_center())
  with check (is_admin() or (center_id = my_center() and not my_office_locked()));

-- ---------------------------------------------------------------------
-- Sign-up is instant
-- ---------------------------------------------------------------------
create or replace function _approve_request(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  r        profiles%rowtype;
  v_office uuid;
begin
  select * into r from profiles where id = p_user;
  if not found then raise exception 'No such account.'; end if;
  if r.role::text <> 'pending' or r.req_status <> 'pending' then
    raise exception 'There is nothing waiting on that account.';
  end if;

  perform set_config('sti.member_join', '1', true);

  if r.req_kind = 'office' then
    if r.req_center_id is null then
      raise exception 'That request does not say which zone.';
    end if;
    insert into offices (center_id, name, manager_name, email, phone, address)
    select r.req_center_id, r.req_office_name, r.full_name, r.email, r.phone,
           coalesce(r.req_address, '')
      from centers c where c.id = r.req_center_id
    returning id into v_office;
    if v_office is null then
      raise exception 'That zone no longer exists. Pick another one.';
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

-- Only other functions in here may call it.
revoke all on function _approve_request(uuid) from public, anon, authenticated;

-- Kept so nothing that still calls it breaks; the Super Admin can still
-- push someone through by hand.
create or replace function approve_access_request(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if my_role() <> 'super_admin' then
    raise exception 'Only the Super Admin can do that.';
  end if;
  perform _approve_request(p_user);
end $$;

create or replace function submit_access_request(
  p_kind        text,
  p_full_name   text,
  p_phone       text,
  p_center_id   uuid,
  p_office_name text,
  p_address     text
) returns void
language plpgsql security definer set search_path = public as $$
declare v_role user_role;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  select role into v_role from profiles where id = auth.uid();
  if v_role is distinct from 'pending' then
    raise exception 'This account is already in.';
  end if;
  if coalesce(p_kind, '') not in ('office', 'leader') then
    raise exception 'Say whether you are joining as an office or as a leader.';
  end if;
  if coalesce(trim(p_full_name), '') = '' then raise exception 'Please give your name.'; end if;
  if coalesce(trim(p_phone), '') = '' then raise exception 'Please give a phone number.'; end if;

  if p_kind = 'office' then
    if p_center_id is null then raise exception 'Pick the zone your office reports to.'; end if;
    if coalesce(trim(p_office_name), '') = '' then raise exception 'Your office needs a name.'; end if;
    if coalesce(trim(p_address), '') = '' then raise exception 'Give the address of your office.'; end if;
    if exists (select 1 from offices
                where lower(name) = lower(trim(p_office_name)) and center_id = p_center_id) then
      raise exception 'That zone already has an office called %.', trim(p_office_name);
    end if;
  end if;

  update profiles set
    full_name       = trim(p_full_name),
    phone           = trim(p_phone),
    req_kind        = p_kind,
    req_center_id   = case when p_kind = 'office' then p_center_id end,
    req_office_name = case when p_kind = 'office' then trim(p_office_name) end,
    req_address     = case when p_kind = 'office' then trim(p_address) end,
    req_status      = 'pending',
    req_note        = '',
    req_at          = now()
  where id = auth.uid();

  perform _approve_request(auth.uid());
end $$;

-- Anyone already waiting is let in now. A request that cannot be honoured
-- (its zone was deleted, say) stays as it was and is skipped.
do $$
declare r record;
begin
  for r in select id from profiles where role::text = 'pending' and req_status = 'pending' loop
    begin
      perform _approve_request(r.id);
    exception when others then
      raise notice 'Skipped %: %', r.id, sqlerrm;
    end;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- A member who wants to lead is a Director straight away
-- ---------------------------------------------------------------------
create or replace function apply_director()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_p profiles%rowtype;
begin
  select * into v_p from profiles where id = auth.uid();
  if v_p.id is null or v_p.role::text <> 'member' then
    return jsonb_build_object('ok', false, 'error', 'Only members can do this.');
  end if;
  perform set_config('sti.member_join', '1', true);
  if v_p.distributor_id is not null then
    update distributors set status = 'Director' where id = v_p.distributor_id;
  end if;
  update profiles
     set role = 'platform_admin'::user_role, member_office_id = null, rank = null,
         distributor_id = null, upgrade_status = 'approved'
   where id = auth.uid();
  return jsonb_build_object('ok', true, 'approved', true);
end $$;

-- ---------------------------------------------------------------------
-- The office link: rank decides what you become
-- ---------------------------------------------------------------------
drop function if exists member_join(text, text, text, text, uuid, text);

create or replace function member_join(
  p_code text, p_rank text, p_name text, p_phone text,
  p_dist uuid default null, p_sponsor text default ''
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me  profiles%rowtype;
  v_off offices%rowtype;
  v_did uuid := p_dist;
  v_dir boolean := p_rank in ('Director', 'Emerald Director');
begin
  select * into v_me from profiles where id = auth.uid();
  if v_me.id is null then raise exception 'Sign in first.'; end if;
  if v_me.role::text <> 'pending' then raise exception 'This account is already in.'; end if;
  if p_rank not in ('Senior Manager', 'Executive Manager', 'Director', 'Emerald Director') then
    raise exception 'This link is for Senior Managers and above. If you are below Senior Manager, ask your office to add you to its distributor list.';
  end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Your name is needed.'; end if;
  select o.* into v_off from offices o join office_join_codes c on c.office_id = o.id
   where c.code = upper(trim(p_code)) and o.active;
  if v_off.id is null then raise exception 'This link is not valid.'; end if;

  if v_did is not null then
    if not exists (select 1 from distributors where id = v_did and office_id = v_off.id)
       or exists (select 1 from profiles where distributor_id = v_did) then
      raise exception 'That name is not available. Type your own name instead.';
    end if;
    update distributors set status = p_rank::distributor_status,
           phone = case when coalesce(p_phone, '') <> '' then p_phone else phone end
     where id = v_did;
  else
    insert into distributors (office_id, center_id, full_name, status, phone)
    values (v_off.id, v_off.center_id, trim(p_name), p_rank::distributor_status, coalesce(p_phone, ''))
    returning id into v_did;
  end if;

  perform set_config('sti.member_join', '1', true);
  if v_dir then
    update profiles
       set role = 'platform_admin'::user_role,
           center_id = v_off.center_id, member_office_id = null, rank = null,
           distributor_id = null,
           full_name = trim(p_name), phone = coalesce(p_phone, ''),
           sponsor_name = trim(coalesce(p_sponsor, '')), req_status = 'none'
     where id = auth.uid();
  else
    update profiles
       set role = 'member'::user_role,
           center_id = v_off.center_id, member_office_id = v_off.id,
           rank = p_rank, distributor_id = v_did,
           full_name = trim(p_name), phone = coalesce(p_phone, ''),
           sponsor_name = trim(coalesce(p_sponsor, '')), req_status = 'none'
     where id = auth.uid();
  end if;
  return jsonb_build_object('ok', true, 'office', v_off.name, 'director', v_dir);
end $$;

-- ---------------------------------------------------------------------
-- Who may remove, who may leave
-- ---------------------------------------------------------------------
-- Only the office login (or an admin) removes a senior manager.
create or replace function remove_member(p_member uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_off uuid;
begin
  select member_office_id into v_off from profiles where id = p_member and role::text = 'member';
  if v_off is null then raise exception 'Not a member.'; end if;
  if not (is_admin() or coalesce(my_owned_office() = v_off, false)) then
    raise exception 'Only the office login can remove a senior manager.';
  end if;
  perform set_config('sti.member_join', '1', true);
  update profiles
     set role = 'pending'::user_role, center_id = null, member_office_id = null,
         rank = null, distributor_id = null, req_status = 'none'
   where id = p_member;
end $$;

-- A senior manager can leave whenever they like.
create or replace function leave_office()
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if my_role()::text <> 'member' then
    return jsonb_build_object('ok', false, 'error', 'You are not a senior manager of an office.');
  end if;
  perform set_config('sti.member_join', '1', true);
  update profiles
     set role = 'pending'::user_role, center_id = null, member_office_id = null,
         rank = null, distributor_id = null, req_status = 'none'
   where id = auth.uid();
  return jsonb_build_object('ok', true);
end $$;

create or replace function regenerate_join_code(p_office uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v text;
begin
  if not (is_admin() or coalesce(my_owned_office() = p_office, false)) then raise exception 'Not allowed.'; end if;
  loop
    v := gen_code(6);
    exit when not exists (select 1 from office_join_codes where code = v);
  end loop;
  insert into office_join_codes (office_id, code) values (p_office, v)
  on conflict (office_id) do update set code = excluded.code, created_at = now();
  return v;
end $$;

-- What each member follows up stays between them and the office login.
create or replace function office_people_names(p_office uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_off uuid := coalesce(p_office, my_owned_office());
begin
  if not (is_admin() or coalesce(my_owned_office() = v_off, false)) then raise exception 'Not allowed.'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('member', p.full_name, 'name', m.name, 'stage', m.stage)
                     order by p.full_name, m.created_at)
    from member_people m join profiles p on p.id = m.owner_id
    where p.role::text = 'member' and p.member_office_id = v_off), '[]'::jsonb);
end $$;

-- The link works, and the feature is on.
insert into app_settings (key, value) values ('feature_members', 'true')
on conflict (key) do update set value = 'true';

commit;

-- ##### PART 8 of 10: Senior Manager signs up, picks an office; the office accepts. Security fix (2026-11-manager-signup.sql) #####
-- =====================================================================
-- Sky Team Ife - a Senior Manager can sign up and pick an office
--
-- Run AFTER 2026-11-office-managers.sql. Safe to run twice.
--
-- Until now a Senior Manager could only get in through an office's own
-- link. Now they can also sign up on the front page, pick the office they
-- belong to, and ask. The OFFICE decides, not the Super Admin: the office
-- login sees the request on its Senior managers page and accepts or
-- declines it. Accepting puts them inside that office, exactly as the
-- link does. (The link still lets people in with no waiting.)
-- =====================================================================
begin;

alter table profiles add column if not exists req_office_id uuid references offices(id) on delete set null;
alter table profiles add column if not exists req_rank      text;
create index if not exists profiles_req_office_idx on profiles(req_office_id) where req_status = 'pending';

-- ---------------------------------------------------------------------
-- The offices a new account can choose from: names only, nothing else.
-- A not-yet-approved account cannot read the offices table, on purpose.
-- ---------------------------------------------------------------------
create or replace function public_offices()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name, 'center_id', o.center_id)
                            order by lower(o.name)), '[]'::jsonb)
    from offices o where o.active;
$$;
revoke all on function public_offices() from public, anon;
grant execute on function public_offices() to authenticated;

-- ---------------------------------------------------------------------
-- Ask to join an office as a Senior Manager (or above, up to Executive)
-- ---------------------------------------------------------------------
create or replace function request_manager(
  p_name text, p_phone text, p_rank text, p_office uuid, p_sponsor text default ''
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_me profiles%rowtype; v_off offices%rowtype;
begin
  select * into v_me from profiles where id = auth.uid();
  if v_me.id is null then raise exception 'Sign in first.'; end if;
  if v_me.role::text <> 'pending' then raise exception 'This account is already in.'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Your name is needed.'; end if;
  if coalesce(trim(p_phone), '') = '' then raise exception 'Please give a phone number.'; end if;
  if p_rank not in ('Senior Manager', 'Executive Manager') then
    raise exception 'Pick Senior Manager or Executive Manager. Anyone below that is added by their office as a distributor.';
  end if;
  select * into v_off from offices where id = p_office and active;
  if v_off.id is null then raise exception 'Pick the office you belong to.'; end if;

  update profiles set
    full_name     = trim(p_name),
    phone         = trim(p_phone),
    sponsor_name  = trim(coalesce(p_sponsor, '')),
    req_kind      = 'manager',
    req_rank      = p_rank,
    req_office_id = v_off.id,
    req_center_id = v_off.center_id,
    req_status    = 'pending',
    req_note      = '',
    req_at        = now()
  where id = auth.uid();
  return jsonb_build_object('ok', true, 'office', v_off.name);
end $$;

-- ---------------------------------------------------------------------
-- The office's inbox: who is asking to join it
-- ---------------------------------------------------------------------
create or replace function office_requests(p_office uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_off uuid := coalesce(p_office, my_owned_office());
begin
  if v_off is null or not (is_admin() or coalesce(my_owned_office() = v_off, false)) then
    raise exception 'Not allowed.';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', p.id, 'name', p.full_name, 'phone', p.phone, 'rank', p.req_rank,
      'sponsor', p.sponsor_name, 'email', p.email, 'at', p.req_at
    ) order by p.req_at)
    from profiles p
    where p.role::text = 'pending' and p.req_kind = 'manager'
      and p.req_status = 'pending' and p.req_office_id = v_off), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------
-- Accept or decline. Only the office login (or an admin).
-- ---------------------------------------------------------------------
create or replace function decide_manager(p_user uuid, p_approve boolean, p_reason text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r     profiles%rowtype;
  v_off offices%rowtype;
  v_did uuid;
begin
  select * into r from profiles where id = p_user;
  if r.id is null or r.role::text <> 'pending' or r.req_kind is distinct from 'manager'
     or r.req_status <> 'pending' or r.req_office_id is null then
    return jsonb_build_object('ok', false, 'error', 'There is no waiting request from that person.');
  end if;
  select * into v_off from offices where id = r.req_office_id;
  if v_off.id is null then
    return jsonb_build_object('ok', false, 'error', 'That office no longer exists.');
  end if;
  if not (is_admin() or coalesce(my_owned_office() = v_off.id, false)) then
    return jsonb_build_object('ok', false, 'error', 'Only the office login can decide this.');
  end if;

  perform set_config('sti.member_join', '1', true);

  if not p_approve then
    update profiles
       set req_status = 'declined',
           req_note   = coalesce(nullif(trim(p_reason), ''), 'The office turned this request down.')
     where id = p_user;
    return jsonb_build_object('ok', true, 'approved', false);
  end if;

  insert into distributors (office_id, center_id, full_name, status, phone)
  values (v_off.id, v_off.center_id, r.full_name, r.req_rank::distributor_status, coalesce(r.phone, ''))
  returning id into v_did;

  update profiles
     set role = 'member'::user_role,
         center_id = v_off.center_id, member_office_id = v_off.id,
         rank = r.req_rank, distributor_id = v_did,
         req_status = 'none', req_note = '', req_kind = null,
         req_office_id = null, req_rank = null
   where id = p_user;
  return jsonb_build_object('ok', true, 'approved', true);
end $$;

-- ---------------------------------------------------------------------
-- SECURITY FIX. The "who may do this" checks in the earlier member
-- functions were written  not (is_admin() or my_office() = x)  . For an
-- account with no office that comparison is NULL, not false, and an IF on
-- NULL does not stop anything: a senior manager (or any signed-in account
-- without an office) could remove members or reissue an office's link.
-- The checks are now null-safe. Same functions, same behaviour for
-- everyone who was allowed.
-- ---------------------------------------------------------------------
create or replace function remove_member(p_member uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_off uuid;
begin
  select member_office_id into v_off from profiles where id = p_member and role::text = 'member';
  if v_off is null then raise exception 'Not a member.'; end if;
  if not (is_admin() or coalesce(my_owned_office() = v_off, false)) then
    raise exception 'Only the office login can remove a senior manager.';
  end if;
  perform set_config('sti.member_join', '1', true);
  update profiles
     set role = 'pending'::user_role, center_id = null, member_office_id = null,
         rank = null, distributor_id = null, req_status = 'none'
   where id = p_member;
end $$;

create or replace function regenerate_join_code(p_office uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v text;
begin
  if not (is_admin() or coalesce(my_owned_office() = p_office, false)) then raise exception 'Not allowed.'; end if;
  loop
    v := gen_code(6);
    exit when not exists (select 1 from office_join_codes where code = v);
  end loop;
  insert into office_join_codes (office_id, code) values (p_office, v)
  on conflict (office_id) do update set code = excluded.code, created_at = now();
  return v;
end $$;

create or replace function office_people_names(p_office uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_off uuid := coalesce(p_office, my_owned_office());
begin
  if not (is_admin() or coalesce(my_owned_office() = v_off, false)) then raise exception 'Not allowed.'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('member', p.full_name, 'name', m.name, 'stage', m.stage)
                     order by p.full_name, m.created_at)
    from member_people m join profiles p on p.id = m.owner_id
    where p.role::text = 'member' and p.member_office_id = v_off), '[]'::jsonb);
end $$;

create or replace function office_members(p_office uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_off uuid := coalesce(p_office, my_office());
begin
  if not (is_admin() or coalesce(my_office() = v_off, false)) then raise exception 'Not allowed.'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', p.id, 'name', p.full_name, 'rank', p.rank, 'phone', p.phone,
      'sponsor', p.sponsor_name,
      'distributor_id', p.distributor_id, 'joined', p.created_at,
      'tracking', (select count(*) from member_people m where m.owner_id = p.id)
    ) order by p.full_name)
    from profiles p
    where p.role::text = 'member' and p.member_office_id = v_off), '[]'::jsonb);
end $$;

commit;

-- ##### PART 9 of 10: The office login checks in too (2026-11-office-checkin.sql) #####
-- =====================================================================
-- Sky Team Ife - everybody checks in to the Senior Manager Training
--
-- Directors and Senior Managers already could. The office login can now
-- too: it types the zone's code, the one every Director can see on the
-- Wednesday training page. Same window as everyone else: Wednesday,
-- from 1:00pm until check-in closes (6:00pm, or later on an extended
-- day), and after 3:00pm counts as late for an office, as for a Director.
--
-- The office's check-in is stored with the Directors' (director_checkins),
-- one row per person per week, so the Wednesday training page lists
-- everybody who checked in together.
-- Safe to run twice.
-- =====================================================================
begin;

-- Wrong codes are counted so the code cannot be guessed: eight tries.
create table if not exists checkin_tries (
  user_id    uuid not null references profiles(id) on delete cascade,
  week_start date not null,
  tries      integer not null default 0,
  primary key (user_id, week_start)
);
alter table checkin_tries enable row level security;   -- no policy: only the function below touches it

create or replace function office_check_in(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me    profiles%rowtype;
  v_local timestamp := now() at time zone 'Africa/Lagos';
  v_week  date;
  v_ev    events%rowtype;
  v_late  boolean;
  v_tries integer;
begin
  select * into v_me from profiles where id = auth.uid();
  if v_me.id is null or v_me.role::text <> 'office' or v_me.center_id is null then
    return jsonb_build_object('ok', false, 'error', 'Only an office can check in here.');
  end if;
  if extract(dow from v_local) <> 3 then
    return jsonb_build_object('ok', false, 'error', 'Check-in is only open on Wednesday.');
  end if;
  if v_local::time < time '13:00' then
    return jsonb_build_object('ok', false, 'error', 'Check-in opens at 1:00pm.');
  end if;
  if v_local::time > checkin_end() then
    return jsonb_build_object('ok', false, 'error', 'The training is over for today.');
  end if;

  v_week := week_start(v_local::date);
  if exists (select 1 from director_checkins where user_id = auth.uid() and week_start = v_week) then
    return jsonb_build_object('ok', true, 'already', true);
  end if;

  select coalesce(tries, 0) into v_tries from checkin_tries where user_id = auth.uid() and week_start = v_week;
  if coalesce(v_tries, 0) >= 8 then
    return jsonb_build_object('ok', false, 'error', 'Too many wrong tries. Ask your Director to check you in.');
  end if;

  perform ensure_week_events_for(v_me.center_id, v_week);
  select * into v_ev from events
   where center_id = v_me.center_id and week_start = v_week and type = 'SM' limit 1;
  if v_ev.id is null then
    return jsonb_build_object('ok', false, 'error', 'No training found for your zone today.');
  end if;

  if not exists (select 1 from event_codes where event_id = v_ev.id and upper(code) = upper(trim(p_code))) then
    insert into checkin_tries (user_id, week_start, tries) values (auth.uid(), v_week, 1)
    on conflict (user_id, week_start) do update set tries = checkin_tries.tries + 1;
    return jsonb_build_object('ok', false, 'error', 'That code is not right. Ask your Director.');
  end if;

  v_late := v_local::time > time '15:00';
  insert into director_checkins (user_id, week_start, late) values (auth.uid(), v_week, v_late);
  return jsonb_build_object('ok', true, 'late', v_late, 'at', to_char(v_local, 'HH12:MI am'));
end $$;

commit;

-- ##### PART 10 of 10: reminders #####
-- =====================================================================
-- Wednesday, all before the 2:45pm meeting (Lagos is UTC+1):
--   1:00pm  check-in opens: Directors get the code, Senior Managers a nudge
--   2:00pm  same again
--   2:30pm  last call
-- Monday to Thursday, 10:00am: offices (and their Senior Managers) that
--   have not filed last week's or this week's report are told.
--
-- It needs the pg_cron and pg_net extensions and the CRON_SECRET you saved
-- in Vercel. If the secret below still says PUT-YOUR-CRON-SECRET-HERE, or
-- the extensions cannot be switched on, this part prints a notice and does
-- nothing, and the rest of the file is unaffected. Safe to run twice:
-- a job with the same name is replaced.
-- =====================================================================
do $reminders$
declare
  v_secret constant text := 'PUT-YOUR-CRON-SECRET-HERE';
  v_code   constant text := 'https://sky-team-ife.vercel.app/api/code-push';
  v_report constant text := 'https://sky-team-ife.vercel.app/api/report-push';
  v_job    record;
begin
  if v_secret = 'PUT-YOUR-CRON-SECRET-HERE' then
    raise notice 'Reminders NOT scheduled: put your CRON_SECRET into PART 10 and run the file again.';
    return;
  end if;

  begin create extension if not exists pg_cron; exception when others then
    raise notice 'Could not switch on pg_cron (%). Database -> Extensions -> pg_cron, then run again.', sqlerrm; end;
  begin create extension if not exists pg_net; exception when others then
    raise notice 'Could not switch on pg_net (%). Database -> Extensions -> pg_net, then run again.', sqlerrm; end;
  if to_regnamespace('cron') is null or to_regnamespace('net') is null then
    raise notice 'Reminders NOT scheduled: pg_cron and pg_net are not both on yet.';
    return;
  end if;

  -- The old 3:05pm job came after the meeting had started.
  for v_job in select jobid from cron.job where jobname = 'sti-wed-code-305pm' loop
    perform cron.unschedule(v_job.jobid);
  end loop;

  perform cron.schedule('sti-wed-code-1pm',   '0 12 * * 3', format($c$select net.http_post(url := %L, headers := jsonb_build_object('content-type','application/json','x-cron-secret',%L), body := '{}'::jsonb)$c$, v_code, v_secret));
  perform cron.schedule('sti-wed-code-2pm',   '0 13 * * 3', format($c$select net.http_post(url := %L, headers := jsonb_build_object('content-type','application/json','x-cron-secret',%L), body := '{}'::jsonb)$c$, v_code, v_secret));
  perform cron.schedule('sti-wed-code-230pm', '30 13 * * 3', format($c$select net.http_post(url := %L, headers := jsonb_build_object('content-type','application/json','x-cron-secret',%L), body := '{}'::jsonb)$c$, v_code, v_secret));
  perform cron.schedule('sti-report-reminder', '0 9 * * 1-4', format($c$select net.http_post(url := %L, headers := jsonb_build_object('content-type','application/json','x-cron-secret',%L), body := '{}'::jsonb)$c$, v_report, v_secret));
  raise notice 'Reminders scheduled: 3 on Wednesdays, 1 each Monday to Thursday.';
exception when others then
  raise notice 'Reminders NOT scheduled: %', sqlerrm;
end $reminders$;

-- ##### SWITCH ON #####
insert into app_settings (key, value) values ('feature_members', 'true')
on conflict (key) do update set value = 'true';

-- ##### CHECK: every row below should say yes #####
select name, 'yes' as present from (
  select routine_name as name from information_schema.routines
   where routine_schema = 'public'
     and routine_name in ('member_join', 'member_check_in', 'director_check_in', 'office_check_in',
                          'request_manager', 'decide_manager', 'office_requests', 'public_offices',
                          'leave_office', 'remove_member', 'checkin_end')
) t order by 1;
