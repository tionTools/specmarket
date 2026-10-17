-- Patch 184: remove inherited/default direct table grants left on authenticated
-- after Patch 183. RLS does not protect TRUNCATE or REFERENCES.
-- Clients only read reminders; all mutations are through authenticated RPCs
-- or service_role. Leave the existing RLS policy and RPC privileges unchanged.
revoke all privileges on table public.crm_pickup_reminders from public, anon, authenticated;
grant select on table public.crm_pickup_reminders to authenticated;

-- Fail closed if grants remain effective through another role or PUBLIC.
-- The migration must not be recorded unless the privilege fix actually works.
do $$
begin
  if not has_table_privilege('authenticated', 'public.crm_pickup_reminders', 'SELECT')
     or has_table_privilege('authenticated', 'public.crm_pickup_reminders', 'INSERT')
     or has_table_privilege('authenticated', 'public.crm_pickup_reminders', 'UPDATE')
     or has_table_privilege('authenticated', 'public.crm_pickup_reminders', 'DELETE')
     or has_table_privilege('authenticated', 'public.crm_pickup_reminders', 'TRUNCATE')
     or has_table_privilege('authenticated', 'public.crm_pickup_reminders', 'REFERENCES')
     or has_table_privilege('authenticated', 'public.crm_pickup_reminders', 'TRIGGER')
     or has_table_privilege('anon', 'public.crm_pickup_reminders', 'SELECT')
     or has_table_privilege('anon', 'public.crm_pickup_reminders', 'TRUNCATE')
     or not (
       select c.relrowsecurity
       from pg_catalog.pg_class c
       where c.oid = 'public.crm_pickup_reminders'::regclass
     )
  then
    raise exception 'CRM_PICKUP_REMINDER_ACL_UNSAFE';
  end if;
end;
$$;
