-- ═══════════════════════════════════════════════════════════════════════════
-- 0266 — EL ESTUDIO DE MARKETING (Fase D, orden del 16-ago): la CAPA VISUAL
-- que le faltaba a `crecimiento.ts` (0230), no un motor nuevo.
--
-- `crecimiento.ts` YA fabrica piezas (guion_video, carrusel_noticias,
-- promo_diaria, encargo_visual, encargo_video_demo, encargo_video_marketing)
-- hacia `cola_aprobacion` (0117) — eso NO se toca. Lo que faltaba, y esta
-- migración lo da de alta:
--
--   1. `marketing_hook` — el banco de hooks: Javier sube un video de
--      referencia que le gustó y anota QUÉ hook usa. Hoy esa anotación es
--      manual (el servidor no tiene whisper ni los videos de Javier —
--      crecimiento.ts lo dice en su propio cuerpo, ver §4 "GUIONES"); la
--      columna `hook_texto` es lo que Javier escribe, no lo que un modelo
--      transcribe. El día que exista transcripción real, esta tabla es
--      donde aterriza sin cambiar de forma.
--   2. `marketing_referencia` — personajes y lugares: fotos con nombre y
--      etiqueta que alimentan la cadena de producción (MARCA.md §6:
--      character sheets → lugares sheets → sequence sheets → animación).
--      El principio del dueño, dictado el 16-ago: "entre más le das, más
--      entienden" — ambas tablas son SIN TENANT, de la empresa y no de una
--      flota (mismo criterio que `aliado_objetivo`, 0230), porque alimentan
--      la memoria compartida de TODOS los agentes de marketing, no un silo.
--   3. Dos buckets de Storage, PRIVADOS los dos — ninguno de los dos es
--      contenido para servir al público; ver el porqué de cada tamaño abajo.
--
-- LO QUE ESTA MIGRACIÓN NO HACE: no genera ni una imagen ni un video (ese
-- pipeline de Higgsfield/Canva sigue siendo el flujo LOCAL de Javier — ver el
-- TODO explícito en `src/lib/likida/marketing/estudio.ts`), no inventa un
-- mecanismo de publicación nuevo (publicar sigue siendo `aprobarPieza` de
-- `agentes/cola.ts`, sin tocar), y no crea ningún agente nuevo en
-- `agente_definicion`: estas dos tablas son INSUMO subido por una persona,
-- no la salida de un agente.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. El banco de hooks ────────────────────────────────────────────────────

create table if not exists public.marketing_hook (
  id             uuid primary key default gen_random_uuid(),
  -- La ruta DENTRO del bucket `marketing_hooks_video` (privado): se guarda la
  -- ruta, no una URL — el mismo criterio que `comprobantes`/`almacen.ts`,
  -- porque una URL firmada expira y persistirla sería guardar una mentira con
  -- fecha de caducidad.
  video_ruta     text not null
                   constraint marketing_hook_ruta_no_vacia check (length(btrim(video_ruta)) > 0),
  -- El hook que ESE video usa, anotado por Javier (o por transcripción real el
  -- día que exista — ver el comentario de arriba). Texto libre: un hook no es
  -- un enum, es prosa.
  hook_texto     text not null
                   constraint marketing_hook_texto_no_vacio check (length(btrim(hook_texto)) > 0),
  creado_por     uuid references public.app_user(id) on delete set null,
  creado_en      timestamptz not null default now()
);

comment on table public.marketing_hook is
  'El banco de hooks del estudio de marketing (0266, Fase D): un video de referencia que Javier subió + el hook que anotó a mano. Sin tenant: es insumo de la empresa para TODOS los agentes de marketing, no de una flota. Deny-all — solo el servidor.';
comment on column public.marketing_hook.video_ruta is
  'Ruta dentro del bucket privado `marketing_hooks_video`, no una URL: las URLs firmadas expiran, la ruta no.';
comment on column public.marketing_hook.hook_texto is
  'La anotación de Javier sobre qué hook usa el video (ej. "pregunta del gremio", "trampa aritmética"). Manual hoy — el servidor no tiene whisper ni los videos originales (crecimiento.ts §4 lo declara). El día que haya transcripción real, esta columna es donde aterriza.';

