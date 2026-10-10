-- ═══════════════════════════════════════════════════════════════════════════
-- 0420 — CARTA PORTE MULTI-FORMATO (Agente 3, loop punta a punta, 1-oct-2026)
--
-- Los clientes grandes del cliente de demo mandan la carga en SU formato: PDF con
-- texto, PDF escaneado, foto, Excel/CSV, XML o el cuerpo de un correo. Hasta hoy
-- Likida solo armaba el complemento Carta Porte 3.1 desde datos capturados a
-- mano (0204). Esta migración es la persistencia de lo que falta entre el
-- documento del cliente y ese complemento:
--
--   cp_buzon              el correo de la flota por el que entran los documentos
--   cp_documento          el documento recibido, su extracción y su revisión
--   cp_documento_evento   la bitácora append-only de cada documento
--   cp_correccion         lo que un humano corrigió campo por campo (alimenta el
--                         aprendizaje y la métrica «% sin corrección»)
--   cp_perfil[_version]   el perfil por cliente-formato, versionado e inmutable
--   cp_export_config      el mapeo configurable al formato destino del cliente
--
-- ── DECISIONES ──────────────────────────────────────────────────────────────
--
--  · Deny-all + service_role, como la 0204: la app lee y escribe con el cliente
--    de servicio y CADA consulta lleva `.eq('tenant_id')`. Ninguna política para
--    `authenticated`: una tabla con datos de operador (nombre, licencia, RFC) no
--    se abre por REST.
--  · FK compuestas (id, tenant_id) hacia viaje, cliente, cp_documento y cp_perfil
--    (regla de la 0028/0145): un autenticado de la flota A no cuelga su fila del
--    padre de la flota B aunque adivine un UUID.
--  · La idempotencia vive aquí: unique (tenant_id, sha256). El mismo archivo dos
--    veces —por correo y por WhatsApp, o un reintento del webhook— es UN
--    documento; la segunda llegada solo deja un evento `duplicado_recibido`.
--  · `version` es el candado optimista de la revisión: dos revisores sobre el
--    mismo documento no se pisan (el segundo UPDATE condicional afecta 0 filas).
--  · El claim de procesamiento (`cp_documento_reclamar`) usa el reloj de la BASE,
--    con lease y tope de intentos: dos invocaciones concurrentes no extraen —y
--    no pagan al modelo— dos veces el mismo documento.
--  · NO se timbra nada aquí ni en ninguna parte de este módulo. El resultado es
--    un borrador (viaje + viaje_mercancia) que sigue el camino de siempre.
--
-- ── RETENCIÓN / ARCO ────────────────────────────────────────────────────────
-- El documento crudo y su texto contienen datos personales de terceros (nombre,
-- licencia y RFC del operador, RFC de remitente/destinatario). `retener_hasta`
-- manda: el archivo y el texto se borran al vencer (cp_documentos_vencidos +
-- purgarDocumentosVencidos en TS), la fila queda como constancia sin contenido.
-- Defaults de la app: 180 días recibido, 365 aprobado (evidencia del embarque),
-- 90 rechazado/fallido. Borrar la flota arrastra todo (cascada); una solicitud
-- ARCO sobre el operador se atiende borrando el documento (cascada a eventos y
-- correcciones). Los eventos NO guardan el contenido de los campos, solo sus
-- nombres y conteos.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── El correo de la flota ───────────────────────────────────────────────────
create table if not exists public.cp_buzon (
  tenant_id  uuid primary key references public.tenant(id) on delete cascade,
  -- Mismo alfabeto que el buzón de facturas (sin i, l, o, u, 0, 1): la dirección
  -- se dicta por teléfono. 24 caracteres ≈ 118 bits: no hay fuerza bruta.
  token      text not null unique,
  activo     boolean not null default true,
  -- Correos o dominios que el cliente usa para mandar. Vacío = cualquiera, y
  -- todo lo que entra pasa por revisión humana de todos modos; con lista, lo que
  -- viene de fuera se marca `remitente_no_reconocido`.
  remitentes_permitidos text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cp_buzon_token_forma check (token ~ '^[abcdefghjkmnpqrstvwxyz2-9]{24}$'),
  constraint cp_buzon_remitentes_tope check (cardinality(remitentes_permitidos) <= 50)
);
comment on table public.cp_buzon is
  'Buzón de correo por flota para documentos de Carta Porte (0420). La dirección es cp-<token>@<dominio de correo>; el webhook de Resend va firmado (Svix) y la flota sale del token del DESTINATARIO, nunca del remitente.';

