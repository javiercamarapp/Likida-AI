-- ═══════════════════════════════════════════════════════════════════════════
-- 0670 — Carta Porte: un Excel con N embarques se parte en N documentos hijos (la tabla y los dominios).
--
-- Hasta aquí un Excel/CSV con varios embarques se leía por el PRIMERO y se avisaba «sube el resto por separado»: los
-- demás embarques se perdían en silencio si nadie leía el aviso. Ahora el archivo se PARTE: el original queda como
-- documento `dividido` (constancia, sin revisión propia) y cada embarque nace como su propio documento `recibido`
-- (con su archivo derivado), que sigue el camino de siempre: extracción, revisión, aprobación, viaje.
--
--   · `cp_documento_embarque` es la ficha de linaje de cada hijo: de qué documento nació (`padre_id`), la HUELLA BASE
--     común a todos los hermanos (el sha256 del archivo original), su lugar (`indice` de `total`) y el folio con el que
--     se agrupó (`clave`). Es una tabla APARTE y no columnas de `cp_documento` a propósito: el código de lectura de la
--     bandeja no depende de ella, así que una base SIN esta migración sigue funcionando (solo no parte los archivos).
--   · `cp_documento.estado` admite 'dividido': el documento original ya no se extrae ni se revisa; nadie lo reclama
--     (`cp_documento_reclamar` y `cp_documentos_pendientes` solo toman recibido / procesando vencido / fallido).
--   · `cp_documento_evento.tipo` admite 'dividido'. La lista se enumera ENTERA (la de la 0642 + el tipo nuevo).
--
-- Deny-all + service_role, como la 0420. FK compuestas (id, tenant_id): un hijo no cuelga de un padre de otra flota.
-- Borrar un documento arrastra SUS fichas de linaje (la del hijo, o las de todos los hijos si es el padre), pero NO los
-- documentos hijos: cada uno tiene su archivo en Storage y su propia retención, y una cascada de filas dejaría esos archivos
-- huérfanos con datos personales. La cancelación ARCO de un archivo dividido la hace la app (`eliminarDocumento`: borra
-- primero cada hijo con su archivo y al final el original). Borrar la flota sí arrastra todo (cascada por tenant).
--
-- Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.cp_documento drop constraint if exists cp_documento_estado_dominio;
alter table public.cp_documento
  add constraint cp_documento_estado_dominio
  check (estado in ('recibido', 'procesando', 'por_revisar', 'aprobado', 'rechazado', 'fallido', 'dividido'));

alter table public.cp_documento_evento drop constraint if exists cp_documento_evento_tipo_dominio;
alter table public.cp_documento_evento
  add constraint cp_documento_evento_tipo_dominio
  check (tipo in (
    'recibido', 'duplicado_recibido', 'extraccion_iniciada', 'extraccion_ok', 'extraccion_fallida',
    'escalada', 'revision_abierta', 'campo_corregido', 'aprobado', 'rechazado', 'reabierto',
    'salida_viaje', 'exportado', 'perfil_aprendido', 'purgado', 'aviso_oficina', 'reintentos_agotados',
    'dividido'
  ));

create table if not exists public.cp_documento_embarque (
  documento_id uuid primary key,
  tenant_id    uuid not null references public.tenant(id) on delete cascade,
  padre_id     uuid not null,
  -- El sha256 del archivo ORIGINAL: común a todos los hermanos (agrupa «los embarques de este Excel»).
  huella_base  text not null,
  indice       int  not null,
  total        int  not null,
  -- El folio con el que se agruparon las filas (tal como lo escribe el cliente).
  clave        text,
  created_at   timestamptz not null default now(),
  constraint cp_documento_embarque_doc_fkey
    foreign key (documento_id, tenant_id) references public.cp_documento (id, tenant_id) on delete cascade,
  constraint cp_documento_embarque_padre_fkey
    foreign key (padre_id, tenant_id) references public.cp_documento (id, tenant_id) on delete cascade,
  constraint cp_documento_embarque_lugar_unico unique (tenant_id, padre_id, indice),
  constraint cp_documento_embarque_huella_forma check (huella_base ~ '^[0-9a-f]{64}$'),
  constraint cp_documento_embarque_lugar check (total between 2 and 100 and indice between 1 and total),
  constraint cp_documento_embarque_clave_largo check (clave is null or char_length(clave) <= 120),
  constraint cp_documento_embarque_no_a_si_mismo check (documento_id <> padre_id)
);
create index if not exists cp_documento_embarque_padre_idx on public.cp_documento_embarque (tenant_id, padre_id, indice);
create index if not exists cp_documento_embarque_huella_idx on public.cp_documento_embarque (tenant_id, huella_base);
comment on table public.cp_documento_embarque is
  'Linaje de un documento de Carta Porte que nació de partir un Excel/CSV con varios embarques (0670): el padre, la huella base común a los hermanos, su lugar (indice de total) y el folio de agrupación.';

alter table public.cp_documento_embarque enable row level security;
revoke all on public.cp_documento_embarque from public, anon, authenticated;
grant select, insert, update, delete on public.cp_documento_embarque to service_role;