alter table public.marketing_hook enable row level security;
revoke all on table public.marketing_hook from public, anon, authenticated;
grant select, insert, update, delete on table public.marketing_hook to service_role;

create index if not exists marketing_hook_creado_en_idx
  on public.marketing_hook (creado_en desc);

-- ── 2. Personajes y lugares ─────────────────────────────────────────────────

create table if not exists public.marketing_referencia (
  id             uuid primary key default gen_random_uuid(),
  tipo           text not null
                   constraint marketing_referencia_tipo_dominio check (tipo in ('personaje', 'lugar')),
  nombre         text not null
                   constraint marketing_referencia_nombre_no_vacio check (length(btrim(nombre)) > 0),
  -- Etiqueta libre opcional (ej. "chofer, 40s, chaleco naranja" o "patio de
  -- maniobras, luz de tarde"): el contexto que el pipeline de sheets usa tal
  -- cual, sin inventar una descripción que Javier no dio.
  etiqueta       text,
  -- Ruta DENTRO del bucket `marketing_referencias` (privado). Mismo criterio
  -- que `video_ruta`: se guarda la ruta, se firma al leer.
  foto_ruta      text not null
                   constraint marketing_referencia_foto_no_vacia check (length(btrim(foto_ruta)) > 0),
  creado_por     uuid references public.app_user(id) on delete set null,
  creado_en      timestamptz not null default now()
);

comment on table public.marketing_referencia is
  'Personajes y lugares del estudio de marketing (0266, Fase D): la foto de referencia que arranca la cadena de producción (MARCA.md §6 — el pipeline usa estas hojas tal cual y produce solo lo que falta). Sin tenant: de la empresa, no de una flota. Deny-all.';
comment on column public.marketing_referencia.etiqueta is
  'Contexto libre que Javier escribe sobre la referencia (edad, vestuario, hora del día…) — nunca inventado por el pipeline.';

alter table public.marketing_referencia enable row level security;
revoke all on table public.marketing_referencia from public, anon, authenticated;
grant select, insert, update, delete on table public.marketing_referencia to service_role;

create index if not exists marketing_referencia_tipo_idx
  on public.marketing_referencia (tipo, creado_en desc);

-- ── 3. Los dos buckets, privados los dos ────────────────────────────────────
--
-- `marketing_hooks_video`: un video de cámara de unos segundos a un par de
-- minutos pesa fácilmente decenas de MB — muy por encima de lo que un Server
-- Action puede recibir en este proyecto (sin `experimental.serverActions.
-- bodySizeLimit` propio, y el límite duro de payload de una función de Vercel
-- es ~4.5 MB de cualquier forma). Por eso ESTE bucket, y sólo este, se sube
-- por URL firmada de ESCRITURA (`createSignedUploadUrl`, generada por el
-- servidor con service_role en `estudio.ts`): el navegador habla directo con
-- Storage, sin pasar el archivo por la función. 200 MB es un techo generoso
-- para un clip de referencia; el plan de Supabase puede topar más abajo, y
-- eso lo decide la plataforma, no esta migración.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('marketing_hooks_video', 'marketing_hooks_video', false, 200 * 1024 * 1024, array['video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v'])
on conflict (id) do nothing;

-- `marketing_referencias`: fotos de personaje/lugar — del tamaño de un avatar,
-- no de un video. Sube por el mismo camino directo que `avatares`
-- (FormData a través de un Server Action), así que el tope tiene que caber
-- cómodo bajo el límite de payload de la función; 4 MB dado con el mismo
-- margen que ya usa `avatares` (2 MB) mas holgura para una foto de cámara sin
-- comprimir.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('marketing_referencias', 'marketing_referencias', false, 4 * 1024 * 1024, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- Sin policies en `storage.objects` para ninguno de los dos — mismo criterio
-- que `comprobantes` (0039): RLS de storage deniega a anon/authenticated por
-- defecto, y el service-role (este servidor) es quien firma tanto la subida
-- (`createSignedUploadUrl`, bucket de video) como la lectura
-- (`createSignedUrl`, los dos buckets). Un token firmado por el servidor
-- autoriza esa subida puntual sin necesitar una policy — no es una puerta
-- abierta a `authenticated`.
