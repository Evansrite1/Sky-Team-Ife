-- Turns ON the features that are built and need no email service:
-- streaks, goals, CSV import, CSV export, activity log.
-- Run after go-live-no-email.sql. Safe to run twice.
insert into app_settings (key, value) values
  ('feature_streaks',      'true'),
  ('feature_goals',        'true'),
  ('feature_csv_import',   'true'),
  ('feature_csv_export',   'true'),
  ('feature_activity_log', 'true')
on conflict (key) do update set value = 'true';

-- Check: the five should say true, the rest false.
select key, value from app_settings where key like 'feature\_%' order by key;
