-- ═══════════════════════════════════════════════════════════════════════════
-- 0815 — PEAJES: la acción que finanzas tomó sobre cada candidato (T-A2-28).
--
--   · `peaje_candidato_accion` — UNA fila por (desglose, renglón, categoría): qué se
--     hizo con ese candidato (reclamado, descartado o justificado), con qué motivo,
--     quién y cuándo. La llave única hace idempotente el doble clic: la segunda vez
--     no inserta nada. NO toca `desglose_peaje_linea`: el cobro del proveedor no cambia.
--   · `reclamo_id` liga el candidato reclamado con su reclamo (`peaje_reclamo`); si el
--     reclamo se borra, el candidato queda reclamado sin reclamo (set null), no desaparece.
--
-- Los candidatos no se guardan (se calculan al leer); aquí solo vive la decisión humana.
-- Aditiva e idempotente; nace vacía. RLS deny-all (solo service_role, que filtra por flota).
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.peaje_candidato_accion (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenant(id) on delete cascade,
  desglose_id uuid not null,
  -- Renglón del archivo (el `indice` de la línea / del candidato).
  indice      integer not null,
  -- Una categoría de cobro (`clase_fuera_de_3_5`…) o `atipico_<señal>`.
  categoria   text not null,
  accion      text not null,
  motivo      text,
  reclamo_id  uuid,
  -- Quién (rol del panel) y cuándo: la huella para defender la decisión después.
  actor       text not null,
  creado_en   timestamptz not null default now(),
  constraint peaje_candidato_accion_unica unique (tenant_id, desglose_id, indice, categoria),
  constraint peaje_candidato_accion_dominio check (accion in ('reclamado', 'descartado', 'justificado')),
  constraint peaje_candidato_accion_forma check (
    indice >= 0 and char_length(categoria) between 1 and 60 and char_length(actor) between 1 and 80
  ),
  -- Descartar y justificar exigen motivo (3 a 300 caracteres); reclamar no lo lleva.
  constraint peaje_candidato_accion_motivo check (
    (accion = 'reclamado' and motivo is null)
    or (accion in ('descartado', 'justificado') and motivo is not null and char_length(motivo) between 3 and 300)
  ),
  -- Solo un candidato reclamado puede llevar reclamo.
  constraint peaje_candidato_accion_reclamo_solo_reclamado check (accion = 'reclamado' or reclamo_id is null),
  constraint peaje_candidato_accion_desglose_fk foreign key (desglose_id, tenant_id)
    references public.desglose_peaje (id, tenant_id) on delete cascade,
  constraint peaje_candidato_accion_reclamo_fk foreign key (reclamo_id, tenant_id)
    references public.peaje_reclamo (id, tenant_id) on delete set null (reclamo_id)
);

comment on table public.peaje_candidato_accion is
  '0815: la decisión de finanzas sobre un candidato de la revisión de cobros (reclamado, descartado con motivo, justificado con motivo), con quién y cuándo. No cambia el cobro del proveedor.';

create index if not exists peaje_candidato_accion_desglose_idx
  on public.peaje_candidato_accion (tenant_id, desglose_id);
create index if not exists peaje_candidato_accion_reclamo_idx
  on public.peaje_candidato_accion (reclamo_id) where reclamo_id is not null;

alter table public.peaje_candidato_accion enable row level security;
