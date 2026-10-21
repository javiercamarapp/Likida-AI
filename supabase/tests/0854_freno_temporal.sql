\set ON_ERROR_STOP on
-- 0854 — `freno_temporal`: el freno AUTOMÁTICO con TTL del HALLAZGO 2 de la
-- auditoría adversarial de A7 Cobranza (21-oct-2026). Lo que SOLO la base
-- puede demostrar, contra Postgres real:
--   (a) un `id` fuera del catálogo (`freno_temporal_id_dominio`) se rechaza;
--   (b) un `id` del catálogo se acepta sin fricción;
--   (c) el `upsert` por `id` (patrón `onConflict: 'id'` que usa
--       `marcarFrenoTemporal`) REEMPLAZA la fila existente — una sola fila
--       por nombre, nunca dos filas del mismo freno compitiendo;
--   (d) RLS está ENCENDIDO y sin ninguna policy (deny-all): solo
--       service-role (que lo salta) puede leer o escribir.
begin;

-- (a) id inventado: lo rebota el CHECK, no un error de columna/tabla.
do $$
begin
  begin
    insert into public.freno_temporal (id, activo_hasta) values ('inventado:no_existe', now() + interval '5 minutes');
    raise exception '0854: un id fuera del catálogo debería haber sido rechazado por freno_temporal_id_dominio';
  exception
    when check_violation then null; -- esperado
  end;
end $$;

-- (b) id del catálogo: entra limpio.
insert into public.freno_temporal (id, activo_hasta, motivo)
values ('cobranza:rechazo_masivo_whatsapp', now() + interval '5 minutes', '5 rechazos reintentables seguidos (tenant X)');

do $$
declare
  n int;
begin
  select count(*) into n from public.freno_temporal where id = 'cobranza:rechazo_masivo_whatsapp';
  if n <> 1 then
    raise exception '0854: esperaba exactamente 1 fila tras el insert inicial, encontré %', n;
  end if;
end $$;

-- (c) el upsert (mismo molde que `marcarFrenoTemporal`: onConflict por id)
-- REEMPLAZA la fila — nunca una segunda fila del mismo freno.
insert into public.freno_temporal (id, activo_hasta, motivo)
values ('cobranza:rechazo_masivo_whatsapp', now() + interval '10 minutes', '5 rechazos reintentables seguidos (tenant Y, corrida más reciente)')
on conflict (id) do update set activo_hasta = excluded.activo_hasta, motivo = excluded.motivo, creado_en = now();

do $$
declare
  n int;
  v_motivo text;
begin
  select count(*) into n from public.freno_temporal where id = 'cobranza:rechazo_masivo_whatsapp';
  if n <> 1 then
    raise exception '0854: el upsert por id debía seguir dejando 1 sola fila, encontré %', n;
  end if;
  select motivo into v_motivo from public.freno_temporal where id = 'cobranza:rechazo_masivo_whatsapp';
  if v_motivo <> '5 rechazos reintentables seguidos (tenant Y, corrida más reciente)' then
    raise exception '0854: el upsert debía REEMPLAZAR el motivo de la corrida anterior, quedó: %', v_motivo;
  end if;
end $$;

-- (d) deny-all: RLS encendido y SIN policies (solo service-role, que las
-- salta, puede tocar la tabla).
do $$
declare
  rls_encendido boolean;
  n_policies int;
begin
  select relrowsecurity into rls_encendido from pg_class where oid = 'public.freno_temporal'::regclass;
  if not rls_encendido then
    raise exception '0854: freno_temporal debe tener RLS encendido (deny-all)';
  end if;
  select count(*) into n_policies from pg_policies where schemaname = 'public' and tablename = 'freno_temporal';
  if n_policies <> 0 then
    raise exception '0854: freno_temporal es deny-all — no debe tener ninguna policy (encontré %)', n_policies;
  end if;
end $$;

rollback;
