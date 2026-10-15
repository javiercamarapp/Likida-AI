-- ═══════════════════════════════════════════════════════════════════════════
-- 0785 — LIQUIDACIÓN POR CORREO: correo del operador, coordinador y
--        configuración de entrega (Agente 1, rango A1 del programa de cinco
--        agentes).
--
-- El desglose de liquidación hoy solo sale por WhatsApp (0370). El cliente pide
-- poder entregarlo también por correo: al operador, a su coordinador de
-- operaciones y a un destinatario fijo de recursos humanos. Esta migración pone
-- SOLO los datos que lo sostienen; ninguna lógica de envío vive aquí.
--
-- ── QUÉ AÑADE ───────────────────────────────────────────────────────────────
--
--   1. `operador.correo`, `operador.correo_rebotado_en`, `operador.coordinador_id`
--      (las tres NULL por defecto: un operador existente sigue igual).
--   2. `liquidacion_coordinador`: el coordinador al que se le copia el desglose
--      de varios operadores. Una fila por coordinador y flota.
--   3. `liquidacion_correo_config`: una fila por flota con el canal, el
--      remitente, los destinatarios fijos, el renglón de viaje, los conceptos
--      prohibidos y la ventana de envío.
--   4. Un trigger BEFORE UPDATE en `operador`: al anonimizar (ARCO, 0173) se
--      borran el correo, su rebote y el coordinador. El correo es un dato
--      personal nuevo; sin esto la cancelación ARCO lo dejaría vivo.
--   5. RLS: lectura de dinero (`ve_finanzas()`, como 0370); escribe solo
--      service_role.
--
-- ── POR QUÉ NO ROMPE A NADIE ────────────────────────────────────────────────
--
-- `canal` por defecto es 'whatsapp' y `activa` por defecto es false: sin fila
-- de configuración, o con la fila por defecto, el comportamiento de siempre.
-- Las columnas nuevas de `operador` son NULL. `operador.telefono` no se toca.
--
-- ── IDEMPOTENCIA ────────────────────────────────────────────────────────────
--
-- Todo es `if not exists` o va en un bloque que pregunta antes. Aplicarla dos
-- veces no cambia nada la segunda vez. Las restricciones nuevas se añaden
-- `not valid` y se validan aparte: las columnas son nuevas y están vacías, así
-- que validar es instantáneo, pero el patrón no depende de eso.
--
-- ── CÓMO SE REVIERTE (documentado, no automático) ───────────────────────────
--
--   drop trigger if exists operador_anonimiza_correo on public.operador;
--   drop function if exists public.operador_anonimiza_correo();
--   alter table public.operador
--     drop constraint if exists operador_coordinador_tenant_fkey,
--     drop constraint if exists operador_correo_forma,
--     drop column if exists coordinador_id,
--     drop column if exists correo_rebotado_en,
--     drop column if exists correo;
--   drop table if exists public.liquidacion_correo_config;
--   drop table if exists public.liquidacion_coordinador;
--
-- (Las dos tablas y las tres columnas son nuevas: nada previo depende de ellas.)
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. operador: correo, rebote y coordinador ───────────────────────────────
alter table public.operador add column if not exists correo text;
alter table public.operador add column if not exists correo_rebotado_en timestamptz;
alter table public.operador add column if not exists coordinador_id uuid;

comment on column public.operador.correo is
  '0785: correo del operador para entregarle el desglose de liquidación. NULL = no tiene. Dato personal: se borra al anonimizar (trigger operador_anonimiza_correo).';
comment on column public.operador.correo_rebotado_en is
  '0785: cuándo rebotó el último envío a `correo`. NULL = nunca rebotó. Se borra con el correo al anonimizar.';
comment on column public.operador.coordinador_id is
  '0785: coordinador de operaciones al que se le copia el desglose de este operador (liquidacion_coordinador). NULL = sin asignar; la interfaz lo dice.';

