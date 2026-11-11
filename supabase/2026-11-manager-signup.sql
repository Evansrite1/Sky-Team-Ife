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

-- Check (should return 4 rows):
select routine_name from information_schema.routines
where routine_schema = 'public'
  and routine_name in ('public_offices', 'request_manager', 'office_requests', 'decide_manager')
order by 1;
