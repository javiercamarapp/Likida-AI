-- ═══════════════════════════════════════════════════════════════════════════
-- 0795 — Programa de despacho: cargas, filas y historia de cambios (Agente 4, Vigía).
--
-- Lo que pidió el cliente: el programa de cada terminal es un Excel que se llena a mano y que CAMBIA después de avisar
-- («todavía me los pueden cambiar», levantamiento 747a3730 ~02:40), así que no basta guardar la última foto: hace falta
-- la historia por fila para poder avisar de nuevo solo cuando algo cambió.
--
--   · `programa_despacho_carga`  una subida del archivo (huella sha256: el MISMO archivo no entra dos veces a la misma
--                                terminal). `avisos` es un resumen acotado de la calidad de lectura, nunca el contenido.
--   · `programa_despacho_fila`   la última versión de cada fila, identificada por `clave_natural` (la calcula el código de
--                                persistencia, T-A4-06: terminal + fecha + tipo + bloque + número). `huella` resume los
--                                campos que importan para detectar cambios. Una fila que deja de venir se oculta
--                                (`visible = false`), no se borra.
--   · `programa_despacho_cambio` una línea por campo que cambió, con el valor de antes y el de después y la carga que lo trajo.
--
-- Todo lo escribe el servidor (service_role); la lectura es para quien atiende clientes (`ve_atencion_cliente()`, 0400),
-- como el resto del Vigía. El código que lea estas tablas debe tolerar su ausencia (42P01 / PGRST205 = «aún no aplicada»).
--
-- ROLLBACK (en orden inverso; no hay funciones ni dependencias externas):
--   drop table if exists public.programa_despacho_cambio;
--   drop table if exists public.programa_despacho_fila;
--   drop table if exists public.programa_despacho_carga;
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.programa_despacho_carga (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenant(id) on delete cascade,
  terminal       text not null,
  origen         text not null,
  archivo_sha256 text not null,
  filas_leidas   integer not null default 0,
  filas_validas  integer not null default 0,
  avisos         jsonb not null default '[]'::jsonb,
  creado_por     uuid,
  created_at     timestamptz not null default now(),
  constraint programa_despacho_carga_id_tenant_key unique (id, tenant_id),
  constraint programa_despacho_carga_terminal_forma check (char_length(btrim(terminal)) between 1 and 40),
  constraint programa_despacho_carga_origen check (origen in ('subida', 'drive', 'api')),
  constraint programa_despacho_carga_sha_forma check (archivo_sha256 ~ '^[0-9a-f]{64}$'),
  constraint programa_despacho_carga_filas check (filas_leidas >= 0 and filas_validas >= 0 and filas_validas <= filas_leidas),
  constraint programa_despacho_carga_avisos_forma check (
    jsonb_typeof(avisos) = 'array' and jsonb_array_length(avisos) <= 200 and octet_length(avisos::text) <= 32768),
  constraint programa_despacho_carga_unica unique (tenant_id, terminal, archivo_sha256)
);
comment on table public.programa_despacho_carga is
  '0795: una subida del programa de despacho de una terminal. Único por (flota, terminal, sha256): el mismo archivo no entra dos veces.';
comment on column public.programa_despacho_carga.terminal is '0795: terminal del archivo (código corto: GDL, BJX, MTY…).';
comment on column public.programa_despacho_carga.origen is '0795: cómo llegó el archivo: subida manual, Drive/Sheets o API.';
comment on column public.programa_despacho_carga.archivo_sha256 is '0795: huella sha256 (hex, 64) del archivo tal como se subió.';
comment on column public.programa_despacho_carga.filas_leidas is '0795: filas crudas que entregó el lector.';
comment on column public.programa_despacho_carga.filas_validas is '0795: filas que pasaron la normalización (≤ filas_leidas).';
comment on column public.programa_despacho_carga.avisos is
  '0795: resumen acotado (≤ 200 elementos, ≤ 32 KB) de los avisos de lectura; sin valores del archivo.';
comment on column public.programa_despacho_carga.creado_por is '0795: usuario que subió el archivo (null si fue automático).';

