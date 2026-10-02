-- ═══════════════════════════════════════════════════════════════════════════
-- 0541 — CANCELACIÓN DE CFDI DE CARTA PORTE (timbre vía PAC).
--
-- Auditoría ola 1 #26: `ProveedorPac.cancelar` devolvía fijo «aún no está construida»
-- y el estado 'cancelado' de `ccp_timbre` (0226/0227) no lo escribía ningún código.
-- Ahora la cancelación se pide al PAC (SW sapien, doc. oficial
-- https://developers.sw.com.mx/knowledge-base/cancelacion-cfdi/) y deja su rastro
-- en la fila del timbre. Reglas que SOLO la base garantiza (supabase/tests/0541_*.sql):
--   · una cancelación solo existe sobre un timbre `vigente` con UUID;
--   · el motivo es del catálogo SAT c_MotivoCancelacion (01-04) y el folio de
--     sustitución va si y solo si el motivo es 01;
--   · `estado='cancelado'` (lo que libera al viaje para re-timbrar la corrección)
--     exige que un humano haya CONFIRMADO la cancelación (`cancelacion_estado =
--     'confirmada'` con quién y cuándo), salvo los timbres cancelados fuera de
--     Likida antes de esta migración (cancelacion_estado nulo).
-- `en_proceso` (SW 201) NO libera el viaje: el CFDI sigue vigente hasta ver el
-- acuse/estatus, porque la consulta de estatus por API no está verificada.
-- Sin datos personales nuevos: solo ids de usuario (ON DELETE SET NULL).
-- ═══════════════════════════════════════════════════════════════════════════
begin;

alter table public.ccp_timbre
  add column if not exists cancelacion_estado text,
  add column if not exists cancelacion_motivo text,
  add column if not exists cancelacion_folio_sustitucion text,
  add column if not exists cancelacion_codigo text,
  add column if not exists cancelacion_acuse text,
  add column if not exists cancelacion_error text,
  add column if not exists cancelacion_solicitada_en timestamptz,
  add column if not exists cancelacion_solicitada_por uuid references public.app_user(id) on delete set null,
  add column if not exists cancelacion_confirmada_en timestamptz,
  add column if not exists cancelacion_confirmada_por uuid references public.app_user(id) on delete set null;

alter table public.ccp_timbre drop constraint if exists ccp_timbre_cancelacion_estado_dominio;
alter table public.ccp_timbre add constraint ccp_timbre_cancelacion_estado_dominio
  check (cancelacion_estado is null or cancelacion_estado in ('solicitada', 'en_proceso', 'rechazada', 'confirmada'));

alter table public.ccp_timbre drop constraint if exists ccp_timbre_cancelacion_motivo_forma;
alter table public.ccp_timbre add constraint ccp_timbre_cancelacion_motivo_forma
  check (
    cancelacion_estado is null
    or (
      cancelacion_motivo is not null and cancelacion_motivo in ('01', '02', '03', '04')
      and (cancelacion_motivo = '01') = (cancelacion_folio_sustitucion is not null)
    )
  );

alter table public.ccp_timbre drop constraint if exists ccp_timbre_cancelacion_sobre_timbre_real;
alter table public.ccp_timbre add constraint ccp_timbre_cancelacion_sobre_timbre_real
  check (cancelacion_estado is null or uuid_fiscal is not null);

alter table public.ccp_timbre drop constraint if exists ccp_timbre_cancelado_confirmado;
alter table public.ccp_timbre add constraint ccp_timbre_cancelado_confirmado
  check (
    estado <> 'cancelado'
    or cancelacion_estado is null
    or (cancelacion_estado = 'confirmada' and cancelacion_confirmada_en is not null)
  );

comment on column public.ccp_timbre.cancelacion_estado is
  '0541: solicitada = se llamó al PAC y no hay respuesta; en_proceso = el SAT recibió la solicitud (SW 201) y el CFDI sigue vigente hasta ver el acuse; rechazada = el PAC/SAT dijo que no; confirmada = un humano vio el CFDI cancelado (único estado que permite estado=cancelado y libera el viaje). NULL = sin cancelación pedida desde Likida.';
comment on column public.ccp_timbre.cancelacion_acuse is
  '0541: acuse XML de cancelación del SAT, tal cual lo devolvió el PAC.';

commit;
