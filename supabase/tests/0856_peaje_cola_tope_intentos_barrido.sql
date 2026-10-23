\set ON_ERROR_STOP on
-- 0856 — COLA DE PEAJES: tope de intentos en el claim + barrido de procesando
-- vencidos (A35-R12-rendimiento-01). Se corre DESPUÉS de aplicar la 0856 (y es
-- idempotente: el bloque inicial la reaplica). Todo dentro de una transacción
-- que termina en rollback. Falla con `raise exception` si algo no se cumple.
--
-- Prueba: (a) el claim sigue entregando pendientes y lease vencido con < 3
-- intentos; (b) NO entrega un lease vencido con 3 intentos; (c) el barrido lo
-- manda a fallida con motivo legible y devuelve la fila; (d) el barrido por
-- gracia (vencido hace > N min aunque tenga pocos intentos); (e) no toca lo
-- vigente (lease en curso, pendiente, procesada); (f) rangos y grants;
-- (g) idempotencia (reaplicar la migración); (h) la reversa.
begin;

insert into public.tenant (id, nombre) values ('85600000-0000-4000-8000-0000000000a1', 'Flota 0856');

create temp table _arch (clave text primary key, id uuid);
grant all on _arch to public;

-- Inserta un archivo de la cola con el estado/intentos/lease pedidos.
create or replace function pg_temp.nuevo(p_clave text, p_estado text, p_intentos int, p_lease interval)
returns void language plpgsql as $$
declare v_id uuid;
begin
  insert into public.peaje_ingesta_archivo
    (tenant_id, huella, nombre, bytes, contenido, estado, intentos, proximo_intento_en, reclamo, reclamado_hasta)
  values ('85600000-0000-4000-8000-0000000000a1', encode(sha256(convert_to(p_clave, 'UTF8')), 'hex'), p_clave || '.csv', 1,
          '\x41'::bytea, p_estado, p_intentos, now() - interval '1 hour',
          case when p_estado = 'procesando' then gen_random_uuid() end,
          case when p_estado = 'procesando' then now() + p_lease end)
  returning id into v_id;
  insert into _arch values (p_clave, v_id);
end $$;

-- ── (g) idempotencia: reaplicar la migración no rompe nada ──────────────────
\ir ../migrations/0856_peaje_cola_tope_intentos_barrido.sql
\ir ../migrations/0856_peaje_cola_tope_intentos_barrido.sql

select pg_temp.nuevo('pendiente',   'pendiente',  0, null);
select pg_temp.nuevo('vencido1',    'procesando', 1, interval '-10 minutes');   -- murió 1 vez: se recupera
select pg_temp.nuevo('vencido3',    'procesando', 3, interval '-10 minutes');   -- murió 3 veces: tope
select pg_temp.nuevo('vigente',     'procesando', 3, interval '+5 minutes');    -- lease en curso: intocable
select pg_temp.nuevo('procesada',   'pendiente',  0, null);
update public.peaje_ingesta_archivo set estado = 'procesada', contenido = null
 where id = (select id from _arch where clave = 'procesada');

set local role service_role;

-- ── (a)(b) el claim ─────────────────────────────────────────────────────────
do $$
declare
  v_ids uuid[]; v_n int; v_int int;
begin
  select array_agg(r.id), count(*) into v_ids, v_n from public.peaje_archivo_reclamar(50, 300) r;
  if not (select id from _arch where clave = 'pendiente') = any (v_ids) then
    raise exception '0856(a): el claim dejó de entregar el pendiente'; end if;
  if not (select id from _arch where clave = 'vencido1') = any (v_ids) then
    raise exception '0856(a): el claim dejó de recuperar un lease vencido con 1 intento'; end if;
  select intentos into v_int from public.peaje_ingesta_archivo where id = (select id from _arch where clave = 'vencido1');
  if v_int <> 2 then raise exception '0856(a): el intento no subió a 2 (es %)', v_int; end if;
  if (select id from _arch where clave = 'vencido3') = any (v_ids) then
    raise exception '0856(b): el claim volvió a entregar un archivo con 3 intentos agotados'; end if;
  if (select id from _arch where clave = 'vigente') = any (v_ids) then
    raise exception '0856(e): el claim tomó un lease en curso'; end if;
  -- un segundo claim no reentrega lo recién reclamado ni el agotado
  select count(*) into v_n from public.peaje_archivo_reclamar(50, 300) r
   where r.id in (select id from _arch where clave in ('pendiente', 'vencido1', 'vencido3'));
  if v_n <> 0 then raise exception '0856(b): un segundo claim reentregó archivos (%)', v_n; end if;
