-- Auto-guess cron job
-- Prerequisites: Enable pg_cron extension in Supabase Dashboard → Database → Extensions
-- Then run this in the SQL Editor:

-- 1. Enable the extension (if not already)
create extension if not exists pg_cron;

-- 2. Schedule the auto-guess function to run every minute
select cron.schedule(
    'auto-guess-expired',
    '* * * * *',
    $$select public.auto_guess_expired_mysteries()$$
);

-- To check scheduled jobs:
-- select * from cron.job;

-- To remove the job if needed:
-- select cron.unschedule('auto-guess-expired');
