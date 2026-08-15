-- Проверка выполняется каждые 30 минут; Edge Function сама применяет расписание Europe/Kyiv
-- (07:00–20:59 = 30 мин, 21:00–23:59 = 60 мин, ночью пропуск).

select cron.unschedule(jobid)
from cron.job
where jobname = 'crm-delivery-tracking';

select cron.schedule('crm-delivery-tracking', '*/30 * * * *', $$
  select public.invoke_crm_marketplace_sync('sync-delivery-tracking', '{"scheduled":true}'::jsonb);
$$);
