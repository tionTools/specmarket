-- Kasta's API cursor traverses historical pages. Both Kasta jobs must use the
-- latest-only handler window rather than retaining a history cursor.
select cron.unschedule(jobid)
from cron.job
where jobname in ('crm-sync-kasta-new', 'crm-refresh-kasta');

select cron.schedule('crm-sync-kasta-new', '2-59/5 * * * *', $$
  select public.invoke_crm_marketplace_sync('sync-kasta-orders', '{"scheduled":true,"latest":true}'::jsonb);
$$);

select cron.schedule('crm-refresh-kasta', '13-59/15 * * * *', $$
  select public.invoke_crm_marketplace_sync('sync-kasta-orders', '{"scheduled":true,"full":true,"latest":true}'::jsonb);
$$);
