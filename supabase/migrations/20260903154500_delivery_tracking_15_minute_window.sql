-- Базовый cron вызывается каждые 15 минут; Edge Function сама сохраняет расписание Europe/Kyiv:
-- 07:00–08:59 и 16:00–20:59 = 30 мин, 09:00–15:59 = 15 мин,
-- 21:00–23:59 = 60 мин, ночью пропуск.

select cron.unschedule(jobid)
from cron.job
where jobname = 'crm-delivery-tracking';

select cron.schedule('crm-delivery-tracking', '*/15 * * * *', $$
  select public.invoke_crm_marketplace_sync('sync-delivery-tracking', '{"scheduled":true}'::jsonb);
$$);
