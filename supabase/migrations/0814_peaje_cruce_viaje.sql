-- ═══════════════════════════════════════════════════════════════════════════
-- 0814 — PEAJES: el VÍNCULO cruce → viaje, guardado aparte (T-A2-21).
--
-- (La ficha lo nombraba «0778»; esa numeración ya está usada. Va en el bloque
-- 0810–0819 asignado a A2.)
--
--   · `peaje_cruce_viaje` — UNA fila por línea del desglose: a qué viaje se ligó
--     (o por qué no: ambiguo, sin viaje, sin unidad, conflicto) y por qué vía
--     (Icident o unidad+ventana). Recalculable: la clave (tenant_id, linea_id)
--     es única y el cálculo la sobrescribe, nunca la duplica.
--   · `peaje_vinculo_config` — el interruptor POR FLOTA, apagado de origen: el
--     vínculo depende de que los viajes estén cargados; sin viajes todo saldría
--     «sin_viaje» y eso sería ruido, no un hallazgo.
--
-- NO se usa `desglose_peaje_linea.viaje_id`: ahí significa «viaje del gasto que
-- respalda la línea» (0106) y `bitacora_conciliada` lo lee así. Mezclar las dos
-- semánticas rompería la conciliación contra tickets (que conserva su viaje_id).
--
-- `viaje_id` es nullable: borrar el viaje deja `viaje_id` en NULL y el vínculo
-- queda con su estado (el siguiente recálculo lo corrige). `on delete set null
-- (viaje_id)` solo anula esa columna, no `tenant_id`.
-- RLS: deny-all (prendida SIN políticas; solo service_role, que filtra por flota).
-- Aditiva e idempotente; nace vacía y apagada.
-- ═══════════════════════════════════════════════════════════════════════════

-- Destino de la FK compuesta (mismo patrón que 0028/0145: `id` ya es PK; el índice
-- extra es el precio de poder apuntarle con (id, tenant_id)).
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'desglose_peaje_linea_id_tenant_key'
                   and conrelid = 'public.desglose_peaje_linea'::regclass) then
    alter table public.desglose_peaje_linea
      add constraint desglose_peaje_linea_id_tenant_key unique (id, tenant_id);
  end if;
end $$;

create table if not exists public.peaje_cruce_viaje (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenant(id) on delete cascade,
  -- Denormalizado para leer «los vínculos de este desglose» sin unir.
  desglose_id   uuid not null,
  linea_id      uuid not null,
  viaje_id      uuid,
  estado        text not null,
  via           text not null,
  -- Viajes que cumplían la ventana (≥2 con `ambiguo`; el que contradijo con `conflicto`).
  candidatos    jsonb not null default '[]'::jsonb,
  icident       text,
  motivo        text,
  calculado_en  timestamptz not null default now(),
  constraint peaje_cruce_viaje_unico unique (tenant_id, linea_id),
  constraint peaje_cruce_viaje_estado_valido
    check (estado in ('ligado', 'ambiguo', 'sin_viaje', 'sin_unidad', 'conflicto')),
  constraint peaje_cruce_viaje_via_valida check (via in ('icident', 'unidad_ventana')),
  -- Solo un `ligado` lleva viaje. (Al revés no se exige: borrar el viaje anula viaje_id.)
  constraint peaje_cruce_viaje_viaje_solo_ligado check (estado = 'ligado' or viaje_id is null),
  constraint peaje_cruce_viaje_candidatos_lista check (jsonb_typeof(candidatos) = 'array'),
  constraint peaje_cruce_viaje_motivo_corto check (motivo is null or char_length(motivo) <= 120),
  constraint peaje_cruce_viaje_linea_fk foreign key (linea_id, tenant_id)
    references public.desglose_peaje_linea (id, tenant_id) on delete cascade,
  constraint peaje_cruce_viaje_desglose_fk foreign key (desglose_id, tenant_id)
    references public.desglose_peaje (id, tenant_id) on delete cascade,
  constraint peaje_cruce_viaje_viaje_fk foreign key (viaje_id, tenant_id)
    references public.viaje (id, tenant_id) on delete set null (viaje_id)
);

create index if not exists peaje_cruce_viaje_desglose_idx
  on public.peaje_cruce_viaje (tenant_id, desglose_id);
create index if not exists peaje_cruce_viaje_viaje_idx
  on public.peaje_cruce_viaje (tenant_id, viaje_id) where viaje_id is not null;

comment on table public.peaje_cruce_viaje is
  '0814: vínculo cruce→viaje, uno por línea del desglose, recalculable. NO es desglose_peaje_linea.viaje_id (viaje del gasto que respalda, 0106). Nace vacía.';

create table if not exists public.peaje_vinculo_config (
  tenant_id       uuid primary key references public.tenant(id) on delete cascade,
  -- Apagado de origen: depende de que la flota ya tenga viajes cargados.
  activo          boolean not null default false,
  actualizado_en  timestamptz not null default now()
);

comment on table public.peaje_vinculo_config is
  '0814: interruptor por flota del cálculo cruce→viaje. activo=false de origen; sin fila = apagado.';

alter table public.peaje_cruce_viaje enable row level security;
alter table public.peaje_vinculo_config enable row level security;
