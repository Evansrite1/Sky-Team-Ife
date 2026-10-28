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
              case when v_week > current_date then 'scheduled' else 'closed' end);
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
            case when p_week > current_date then 'scheduled' else 'closed' end);
  end if;
end $$;

commit;

-- Check (should return 2 rows):
select routine_name from information_schema.routines
where routine_schema = 'public' and routine_name in ('ensure_week_events', 'ensure_week_events_for');
