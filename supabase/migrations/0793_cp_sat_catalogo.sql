-- ═══════════════════════════════════════════════════════════════════════════
-- 0793 — Carta Porte: catálogos SAT en una sola tabla (T-A3-23).
--
-- Qué es: la validación de la carta porte contra el SAT (clave de producto, unidad, embalaje, fracción
-- arancelaria, material peligroso, país, código postal, colonia/localidad/municipio) necesita los catálogos
-- oficiales. Hoy solo viven embebidos `c_Estado` y 11 unidades. Esta tabla los guarda todos, uno por fila,
-- identificados por (catalogo, clave): catalogo = nombre oficial, p. ej. 'c_ClaveProdServCP'.
--
-- SIN DATOS: los catálogos son públicos pero enormes; no van en migración ni en el repo. Se cargan con
-- scripts/importar-catalogo-sat.ts a partir del archivo oficial del SAT o de la exportación del TMS.
-- Tabla vacía = la validación (T-A3-24) degrada a aviso; nunca bloquea a todos.
--
-- Reglas:
--   · Global (no por flota): los catálogos del SAT son iguales para todos. Deny-all + service_role (igual
--     que 0420/0790/0792): `anon` y `authenticated` no leen; el servidor consulta con service_role.
--   · extra jsonb: columnas adicionales del catálogo oficial (p. ej. estado/municipio de un código postal).
--   · Vigencia: vigente_desde / vigente_hasta (nulos = sin límite); hasta no puede ser anterior a desde.
--   · No toca ninguna tabla, función ni constraint anterior. Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.cp_sat_catalogo (
  catalogo       text not null,
  clave          text not null,
  descripcion    text not null default '',
  extra          jsonb not null default '{}'::jsonb,
  vigente_desde  date,
  vigente_hasta  date,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint cp_sat_catalogo_pkey primary key (catalogo, clave),
  constraint cp_sat_catalogo_catalogo_forma check (catalogo ~ '^c_[A-Za-z0-9_]{1,60}$'),
  constraint cp_sat_catalogo_clave_largo check (char_length(btrim(clave)) between 1 and 40),
  constraint cp_sat_catalogo_descripcion_largo check (char_length(descripcion) <= 1000),
  constraint cp_sat_catalogo_extra_objeto check (jsonb_typeof(extra) = 'object'),
  constraint cp_sat_catalogo_vigencia_orden check (vigente_hasta is null or vigente_desde is null or vigente_hasta >= vigente_desde)
);
comment on table public.cp_sat_catalogo is
  'Catálogos SAT de Carta Porte (0793), una fila por (catalogo, clave). Vacía al crearse; se carga con scripts/importar-catalogo-sat.ts desde un archivo local.';

-- El índice por (catalogo, clave) es la propia llave primaria.

alter table public.cp_sat_catalogo enable row level security;
revoke all on public.cp_sat_catalogo from public, anon, authenticated;
grant select, insert, update, delete on public.cp_sat_catalogo to service_role;