-- ── 2. liquidacion_coordinador ──────────────────────────────────────────────
create table if not exists public.liquidacion_coordinador (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenant(id) on delete cascade,
  nombre      text,
  correo      text not null,
  activo      boolean not null default true,
  created_at  timestamptz not null default now(),
  -- Destino de la FK compuesta de `operador` (regla de la 0028/0145: toda FK
  -- entre dos tablas con tenant_id lleva su compuesta, o un autenticado de la
  -- flota A cuelga su fila del padre de la flota B).
  constraint liquidacion_coordinador_id_tenant_key unique (id, tenant_id),
  constraint liquidacion_coordinador_nombre_largo check (nombre is null or char_length(nombre) <= 200),
  constraint liquidacion_coordinador_correo_forma check (
    correo ~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$' and char_length(correo) <= 254
  )
);

comment on table public.liquidacion_coordinador is
  '0785: coordinadores de operaciones a quienes se copia el desglose de liquidación. Una fila por correo y flota. Escribe solo service_role.';

-- Un mismo correo no se da de alta dos veces en la misma flota, sin importar
-- mayúsculas. Índice y no constraint: la unicidad es sobre una expresión.
create unique index if not exists liquidacion_coordinador_correo_unico
  on public.liquidacion_coordinador (tenant_id, lower(correo));

-- ── FK compuesta operador → coordinador ─────────────────────────────────────
-- Un coordinador de OTRA flota no puede colgarse de un operador. Si el
-- coordinador se borra, solo `coordinador_id` se vacía (SET NULL de una
-- columna, como la 0310): `tenant_id` del operador es NOT NULL y no puede
-- anularse.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'operador_coordinador_tenant_fkey'
      and conrelid = 'public.operador'::regclass
  ) then
    alter table public.operador
      add constraint operador_coordinador_tenant_fkey
      foreign key (coordinador_id, tenant_id)
      references public.liquidacion_coordinador (id, tenant_id)
      on delete set null (coordinador_id) not valid;
  end if;
end $$;

alter table public.operador validate constraint operador_coordinador_tenant_fkey;

create index if not exists operador_coordinador_idx
  on public.operador (coordinador_id) where coordinador_id is not null;

