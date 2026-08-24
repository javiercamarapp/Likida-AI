-- ═══════════════════════════════════════════════════════════════════════════
-- 0185 — EL PANEL DE QA DEJA DE VIVIR EN ARCHIVOS (Fase B, pieza 1)
--
-- El diseño (00-PANEL-DE-QA.md §4) siempre pidió estas tres tablas. La Fase A
-- no las creó por una razón concreta y escrita en `qa-tipos.ts`: "las
-- migraciones están CONGELADAS (0115-0125 sin aplicar, esperando el token de
-- Supabase)". Ese motivo caducó — vamos en la 0173 y el MCP aplica migraciones
-- desde el 20-ago. El atajo (estado como JSON en Storage) se queda sin excusa.
--
-- POR QUÉ IMPORTA, más allá de la limpieza. El ledger en archivos tiene dos
-- agujeros que ningún cuidado en TypeScript cierra:
--
--   1. EL DEDUP DEL BANCO ES UN READ-MODIFY-WRITE. `subirFotos` lee
--      `banco/manifiesto.json`, busca el hash, y reescribe el archivo entero.
--      Dos subidas concurrentes leen el mismo manifiesto y la segunda pisa a
--      la primera: la foto se pierde del índice aunque sus bytes estén en el
--      bucket. Un `unique` sobre el hash lo vuelve imposible por construcción.
--
--   2. EL GASTO DEL DÍA SE CALCULA DESCARGANDO 200 JSON. `gastoHoyUsd` lista
--      la carpeta y abre corrida por corrida para sumar `costoUsdTotal` — y
--      ese número es el CANDADO del tope diario de $5 (TOPE_DIA_USD). Un
--      candado de dinero que depende de 200 descargas es un candado que falla
--      abierto el día que Storage vaya lento.
--
-- QUÉ NO SE MUEVE. Los BYTES siguen en Storage: `qa-fotos` guarda las
-- imágenes y `qa-evidencia` los PDF del cierre. Aquí vive el ÍNDICE y el
-- estado, no el binario — el mismo reparto que `gasto.imagen_url` usa desde la
-- 0039.
--
-- `carril` nace con 'completo' permitido aunque hoy nadie lo escriba: la Fase C
-- (GitHub Actions) no necesita otra migración para existir, solo un valor.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── El banco de fotos ──────────────────────────────────────────────────────
create table if not exists public.qa_foto (
  id           uuid primary key default gen_random_uuid(),
  -- sha256 de los BYTES, el mismo digest que `hashImagen` de producción. El
  -- UNIQUE es la garantía entera de esta tabla.
  hash         text not null unique,
  path         text not null,
  mime         text not null,
  etiqueta     text not null,
  bytes        integer not null check (bytes > 0),
  subido_en    timestamptz not null default now(),
  -- EL ORÁCULO HUMANO (Fase B, pieza 2): lo que una persona confirmó que este
  -- ticket dice de verdad. NULL = nadie lo ha confirmado, y eso NO es "está
  -- bien": es "no se sabe". Ningún veredicto puede leerlo como aprobación.
  ocr_esperado    jsonb,
  confirmado_por  uuid references public.app_user(id) on delete set null,
  confirmado_en   timestamptz,
  -- Sin confirmador no hay confirmación: un `ocr_esperado` sin firma es un
  -- dato que nadie respalda, y ese es exactamente el caso que el oráculo
  -- humano existe para impedir.
  constraint qa_foto_confirmacion_completa check (
    (ocr_esperado is null and confirmado_en is null)
    or (ocr_esperado is not null and confirmado_en is not null)
  )
);

comment on table public.qa_foto is
  'El banco de fotos del panel de QA (/admin/qa). Los BYTES viven en el bucket qa-fotos; aquí vive el índice. `hash` es UNIQUE: el dedup del banco es una garantía de la base, no un read-modify-write sobre un JSON.';
