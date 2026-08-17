-- ═══════════════════════════════════════════════════════════════════════════
-- 0127 · EL BUS DE MANDO — Fase D del plan de cierre (16-ago-2026).
--
-- Las 21 rutinas launchd de la Mac hoy reportan por WhatsApp y dejan sus
-- piezas en carpetas locales; Javier solo puede operarlas desde una terminal.
-- Este bus las sube a la base para que /admin (y el teléfono) sean la consola:
--
--   Mac ──sube──▶  bus_corrida  (qué corrió y cómo terminó)
--   Mac ──sube──▶  bus_pieza    (cada pieza en la cola local, espejada)
--   Mac ◀──lee──   bus_orden    (lo que Javier ordena desde /admin)
--
-- Quién escribe qué (y nada más):
--  · La Mac (service-role vía scripts/mejora-diaria/bus.sh) inserta corridas
--    y piezas, y RESUELVE órdenes (pendiente→tomada→hecha/fallida).
--  · /admin (service-role tras requireSuperadmin) crea órdenes y resuelve
--    piezas (pendiente→aprobada/descartada).
--  · Nadie más: RLS encendido SIN policies — anon/authenticated no tienen
--    ningún camino a estas tablas (mismo criterio que los buckets 0008/0039:
--    deny por defecto, el service-role es el único actor).
--
-- Lo que este bus NO es: no es la cola de aprobación de ENVÍOS (0117 — esa
-- tiene el CHECK enviado-solo-aprobado y mueve dinero de prospectos), ni la
-- bitácora de agentes de la nube (0102 agente_corrida). Es el espejo de las
-- rutinas LOCALES. La bandeja "Tu turno" los junta a los tres en pantalla,
-- no en el esquema.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1 · bus_corrida — cada corrida launchd, reportada por la Mac ───────────
create table if not exists public.bus_corrida (
  id          uuid primary key default gen_random_uuid(),
  -- El nombre del encargo (encargos/<rutina>.md). Misma forma que exige
  -- rutina.sh para armar la rama y el plist: minúsculas y guiones.
  rutina      text not null
              constraint bus_corrida_rutina_forma check (rutina ~ '^[a-z0-9-]{2,40}$'),
  inicio      timestamptz not null default now(),
  fin         timestamptz,
  -- La línea "VEREDICTO: …" que ya producen los encargos (o "sin veredicto",
  -- que es un dato: la rutina terminó sin decir qué hizo).
  veredicto   text,
  pr_url      text,
  exit_code   integer,
  host        text not null default 'mac-javier',
  constraint bus_corrida_fin_coherente check (fin is null or fin >= inicio)
);

-- La consulta de la bandeja es "la última corrida de cada rutina".
create index if not exists idx_bus_corrida_rutina_inicio
  on public.bus_corrida (rutina, inicio desc);

-- ── 2 · bus_pieza — el espejo de la cola local de marketing ────────────────
create table if not exists public.bus_pieza (
  id            uuid primary key default gen_random_uuid(),
  rutina        text not null,
  -- Ruta RELATIVA dentro de ~/javiercamarapp/likida-marketing-cola. Única:
  -- la Mac espeja con upsert y una carpeta es una pieza, no un historial.
  carpeta       text not null constraint bus_pieza_carpeta_unica unique,
  titulo        text not null,
  tipo          text not null
                constraint bus_pieza_tipo_dominio
                check (tipo in ('imagen', 'video', 'copy', 'articulo', 'sequence', 'reporte', 'otro')),
  -- El copy de la pieza (post.md/guion.md), para leerla desde el teléfono
  -- sin abrir la Mac. La imagen va al bucket 'bus' (media_path).
  copy_md       text,
  media_path    text,
  estado        text not null default 'pendiente'
                constraint bus_pieza_estado_dominio
                check (estado in ('pendiente', 'aprobada', 'descartada', 'publicada')),
  creado_en     timestamptz not null default now(),
  resuelto_en   timestamptz,
  resuelto_por  text,
  -- Mismo criterio que cola_resolucion_con_actor (0120): resolver deja firma.
  constraint bus_pieza_resolucion_coherente
    check ((estado = 'pendiente') = (resuelto_en is null)),
  constraint bus_pieza_resolucion_con_actor
    check ((estado = 'pendiente') = (resuelto_por is null))
);

