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
  if not (is_admin() or my_office() = p_office) then raise exception 'Not allowed.'; end if;
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
  if not (is_admin() or my_office() = v_off) then raise exception 'Not allowed.'; end if;
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
  if not (is_admin() or my_office() = v_off) then raise exception 'Not allowed.'; end if;
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
  if not (is_admin() or my_office() = v_off) then raise exception 'Not allowed.'; end if;
  perform set_config('sti.member_join', '1', true);
  update profiles
     set role = 'pending'::user_role, center_id = null, member_office_id = null,
         rank = null, distributor_id = null, req_status = 'none'
   where id = p_member;
end $$;

commit;

-- Check (should list the new tables and functions):
select 'table' as kind, table_name as name from information_schema.tables
 where table_schema = 'public'
   and table_name in ('office_join_codes', 'event_codes', 'member_people')
union all
select 'function', routine_name from information_schema.routines
 where routine_schema = 'public'
   and routine_name in ('join_office_info', 'member_join', 'member_check_in', 'office_members', 'remove_member')
order by 1, 2;
