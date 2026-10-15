-- ═══════════════════════════════════════════════════════════════════════════
-- limpiar.sql — borra ENTERO el tenant «Flota Demo» y el esquema
-- simulado cinco_agentes_sim. Un solo DELETE sobre `tenant` (todo cuelga de él
-- con ON DELETE CASCADE). Se niega si el id fijo se llama de otra forma.
-- Mismas guardas que el seed: solo base local.
-- ═══════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on
\if :{?red_privada}
\else
  \set red_privada 0
\endif
select set_config('demo.red_privada', :'red_privada', false) \g /dev/null
do $$
declare
  ip inet := inet_server_addr();
  t uuid := 'eeeeeeee-0620-4000-8000-000000000250';
  n text;
begin
  if not (ip is null or ip <<= '127.0.0.0/8'::inet or ip = '::1'::inet
          or (current_setting('demo.red_privada', true) = '1'
              and (ip <<= '10.0.0.0/8'::inet or ip <<= '172.16.0.0/12'::inet or ip <<= '192.168.0.0/16'::inet))) then
    raise exception 'DEMO CINCO AGENTES: el servidor escucha en % (no es loopback; las redes privadas piden DEMO_PERMITIR_RED_PRIVADA=1). No se limpia nada.', ip;
  end if;
  if current_database() ~* 'prod' then
    raise exception 'DEMO CINCO AGENTES: la base se llama «%» (parece de producción). No se limpia nada.', current_database();
  end if;
  select nombre into n from tenant where id = t;
  if n is null then
    raise notice 'Flota Demo no existe: nada que borrar en tenant';
  elsif n <> 'Flota Demo' then
    raise exception 'el tenant % se llama "%" y no es el demo: no se borra', t, n;
  else
    delete from tenant where id = t;
    raise notice 'Flota Demo borrado (cascada).';
  end if;
end $$;

drop schema if exists cinco_agentes_sim cascade;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'cinco_agentes_demo_lector') then
    execute 'drop owned by cinco_agentes_demo_lector';
    execute 'drop role cinco_agentes_demo_lector';
  end if;
exception when others then
  raise notice 'no se pudo borrar el rol cinco_agentes_demo_lector (¿lo usa otra base?): %', sqlerrm;
end $$;

select (select count(*) from tenant where id = 'eeeeeeee-0620-4000-8000-000000000250') as tenant,
       (select count(*) from viaje where tenant_id = 'eeeeeeee-0620-4000-8000-000000000250') as viajes,
       (select count(*) from posicion where tenant_id = 'eeeeeeee-0620-4000-8000-000000000250') as posiciones;