-- ── Forma del correo del operador ───────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'operador_correo_forma'
      and conrelid = 'public.operador'::regclass
  ) then
    alter table public.operador
      add constraint operador_correo_forma
      check (correo is null or (correo ~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$' and char_length(correo) <= 254))
      not valid;
  end if;
end $$;

alter table public.operador validate constraint operador_correo_forma;

-- ── 3. liquidacion_correo_config ────────────────────────────────────────────
-- Una fila por flota. Sin fila = canal 'whatsapp' (el lector de TypeScript
-- trata la ausencia como la configuración por defecto).
--
-- `rh_correos`: hasta 3, cada uno con forma de correo. La forma se comprueba
-- sobre la lista unida con saltos de línea: la forma de un correo excluye todo
-- espacio en blanco (incluido el salto de línea), así que un elemento no puede
-- colarse como dos y la unión no es ambigua.
create table if not exists public.liquidacion_correo_config (
  tenant_id           uuid primary key references public.tenant(id) on delete cascade,
  canal               text not null default 'whatsapp',
  activa              boolean not null default false,
  remitente_nombre    text,
  responder_a         text,
  rh_correos          text[] not null default '{}',
  archivo_correo      text,
  envia_coordinador   boolean not null default true,
  envia_rh            boolean not null default true,
  etiqueta_viaje      text not null default 'Pago de viaje',
  agrupar_viaje       boolean not null default false,
  conceptos_viaje     text[] not null default '{Sueldo,Viáticos}',
  renombres           jsonb not null default '[]'::jsonb,
  conceptos_prohibidos text[] not null default '{}',
  tipos_que_reciben   text[] not null default '{foraneo,local}',
  neto_negativo       text not null default 'retener',
  enviar_desde_hora   smallint,
  actualizado_en      timestamptz not null default now(),
  actualizado_por     text,
  constraint liquidacion_correo_config_canal_dominio check (canal in ('whatsapp', 'correo', 'ambos')),
  constraint liquidacion_correo_config_remitente_largo check (
    remitente_nombre is null or char_length(remitente_nombre) <= 120
  ),
  constraint liquidacion_correo_config_responder_a_forma check (
    responder_a is null or (responder_a ~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$' and char_length(responder_a) <= 254)
  ),
  constraint liquidacion_correo_config_rh_tope check (cardinality(rh_correos) <= 3),
  constraint liquidacion_correo_config_rh_forma check (
    array_to_string(rh_correos, E'\n') ~
      '^([^\s@]+@[^\s@]+\.[^\s@]{2,}(\n[^\s@]+@[^\s@]+\.[^\s@]{2,}){0,2})?$'
    and char_length(array_to_string(rh_correos, E'\n')) <= 764
  ),
  constraint liquidacion_correo_config_archivo_forma check (
    archivo_correo is null or (archivo_correo ~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$' and char_length(archivo_correo) <= 254)
  ),
  constraint liquidacion_correo_config_etiqueta_largo check (char_length(etiqueta_viaje) between 1 and 80),
  constraint liquidacion_correo_config_conceptos_viaje_tope check (cardinality(conceptos_viaje) <= 20),
  constraint liquidacion_correo_config_renombres_forma check (
    jsonb_typeof(renombres) = 'array' and jsonb_array_length(renombres) <= 50
  ),
  constraint liquidacion_correo_config_prohibidos_tope check (cardinality(conceptos_prohibidos) <= 50),
  constraint liquidacion_correo_config_tipos_tope check (cardinality(tipos_que_reciben) <= 10),
  constraint liquidacion_correo_config_neto_negativo_dominio check (neto_negativo in ('retener', 'enviar')),
  constraint liquidacion_correo_config_hora_rango check (
    enviar_desde_hora is null or enviar_desde_hora between 0 and 23
  )
);

comment on table public.liquidacion_correo_config is
  '0785: configuración de la entrega del desglose por correo, una fila por flota. Sin fila = canal whatsapp (cero cambio). Escribe solo service_role.';
comment on column public.liquidacion_correo_config.canal is
  'Por dónde se entrega el desglose: whatsapp (por defecto), correo o ambos.';
comment on column public.liquidacion_correo_config.activa is
  'Interruptor de la entrega por correo. false por defecto: configurar no envía nada.';
comment on column public.liquidacion_correo_config.rh_correos is
  'Destinatarios fijos de recursos humanos (hasta 3).';
comment on column public.liquidacion_correo_config.archivo_correo is
  'Buzón de archivo al que se copia todo lo enviado. NULL = sin archivo.';
comment on column public.liquidacion_correo_config.neto_negativo is
  'Qué hacer con un desglose de neto negativo: retener (no enviar, avisar) o enviar.';
comment on column public.liquidacion_correo_config.enviar_desde_hora is
  'Hora local (0-23) desde la que se puede enviar. NULL = sin ventana.';

-- ── 4. Trigger: anonimizar borra el correo ──────────────────────────────────
-- ARCO (0173) marca `anonimizado_en`. El correo, su rebote y el coordinador
-- son datos nuevos de esa persona: se vacían en el mismo UPDATE, sin depender
-- de que el ejecutor ARCO los conozca.
create or replace function public.operador_anonimiza_correo()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.anonimizado_en is not null and old.anonimizado_en is null then
    new.correo := null;
    new.coordinador_id := null;
    new.correo_rebotado_en := null;
  end if;
  return new;
end;
$$;

comment on function public.operador_anonimiza_correo() is
  '0785: al anonimizar un operador (anonimizado_en pasa de NULL a un valor) vacía correo, correo_rebotado_en y coordinador_id.';

drop trigger if exists operador_anonimiza_correo on public.operador;
create trigger operador_anonimiza_correo
  before update on public.operador
  for each row execute function public.operador_anonimiza_correo();

-- ── 5. RLS ──────────────────────────────────────────────────────────────────
-- Tabla nueva sin RLS = agujero para quien le pregunta a PostgREST con la anon
-- key. Lectura: dinero (el encargado no entra). Escritura: ninguna política,
-- solo service_role. `operador` conserva sus políticas: las columnas nuevas no
-- necesitan una propia.
alter table public.liquidacion_coordinador enable row level security;
alter table public.liquidacion_correo_config enable row level security;

drop policy if exists tenant_lee on public.liquidacion_coordinador;
create policy tenant_lee on public.liquidacion_coordinador for select
  using ((tenant_id = any(get_user_tenant_ids()) and ve_finanzas()) or is_superadmin());

drop policy if exists tenant_lee on public.liquidacion_correo_config;
create policy tenant_lee on public.liquidacion_correo_config for select
  using ((tenant_id = any(get_user_tenant_ids()) and ve_finanzas()) or is_superadmin());
