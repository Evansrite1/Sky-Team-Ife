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

-- Check (should return 1 row):
select routine_name from information_schema.routines
where routine_schema = 'public' and routine_name = 'zone_members_summary';
