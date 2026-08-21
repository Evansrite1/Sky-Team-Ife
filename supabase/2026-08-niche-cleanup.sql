-- =====================================================================
-- Sky Team Ife — cleaning up the niches
--
-- Two problems, fixed in order:
--
--   1. SPLITTING.  Someone typed a whole list into one box — "AI video,
--      GHL landing page, A2P" — and it went in as one run-on product
--      instead of three. Any catalogue entry that still holds a comma
--      is split into its parts, and every report that carried the
--      run-on entry is rewritten to carry the parts instead.
--
--   2. CASING.  "AI video" and "ai video" are the same product typed two
--      different ways, and until now they were counted as two. Every
--      catalogue entry is grouped case-insensitively; the spelling used
--      most often across all reports is kept as the one true spelling,
--      and every report is rewritten onto it.
--
-- The app itself no longer creates either problem going forward — the
-- niche box splits on commas as you type, and matches what already
-- exists in the catalogue regardless of case. This script is only for
-- what is already sitting in the database from before that.
--
-- Run the whole thing in the Supabase SQL editor. It is wrapped in one
-- transaction and safe to run twice — the second run finds nothing left
-- to split or merge and changes nothing.
--
-- Look first if you want to see what this is about to touch:
--   select name from niches where name like '%,%';
--   select lower(trim(name)) as key, count(*) as spellings,
--          array_agg(name) as seen
--     from niches group by 1 having count(*) > 1;
-- =====================================================================
begin;

-- ---------------------------------------------------------------------
-- 1. SPLIT ANY RUN-ON ENTRY
-- ---------------------------------------------------------------------
do $$
declare
  v_joined text;
  v_parts  text[];
begin
  for v_joined in select name from niches where name like '%,%' loop
    v_parts := array(
      select trim(p) from unnest(string_to_array(v_joined, ',')) as p
       where trim(p) <> ''
    );
    if array_length(v_parts, 1) is null then
      -- Nothing usable in it at all — just drop the empty entry.
      delete from niches where name = v_joined;
      continue;
    end if;

    raise notice 'Splitting "%" into %', v_joined, v_parts;

    update reports
       set niches = (
         select array_agg(distinct n order by n)
           from unnest(array_remove(niches, v_joined) || v_parts) as n)
     where v_joined = any(niches);

    update reports
       set new_niches = (
         select array_agg(distinct n order by n)
           from unnest(array_remove(new_niches, v_joined) || v_parts) as n)
     where v_joined = any(new_niches);

    delete from niches where name = v_joined;

    insert into niches (name)
    select unnest(v_parts)
    on conflict (name) do nothing;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 2. MERGE CASE VARIANTS
-- ---------------------------------------------------------------------
do $$
declare
  v_key      text;
  v_canon    text;
  v_variant  text;
begin
  for v_key in
    select lower(trim(name)) from niches
     group by 1 having count(*) > 1
  loop
    -- The spelling used on the most reports wins; a tie goes to
    -- whichever was typed first, so the older habit sticks.
    select n.name into v_canon
      from niches n
      left join lateral (
        select count(*) as uses from reports r
         where n.name = any(r.niches) or n.name = any(r.new_niches)
      ) u on true
     where lower(trim(n.name)) = v_key
     order by coalesce(u.uses, 0) desc, n.created_at asc
     limit 1;

    raise notice 'Merging "%" onto "%"', v_key, v_canon;

    for v_variant in
      select name from niches where lower(trim(name)) = v_key and name <> v_canon
    loop
      update reports
         set niches = (
           select array_agg(distinct n order by n)
             from unnest(array_remove(niches, v_variant) || array[v_canon]) as n)
       where v_variant = any(niches);

      update reports
         set new_niches = (
           select array_agg(distinct n order by n)
             from unnest(array_remove(new_niches, v_variant) || array[v_canon]) as n)
       where v_variant = any(new_niches);

      delete from niches where name = v_variant;
    end loop;
  end loop;
end $$;

commit;

-- ---------------------------------------------------------------------
-- AFTERWARDS — both of these should come back empty
-- ---------------------------------------------------------------------
--   select name from niches where name like '%,%';
--   select lower(trim(name)) from niches group by 1 having count(*) > 1;
