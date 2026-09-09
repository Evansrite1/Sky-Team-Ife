-- =====================================================================
-- Sky Team Ife — ten feature requests, and a way to turn each on or off
--
-- What this adds:
--   1. Feature flags in app_settings — every new feature below has one,
--      default 'false'. Nothing changes for anyone until the Super
--      Admin flips it on from Admin -> Features. Two of the ten
--      (WhatsApp, SMS) get a flag and nothing else — they need a
--      provider decision and real credentials this file cannot supply,
--      so their switch stays there labelled "coming soon" until that
--      happens.
--   2. activity_log — one row per admin action (an office moved, a zone
--      edited, an office deleted), so a mistake like a report landing
--      on the wrong week takes five seconds to trace instead of a
--      back-and-forth conversation.
--   3. goals — an office's own target for the month: orders and amount,
--      set by the office itself, read back on its own dashboard next to
--      the existing "gap to the zone leader" panel.
--   4. Everything email (renewal reminders, payment receipts, the
--      Monday zone digest) is built on a Resend-backed Edge Function
--      and pg_cron — see the note at the bottom for the one manual step
--      that has to happen outside this file.
--
-- Run the whole thing in the Supabase SQL editor. Wrapped in one
-- transaction; safe to run twice.
-- =====================================================================
begin;

-- ---------------------------------------------------------------------
-- 1. Feature flags — off by default, every one of them
-- ---------------------------------------------------------------------
insert into app_settings (key, value) values
  ('feature_streaks',         'false'),
  ('feature_csv_import',      'false'),
  ('feature_goals',           'false'),
  ('feature_csv_export',      'false'),
  ('feature_activity_log',    'false'),
  ('feature_renewal_emails',  'false'),
  ('feature_receipt_emails',  'false'),
  ('feature_monthly_digest',  'false'),
  ('feature_whatsapp',        'false'),   -- coming soon: needs a WhatsApp Business API decision
  ('feature_sms',             'false')    -- coming soon: needs an SMS gateway decision
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- 2. Activity log
-- ---------------------------------------------------------------------
create table if not exists activity_log (
  id          uuid primary key default gen_random_uuid(),
  actor_id    uuid references profiles(id) on delete set null,
  actor_name  text not null default '',
  action      text not null,             -- 'office.move' | 'office.delete' | 'center.edit' | ...
  target_kind text not null default '',  -- 'office' | 'center' | ...
  target_id   uuid,
  target_name text not null default '',
  detail      text not null default '',
  created_at  timestamptz not null default now()
);
create index if not exists activity_log_created_idx on activity_log(created_at desc);

alter table activity_log enable row level security;

drop policy if exists activity_log_read on activity_log;
create policy activity_log_read on activity_log
  for select to authenticated using (is_admin());

drop policy if exists activity_log_write on activity_log;
create policy activity_log_write on activity_log
  for insert to authenticated with check (is_admin());

-- ---------------------------------------------------------------------
-- 3. Goals — an office's own target, one row per tracking month
-- ---------------------------------------------------------------------
create table if not exists goals (
  office_id     uuid not null references offices(id) on delete cascade,
  month_no      integer not null,
  target_orders integer not null default 0 check (target_orders >= 0),
  target_amount numeric(12,2) not null default 0 check (target_amount >= 0),
  updated_at    timestamptz not null default now(),
  primary key (office_id, month_no)
);

alter table goals enable row level security;

drop policy if exists goals_read on goals;
create policy goals_read on goals
  for select to authenticated using (is_admin() or office_id = my_office());

drop policy if exists goals_write on goals;
create policy goals_write on goals
  for all to authenticated
  using (office_id = my_office()) with check (office_id = my_office());

-- ---------------------------------------------------------------------
-- 4. Email — the settings the notify Edge Function reads.
--    RESEND_API_KEY itself is an Edge Function secret, never a row in
--    this table and never in git. Set it once:
--      Supabase dashboard -> Edge Functions -> Manage secrets
--      RESEND_API_KEY   re_...
--      NOTIFY_FROM       e.g. "Sky Team Ife <no-reply@yourdomain.com>"
--        (must be a domain verified in Resend, or Resend rejects it)
-- ---------------------------------------------------------------------
insert into app_settings (key, value) values
  ('notify_reminder_days', '7,3,1')   -- how many days before lock/renewal to email
on conflict (key) do nothing;

commit;

-- =====================================================================
-- AFTER THIS FILE — three things outside the SQL editor:
--
-- 1. Deploy the new Edge Function:
--      supabase functions deploy notify
--    and set its two secrets (above) in the dashboard.
--
-- 2. Turn on pg_cron and pg_net, once, in the Supabase dashboard under
--    Database -> Extensions (search each by name, enable it). Then run
--    this block by itself, separately, AFTER both extensions show as
--    enabled — it will error if you run it before they are:
--
--      select cron.schedule('sti-daily-reminders', '30 6 * * *', $$
--        select net.http_post(
--          url := 'https://<project-ref>.functions.supabase.co/notify',
--          headers := jsonb_build_object('content-type', 'application/json'),
--          body := jsonb_build_object('type', 'reminders')
--        );
--      $$);
--
--      select cron.schedule('sti-monday-digest', '0 7 * * 1', $$
--        select net.http_post(
--          url := 'https://<project-ref>.functions.supabase.co/notify',
--          headers := jsonb_build_object('content-type', 'application/json'),
--          body := jsonb_build_object('type', 'digest')
--        );
--      $$);
--
--    Replace <project-ref> with the one in your Supabase URL. 6:30am
--    and Monday 7am are both server time (UTC) — Nigeria is UTC+1, so
--    those land at 7:30am and Monday 8am locally; adjust the two
--    numbers before "* * *" / "* * 1" if you want a different local
--    time.
--
-- 3. Payment receipts need nothing extra here — they are sent straight
--    from paystack-webhook when a charge succeeds, which you already
--    have to redeploy for the new pricing. Nothing to schedule.
--
-- Every one of these three stays silent until its switch in
-- Admin -> Features is turned on, regardless of whether the Edge
-- Function and cron jobs exist yet — the flag is checked first, inside
-- notify and inside the webhook, before anything is sent.
-- =====================================================================
