-- ═══════════════════════════════════════════════════════════════════════════
-- 0376 — INGESTA AUTOMÁTICA DEL DESGLOSE DE PEAJE (Agente 2, loop punta a punta)
--
-- Hasta aquí el desglose del proveedor solo entraba por la pantalla (subida
-- manual): nadie lo recibía solo y nada lo procesaba solo. Esta migración pone
-- lo que el endpoint firmado y el cron necesitan:
--
--   · `peaje_ingesta_config`   la rotación de la llave de firma por flota. La
--                              llave NO se guarda: se DERIVA (HMAC del secreto
--                              maestro del servidor con flota + rotación), así
--                              que rotarla es subir un entero y la base nunca
--                              contiene un secreto que filtrar.
--   · `peaje_ingesta_archivo`  la cola: un archivo recibido = una fila. La
--                              huella (sha256 del contenido) con la flota es
--                              única: el MISMO archivo recibido dos veces (el
--                              proveedor reintenta, alguien lo reenvía) es la
--                              misma fila, no dos desgloses.
--   · `peaje_archivo_reclamar` el CLAIM anti-duplicado del cron (FOR UPDATE SKIP
--                              LOCKED + lease con token). Dos cron simultáneos
--                              no toman el mismo archivo; un worker muerto suelta
--                              el archivo cuando vence su lease.
--   · `peaje_mapeo_columnas`   el mapeo configurable de columnas por proveedor,
--                              para los formatos que el lector no reconoce solo.
--   · `peaje_posiciones_ventana` las posiciones GPS dentro de ventanas de minutos
--                              alrededor del cobro, para el cruce por caseta.
--   · el latido del cron `peajes` en el dominio de `cron_latido`.
--
-- La cola guarda el contenido (bytea, ≤ 4 MB por el CHECK) solo mientras el
-- archivo está pendiente o falló: al procesarse bien, el contenido se borra y
-- queda la fila como constancia (huella, nombre, quién, cuándo, a qué desglose
-- llegó).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Rotación de la llave de firma ───────────────────────────────────────────
create table if not exists public.peaje_ingesta_config (
  tenant_id  uuid primary key references public.tenant(id) on delete cascade,
  rotacion   int not null default 1,
  activa     boolean not null default true,
  updated_at timestamptz not null default now(),
  constraint peaje_ingesta_config_rotacion_pos check (rotacion >= 1)
);
comment on table public.peaje_ingesta_config is
  'Rotación de la llave de firma del buzón de peajes por flota (0376). La llave se deriva con HMAC del secreto del servidor; aquí solo vive el entero que la rota y el interruptor de la flota.';

-- ── La cola de archivos recibidos ───────────────────────────────────────────
create table if not exists public.peaje_ingesta_archivo (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenant(id) on delete cascade,
  huella           text not null,
  nombre           text not null,
  proveedor        text,
  origen           text not null default 'api',
  bytes            int not null,
  -- Se borra al procesar con éxito (queda la fila como constancia).
  contenido        bytea,
  estado           text not null default 'pendiente',
  intentos         int not null default 0,
  proximo_intento_en timestamptz not null default now(),
  -- El claim: quién lo tiene y hasta cuándo. `reclamo` es el TOKEN que debe
  -- presentar quien lo cierre: un worker lento cuyo lease ya venció no puede
  -- pisar el resultado del que lo tomó después.
  reclamo          uuid,
  reclamado_hasta  timestamptz,
  desglose_id      uuid references public.desglose_peaje(id) on delete set null,
  ultimo_error     text,
  recibida_en      timestamptz not null default now(),
  procesada_en     timestamptz,
  constraint peaje_ingesta_archivo_huella_unica unique (tenant_id, huella),
  constraint peaje_ingesta_archivo_huella_forma check (huella ~ '^[0-9a-f]{64}$'),
  constraint peaje_ingesta_archivo_estado_dominio check (estado in ('pendiente', 'procesando', 'procesada', 'fallida')),
  constraint peaje_ingesta_archivo_origen_dominio check (origen in ('api', 'panel')),
  constraint peaje_ingesta_archivo_tamano check (bytes between 1 and 4194304),
  constraint peaje_ingesta_archivo_nombre_largo check (char_length(nombre) between 1 and 255),
  constraint peaje_ingesta_archivo_intentos_sanos check (intentos >= 0),
  -- Un archivo procesado no conserva su contenido; uno pendiente/procesando sí lo necesita.
  constraint peaje_ingesta_archivo_contenido_coherente check (
    (estado = 'procesada' and contenido is null)
    or (estado in ('pendiente', 'procesando') and contenido is not null)
    or estado = 'fallida'
  )
);
comment on table public.peaje_ingesta_archivo is
  'Cola de archivos de desglose recibidos por el buzón firmado (0376). unique (tenant, huella): el mismo archivo dos veces es la misma fila. El cron los reclama con peaje_archivo_reclamar.';