create table if not exists public.programa_despacho_fila (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenant(id) on delete cascade,
  carga_ultima_id uuid,
  terminal        text not null,
  fecha           date not null,
  tipo            text not null,
  bloque          text,
  num             integer,
  clave_natural   text not null,
  cliente         text,
  consignatario   text,
  linea           text,
  caja            text,
  unidad          text,
  cita_en         timestamptz,
  cita_texto      text,
  transito        text not null default 'vacio',
  ccp             text not null default 'vacio',
  comentarios     text,
  color           jsonb,
  huella          text not null,
  primera_vez     timestamptz not null default now(),
  ultima_vez      timestamptz not null default now(),
  visible         boolean not null default true,
  constraint programa_despacho_fila_id_tenant_key unique (id, tenant_id),
  constraint programa_despacho_fila_carga_fkey
    foreign key (carga_ultima_id, tenant_id) references public.programa_despacho_carga (id, tenant_id)
    on delete set null (carga_ultima_id),
  constraint programa_despacho_fila_terminal_forma check (char_length(btrim(terminal)) between 1 and 40),
  constraint programa_despacho_fila_tipo check (tipo in ('IMPORTACION', 'EXPORTACION', 'CANCELACIONES', 'DOMESTICO', 'MOV_VACIO', 'OTRO')),
  constraint programa_despacho_fila_transito check (transito in ('patio_nld', 'en_ruta', 'pend_cruce', 'ok', 'patio_otro', 'na', 'vacio', 'desconocido')),
  constraint programa_despacho_fila_ccp check (ccp in ('listo', 'despachado', 'pend_reque', 'pend_ccp', 'falta_complemento', 'vacio', 'desconocido')),
  constraint programa_despacho_fila_clave_forma check (char_length(clave_natural) between 1 and 300),
  constraint programa_despacho_fila_huella_forma check (char_length(huella) between 8 and 128),
  constraint programa_despacho_fila_color_forma check (color is null or (jsonb_typeof(color) = 'object' and octet_length(color::text) <= 2048)),
  constraint programa_despacho_fila_num check (num is null or num >= 0),
  constraint programa_despacho_fila_vistas check (ultima_vez >= primera_vez),
  constraint programa_despacho_fila_clave_unica unique (tenant_id, terminal, clave_natural)
);
create index if not exists programa_despacho_fila_fecha_idx  on public.programa_despacho_fila (tenant_id, fecha);
create index if not exists programa_despacho_fila_unidad_idx on public.programa_despacho_fila (tenant_id, unidad);
create index if not exists programa_despacho_fila_caja_idx   on public.programa_despacho_fila (tenant_id, caja);
create index if not exists programa_despacho_fila_carga_idx  on public.programa_despacho_fila (tenant_id, carga_ultima_id);
comment on table public.programa_despacho_fila is
  '0795: la última versión de cada fila del programa de despacho; identidad = (flota, terminal, clave_natural). Una fila que deja de venir se oculta (visible=false), no se borra.';
comment on column public.programa_despacho_fila.carga_ultima_id is '0795: la carga que trajo la versión vigente (null si esa carga se purgó).';
comment on column public.programa_despacho_fila.fecha is '0795: día de la sección del programa (no la hora de la cita).';
comment on column public.programa_despacho_fila.tipo is '0795: sección del programa (TipoSeccionPrograma del lector).';
comment on column public.programa_despacho_fila.bloque is '0795: subbloque o ruta de la sección (p. ej. el título del tramo), si el archivo lo trae.';
comment on column public.programa_despacho_fila.num is '0795: columna «#» del programa; null si la fila no lo trae.';
comment on column public.programa_despacho_fila.clave_natural is
  '0795: identidad estable de la fila entre cargas (terminal + fecha + tipo + bloque + número); la calcula el código de persistencia, no la base.';