create index if not exists idx_bus_pieza_estado on public.bus_pieza (estado, creado_en desc);

-- ── 3 · bus_orden — lo que Javier ordena; la Mac ejecuta y firma ───────────
create table if not exists public.bus_orden (
  id           uuid primary key default gen_random_uuid(),
  tipo         text not null
               constraint bus_orden_tipo_dominio
               check (tipo in ('correr_ahora', 'kill_switch_on', 'kill_switch_off', 'editar_encargo', 'nota')),
  -- A qué rutina va dirigida. Las de kill switch y las notas son globales.
  rutina       text,
  payload      jsonb not null default '{}'::jsonb,
  estado       text not null default 'pendiente'
               constraint bus_orden_estado_dominio
               check (estado in ('pendiente', 'tomada', 'hecha', 'fallida')),
  creado_en    timestamptz not null default now(),
  creado_por   text not null,
  tomada_en    timestamptz,
  resuelta_en  timestamptz,
  resultado    text,
  -- Correr y editar necesitan saber QUÉ rutina; sin ella la orden no dice nada.
  constraint bus_orden_rutina_requerida
    check (tipo not in ('correr_ahora', 'editar_encargo') or rutina is not null),
  constraint bus_orden_tomada_coherente
    check ((estado = 'pendiente') = (tomada_en is null)),
  constraint bus_orden_resuelta_coherente
    check ((estado in ('hecha', 'fallida')) = (resuelta_en is not null)),
  -- Una orden fallida dice POR QUÉ o no enseña nada (mismo espíritu que
  -- cola_rechazo_con_motivo, 0117).
  constraint bus_orden_fallo_con_motivo
    check (estado <> 'fallida' or (resultado is not null and length(trim(resultado)) > 0))
);

-- El poller de la Mac pregunta "¿hay pendientes?" cada pocos minutos; índice
-- parcial para que esa pregunta no recorra el historial.
create index if not exists idx_bus_orden_pendientes
  on public.bus_orden (creado_en) where estado = 'pendiente';

-- ── 4 · bus_rutina — el catálogo de las rutinas launchd, sembrado por la Mac ─
-- La fuente de verdad del ENCARGO sigue siendo encargos/<rutina>.md en el
-- repo (editar desde la UI pasa por PR chico — regla de Fase D); esta tabla
-- es el ESPEJO para que /admin sepa qué rutinas existen, con qué horario y
-- con qué texto corren hoy. La siembra la hace bus.sh sembrar-catalogo
-- leyendo los .plist y los encargos reales — nada aquí se escribe a mano.
create table if not exists public.bus_rutina (
  nombre         text primary key
                 constraint bus_rutina_nombre_forma check (nombre ~ '^[a-z0-9-]{2,40}$'),
  horario        text not null default '',
  descripcion    text not null default '',
  encargo_md     text not null default '',
  actualizado_en timestamptz not null default now()
);

-- ── 5 · El bucket de medios del bus (previews de piezas) ───────────────────
-- Privado y sin policies: solo el service-role sube y firma URLs (criterio
-- de la 0008 y la 0039).
insert into storage.buckets (id, name, public)
values ('bus', 'bus', false)
on conflict (id) do nothing;

-- ── 6 · RLS: encendido, sin policies — service-role es el único actor ──────
alter table public.bus_corrida enable row level security;
alter table public.bus_pieza   enable row level security;
alter table public.bus_orden   enable row level security;
alter table public.bus_rutina  enable row level security;
