-- ═══════════════════════════════════════════════════════════════════════════
-- 0530 · BUZÓN DE FACTURAS (Agente 9, loop punta a punta, ola 3): RECEPCIÓN POR
--       ARCHIVO, PDF SOLO, ZIP Y PAREJA XML+PDF.
--
-- Auditoría (6-7-9-10-12-13, §3): «un PDF solo se cuenta y se ignora» y no había
-- zip. Esta migración pone el esquema para recibirlos sin perder rastro:
--
--   1. `buzon_recepcion`: UNA fila por archivo recibido (hoja del correo, o del
--      zip). Es la pantalla de estado del buzón: qué llegó, qué se hizo con cada
--      archivo y por qué (procesada, duplicada, en revisión, descartada,
--      ignorada, RECHAZADA por seguridad —zip bomba, XXE, PDF corrupto— o error).
--      unique (flota, correo, huella): el reintento de un correo no la duplica.
--
--   2. Columnas de `factura_proveedor`: de dónde salieron los datos
--      (`fuente_datos`), si requiere revisión humana por lectura de baja
--      confianza (`requiere_revision` + motivo) y el PDF emparejado (en el bucket
--      privado `buzon-facturas`). El CFDI llegado por XML es dato duro; el
--      llegado por PDF es LECTURA y se marca.
--
--   3. Bucket privado `buzon-facturas` y `purgar_buzon_recepcion`: retención de la
--      bitácora de archivos (365 días) SOLO de lo que no cuelga de una factura (la
--      factura es evidencia fiscal, CFF 30: 5 años, y su recepción se conserva
--      con ella). Los PDF no ligados a una factura se encolan para borrado en
--      `storage_huerfano_candidato` (Supabase prohíbe borrar storage.objects por SQL).
--
-- NO reescribe ningún CHECK existente (solo agrega los suyos).
-- RLS: deny-all con service_role, igual que 0091/0095.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. factura_proveedor: de dónde salió y si hay que revisarla ────────────
alter table public.factura_proveedor
  add column if not exists requiere_revision boolean not null default false,
  add column if not exists revision_motivo   text,
  add column if not exists fuente_datos      text,
  add column if not exists pdf_ruta          text,
  add column if not exists pdf_sha256        text,
  add column if not exists pdf_nombre        text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'factura_proveedor_id_tenant_key') then
    alter table public.factura_proveedor add constraint factura_proveedor_id_tenant_key unique (id, tenant_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'factura_proveedor_fuente_datos_dominio') then
    alter table public.factura_proveedor
      add constraint factura_proveedor_fuente_datos_dominio
      check (fuente_datos is null or fuente_datos in ('xml', 'pdf_texto', 'pdf_vision', 'foto'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'factura_proveedor_revision_coherente') then
    alter table public.factura_proveedor
      add constraint factura_proveedor_revision_coherente
      check ((requiere_revision and revision_motivo is not null) or (not requiere_revision and revision_motivo is null));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'factura_proveedor_pdf_coherente') then
    alter table public.factura_proveedor
      add constraint factura_proveedor_pdf_coherente
      check ((pdf_ruta is null) = (pdf_sha256 is null));
  end if;
end $$;

comment on column public.factura_proveedor.requiere_revision is
  'true = los datos salieron de una LECTURA (PDF o foto) de baja confianza: una persona debe cotejarlos contra el documento antes de aprobar. La factura sigue siendo pendiente; esta marca la sube en la bandeja.';
comment on column public.factura_proveedor.fuente_datos is
  'xml = dato duro del CFDI; pdf_texto = lectura de la capa de texto del PDF; pdf_vision = lectura por visión del PDF; foto = foto subida/enviada. NULL = fila anterior a la 0530, fuente no rastreada (no se adivina).';
comment on column public.factura_proveedor.pdf_ruta is
  'Ruta del PDF emparejado en el bucket privado buzon-facturas. NULL = no llegó PDF.';

