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
  if not (is_admin() or my_office() = v_off) then raise exception 'Not allowed.'; end if;
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

-- Check (should return one row, member_join):
select routine_name from information_schema.routines
where routine_schema = 'public' and routine_name = 'member_join';