comment on column public.qa_foto.ocr_esperado is
  'Lo que una PERSONA confirmó que el ticket dice (oráculo humano). NULL = sin confirmar, que no es lo mismo que correcto. Exige confirmado_en por CHECK.';

-- ── Las corridas ───────────────────────────────────────────────────────────
create table if not exists public.qa_corrida (
  id             uuid primary key default gen_random_uuid(),
  escenario      text not null,
  carril         text not null default 'rapido' check (carril in ('rapido', 'completo')),
  parametros     jsonb not null,
  estado         text not null check (estado in ('pendiente','corriendo','ok','parcial','fallo','abortada')),
  -- Por qué está como está. Un estado sin motivo es un fallo en silencio, y el
  -- panel entero se diseñó para no tener ninguno.
  motivo         text,
  tenant_id      uuid references public.tenant(id) on delete set null,
  tenant_nombre  text not null,
  creada_en      timestamptz not null default now(),
  inicio         timestamptz,
  fin            timestamptz,
  -- Última señal de vida del motor. La pantalla dice "sin señales desde hace
  -- Ns" cuando el proceso muere sin poder escribir su aborto: fallar cerrado
  -- en la LECTURA, no confiar en que el escritor alcanzó a avisar.
  latido_en      timestamptz not null default now(),
  costo_usd_total numeric(12,4) not null default 0 check (costo_usd_total >= 0),
  veredicto      jsonb,
  turnos         jsonb not null default '[]'::jsonb,
  pdfs           text[] not null default '{}'::text[],
  limpieza       text
);

comment on table public.qa_corrida is
  'Una corrida del panel de QA. Sustituye a corridas/<id>/corrida.json del bucket qa-evidencia (Fase A). `carril` admite "completo" desde ya: la Fase C (GitHub Actions) no necesita otra migración.';
comment on column public.qa_corrida.costo_usd_total is
  'Costo REAL leído de llm_costo, nunca una estimación. Es la base del tope diario de $5 (TOPE_DIA_USD): por eso se suma en SQL y no descargando archivos.';

-- El tope diario se mide por día calendario de MÉXICO, no UTC — el índice se
-- construye sobre la misma expresión que la consulta usa, o no lo usa.
create index if not exists qa_corrida_dia_mx_idx
  on public.qa_corrida (((creada_en at time zone 'America/Mexico_City')::date));

create index if not exists qa_corrida_creada_idx
  on public.qa_corrida (creada_en desc);

-- ── Los pasos de cada corrida ──────────────────────────────────────────────
create table if not exists public.qa_corrida_paso (
  corrida_id  uuid not null references public.qa_corrida(id) on delete cascade,
  n           integer not null,
  nombre      text not null,
  estado      text not null check (estado in ('pendiente','corriendo','ok','warn','bad')),
  costo_usd   numeric(12,4) not null default 0 check (costo_usd >= 0),
  detalle     text,
  inicio      timestamptz,
  fin         timestamptz,
  -- El motor reescribe cada paso varias veces (pendiente → corriendo → ok).
  -- Con la PK compuesta ese upsert no puede duplicar un paso, que es
  -- justamente lo que el JSON no podía prometer.
  primary key (corrida_id, n)
);

comment on table public.qa_corrida_paso is
  'Los pasos de una corrida de QA, uno por número. La PK (corrida_id, n) hace imposible duplicar un paso: el motor lo reescribe en cada transición y el upsert cae siempre en la misma fila.';

-- ── RLS: deny-all a propósito ──────────────────────────────────────────────
-- Mismo patrón que tenant_perfil_version (0169), agente_cobranza_config (0089)
-- y prospecto_contacto (0118): esto es superficie de superadmin, solo
-- supabaseAdmin() (server, bypassa RLS) la toca. Sin policies, RLS deniega a
-- anon y authenticated — y una foto de ticket real trae RFC y domicilio
-- (LFPDPPP art. 2 fr. VI), así que el default abierto no es una opción.
alter table public.qa_foto         enable row level security;
alter table public.qa_corrida      enable row level security;
alter table public.qa_corrida_paso enable row level security;
