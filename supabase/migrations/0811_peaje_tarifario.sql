-- ═══════════════════════════════════════════════════════════════════════════
-- 0811 — PEAJES: el TARIFARIO por caseta y clase (T-A2-06).
--
-- (La ficha lo nombraba «0777 parte B»; esa numeración ya está usada. Va en el
-- bloque 0810–0819 asignado a A2, después de la 0810.)
--
-- Para pasar un candidato a «cobro indebido con monto reclamable» hace falta saber
-- cuánto DEBIÓ costar cruzar esa caseta con esa clase de vehículo. Esta tabla guarda
-- ese dato con su procedencia y su confirmación:
--
--   · `origen`: 'declarada' (la capturó o subió la flota), 'inferida' (la propone el
--     sistema a partir de los cruces vistos; es una HIPÓTESIS) o 'proveedor' (viene
--     de la lista del proveedor de TAG).
--   · `confirmada`: solo una persona (con `confirmada_por`) o una carga marcada
--     'proveedor' la vuelve verdadera. Una tarifa inferida o declarada NUNCA nace
--     confirmada, y el CHECK de abajo impide que quede confirmada sin responsable.
--   · Vigencia: `vigente_desde` y `vigente_hasta` (NULL = sin fin). Que dos vigencias
--     de la misma caseta y clase no se traslapen lo valida la aplicación al guardar
--     (la base solo garantiza la llave única por inicio de vigencia).
--
-- `caseta_norm` es el nombre normalizado de la caseta (el mismo que `peaje_caseta`),
-- sin FK a propósito: una tarifa inferida o la lista del proveedor puede nombrar una
-- caseta que todavía no está dada de alta en el catálogo.
--
-- NO SE SIEMBRA NINGUNA TARIFA: la tabla nace vacía. Sin tarifa confirmada, todo
-- lo inferido queda «por confirmar» y todo sigue siendo candidato.
--
-- RLS: deny-all (prendida SIN políticas; solo service_role, que filtra por tenant en
-- cada consulta), igual que 0775–0778. Aditiva e idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.peaje_tarifa (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenant(id) on delete cascade,
  -- Nombre normalizado de la caseta (llave de `peaje_caseta`).
  caseta_norm    text not null,
  clase          smallint not null,
  importe        numeric(12,2) not null,
  vigente_desde  date not null,
  vigente_hasta  date,
  origen         text not null,
  confirmada     boolean not null default false,
  confirmada_por text,
  created_at     timestamptz not null default now(),
  constraint peaje_tarifa_unica unique (tenant_id, caseta_norm, clase, vigente_desde),
  constraint peaje_tarifa_forma check (
    char_length(caseta_norm) between 1 and 120
    and clase between 1 and 99
    and importe >= 0
    and (vigente_hasta is null or vigente_hasta >= vigente_desde)
    and origen in ('declarada', 'inferida', 'proveedor')
    and (confirmada_por is null or char_length(confirmada_por) between 1 and 120)
  ),
  -- Nada queda «confirmada» sin una persona responsable o sin venir del proveedor.
  constraint peaje_tarifa_confirmacion_con_responsable check (
    not confirmada or origen = 'proveedor' or confirmada_por is not null
  )
);

comment on table public.peaje_tarifa is
  '0811: tarifario por caseta y clase. Nace vacío. Una tarifa inferida o declarada solo se confirma por una persona; la del proveedor, por la carga marcada así.';
comment on column public.peaje_tarifa.origen is
  'declarada = la subió o capturó la flota; inferida = propuesta del sistema (hipótesis); proveedor = lista del proveedor de TAG.';
comment on column public.peaje_tarifa.confirmada is
  'true solo si una persona la confirmó (confirmada_por) o si la carga fue marcada origen proveedor. Sin confirmar, el cruce sigue siendo candidato.';

create index if not exists peaje_tarifa_caseta_idx on public.peaje_tarifa (tenant_id, caseta_norm, clase);

alter table public.peaje_tarifa enable row level security;
