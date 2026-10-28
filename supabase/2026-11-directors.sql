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

-- Check (should return 3 rows):
select routine_name from information_schema.routines
where routine_schema = 'public'
  and routine_name in ('director_check_in', 'apply_director', 'review_director_application');