comment on column public.programa_despacho_fila.cliente is '0795: quien paga (columna CLIENTE).';
comment on column public.programa_despacho_fila.consignatario is '0795: columna CONSIGNATARIO.';
comment on column public.programa_despacho_fila.linea is '0795: línea transportista, si el archivo la trae.';
comment on column public.programa_despacho_fila.caja is '0795: número de caja tal como viene (trim, mayúsculas).';
comment on column public.programa_despacho_fila.unidad is '0795: número de unidad (tractor) tal como viene.';
comment on column public.programa_despacho_fila.cita_en is '0795: cita como instante (se interpretó en la zona de la terminal).';
comment on column public.programa_despacho_fila.cita_texto is '0795: cita que no es una hora («DIRECTO»); null en otro caso.';
comment on column public.programa_despacho_fila.transito is '0795: estado de tránsito normalizado (catálogo del normalizador; «desconocido» si no se reconoció).';
comment on column public.programa_despacho_fila.ccp is '0795: estado de la carta porte normalizado (catálogo del normalizador).';
comment on column public.programa_despacho_fila.comentarios is '0795: comentarios de la fila.';
comment on column public.programa_despacho_fila.color is '0795: color de la fila en la hoja (objeto), reservado para la lectura de colores (T-A4-08); null si no se lee.';
comment on column public.programa_despacho_fila.huella is '0795: resumen de los campos que cuentan para detectar un cambio; si cambia entre cargas, se registra en programa_despacho_cambio.';
comment on column public.programa_despacho_fila.primera_vez is '0795: cuándo se vio por primera vez la fila.';
comment on column public.programa_despacho_fila.ultima_vez is '0795: la última vez que una carga la trajo.';
comment on column public.programa_despacho_fila.visible is '0795: false cuando la última carga ya no la trae (se conserva para la historia).';

create table if not exists public.programa_despacho_cambio (
  id        bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenant(id) on delete cascade,
  fila_id   uuid not null,
  campo     text not null,
  antes     text,
  despues   text,
  carga_id  uuid,
  en        timestamptz not null default now(),
  constraint programa_despacho_cambio_fila_fkey
    foreign key (fila_id, tenant_id) references public.programa_despacho_fila (id, tenant_id) on delete cascade,
  constraint programa_despacho_cambio_carga_fkey
    foreign key (carga_id, tenant_id) references public.programa_despacho_carga (id, tenant_id)
    on delete set null (carga_id),
  constraint programa_despacho_cambio_campo_forma check (char_length(btrim(campo)) between 1 and 60),
  constraint programa_despacho_cambio_distinto check (antes is distinct from despues)
);
create index if not exists programa_despacho_cambio_fila_idx on public.programa_despacho_cambio (tenant_id, fila_id, en);
comment on table public.programa_despacho_cambio is
  '0795: historia de cambios por fila y campo (antes/después) entre cargas; base del «reenvío si cambia».';
comment on column public.programa_despacho_cambio.campo is '0795: nombre del campo que cambió (caja, unidad, cita_en, transito, ccp…) o «visible».';
comment on column public.programa_despacho_cambio.antes is '0795: valor anterior como texto (null si no había).';
comment on column public.programa_despacho_cambio.despues is '0795: valor nuevo como texto (null si quedó vacío).';
comment on column public.programa_despacho_cambio.carga_id is '0795: carga que trajo el cambio (null si esa carga se purgó).';
comment on column public.programa_despacho_cambio.en is '0795: cuándo se detectó el cambio.';

alter table public.programa_despacho_carga  enable row level security;
alter table public.programa_despacho_fila   enable row level security;
alter table public.programa_despacho_cambio enable row level security;
drop policy if exists tenant_lee on public.programa_despacho_carga;
create policy tenant_lee on public.programa_despacho_carga for select
  using ((tenant_id = any(get_user_tenant_ids()) and ve_atencion_cliente()) or is_superadmin());
drop policy if exists tenant_lee on public.programa_despacho_fila;
create policy tenant_lee on public.programa_despacho_fila for select
  using ((tenant_id = any(get_user_tenant_ids()) and ve_atencion_cliente()) or is_superadmin());
drop policy if exists tenant_lee on public.programa_despacho_cambio;
create policy tenant_lee on public.programa_despacho_cambio for select
  using ((tenant_id = any(get_user_tenant_ids()) and ve_atencion_cliente()) or is_superadmin());

revoke all on table public.programa_despacho_carga, public.programa_despacho_fila, public.programa_despacho_cambio
  from public, anon, authenticated;
grant select on table public.programa_despacho_carga, public.programa_despacho_fila, public.programa_despacho_cambio to authenticated;
grant select, insert, update, delete on table public.programa_despacho_carga, public.programa_despacho_fila, public.programa_despacho_cambio to service_role;
grant usage, select on sequence public.programa_despacho_cambio_id_seq to service_role;