-- ── Perfil por cliente-formato (versionado) ─────────────────────────────────
create table if not exists public.cp_perfil (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenant(id) on delete cascade,
  cliente_id     uuid,
  clave          text not null,
  nombre         text not null,
  formato        text not null,
  -- La huella estructural con la que se reconoce el formato (encabezados, raíz
  -- XML, etiquetas…). No contiene datos del documento.
  firma          jsonb not null default '{}'::jsonb,
  version_activa int not null default 1,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint cp_perfil_clave_unica unique (tenant_id, clave),
  constraint cp_perfil_id_tenant_key unique (id, tenant_id),
  constraint cp_perfil_cliente_tenant_fkey
    foreign key (cliente_id, tenant_id) references public.cliente (id, tenant_id) on delete set null (cliente_id),
  constraint cp_perfil_clave_forma check (clave ~ '^[a-z0-9][a-z0-9_-]{0,59}$'),
  constraint cp_perfil_nombre_largo check (char_length(nombre) between 1 and 120),
  constraint cp_perfil_formato_dominio check (formato in ('pdf_texto', 'pdf_escaneado', 'imagen', 'excel', 'csv', 'xml', 'correo')),
  constraint cp_perfil_version_pos check (version_activa >= 1)
);
create index if not exists cp_perfil_tenant_idx on public.cp_perfil (tenant_id, updated_at desc);
comment on table public.cp_perfil is
  'Perfil de plantilla por cliente-formato (0420): qué columna/etiqueta de SU documento es cada campo del complemento. Nace y se corrige solo con lo que un humano confirmó.';

create table if not exists public.cp_documento (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenant(id) on delete cascade,
  canal            text not null,
  formato          text not null,
  nombre_archivo   text not null,
  mime             text,
  bytes            int not null,
  sha256           text not null,
  -- NULL cuando el archivo ya se purgó por retención.
  storage_ruta     text,
  estado           text not null default 'recibido',
  version          int not null default 1,

  cliente_id       uuid,
  perfil_id        uuid,
  perfil_version   int,

  -- Quién lo mandó, tal cual llegó (correo o teléfono): dato personal, sujeto a
  -- la misma retención que el documento.
  remitente        text,
  asunto           text,
  remitente_reconocido boolean,

  texto_extracto   text,
  -- El documento trae texto que parece una instrucción al modelo: nada de lo que
  -- se extrajo de él se aprueba sin que un humano confirme cada campo crítico.
  riesgo_inyeccion boolean not null default false,

  extraccion       jsonb,
  validacion       jsonb,
  confianza_min    numeric(4,3),
  nivel_modelo     smallint,
  modelo           text,
  tokens_in        int not null default 0,
  tokens_out       int not null default 0,
  costo_usd        numeric(10,6) not null default 0,

  viaje_id         uuid,

  procesando_hasta timestamptz,
  intentos         int not null default 0,
  ultimo_error     text,

  abierto_en       timestamptz,
  revisado_por     uuid references public.app_user(id) on delete set null,
  aprobado_por     uuid references public.app_user(id) on delete set null,
  aprobado_en      timestamptz,
  rechazo_motivo   text,
  tiempo_revision_seg int,
  exportado_en     timestamptz,

  retener_hasta    timestamptz not null default (now() + interval '180 days'),
  purgado_en       timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint cp_documento_huella_unica unique (tenant_id, sha256),
  constraint cp_documento_id_tenant_key unique (id, tenant_id),
  constraint cp_documento_cliente_tenant_fkey
    foreign key (cliente_id, tenant_id) references public.cliente (id, tenant_id) on delete set null (cliente_id),
  constraint cp_documento_perfil_tenant_fkey
    foreign key (perfil_id, tenant_id) references public.cp_perfil (id, tenant_id) on delete set null (perfil_id),
  constraint cp_documento_viaje_tenant_fkey
    foreign key (viaje_id, tenant_id) references public.viaje (id, tenant_id) on delete set null (viaje_id),
  constraint cp_documento_canal_dominio check (canal in ('manual', 'correo', 'whatsapp')),
  constraint cp_documento_formato_dominio check (formato in ('pdf_texto', 'pdf_escaneado', 'imagen', 'excel', 'csv', 'xml', 'correo')),
  constraint cp_documento_estado_dominio check (estado in ('recibido', 'procesando', 'por_revisar', 'aprobado', 'rechazado', 'fallido')),
  constraint cp_documento_sha_forma check (sha256 ~ '^[0-9a-f]{64}$'),
  constraint cp_documento_bytes_rango check (bytes between 1 and 12582912),
  constraint cp_documento_nombre_largo check (char_length(nombre_archivo) between 1 and 255),
  constraint cp_documento_extracto_tope check (texto_extracto is null or char_length(texto_extracto) <= 60000),
  constraint cp_documento_confianza_rango check (confianza_min is null or (confianza_min >= 0 and confianza_min <= 1)),
  constraint cp_documento_version_pos check (version >= 1 and intentos >= 0),
  -- Un documento aprobado tiene quién y cuándo; uno que no, no los lleva.
  constraint cp_documento_aprobacion_completa check (
    (estado = 'aprobado') = (aprobado_en is not null)
  ),
  constraint cp_documento_rechazo_motivo check (
    estado <> 'rechazado' or (rechazo_motivo is not null and char_length(rechazo_motivo) between 1 and 500)
  ),
  constraint cp_documento_purga_coherente check (
    purgado_en is null or (storage_ruta is null and texto_extracto is null)
  )
);
create index if not exists cp_documento_tenant_estado_idx
  on public.cp_documento (tenant_id, estado, created_at desc);
