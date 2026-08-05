-- =====================================================================
-- Sky Team Ife — wipe the data, keep the Super Admin
-- ---------------------------------------------------------------------
-- READ THIS BEFORE YOU RUN IT.
--
-- This deletes every center, office, distributor, report, event, scan,
-- subscription and payment, and every account except the bootstrap
-- Super Admin. It cannot be undone. There is no soft delete and no
-- backup taken for you.
--
-- The tables, the policies and the functions are all left alone — this
-- empties the data, it does not touch the schema. You will not need to
-- re-run schema.sql afterwards.
--
-- To take a backup first: Supabase dashboard -> Database -> Backups,
-- or run pg_dump against the connection string in Project Settings.
--
-- Run it in the SQL editor as one block.
-- =====================================================================

begin;

-- Everything that hangs off an office or a center. Order matters only
-- for readability; the foreign keys cascade anyway.
delete from scans;
delete from payments;
delete from subscriptions;
delete from reports;
delete from events;
delete from distributors;
delete from offices;
delete from centers;
delete from niches;

-- Detach the Super Admin from anything that is about to disappear, and
-- clear any access request left on the row.
update profiles
   set office_id       = null,
       center_id       = null,
       req_status      = 'none',
       req_kind        = null,
       req_center_id   = null,
       req_office_name = null,
       req_address     = null,
       req_note        = '',
       req_at          = null
 where role = 'super_admin';

-- Every other account goes. Deleting from auth.users cascades into
-- profiles, so the two never drift apart.
delete from auth.users
 where lower(coalesce(email, '')) <> lower(coalesce((select value from app_settings where key = 'bootstrap_admin'), ''));

commit;

-- =====================================================================
-- What is left
-- =====================================================================
select 'profiles'      as table_name, count(*) from profiles
union all select 'auth users',    count(*) from auth.users
union all select 'centers',       count(*) from centers
union all select 'offices',       count(*) from offices
union all select 'distributors',  count(*) from distributors
union all select 'reports',       count(*) from reports
union all select 'events',        count(*) from events
union all select 'scans',         count(*) from scans
union all select 'subscriptions', count(*) from subscriptions
union all select 'payments',      count(*) from payments
union all select 'niches',        count(*) from niches;

-- profiles and auth users should both read 1. Everything else 0.
-- If profiles reads 1 but auth users reads 0, the bootstrap_admin
-- setting does not match the address you actually signed up with.
