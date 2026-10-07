-- =====================================================================
-- Sky Team Ife — feedback from the "What's new" popup
--
-- The popup asks everyone: does this update solve a problem for you?
--   Yes -> what should an office pay per month, and what features do
--          you want next.
--   No  -> what else do you need us to add.
--
-- The answers land here, and only the Super Admin can read them
-- (Admin -> top of the page). Anyone signed in can send their own.
--
-- Run in the Supabase SQL editor. Safe to run twice.
-- =====================================================================
begin;

create table if not exists feedback (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references profiles(id) on delete cascade,
  name        text not null default '',
  role        text not null default '',
  office_id   uuid references offices(id) on delete set null,
  center_id   uuid references centers(id) on delete set null,
  topic       text not null default '',          -- which update it answers
  solves      boolean not null,
  price_ngn   integer check (price_ngn is null or price_ngn >= 0),
  features    text not null default '',
  needs       text not null default '',
  created_at  timestamptz not null default now()
);
create index if not exists feedback_created_idx on feedback(created_at desc);

alter table feedback enable row level security;

drop policy if exists feedback_insert on feedback;
create policy feedback_insert on feedback
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists feedback_read on feedback;
create policy feedback_read on feedback
  for select to authenticated
  using (my_role() = 'super_admin');

commit;

-- See the answers here too, newest first:
-- select created_at, name, role, solves, price_ngn, features, needs
-- from feedback order by created_at desc;
