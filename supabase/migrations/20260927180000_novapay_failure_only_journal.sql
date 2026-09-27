-- A failure-only journal no longer creates running/progress entries. Remove stale rows
-- from the previous instrumentation; retain all failed attempts for the CRM display.
delete from public.crm_novapay_sync_log where status = 'running';