comment on column public.peaje_ingesta_archivo.reclamo is
  'Token del claim vigente. Solo quien lo presenta puede cerrar el archivo.';

create index if not exists peaje_ingesta_archivo_trabajo_idx
  on public.peaje_ingesta_archivo (proximo_intento_en)
  where estado in ('pendiente', 'procesando');
create index if not exists peaje_ingesta_archivo_tenant_idx
  on public.peaje_ingesta_archivo (tenant_id, recibida_en desc);

-- El desglose que nace de un archivo de la cola apunta a él, y a lo más UNO por
-- archivo: es lo que vuelve idempotente el reproceso tras un crash entre
-- «insertar el desglose» y «marcar el archivo procesado».
alter table public.desglose_peaje
  add column if not exists ingesta_archivo_id uuid references public.peaje_ingesta_archivo(id) on delete set null;
create unique index if not exists desglose_peaje_ingesta_unica
  on public.desglose_peaje (ingesta_archivo_id) where ingesta_archivo_id is not null;
comment on column public.desglose_peaje.ingesta_archivo_id is
  'El archivo de la cola del que nació este desglose (NULL = subida manual). Único: un archivo no genera dos desgloses aunque el cron se reintente.';

-- ── El claim anti-duplicado ─────────────────────────────────────────────────
create or replace function public.peaje_archivo_reclamar(p_limite int default 5, p_lease_segundos int default 300)
returns table (id uuid, tenant_id uuid, nombre text, proveedor text, intentos int, reclamo uuid, desglose_id uuid)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_reclamo uuid := gen_random_uuid();
begin
  if p_limite is null or p_limite < 1 or p_limite > 50 then
    raise exception 'peaje_archivo_reclamar: p_limite fuera de rango (1-50)';
  end if;
  if p_lease_segundos is null or p_lease_segundos < 30 or p_lease_segundos > 3600 then
    raise exception 'peaje_archivo_reclamar: p_lease_segundos fuera de rango (30-3600)';
  end if;

  return query
  with elegibles as (
    select a.id
      from public.peaje_ingesta_archivo a
     where a.contenido is not null
       and (
         -- Pendiente y ya le toca…
         (a.estado = 'pendiente' and a.proximo_intento_en <= now())
         -- …o un worker lo tomó y murió: su lease venció.
         or (a.estado = 'procesando' and a.reclamado_hasta is not null and a.reclamado_hasta < now())
       )
     order by a.proximo_intento_en, a.recibida_en
     limit p_limite
       for update skip locked
  )
  update public.peaje_ingesta_archivo a
     set estado = 'procesando',
         reclamo = v_reclamo,
         reclamado_hasta = now() + make_interval(secs => p_lease_segundos),
         intentos = a.intentos + 1
    from elegibles e
   where a.id = e.id
  returning a.id, a.tenant_id, a.nombre, a.proveedor, a.intentos, a.reclamo, a.desglose_id;
end;
$$;
comment on function public.peaje_archivo_reclamar(int, int) is
  'Claim anti-duplicado del cron de peajes (0376): toma hasta p_limite archivos pendientes (o con lease vencido) con FOR UPDATE SKIP LOCKED y los marca procesando con un token. SECURITY INVOKER: solo service_role.';
revoke all on function public.peaje_archivo_reclamar(int, int) from public, anon, authenticated;
grant execute on function public.peaje_archivo_reclamar(int, int) to service_role;

