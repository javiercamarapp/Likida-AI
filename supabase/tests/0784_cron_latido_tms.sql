-- Prueba de 0784 (cron_latido admite el id `tms`, T-TMS-12).
-- Ejecutar después de las migraciones con:
--   psql -X -v ON_ERROR_STOP=1 -f supabase/tests/0784_cron_latido_tms.sql
-- Todo ocurre en una transacción que se revierte. Sale con excepción si algo falla; si no, NOTICE CRON_LATIDO_TMS_OK.

begin;

do $$
declare
  rechazado boolean := false;
  def text;
begin
  -- El latido del cron nuevo se acepta (upsert, como lo hace registrarLatido).
  insert into public.cron_latido(id, ultimo_latido, estado, detalle)
    values ('tms', now(), 'ok', '{}'::jsonb)
    on conflict (id) do update set ultimo_latido = excluded.ultimo_latido;
  if not exists (select 1 from public.cron_latido where id = 'tms') then
    raise exception '0784: el latido tms no quedó escrito';
  end if;

  -- Los ids anteriores siguen admitidos (el dominio solo se ensanchó).
  insert into public.cron_latido(id, ultimo_latido, estado, detalle)
    values ('guardia', now(), 'ok', '{}'::jsonb)
    on conflict (id) do update set ultimo_latido = excluded.ultimo_latido;

  -- Un id desconocido sigue rebotando (23514), no se volvió un dominio abierto.
  begin
    insert into public.cron_latido(id, ultimo_latido, estado, detalle)
      values ('cron-inexistente', now(), 'ok', '{}'::jsonb);
  exception when check_violation then
    rechazado := true;
  end;
  if not rechazado then raise exception '0784: el CHECK ya no rechaza un id de cron desconocido'; end if;

  select pg_get_constraintdef(oid) into def from pg_constraint where conname = 'cron_latido_id_dominio';
  if def is null or def not like '%''tms''%' or def not like '%''guardia''%' then
    raise exception '0784: el CHECK no lista tms y guardia: %', def;
  end if;

  raise notice 'CRON_LATIDO_TMS_OK';
end
$$;

rollback;
