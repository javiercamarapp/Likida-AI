-- ═══════════════════════════════════════════════════════════════════════════
-- 0778 — PEAJES: excepciones por UNIDAD de «caseta que no debe cruzarse» y
--         cruces JUSTIFICADOS (revisados con motivo).
--
--   · `peaje_caseta_excepcion_unidad` — unidades a las que NO se les marca el cruce
--     de una caseta prohibida (p. ej. una camioneta de rescates que sí puede pasar).
--     Cuelga de `peaje_caseta_nombre` (misma flota) por el nombre normalizado.
--     Nace VACÍA: no viene ninguna excepción precargada.
--   · `peaje_cruce_justificado` — un cruce concreto (renglón `indice` de un desglose)
--     que alguien revisó y explicó. NO borra el candidato: la revisión se calcula al
--     leer y el cruce sigue en el historial, rotulado como justificado con su motivo.
--
-- RLS: deny-all (prendida SIN políticas; solo service_role, que filtra por tenant en
-- cada consulta), igual que 0775–0777. Aditiva e idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.peaje_caseta_excepcion_unidad (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenant(id) on delete cascade,
  -- Nombre normalizado de la caseta (llave de `peaje_caseta_nombre`).
  caseta_norm   text not null,
  -- Unidad normalizada (minúsculas, sin signos), tal como la declara el archivo.
  unidad_norm   text not null,
  unidad        text not null,
  nota          text,
  creado_en     timestamptz not null default now(),
  constraint peaje_caseta_excepcion_unidad_unica unique (tenant_id, caseta_norm, unidad_norm),
  constraint peaje_caseta_excepcion_unidad_forma check (
    char_length(unidad_norm) between 1 and 40 and char_length(unidad) between 1 and 40
    and (nota is null or char_length(nota) <= 300)
  ),
  -- Misma flota: la excepción cuelga de una caseta del catálogo de esa flota.
  constraint peaje_caseta_excepcion_unidad_caseta_fk foreign key (tenant_id, caseta_norm)
    references public.peaje_caseta_nombre (tenant_id, nombre_norm) on delete cascade
);

comment on table public.peaje_caseta_excepcion_unidad is
  '0778: unidades a las que no se les marca el cruce de una caseta que no debe cruzarse. Nace vacía.';

create table if not exists public.peaje_cruce_justificado (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenant(id) on delete cascade,
  desglose_id   uuid not null,
  -- Renglón del archivo (el `indice` de la línea / del candidato).
  indice        integer not null,
  categoria     text not null default 'caseta_no_debe_cruzarse',
  motivo        text not null,
  creado_en     timestamptz not null default now(),
  constraint peaje_cruce_justificado_unico unique (tenant_id, desglose_id, indice, categoria),
  constraint peaje_cruce_justificado_forma check (
    indice >= 0 and char_length(motivo) between 3 and 300 and char_length(categoria) <= 60
  ),
  constraint peaje_cruce_justificado_desglose_fk foreign key (desglose_id, tenant_id)
    references public.desglose_peaje (id, tenant_id) on delete cascade
);

comment on table public.peaje_cruce_justificado is
  '0778: cruces revisados con motivo. El candidato no desaparece: se rotula como justificado.';

alter table public.peaje_caseta_excepcion_unidad enable row level security;
alter table public.peaje_cruce_justificado enable row level security;
