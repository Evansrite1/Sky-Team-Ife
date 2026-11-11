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
