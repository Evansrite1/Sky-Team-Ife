-- =====================================================================
-- Sky Team Ife — push notifications
--
-- One row per phone or computer that said yes to notifications. The app
-- writes it when someone turns notifications on; the sender (api/push.js
-- on Vercel) reads it to know where to deliver.
--
-- Who can do what:
--   * Everyone manages their own devices, and nobody else's.
--   * The Super Admin can see how many devices each person has on.
--
-- Run in the Supabase SQL editor. Safe to run twice.
-- =====================================================================
begin;

create table if not exists push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references profiles(id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  role        text not null default '',
  office_id   uuid references offices(id) on delete set null,
  center_id   uuid references centers(id) on delete set null,
  user_agent  text not null default '',
  created_at  timestamptz not null default now(),
  last_used   timestamptz
);
create index if not exists push_subscriptions_user_idx on push_subscriptions(user_id);

alter table push_subscriptions enable row level security;

drop policy if exists push_own on push_subscriptions;
create policy push_own on push_subscriptions
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists push_super_read on push_subscriptions;
create policy push_super_read on push_subscriptions
  for select to authenticated
  using (my_role() = 'super_admin');

commit;
