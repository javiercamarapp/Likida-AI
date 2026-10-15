-- ═══════════════════════════════════════════════════════════════════════════
-- 0799 — Vigía: estatus de importación por caja (Agente 4).
--
-- Lo que pidió el cliente (levantamiento 9df88631 ~16:56 y ~17:26): saber si la caja ya está en patio / pendiente de cruce /
-- en ruta y si ya tiene sus documentos (listo / pendiente de requisito). Hoy una persona lo actualiza a mano en el programa
-- y «no siempre» lo tiene al día; la idea es fijarlo desde el control de unidad de Track & Trace o, mientras no haya acceso,
-- derivarlo de las columnas TRANSITO y CCP del propio programa de despacho (0795).
--
--   · `vigia_estatus_importacion`  una fila por (flota, caja, fuente): lo último que esa fuente dijo de la caja.
--       estado  patio | pend_cruce | en_ruta | desconocido        (dónde está)
--       docs    listo | pend_requisito | desconocido               (si ya tiene sus documentos)
--       fuente  programa | track_trace | manual                    (quién lo dijo)
--       observado_en  cuándo lo vio la fuente (no cuándo lo guardamos). Una fuente NO puede retroceder su propio
--                     `observado_en` (un trigger lo impide): un dato más viejo no pisa a uno más nuevo.
--       fila_id       la fila del programa de la que salió (null si no viene de una); borrar la fila conserva el estatus.
--     Qué fuente manda para una caja (la de `observado_en` mayor) lo resuelve el código (`importacion/modelo.ts`), no esta tabla:
--     aquí viven los hechos de cada fuente por separado, para poder compararlos (programa contra Track & Trace).
--
-- Todo lo escribe el servidor (service_role); la lectura es para quien atiende clientes (`ve_atencion_cliente()`, 0400),
-- como 0795/0796/0797. El código que lea esta tabla debe tolerar su ausencia (42P01 / PGRST205 = «aún no aplicada»).
-- No hay credenciales ni datos de Track & Trace aquí: el formato real de esa fuente aún no se conoce (bloqueo B11).
-- No se redefine ninguna función existente: todo lo nuevo lleva el prefijo `vigia_estatus_importacion`.
--
-- RESERVA: este número también queda reservado para correcciones del Agente 4 que lleguen después; esta versión solo crea
-- la tabla de arriba.
--
-- ROLLBACK (ninguna otra migración depende de estos objetos):
--   drop table if exists public.vigia_estatus_importacion;   -- se lleva su trigger
--   drop function if exists public.vigia_estatus_importacion_orden();
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.vigia_estatus_importacion (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenant(id) on delete cascade,
  caja           text not null,
  unidad         text,
  estado         text not null default 'desconocido',
  docs           text not null default 'desconocido',
  fuente         text not null,
  observado_en   timestamptz not null,
  fila_id        uuid,
  actualizado_en timestamptz not null default now(),
  constraint vigia_estatus_importacion_id_tenant_key unique (id, tenant_id),
  constraint vigia_estatus_importacion_fila_fkey
    foreign key (fila_id, tenant_id) references public.programa_despacho_fila (id, tenant_id) on delete set null (fila_id),
  constraint vigia_estatus_importacion_caja_forma check (char_length(btrim(caja)) between 1 and 40),
  constraint vigia_estatus_importacion_unidad_forma check (unidad is null or char_length(btrim(unidad)) between 1 and 40),
  constraint vigia_estatus_importacion_estado check (estado in ('patio', 'pend_cruce', 'en_ruta', 'desconocido')),
  constraint vigia_estatus_importacion_docs check (docs in ('listo', 'pend_requisito', 'desconocido')),
  constraint vigia_estatus_importacion_fuente check (fuente in ('programa', 'track_trace', 'manual'))
);
create unique index if not exists vigia_estatus_importacion_caja_fuente_uq
  on public.vigia_estatus_importacion (tenant_id, lower(btrim(caja)), fuente);
create index if not exists vigia_estatus_importacion_fila_idx
  on public.vigia_estatus_importacion (tenant_id, fila_id) where fila_id is not null;
comment on table public.vigia_estatus_importacion is
  '0799: lo último que cada fuente (programa, track_trace, manual) dijo del estatus de importación de una caja. Único por flota, caja (sin importar mayúsculas ni espacios en los extremos) y fuente.';
comment on column public.vigia_estatus_importacion.caja is '0799: número de caja tal como lo usa la flota (texto: se conservan ceros a la izquierda y letras).';
comment on column public.vigia_estatus_importacion.estado is '0799: dónde está la caja: patio, pend_cruce, en_ruta o desconocido.';
comment on column public.vigia_estatus_importacion.docs is '0799: si ya tiene sus documentos: listo, pend_requisito o desconocido.';
comment on column public.vigia_estatus_importacion.fuente is '0799: quién lo dijo: programa (derivado del programa de despacho), track_trace o manual.';
comment on column public.vigia_estatus_importacion.observado_en is '0799: cuándo lo vio la fuente; una fuente no puede retroceder el suyo.';
comment on column public.vigia_estatus_importacion.fila_id is '0799: fila del programa (0795) de la que salió; null si no viene de una. Borrarla deja el estatus sin fila.';

create or replace function public.vigia_estatus_importacion_orden()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if new.observado_en < old.observado_en then
    raise exception 'vigia_estatus_importacion: observado_en no puede retroceder (% < %)', new.observado_en, old.observado_en
      using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.vigia_estatus_importacion_orden() from public, anon, authenticated;

drop trigger if exists vigia_estatus_importacion_orden on public.vigia_estatus_importacion;
create trigger vigia_estatus_importacion_orden
  before update on public.vigia_estatus_importacion
  for each row execute function public.vigia_estatus_importacion_orden();

alter table public.vigia_estatus_importacion enable row level security;
drop policy if exists tenant_lee on public.vigia_estatus_importacion;
create policy tenant_lee on public.vigia_estatus_importacion for select
  using ((tenant_id = any(get_user_tenant_ids()) and ve_atencion_cliente()) or is_superadmin());

revoke all on table public.vigia_estatus_importacion from public, anon, authenticated;
grant select on table public.vigia_estatus_importacion to authenticated;
grant select, insert, update, delete on table public.vigia_estatus_importacion to service_role;