create index if not exists cp_documento_trabajo_idx
  on public.cp_documento (procesando_hasta) where estado = 'procesando';
create index if not exists cp_documento_retencion_idx
  on public.cp_documento (retener_hasta) where purgado_en is null;
create index if not exists cp_documento_viaje_idx
  on public.cp_documento (viaje_id) where viaje_id is not null;
comment on table public.cp_documento is
  'Documento de un cliente grande (PDF/foto/Excel/XML/correo) con su extracción, validación y revisión humana (0420). La fila sobrevive a la purga por retención sin contenido.';
comment on column public.cp_documento.version is
  'Candado optimista: cada cambio de la revisión sube 1 y exige la versión que el revisor vio. Dos revisores simultáneos no se pisan.';
comment on column public.cp_documento.riesgo_inyeccion is
  'El documento trae texto con forma de instrucción al modelo. Obliga a confirmar a mano cada campo crítico antes de aprobar.';
comment on column public.cp_documento.retener_hasta is
  'Cuándo se borran el archivo y el texto (datos personales de terceros). La app lo mueve: recibido 180 d, aprobado 365 d, rechazado/fallido 90 d.';

create table if not exists public.cp_documento_evento (
  id            bigint generated always as identity primary key,
  documento_id  uuid not null,
  tenant_id     uuid not null references public.tenant(id) on delete cascade,
  tipo          text not null,
  actor_id      uuid references public.app_user(id) on delete set null,
  -- Sin el CONTENIDO de los campos: nombres, conteos, motivos.
  detalle       jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  constraint cp_documento_evento_doc_tenant_fkey
    foreign key (documento_id, tenant_id) references public.cp_documento (id, tenant_id) on delete cascade,
  constraint cp_documento_evento_tipo_dominio check (tipo in (
    'recibido', 'duplicado_recibido', 'extraccion_iniciada', 'extraccion_ok', 'extraccion_fallida',
    'escalada', 'revision_abierta', 'campo_corregido', 'aprobado', 'rechazado', 'reabierto',
    'salida_viaje', 'exportado', 'perfil_aprendido', 'purgado'
  ))
);
create index if not exists cp_documento_evento_doc_idx on public.cp_documento_evento (documento_id, id);
create index if not exists cp_documento_evento_tenant_idx on public.cp_documento_evento (tenant_id, created_at desc);
comment on table public.cp_documento_evento is
  'Bitácora append-only de cada documento de Carta Porte (0420): quién hizo qué y cuándo, sin el contenido de los campos.';