end $$;

-- ── (c)(d)(e) el barrido ────────────────────────────────────────────────────
do $$
declare
  v_filas record; v_n int; v_est text; v_err text; v_ids uuid[];
begin
  select array_agg(b.id), count(*) into v_ids, v_n from public.peaje_archivo_barrer_vencidos(3, 60) b;
  if v_n <> 1 then raise exception '0856(c): el barrido debía mover 1 (vencido3), movió %', v_n; end if;
  if not (select id from _arch where clave = 'vencido3') = any (v_ids) then
    raise exception '0856(c): el barrido no devolvió el archivo agotado'; end if;

  select estado, ultimo_error into v_est, v_err from public.peaje_ingesta_archivo where id = (select id from _arch where clave = 'vencido3');
  if v_est <> 'fallida' then raise exception '0856(c): vencido3 quedó en % y no en fallida', v_est; end if;
  if v_err is null or v_err not like '%interrumpió 3 veces%' then raise exception '0856(c): motivo ilegible o ausente: %', v_err; end if;
  if (select contenido from public.peaje_ingesta_archivo where id = (select id from _arch where clave = 'vencido3')) is null then
    raise exception '0856(c): el barrido borró el contenido (debe conservarse para reprocesar)'; end if;
  if (select reclamo from public.peaje_ingesta_archivo where id = (select id from _arch where clave = 'vencido3')) is not null then
    raise exception '0856(c): el barrido dejó el token del claim'; end if;

  -- (d) vencido hace horas con pocos intentos (nadie lo retomó): lo barre la gracia
  insert into public.peaje_ingesta_archivo (tenant_id, huella, nombre, bytes, contenido, estado, intentos, reclamo, reclamado_hasta)
  values ('85600000-0000-4000-8000-0000000000a1', repeat('b', 64), 'viejo.csv', 1, '\x41'::bytea, 'procesando', 1, gen_random_uuid(), now() - interval '3 hours');
  select count(*) into v_n from public.peaje_archivo_barrer_vencidos(3, 60);
  if v_n <> 1 then raise exception '0856(d): el barrido por gracia debía mover 1, movió %', v_n; end if;
  select estado, ultimo_error into v_est, v_err from public.peaje_ingesta_archivo where huella = repeat('b', 64);
  if v_est <> 'fallida' or v_err not like '%más de 60 minutos%' then
    raise exception '0856(d): viejo quedó en % con motivo %', v_est, v_err; end if;

  -- lo vigente, lo recién reclamado y lo pendiente NO se tocan
  select estado into v_est from public.peaje_ingesta_archivo where id = (select id from _arch where clave = 'vigente');
  if v_est <> 'procesando' then raise exception '0856(e): el barrido tocó un lease en curso (%)', v_est; end if;
  select estado into v_est from public.peaje_ingesta_archivo where id = (select id from _arch where clave = 'vencido1');
  if v_est <> 'procesando' then raise exception '0856(e): el barrido tocó el recién reclamado (%)', v_est; end if;

  -- barrer otra vez no encuentra nada (idempotente)
  select count(*) into v_n from public.peaje_archivo_barrer_vencidos(3, 60);
  if v_n <> 0 then raise exception '0856(c): el segundo barrido movió % filas', v_n; end if;

  -- (f) rangos
  begin perform * from public.peaje_archivo_barrer_vencidos(0, 60);
    raise exception '0856(f): aceptó p_max_intentos = 0';
  exception when raise_exception then
    if sqlerrm like '0856(f)%' then raise; end if; end;
  begin perform * from public.peaje_archivo_barrer_vencidos(3, 1);
    raise exception '0856(f): aceptó p_gracia_minutos = 1';
  exception when raise_exception then
    if sqlerrm like '0856(f)%' then raise; end if; end;