-- ── Mapeo configurable de columnas por proveedor ────────────────────────────
create table if not exists public.peaje_mapeo_columnas (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenant(id) on delete cascade,
  -- Normalizado (minúsculas, sin acentos): «PASE», «pase » y «Pase» son uno.
  proveedor_norm text not null,
  proveedor      text not null,
  -- {"fecha":"Fecha de cobro","hora":"Hora","caseta":"Plaza","monto":"Importe","tag":"No. TAG"}
  -- Cada valor es el ENCABEZADO exacto (sin importar mayúsculas/acentos) o la
  -- letra de la columna («C»). Solo `monto` y `caseta` son obligatorios.
  columnas       jsonb not null,
  activo         boolean not null default true,
  updated_at     timestamptz not null default now(),
  constraint peaje_mapeo_unico unique (tenant_id, proveedor_norm),
  constraint peaje_mapeo_columnas_forma check (
    jsonb_typeof(columnas) = 'object'
    and columnas ? 'monto'
    and columnas ? 'caseta'
  )
);
comment on table public.peaje_mapeo_columnas is
  'Mapeo de columnas por proveedor cuando el lector no reconoce el formato solo (0376). Va por encabezado o por letra de columna; sin él, el lector detecta por nombre y, si no puede, dice qué encabezados leyó.';

-- ── Posiciones GPS en ventanas alrededor del cobro ──────────────────────────
-- Entrada: un arreglo jsonb de {linea_id, unidad_id, desde, hasta}. El índice
-- (tenant, unidad, medida_en) de la 0050 trabaja por cada ventana. Devuelve las
-- posiciones ordenadas; el motor puro (peajes/cruce_gps.ts) decide qué significan.
create or replace function public.peaje_posiciones_ventana(p_tenant uuid, p_ventanas jsonb)
returns table (linea_id uuid, lat double precision, lng double precision, medida_en timestamptz)
language sql
stable
set search_path = public, pg_catalog
as $$
  select v.linea_id, p.lat, p.lng, p.medida_en
    from jsonb_to_recordset(p_ventanas) as v(linea_id uuid, unidad_id uuid, desde timestamptz, hasta timestamptz)
    join public.posicion p
      on p.tenant_id = p_tenant
     and p.unidad_id = v.unidad_id
     and p.medida_en between v.desde and v.hasta
   where jsonb_typeof(p_ventanas) = 'array'
$$;
comment on function public.peaje_posiciones_ventana(uuid, jsonb) is
  'Posiciones GPS de cada {linea_id, unidad_id, desde, hasta} para el cruce por caseta (0376). Solo devuelve filas; la clasificación vive en el motor puro de la app. SECURITY INVOKER; p_tenant sin default.';
revoke all on function public.peaje_posiciones_ventana(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.peaje_posiciones_ventana(uuid, jsonb) to service_role;

-- ── RLS (deny-all; solo service_role) ───────────────────────────────────────
alter table public.peaje_ingesta_config enable row level security;
alter table public.peaje_ingesta_archivo enable row level security;
alter table public.peaje_mapeo_columnas enable row level security;

-- ── El latido del cron `peajes` ─────────────────────────────────────────────
-- El dominio de `cron_latido` se enumera ENTERO cada vez (lección de la
-- 0227/0241/0248). Espejo de CRONS en `lib/admin/salud.ts`.
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'cron_latido_id_dominio' and conrelid = 'public.cron_latido'::regclass
  ) then
    alter table public.cron_latido drop constraint cron_latido_id_dominio;
  end if;
  alter table public.cron_latido
    add constraint cron_latido_id_dominio
    check (id in (
      'wa-pendientes',
      'wa-outbox',
      'escalar',
      'facturar',
      'purgar',
      'runner',
      'gps',
      'asistencia',
      'descarga-sat',
      'jornada',
      'portales-vivos',
      'liquidaciones-externas',
      'peajes'
    ));
end $$;

comment on constraint cron_latido_id_dominio on public.cron_latido is
  'El catálogo COMPLETO de ids de cron, espejo de CRONS en lib/admin/salud.ts. Se enumera entero al tocarlo: una lista corta no falla ruidosamente, silencia el latido de los crons que faltan. La 0376 añade peajes.';
