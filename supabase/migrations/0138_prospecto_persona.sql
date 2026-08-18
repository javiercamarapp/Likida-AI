-- ═══════════════════════════════════════════════════════════════════════════
-- LAS PERSONAS DETRÁS DEL PROSPECTO (18-ago-2026).
--
-- `prospecto` guarda UN contacto (`contacto_nombre`, `correo`, `telefono`) y
-- una empresa tiene varias: el director general que decide, el contralor que
-- sufre la liquidación, el de sistemas que la conecta. Investigar una flota y
-- encontrar tres personas no tenía dónde aterrizar — se apilaba en `notas`,
-- que es prosa que nadie puede filtrar ni deduplicar.
--
-- `prospecto_contacto` (0118) NO es esto: esa es la BITÁCORA de toques —qué se
-- le mandó y cuándo—. Esta es la libreta de a quién.
--
-- ── `origen` Y `confianza` SON EL CORAZÓN DE LA TABLA, no metadatos ─────────
-- Estos datos los va a llenar un agente investigando en la web, y un agente
-- que no encuentra un correo PUEDE DEDUCIRLO del patrón de la empresa
-- (nombre.apellido@dominio). Esa deducción a veces acierta y a veces rebota.
--
-- Un correo inventado que se guarda igual que uno verificado tiene dos costos
-- que no se ven hasta que es tarde: rebota y quema la reputación del dominio
-- de Likida —lo que degrada la entregabilidad de TODO lo demás, incluida la
-- factura de un cliente real—, y le hace creer a quien lee el tablero que
-- tiene una vía de contacto que no existe.
--
-- Por eso `origen` es obligatorio y `inferido` es uno de sus valores: separar
-- "lo leí en su sitio" de "lo adiviné" es la única forma de mandar primero lo
-- verificado y tratar lo demás como lo que es. Es la misma regla que gobierna
-- el resto del producto: nunca inventar una cifra, y si se estima, decirlo.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.prospecto_persona (
  id           uuid primary key default gen_random_uuid(),
  prospecto_id uuid not null references public.prospecto(id) on delete cascade,
  nombre       text not null
                 constraint prospecto_persona_nombre_no_vacio check (length(btrim(nombre)) > 0),
  -- El puesto tal como se publicó. Es lo que decide a quién se le escribe
  -- primero: al que firma el cheque o al que sufre el problema.
  puesto       text,
  correo       text,
  telefono     text,
  linkedin     text,
  -- De dónde salió el dato. `inferido` = deducido de un patrón, NO verificado.
  origen       text not null
                 constraint prospecto_persona_origen_dominio check (origen in
                   ('sitio_empresa', 'linkedin', 'directorio', 'denue', 'prensa', 'inferido', 'otro')),
  -- Qué tan sólido es. Un `inferido` no puede declararse 'alta': si se pudiera,
  -- la columna `origen` no serviría de nada y volveríamos a mezclar.
  confianza    text not null default 'media'
                 constraint prospecto_persona_confianza_dominio check (confianza in ('alta', 'media', 'baja')),
  constraint prospecto_persona_inferido_no_es_alta
    check (not (origen = 'inferido' and confianza = 'alta')),
  -- Dónde se leyó, para poder volver a comprobarlo sin repetir la búsqueda.
  evidencia    text,
  notas        text,
  created_at   timestamptz not null default now()
);

create index if not exists idx_prospecto_persona_prospecto
  on public.prospecto_persona (prospecto_id);

-- La misma persona encontrada dos veces no son dos personas. Se deduplica por
-- correo, que es lo único verdaderamente único; el nombre se repite entre
-- empresas y hasta dentro de una.
create unique index if not exists idx_prospecto_persona_correo_unico
  on public.prospecto_persona (prospecto_id, lower(correo)) where correo is not null;

-- ── RLS ────────────────────────────────────────────────────────────────────
-- Mismo criterio que `prospecto` (0105): datos de prospección son del negocio,
-- no del cliente. Ningún tenant los ve; el service role escribe.
alter table public.prospecto_persona enable row level security;

drop policy if exists prospecto_persona_lee_superadmin on public.prospecto_persona;
create policy prospecto_persona_lee_superadmin on public.prospecto_persona
  for select using (
    exists (select 1 from public.app_user u where u.id = auth.uid() and u.rol = 'superadmin')
  );
