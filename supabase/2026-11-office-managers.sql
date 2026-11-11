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

-- Check: nobody should be left waiting (this should say 0).
select count(*) as still_waiting from profiles where role::text = 'pending' and req_status = 'pending';
