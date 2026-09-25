-- Keep the existing Kyiv-time due gate and staggered execution minutes, but avoid
-- starting three no-op pg_cron jobs every minute. The due gate retains the
-- five-minute daytime / hourly nighttime synchronization policy, including DST.
select cron.unschedule(jobid)
from cron.job
where jobname in ('crm-sync-prom-poll', 'crm-sync-epicentr-poll', 'crm-sync-kasta-poll');

select cron.schedule('crm-sync-prom-poll', '*/5 * * * *', $$
  select case when public.crm_marketplace_sync_is_due('Пром')
    then public.invoke_crm_marketplace_sync('sync-prom-orders', '{"scheduled":true}'::jsonb) end;
$$);

select cron.schedule('crm-sync-epicentr-poll', '1-59/5 * * * *', $$
  select case when public.crm_marketplace_sync_is_due('Эпицентр')
    then public.invoke_crm_marketplace_sync('sync-epicentr-orders', '{"scheduled":true}'::jsonb) end;
$$);

select cron.schedule('crm-sync-kasta-poll', '2-59/5 * * * *', $$
  select case when public.crm_marketplace_sync_is_due('Каста')
    then public.invoke_crm_marketplace_sync('sync-kasta-orders', '{"scheduled":true}'::jsonb) end;
$$);
