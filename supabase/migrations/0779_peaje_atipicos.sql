-- ═══════════════════════════════════════════════════════════════════════════
-- 0779 — PEAJES: umbrales de los CRUCES ATÍPICOS (por flota) y sus HALLAZGOS.
--
--   · `peaje_atipico_config` — UNA fila por flota: el detector corre solo si la
--     flota lo activó (`activo`, default FALSE) y los umbrales viven en un jsonb
--     que la app valida con zod (`atipicos_config.ts`); aquí solo se exige que sea
--     un objeto. Nace VACÍA: ninguna flota tiene el detector prendido de origen.
--   · `peaje_atipico` — un hallazgo (patrón inusual a revisar, NUNCA una acusación).
--     La `llave` es determinista (misma situación = misma llave): guardar dos veces
--     el mismo desglose no duplica. `estado` avanza nuevo → avisado → revisado →
--     justificado y no retrocede (lo cuida la app); sirve para no re-avisar y para
--     calcular el % revisado.
--
-- No toca tablas de B2 (0775–0778). RLS: deny-all (prendida SIN políticas; solo
-- service_role, que filtra por tenant en cada consulta), igual que 0775–0778.
-- Aditiva e idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.peaje_atipico_config (
  tenant_id       uuid primary key references public.tenant(id) on delete cascade,
  -- Apagado de origen: la flota lo enciende cuando quiere recibir los avisos.
  activo          boolean not null default false,
  -- Umbrales de las tres reglas (forma validada por la app).
  umbrales        jsonb not null default '{}'::jsonb,
  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now(),
  constraint peaje_atipico_config_umbrales_objeto check (jsonb_typeof(umbrales) = 'object')
);

comment on table public.peaje_atipico_config is
  '0779: configuración del detector de cruces atípicos, una fila por flota. activo=false de origen; los umbrales los valida la app.';

create table if not exists public.peaje_atipico (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenant(id) on delete cascade,
  -- Determinista (regla + unidad + caseta(s) + primer cruce): idempotencia al guardar.
  llave            text not null,
  desglose_id      uuid,
  unidad_id        uuid,
  -- Unidad tal como la declara el archivo del proveedor.
  unidad_archivo   text not null,
  regla            text not null,
  detalle          jsonb not null default '{}'::jsonb,
  monto            numeric(14,2) not null default 0,
  estado           text not null default 'nuevo',
  avisado_en       timestamptz,
  revisado_en      timestamptz,
  revisado_por     text,
  nota             text,
  creado_en        timestamptz not null default now(),
  actualizado_en   timestamptz not null default now(),
  constraint peaje_atipico_llave_unica unique (tenant_id, llave),
  constraint peaje_atipico_regla_valida check (regla in ('repeticion_caseta', 'ida_y_vuelta_madrugada', 'secuencia_imposible')),
  constraint peaje_atipico_estado_valido check (estado in ('nuevo', 'avisado', 'revisado', 'justificado')),
  constraint peaje_atipico_forma check (
    char_length(llave) between 1 and 300
    and char_length(unidad_archivo) between 1 and 40
    and jsonb_typeof(detalle) = 'object'
    and monto >= 0
    and (nota is null or char_length(nota) <= 300)
    and (revisado_por is null or char_length(revisado_por) <= 120)
  ),
  -- Quien revisó y cuándo van juntos; revisado/justificado exigen ambos.
  constraint peaje_atipico_revision_coherente check (
    (revisado_en is null) = (revisado_por is null)
    and (estado not in ('revisado', 'justificado') or revisado_en is not null)
  ),
  -- Misma flota: el hallazgo cuelga de un desglose / unidad de esa flota.
  constraint peaje_atipico_desglose_fk foreign key (desglose_id, tenant_id)
    references public.desglose_peaje (id, tenant_id) on delete cascade,
  constraint peaje_atipico_unidad_fk foreign key (unidad_id, tenant_id)
    references public.unidad (id, tenant_id) on delete cascade
);

comment on table public.peaje_atipico is
  '0779: hallazgos del detector de cruces atípicos (patrón inusual a revisar, no acusación). llave única por flota; el estado no retrocede.';

create index if not exists peaje_atipico_estado_idx on public.peaje_atipico (tenant_id, estado);
create index if not exists peaje_atipico_desglose_idx on public.peaje_atipico (tenant_id, desglose_id) where desglose_id is not null;

alter table public.peaje_atipico_config enable row level security;
alter table public.peaje_atipico enable row level security;
