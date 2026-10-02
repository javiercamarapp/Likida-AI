-- ═══════════════════════════════════════════════════════════════════════════
-- 0660 — «Mis reglas» (Agente 13): RECLAMO ATÓMICO ANTES DE MANDAR.
--
-- Hasta aquí el vigilante mandaba PRIMERO y sellaba DESPUÉS (0229, patrón 0202). Es correcto para un fallo de red (el aviso
-- que no salió se reintenta), pero deja una carrera: dos corridas solapadas del cron (Vercel entrega at-least-once) leen el
-- mismo conjunto de casos «nuevos», ambas pasan el chequeo de sellos y ambas mandan el WhatsApp. El sello llega tarde.
--
-- Esta migración agrega el reclamo con el mismo patrón que la cobranza por gasto (0525): INSERTAR LA LLAVE ES RECLAMARLA.
-- La llave nace en estado `enviando` con un token y un arriendo; quien pierde el insert no manda nada.
--
--   regla_disparo.estado            'enviado' (default: todo lo anterior a esta migración ya se mandó) | 'enviando'
--   regla_disparo.reclamo_token     quién lleva el envío
--   regla_disparo.reclamo_expira_en hasta cuándo es suyo; vencido, otra corrida lo puede retomar (la que murió a media)
--
--   reclamar_disparos_regla   → las llaves que ESTA llamada ganó (nuevas, o `enviando` con arriendo vencido) y su token;
--   confirmar_disparos_regla  → Meta aceptó: las llaves pasan a `enviado` (solo con el token vigente); devuelve cuántas;
--   liberar_disparos_regla    → Meta rechazó: se borran las llaves que aún lleva ese token, para reintentar a la hora.
--
-- Security definer, search_path vacío, solo service_role. El código funciona sin esta migración (cae al orden anterior).
-- Idempotente: columnas con IF NOT EXISTS, CHECK condicionado, funciones con CREATE OR REPLACE.
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.regla_disparo
  add column if not exists estado text not null default 'enviado',
  add column if not exists reclamo_token uuid,
  add column if not exists reclamo_expira_en timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'regla_disparo_estado_dominio') then
    alter table public.regla_disparo
      add constraint regla_disparo_estado_dominio check (estado in ('enviando', 'enviado'));
  end if;
  -- Una llave `enviando` trae su token y su arriendo; una `enviado` ya no los lleva.
  if not exists (select 1 from pg_constraint where conname = 'regla_disparo_reclamo_coherente') then
    alter table public.regla_disparo
      add constraint regla_disparo_reclamo_coherente check (
        (estado = 'enviando' and reclamo_token is not null and reclamo_expira_en is not null)
        or (estado = 'enviado' and reclamo_token is null and reclamo_expira_en is null)
      );
  end if;
end $$;

comment on column public.regla_disparo.estado is
  'enviado = el aviso de esta llave ya salió (o es anterior a la 0660); enviando = una corrida la reclamó y está mandando. Un arriendo vencido se retoma.';

create or replace function public.reclamar_disparos_regla(
  p_tenant uuid, p_regla uuid, p_items jsonb,
  p_lease_segundos integer default 300, p_ahora timestamptz default clock_timestamp()
) returns table (o_token uuid, o_objeto text, o_objeto_id uuid, o_clave text)
language plpgsql security definer set search_path = ''
as $$
declare v_token uuid := gen_random_uuid();
begin
  if p_lease_segundos < 30 or p_lease_segundos > 900 then raise exception 'lease fuera de 30..900'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then raise exception 'p_items debe ser un arreglo'; end if;
  return query
  insert into public.regla_disparo as d (tenant_id, regla_id, objeto, objeto_id, clave, evidencia, estado, reclamo_token, reclamo_expira_en)
  select distinct on (i.objeto, i.objeto_id, i.clave)
         p_tenant, p_regla, i.objeto, i.objeto_id, i.clave, i.evidencia, 'enviando', v_token,
         p_ahora + make_interval(secs => p_lease_segundos)
    from (
      select e ->> 'objeto' as objeto, (e ->> 'objeto_id')::uuid as objeto_id,
             coalesce(e ->> 'clave', '') as clave, left(e ->> 'evidencia', 1000) as evidencia
        from jsonb_array_elements(p_items) e
    ) i
  on conflict (tenant_id, regla_id, objeto, objeto_id, clave) do update
     set estado = 'enviando', reclamo_token = v_token, reclamo_expira_en = excluded.reclamo_expira_en,
         evidencia = excluded.evidencia
   where d.estado = 'enviando' and d.reclamo_expira_en <= p_ahora
  returning v_token, d.objeto, d.objeto_id, d.clave;
end;
$$;
revoke all on function public.reclamar_disparos_regla(uuid, uuid, jsonb, integer, timestamptz) from public, anon, authenticated;
grant execute on function public.reclamar_disparos_regla(uuid, uuid, jsonb, integer, timestamptz) to service_role;

create or replace function public.confirmar_disparos_regla(
  p_tenant uuid, p_regla uuid, p_token uuid, p_ahora timestamptz default clock_timestamp()
) returns integer
language plpgsql security definer set search_path = ''
as $$
declare v_n integer;
begin
  update public.regla_disparo d
     set estado = 'enviado', reclamo_token = null, reclamo_expira_en = null, disparado_en = p_ahora
   where d.tenant_id = p_tenant and d.regla_id = p_regla and d.estado = 'enviando' and d.reclamo_token = p_token;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function public.confirmar_disparos_regla(uuid, uuid, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.confirmar_disparos_regla(uuid, uuid, uuid, timestamptz) to service_role;

create or replace function public.liberar_disparos_regla(
  p_tenant uuid, p_regla uuid, p_token uuid
) returns integer
language plpgsql security definer set search_path = ''
as $$
declare v_n integer;
begin
  delete from public.regla_disparo d
   where d.tenant_id = p_tenant and d.regla_id = p_regla and d.estado = 'enviando' and d.reclamo_token = p_token;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function public.liberar_disparos_regla(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.liberar_disparos_regla(uuid, uuid, uuid) to service_role;