end $$;

-- ── (f) grants: solo service_role ───────────────────────────────────────────
reset role;
do $$
begin
  if has_function_privilege('anon', 'public.peaje_archivo_barrer_vencidos(int,int)', 'execute')
     or has_function_privilege('authenticated', 'public.peaje_archivo_barrer_vencidos(int,int)', 'execute') then
    raise exception '0856(f): anon/authenticated pueden ejecutar el barrido'; end if;
  if not has_function_privilege('service_role', 'public.peaje_archivo_barrer_vencidos(int,int)', 'execute') then
    raise exception '0856(f): service_role no puede ejecutar el barrido'; end if;
  if has_function_privilege('anon', 'public.peaje_archivo_reclamar(int,int)', 'execute')
     or has_function_privilege('authenticated', 'public.peaje_archivo_reclamar(int,int)', 'execute') then
    raise exception '0856(f): anon/authenticated pueden ejecutar el claim'; end if;
end $$;

-- ── (h) la reversa: el claim vuelve al comportamiento de la 0376 ────────────
drop function if exists public.peaje_archivo_barrer_vencidos(int, int);
create or replace function public.peaje_archivo_reclamar(p_limite int default 5, p_lease_segundos int default 300)
returns table (id uuid, tenant_id uuid, nombre text, proveedor text, intentos int, reclamo uuid, desglose_id uuid)
language plpgsql security invoker set search_path = public, pg_temp
as $f$
declare v_reclamo uuid := gen_random_uuid();
begin
  if p_limite is null or p_limite < 1 or p_limite > 50 then
    raise exception 'peaje_archivo_reclamar: p_limite fuera de rango (1-50)';
  end if;
  if p_lease_segundos is null or p_lease_segundos < 30 or p_lease_segundos > 3600 then
    raise exception 'peaje_archivo_reclamar: p_lease_segundos fuera de rango (30-3600)';
  end if;
  return query
  with elegibles as (
    select a.id from public.peaje_ingesta_archivo a
     where a.contenido is not null
       and ((a.estado = 'pendiente' and a.proximo_intento_en <= now())
         or (a.estado = 'procesando' and a.reclamado_hasta is not null and a.reclamado_hasta < now()))
     order by a.proximo_intento_en, a.recibida_en limit p_limite for update skip locked)
  update public.peaje_ingesta_archivo a
     set estado = 'procesando', reclamo = v_reclamo,
         reclamado_hasta = now() + make_interval(secs => p_lease_segundos), intentos = a.intentos + 1
    from elegibles e where a.id = e.id
  returning a.id, a.tenant_id, a.nombre, a.proveedor, a.intentos, a.reclamo, a.desglose_id;
end;
$f$;
do $$
declare v_n int;
begin
  if exists (select 1 from pg_proc where proname = 'peaje_archivo_barrer_vencidos') then
    raise exception '0856(h): la reversa no quitó el barrido'; end if;
  -- con la reversa, un lease vencido con 3 intentos vuelve a entregarse (el defecto original)
  update public.peaje_ingesta_archivo set estado = 'procesando', reclamo = gen_random_uuid(),
         reclamado_hasta = now() - interval '1 minute', intentos = 3
   where id = (select id from _arch where clave = 'vencido3');
  select count(*) into v_n from public.peaje_archivo_reclamar(50, 300) r where r.id = (select id from _arch where clave = 'vencido3');
  if v_n <> 1 then raise exception '0856(h): tras la reversa el claim no se comporta como el de la 0376'; end if;
end $$;

rollback;
select '0856: OK' as resultado;