-- ── 2. La recepción por archivo ────────────────────────────────────────────
create table if not exists public.buzon_recepcion (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenant(id) on delete cascade,
  -- El correo de Resend del que vino (idempotencia del reintento).
  email_id    text not null,
  -- Nombre del archivo, SANEADO (lo escribió el remitente: no es de confianza).
  nombre      text not null,
  -- Si venía dentro de un zip, nombre de ese zip.
  zip_origen  text,
  tipo        text not null,
  bytes       integer not null,
  -- SHA-256 del contenido: dos correos con el mismo archivo se reconocen sin releerlo.
  sha256      text not null,
  estado      text not null,
  motivo      text,
  cfdi_uuid   text,
  factura_id  uuid,
  -- Confianza 0-1 de la lectura cuando el dato salió de un PDF.
  confianza   numeric(3,2),
  -- PDF guardado (solo los que se emparejaron o esperan revisión).
  storage_ruta text,
  recibido_en timestamptz not null default now(),
  decidido_por text,
  decidido_en  timestamptz,

  constraint buzon_recepcion_unico unique (tenant_id, email_id, sha256),
  constraint buzon_recepcion_factura_tenant_fkey
    foreign key (factura_id, tenant_id) references public.factura_proveedor (id, tenant_id) on delete cascade,
  constraint buzon_recepcion_tipo_dominio check (tipo in ('xml', 'pdf', 'zip', 'otro')),
  constraint buzon_recepcion_estado_dominio
    check (estado in ('procesada', 'duplicada', 'revision', 'descartada', 'ignorada', 'rechazada', 'error')),
  constraint buzon_recepcion_sha_forma check (sha256 ~ '^[0-9a-f]{64}$'),
  constraint buzon_recepcion_bytes_sanos check (bytes >= 0),
  constraint buzon_recepcion_confianza_rango check (confianza is null or (confianza >= 0 and confianza <= 1)),
  constraint buzon_recepcion_textos_acotados check (
    char_length(nombre) <= 160 and (motivo is null or char_length(motivo) <= 300) and (zip_origen is null or char_length(zip_origen) <= 160)
  ),
  -- Una decisión humana (descartar) lleva quién y cuándo, juntos.
  constraint buzon_recepcion_decision_coherente check ((decidido_por is null) = (decidido_en is null))
);

comment on table public.buzon_recepcion is
  'Bitácora por ARCHIVO del buzón de facturas (0530): qué llegó, qué se hizo con cada archivo y por qué. Alimenta la pantalla de estado. Las filas ligadas a una factura viven con ella; las demás se purgan a los 365 días (purgar_buzon_recepcion).';
comment on column public.buzon_recepcion.estado is
  'procesada = entró a la bandeja; duplicada = ya estaba (mismo UUID o mismo archivo); revision = una persona debe mirarlo (PDF sin datos legibles o de baja confianza); descartada = una persona lo descartó; ignorada = tipo que el buzón no lee; rechazada = RECHAZADO POR SEGURIDAD (zip bomba, XML con DTD/XXE, PDF corrupto…), el motivo dice cuál; error = fallo transitorio, se reintenta con el correo.';

create index if not exists buzon_recepcion_por_fecha_idx
  on public.buzon_recepcion (tenant_id, recibido_en desc, id);
create index if not exists buzon_recepcion_revision_idx
  on public.buzon_recepcion (tenant_id, recibido_en desc) where estado = 'revision';
create index if not exists buzon_recepcion_sha_idx
  on public.buzon_recepcion (tenant_id, sha256);
create index if not exists buzon_recepcion_retencion_idx
  on public.buzon_recepcion (recibido_en) where factura_id is null;

alter table public.buzon_recepcion enable row level security;
revoke all on table public.buzon_recepcion from public, anon, authenticated;
grant select, insert, update, delete on table public.buzon_recepcion to service_role;

-- ── 3. Bucket privado y retención ──────────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('buzon-facturas', 'buzon-facturas', false)
on conflict (id) do nothing;

-- Purga de la bitácora de archivos que NO cuelgan de una factura. Devuelve cuántas filas borró.
-- Los PDF guardados se encolan para borrarse desde la API de Storage.
create or replace function public.purgar_buzon_recepcion(p_ahora timestamptz default now(), p_dias integer default 365)
returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_borradas integer;
begin
  if p_dias < 30 then
    raise exception 'purgar_buzon_recepcion: el plazo mínimo es de 30 días';
  end if;
  insert into public.storage_huerfano_candidato (bucket, nombre, motivo)
  select 'buzon-facturas', r.storage_ruta, 'retencion_buzon_recepcion'
  from public.buzon_recepcion r
  where r.factura_id is null and r.storage_ruta is not null and r.recibido_en < p_ahora - make_interval(days => p_dias)
  on conflict (bucket, nombre) do nothing;

  delete from public.buzon_recepcion
  where factura_id is null and recibido_en < p_ahora - make_interval(days => p_dias);
  get diagnostics v_borradas = row_count;
  return v_borradas;
end $$;

revoke all on function public.purgar_buzon_recepcion(timestamptz, integer) from public, anon, authenticated;
grant execute on function public.purgar_buzon_recepcion(timestamptz, integer) to service_role;
