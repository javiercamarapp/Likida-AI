-- ═══════════════════════════════════════════════════════════════════════════
-- 0116 — `agente_definicion`: un agente nuevo deja de ser una migración.
--
-- Fase 2 pieza 1 del blueprint (16-ago-2026). La decisión de arquitectura
-- viene del plan hacia el 90% §(b), literal: en vez de seguir ampliando el
-- CHECK de `agente_corrida.agente` cada vez que un agente pasa a vivo (ya
-- pasó dos veces: 0102 → 0105), se crea el catálogo declarativo y el CHECK
-- enumerado se cambia por una FK. Agregar un agente pasa de "migración +
-- deploy" a "una fila nueva".
--
-- LA GARANTÍA QUE NO SE PIERDE: el CHECK viejo afirmaba que solo los 7
-- agentes del producto escriben corridas. Esa garantía se MUDA, no se tira:
-- la FK garantiza que toda corrida apunta a un agente DECLARADO, y el bloque
-- de verificaciones.sql de esta migración afirma que los 7 del producto
-- existen sembrados y `vivo` — estandares-tecnicos.md §7 ("el dominio vive en
-- TRES lugares") sigue verdadero con la base como catálogo en vez de CHECK.
--
-- El catálogo de `interruptor` (0110) NO se toca aquí a propósito: los
-- agentes declarativos de nivel 1 son documento + prompt (corren fuera del
-- producto) y no necesitan kill switch hasta que exista el runner de nivel 2
-- — darles palanca hoy sería un interruptor que no corta nada.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.agente_definicion (
  -- El id ES el nombre técnico ('liquidacion', 'cazador_censo'…): es lo que
  -- `agente_corrida.agente` ya guarda, así la FK entra sin reescribir filas.
  id             text primary key
                   constraint agente_definicion_id_forma check (id ~ '^[a-z0-9_]{2,40}$'),
  nombre         text not null,
  -- Los 7 departamentos del organigrama de la compañía-agente.
  departamento   text not null
                   constraint agente_definicion_departamento_dominio check (departamento in
                     ('producto', 'leads', 'exito_cliente', 'crecimiento', 'back_office', 'ingenieria', 'direccion')),
  descripcion    text,
  -- Cómo arranca. El dominio espeja `agente_corrida.disparo` (0115) más
  -- 'webhook' (proveedores corre por correo, el WhatsApp por webhook).
  disparador     text not null default 'manual'
                   constraint agente_definicion_disparador_dominio check (disparador in
                     ('cron', 'manual', 'correo', 'whatsapp', 'webhook')),
  -- El ciclo de vida honesto del catálogo (SISTEMA-MAESTRO): diseñado (solo
  -- documento+prompt), vivo (corre en el producto), pausado, retirado.
  estado         text not null default 'disenado'
                   constraint agente_definicion_estado_dominio check (estado in
                     ('disenado', 'vivo', 'pausado', 'retirado')),
  -- El tope de gasto DECLARADO por día, USD (patrón LIKIDA_CHAT_TOPE_DIA_USD
  -- hecho por-agente). NULL = sin tope declarado, y el panel lo dice así —
  -- jamás lo pinta como "sin gasto". La MEDICIÓN por agente llega con el
  -- runner de nivel 2; declarar el techo primero es lo que permite que ese
  -- runner nazca acotado en vez de acotarse después.
  presupuesto_dia_usd numeric
                   constraint agente_definicion_presupuesto_positivo check (presupuesto_dia_usd is null or presupuesto_dia_usd > 0),
  -- Dónde vive su blueprint/prompt (nivel 1): ruta del documento, no el
  -- prompt entero — el versionado de prompts es hueco declarado del plan (d).
  prompt_ref     text,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

comment on table public.agente_definicion is
  'El catálogo declarativo de agentes (plan hacia el 90%, Fase 2 pieza 1): un agente nuevo es una FILA, no una migración. Los 7 del producto van sembrados como vivos; el resto nace disenado (documento+prompt) y solo el runner de nivel 2 los ejecutará dentro del producto. Deny-all: solo el servidor lee y escribe.';
comment on column public.agente_definicion.presupuesto_dia_usd is
  'Tope de gasto declarado por día (USD). NULL = sin tope declarado — el panel lo dice, no lo esconde. La medición por agente es del runner de nivel 2; el techo se declara desde hoy.';

-- Deny-all (mismo criterio que interruptor/prospecto, estandares §6): RLS
-- activo, cero policies — solo el service role del servidor toca esto.
alter table public.agente_definicion enable row level security;

-- ── La siembra: los 7 vivos del producto, con su verdad operativa ──────────
insert into public.agente_definicion (id, nombre, departamento, disparador, estado, descripcion) values
  ('liquidacion', 'Agente de Liquidación', 'producto', 'whatsapp', 'vivo', 'El corazón: cuadra comprobantes contra anticipo y política y cierra la liquidación en PDF. Su corrida es el cierre confirmado por el operador (0115).'),
  ('facturas',    'Agente de Facturas',    'producto', 'cron',     'vivo', 'Emisión y cola de CFDI al vuelo (cron facturar + cola).'),
  ('cobranza',    'Agente de Cobranza',    'producto', 'cron',     'vivo', 'Recuerda comprobación al chofer por tiers configurables por flota.'),
  ('conductores', 'Agente de Conductores', 'producto', 'cron',     'vivo', 'Escala el viaje que ningún chofer aceptó: insiste al chofer y avisa al jefe.'),
  ('peajes',      'Agente de Peajes',      'producto', 'manual',   'vivo', 'Concilia el estado de cuenta del TAG contra los gastos de caseta.'),
  ('proveedores', 'Agente de Proveedores', 'producto', 'correo',   'vivo', 'El buzón de facturas de proveedor: CFDI por correo a la contabilidad de la flota.'),
  ('ventas',      'Asignador de Prospectos', 'leads',  'manual',   'vivo', 'Reparte los prospectos del censo entre vendedores, equilibrando carga viva. Corre para Likida (tenant null).')
on conflict (id) do nothing;

-- ── La mudanza del CHECK a FK ──────────────────────────────────────────────
-- El orden importa: la siembra va ANTES de la FK — con la tabla vacía, toda
-- corrida existente violaría la referencia y el ALTER no entraría.
alter table public.agente_corrida
  drop constraint agente_corrida_agente_dominio;
alter table public.agente_corrida
  add constraint agente_corrida_agente_fk
    foreign key (agente) references public.agente_definicion(id);

comment on constraint agente_corrida_agente_fk on public.agente_corrida is
  'Reemplaza al CHECK enumerado (0102/0105): toda corrida apunta a un agente DECLARADO en agente_definicion. La garantía de que los 7 del producto existen vive en el bloque de verificaciones.sql de la 0116.';
