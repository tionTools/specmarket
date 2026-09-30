-- Keep the existing 15-minute cron poll, but do not invoke the Edge Function during
-- the 00:00-06:59 Europe/Kyiv night window. The worker retains the same defensive
-- night gate for manual/legacy callers and preserves DST behavior.
select cron.unschedule(jobid)
from cron.job
where jobname = 'crm-delivery-tracking';

select cron.schedule('crm-delivery-tracking', '*/15 * * * *', $$
  select public.invoke_crm_marketplace_sync(
    'sync-delivery-tracking',
    '{"scheduled":true}'::jsonb
  )
  where extract(hour from (now() at time zone 'Europe/Kyiv'))::int between 7 and 23;
$$);
