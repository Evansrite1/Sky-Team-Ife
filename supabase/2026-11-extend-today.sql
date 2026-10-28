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
on conflict (key) do update set value = excluded.value;

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

-- Check: should show 2026-10-28 and 20:00, then 20:00:00 for today.
select key, value from app_settings where key like 'checkin_extra%' order by key;
select checkin_end() as closes_at_now;