create table if not exists public.cp_correccion (
  id            bigint generated always as identity primary key,
  documento_id  uuid not null,
  tenant_id     uuid not null references public.tenant(id) on delete cascade,
  campo         text not null,
  renglon       int,
  valor_antes   text,
  valor_despues text,
  actor_id      uuid references public.app_user(id) on delete set null,
  created_at    timestamptz not null default now(),
  constraint cp_correccion_doc_tenant_fkey
    foreign key (documento_id, tenant_id) references public.cp_documento (id, tenant_id) on delete cascade,
  constraint cp_correccion_campo_largo check (char_length(campo) between 1 and 60),
  constraint cp_correccion_renglon_pos check (renglon is null or renglon >= 0),
  constraint cp_correccion_valor_largo check (
    (valor_antes is null or char_length(valor_antes) <= 500) and (valor_despues is null or char_length(valor_despues) <= 500)
  )
);
create index if not exists cp_correccion_doc_idx on public.cp_correccion (documento_id, id);
create index if not exists cp_correccion_tenant_idx on public.cp_correccion (tenant_id, created_at desc);
comment on table public.cp_correccion is
  'Cada corrección humana campo a campo (0420). Es la materia prima del aprendizaje del perfil y de la métrica «% de documentos sin corrección».';

create table if not exists public.cp_perfil_version (
  perfil_id     uuid not null,
  tenant_id     uuid not null references public.tenant(id) on delete cascade,
  version       int not null,
  mapeos        jsonb not null default '[]'::jsonb,
  ejemplos      jsonb not null default '[]'::jsonb,
  nota          text,
  origen_documento_id uuid,
  creada_por    uuid references public.app_user(id) on delete set null,
  created_at    timestamptz not null default now(),
  primary key (perfil_id, version),
  constraint cp_perfil_version_perfil_tenant_fkey
    foreign key (perfil_id, tenant_id) references public.cp_perfil (id, tenant_id) on delete cascade,
  constraint cp_perfil_version_origen_fkey
    foreign key (origen_documento_id, tenant_id) references public.cp_documento (id, tenant_id) on delete set null (origen_documento_id),
  constraint cp_perfil_version_pos check (version >= 1),
  constraint cp_perfil_version_mapeos_forma check (jsonb_typeof(mapeos) = 'array' and jsonb_array_length(mapeos) <= 200),
  constraint cp_perfil_version_ejemplos_forma check (jsonb_typeof(ejemplos) = 'array' and jsonb_array_length(ejemplos) <= 5)
);
comment on table public.cp_perfil_version is
  'Versiones INMUTABLES de un perfil (0420): una corrección confirmada crea la versión siguiente; volver atrás es apuntar version_activa a una anterior, nunca editar una existente.';

create or replace function public.cp_perfil_version_inmutable() returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'cp_perfil_version es inmutable: crea una versión nueva en vez de editar la %', old.version
    using errcode = '23514';
end;
$$;
drop trigger if exists cp_perfil_version_sin_update on public.cp_perfil_version;
create trigger cp_perfil_version_sin_update
  before update on public.cp_perfil_version
  for each row execute function public.cp_perfil_version_inmutable();

create table if not exists public.cp_export_config (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenant(id) on delete cascade,
  nombre     text not null,
  formato    text not null,
  config     jsonb not null,
  activa     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cp_export_config_nombre_unico unique (tenant_id, nombre),
  constraint cp_export_config_nombre_largo check (char_length(nombre) between 1 and 80),
  constraint cp_export_config_formato_dominio check (formato in ('csv', 'json')),
  constraint cp_export_config_forma check (jsonb_typeof(config) = 'object')
);
comment on table public.cp_export_config is
  'Mapeo configurable al formato destino de la flota (0420): el formato real del cliente de demo NO se conoce, así que columnas y nombres se declaran aquí, no en código.';

-- El renglón de mercancía recuerda de qué documento nació: al volver a aprobar el
-- documento se reemplazan SOLO esos renglones, nunca los capturados a mano.
alter table public.viaje_mercancia
  add column if not exists cp_documento_id uuid;
alter table public.viaje_mercancia
  drop constraint if exists viaje_mercancia_cp_documento_fkey;
