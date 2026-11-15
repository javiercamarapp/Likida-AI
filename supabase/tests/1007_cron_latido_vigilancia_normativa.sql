-- Prueba de 1007 (cron_latido admite el id `vigilancia-normativa`).
-- Ejecutar después de las migraciones con:
--   psql -X -v ON_ERROR_STOP=1 -f supabase/tests/1007_cron_latido_vigilancia_normativa.sql
-- Todo ocurre en una transacción que se revierte. Sale con excepción si algo falla; si no, NOTICE CRON_LATIDO_VIGILANCIA_OK.

begin;

do $$
declare
  rechazado boolean := false;
  def text;
begin
  -- El latido del cron nuevo se acepta (upsert, como lo hace registrarLatido) y guarda el estado en `detalle`.
  insert into public.cron_latido(id, ultimo_latido, estado, detalle)
    values ('vigilancia-normativa', now(), 'ok', '{"vigilancia":{"ultimoDiaBarrido":"2026-11-13"}}'::jsonb)
    on conflict (id) do update set ultimo_latido = excluded.ultimo_latido, detalle = excluded.detalle;
  if not exists (
    select 1 from public.cron_latido
    where id = 'vigilancia-normativa' and detalle #>> '{vigilancia,ultimoDiaBarrido}' = '2026-11-13'
  ) then
    raise exception '1007: el latido vigilancia-normativa no quedó escrito con su estado';
  end if;

  -- Los ids anteriores siguen admitidos (el dominio solo se ensanchó).
  insert into public.cron_latido(id, ultimo_latido, estado, detalle)
    values ('tms', now(), 'ok', '{}'::jsonb)
    on conflict (id) do update set ultimo_latido = excluded.ultimo_latido;

  -- Un id desconocido sigue rebotando (23514), no se volvió un dominio abierto.
  begin
    insert into public.cron_latido(id, ultimo_latido, estado, detalle)
      values ('cron-inexistente', now(), 'ok', '{}'::jsonb);
  exception when check_violation then
    rechazado := true;
  end;
  if not rechazado then raise exception '1007: el CHECK ya no rechaza un id de cron desconocido'; end if;

  select pg_get_constraintdef(oid) into def from pg_constraint where conname = 'cron_latido_id_dominio';
  if def is null or def not like '%''vigilancia-normativa''%' or def not like '%''tms''%' then
    raise exception '1007: el CHECK no lista vigilancia-normativa y tms: %', def;
  end if;

  raise notice 'CRON_LATIDO_VIGILANCIA_OK';
end
$$;

rollback;