alter table public.viaje_mercancia
  add constraint viaje_mercancia_cp_documento_fkey
    foreign key (cp_documento_id, tenant_id) references public.cp_documento (id, tenant_id) on delete set null (cp_documento_id);
create index if not exists viaje_mercancia_cp_documento_idx
  on public.viaje_mercancia (cp_documento_id) where cp_documento_id is not null;
comment on column public.viaje_mercancia.cp_documento_id is
  'El documento de cliente (cp_documento, 0420) del que se extrajo este renglón. NULL = capturado a mano.';

-- ── RLS: deny-all + service_role (el doble candado de la 0204) ──────────────
alter table public.cp_buzon enable row level security;
alter table public.cp_perfil enable row level security;
alter table public.cp_perfil_version enable row level security;
alter table public.cp_documento enable row level security;
alter table public.cp_documento_evento enable row level security;
alter table public.cp_correccion enable row level security;
alter table public.cp_export_config enable row level security;

revoke all on public.cp_buzon, public.cp_perfil, public.cp_perfil_version, public.cp_documento,
  public.cp_documento_evento, public.cp_correccion, public.cp_export_config from public, anon, authenticated;
grant select, insert, update, delete on public.cp_buzon, public.cp_perfil, public.cp_perfil_version,
  public.cp_documento, public.cp_correccion, public.cp_export_config to service_role;
-- La bitácora es append-only también para el servicio: en Supabase los privilegios
-- por defecto ya le dan TODO a service_role, así que primero se le quita.
revoke all on public.cp_documento_evento from service_role;
grant select, insert on public.cp_documento_evento to service_role;
grant usage, select on all sequences in schema public to service_role;

-- ── Bucket privado ──────────────────────────────────────────────────────────
-- Sin policies: la RLS de storage deniega a anon/authenticated por defecto y solo
-- el servicio escribe y firma (mismo criterio que la 0008 y la 0039).
insert into storage.buckets (id, name, public)
values ('cartaporte-docs', 'cartaporte-docs', false)
on conflict (id) do nothing;

-- ── El claim de procesamiento ───────────────────────────────────────────────
-- Un UPDATE condicional es atómico: de dos invocaciones simultáneas gana una y la
-- otra recibe cero filas. El lease (reloj de la BASE) deja que un worker muerto
-- suelte el documento; el tope de intentos evita pagar al modelo para siempre por
-- un archivo que no se deja leer.
create or replace function public.cp_documento_reclamar(p_tenant uuid, p_id uuid, p_lease_segundos int default 120)
returns table (intentos int, version int)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if p_lease_segundos is null or p_lease_segundos < 30 or p_lease_segundos > 900 then
    raise exception 'cp_documento_reclamar: p_lease_segundos fuera de rango (30-900)';
  end if;
  return query
  update public.cp_documento d
     set estado = 'procesando',
         procesando_hasta = now() + make_interval(secs => p_lease_segundos),
         intentos = d.intentos + 1,
         version = d.version + 1,
         updated_at = now()
   where d.id = p_id
     and d.tenant_id = p_tenant
     and d.purgado_en is null
     and d.intentos < 5
     and (
       d.estado in ('recibido', 'fallido')
       or (d.estado = 'procesando' and d.procesando_hasta < now())
     )
  returning d.intentos, d.version;
end;
$$;
revoke all on function public.cp_documento_reclamar(uuid, uuid, int) from public, anon, authenticated;
grant execute on function public.cp_documento_reclamar(uuid, uuid, int) to service_role;

-- ── Lo que ya venció ────────────────────────────────────────────────────────
create or replace function public.cp_documentos_vencidos(p_limite int default 100)
returns table (id uuid, tenant_id uuid, storage_ruta text)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if p_limite is null or p_limite < 1 or p_limite > 1000 then
    raise exception 'cp_documentos_vencidos: p_limite fuera de rango (1-1000)';
  end if;
  return query
  select d.id, d.tenant_id, d.storage_ruta
    from public.cp_documento d
   where d.purgado_en is null and d.retener_hasta < now()
   order by d.retener_hasta
   limit p_limite;
end;
$$;
revoke all on function public.cp_documentos_vencidos(int) from public, anon, authenticated;
grant execute on function public.cp_documentos_vencidos(int) to service_role;
