-- ═══════════════════════════════════════════════════════════════════════════
-- 0400 — VIGÍA DE SERVICIO AL CLIENTE (Agente 4)
--
-- Hasta hoy un número que no era chofer, oficina ni proveedor recibía «no te
-- tengo registrado como operador». Este agente le da un lugar a los CLIENTES de
-- la flota (el que espera su carga): sus chats entran por el mismo WhatsApp, se
-- clasifican, se contestan con datos reales del viaje y —con un toque del
-- gerente— salen. Lo que no se puede contestar, o huele a molestia, escala.
--
-- ── LA PUERTA ES UNA ALLOWLIST POR FLOTA ────────────────────────────────────
--
-- `vigia_contacto` es la lista de números de clientes que la flota AUTORIZÓ
-- (con su constancia de consentimiento). Un desconocido que no está aquí sigue
-- recibiendo la regla de siempre. Un número ACTIVO pertenece a UNA flota (índice
-- único parcial): el mensaje entrante trae solo el número, y si dos flotas lo
-- reclamaran no habría contexto que desempate — la misma regla que ya se aplica
-- a operador y app_user (contactos.ts). El cliente de la flota (`cliente`, 0048)
-- y sus viajes son la frontera de datos: el agente SOLO habla de viajes de ese
-- cliente en esa flota.
--
-- ── EL CICLO ────────────────────────────────────────────────────────────────
--
--   entrante ──► vigia_recibir_mensaje() (atómico: conversación + mensaje,
--                 dedupe por wamid) ──► clasificar ──► redactar con datos reales
--                 ──► saliente en borrador / pendiente_aprobacion
--                 ──► gerente: Enviar / No enviar / Yo me encargo (botones)
--                 ──► enviado  (selector enviarConFallback: 24 h → texto,
--                               fuera de ventana → plantilla)
--
--   Una respuesta al cliente nace SIEMPRE como saliente de estado `borrador` o
--   `pendiente_aprobacion`; solo pasa a `aprobado` por (a) un humano o (b) el
--   modo `autoenviar_bajo_riesgo` de la flota, y ese camino deja `autoenviado`.
--
-- ── DATOS PERSONALES DE CLIENTES FINALES ────────────────────────────────────
--
--   · Consentimiento: sin `consentimiento_en` y con `optout_en`, no se envía.
--   · Opt-out: «BAJA» corta de inmediato (`estado = 'baja'`).
--   · Retención: `vigia_purgar` borra los mensajes más viejos que
--     `vigia_config.retencion_dias` (180 por omisión; 30–730).
--   · ARCO (cancelación): `vigia_suprimir_contacto` borra mensajes y
--     conversaciones y deja el contacto como `suprimido`, sin teléfono en claro.
--   · La bitácora (`vigia_evento`) NO guarda texto ni teléfono: solo hashes.
--
-- Todo lo escribe el servidor (service_role). RLS de lectura: la flota
-- (flota_admin y encargado; el contador no atiende clientes).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Quién ve la atención al cliente, en la base ────────────────────────────
-- Espeja `/dashboard/agentes/vigia`: área `operacion` (superadmin, flota_admin,
-- encargado). Mismo motivo que `ve_finanzas()` (0048): sin sesión de panel,
-- cualquiera con la anon key le pregunta a PostgREST directo.
create or replace function public.ve_atencion_cliente()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.app_user
    where id = auth.uid()
      and rol in ('superadmin', 'flota_admin', 'encargado')
  );
$$;
revoke execute on function public.ve_atencion_cliente() from anon, public;
grant execute on function public.ve_atencion_cliente() to authenticated, service_role;
comment on function public.ve_atencion_cliente is
  '0400: TRUE si el usuario atiende a clientes finales (superadmin, flota_admin, encargado). El contador no.';

-- ── Configuración por flota ────────────────────────────────────────────────
create table if not exists public.vigia_config (
  tenant_id                 uuid primary key references public.tenant(id) on delete cascade,
  -- Apagado por omisión y falla CERRADO: una flota sin fila no recibe ningún
  -- mensaje de este agente.
  habilitado                boolean not null default false,
  modo_aprobacion           text not null default 'siempre',
  -- Cuántas respuestas de la MISMA intención el gerente tiene que haber
  -- aprobado sin editarlas para que el agente pueda autoenviar esa intención.
  autoenviar_min_aprobaciones int not null default 5,
  -- Minutos que un cliente puede esperar respuesta antes de avisar al gerente
  -- responsable (nivel 1) y minutos ADICIONALES para subir al dueño (nivel 2).
  sla_respuesta_min         int not null default 30,
  escalar_nivel2_min        int not null default 60,
  retencion_dias            int not null default 180,
  aviso_privacidad_url      text,
  updated_at                timestamptz not null default now(),
  updated_by                uuid,
  constraint vigia_config_modo_dominio check (modo_aprobacion in ('siempre', 'autoenviar_bajo_riesgo')),
  constraint vigia_config_min_aprob check (autoenviar_min_aprobaciones between 1 and 100),
  constraint vigia_config_sla check (sla_respuesta_min between 5 and 1440),
  constraint vigia_config_nivel2 check (escalar_nivel2_min between 5 and 2880),
  constraint vigia_config_retencion check (retencion_dias between 30 and 730),
  constraint vigia_config_aviso_url check (aviso_privacidad_url is null or aviso_privacidad_url ~ '^https://[^[:space:]]{1,480}$')
);
comment on table public.vigia_config is
  '0400: palancas del Vigía de servicio al cliente por flota. Sin fila = apagado (falla cerrado).';
comment on column public.vigia_config.modo_aprobacion is
  'siempre = el gerente aprueba cada respuesta. autoenviar_bajo_riesgo = el agente envía solo las intenciones de bajo riesgo que el gerente ya validó autoenviar_min_aprobaciones veces sin editar.';

-- ── Contactos autorizados (la allowlist) ───────────────────────────────────
create table if not exists public.vigia_contacto (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.tenant(id) on delete cascade,
  cliente_id            uuid not null,
  -- 52 + 10 dígitos (misma forma que wa_normalizar_telefono). `suprimido` lo
  -- sustituye por el hash: el número en claro ya no existe.
  telefono              text not null,
  telefono_hash         text not null,
  nombre                text,
  -- Quién de la flota atiende a este cliente (app_user). NULL = el jefe de la flota.
  gerente_user_id       uuid references public.app_user(id) on delete set null,
  estado                text not null default 'activo',
  consentimiento_en     timestamptz,
  consentimiento_origen text,
  optout_en             timestamptz,
  aviso_privacidad_en   timestamptz,
  suprimido_en          timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint vigia_contacto_id_tenant_key unique (id, tenant_id),
  constraint vigia_contacto_cliente_tenant_fkey
    foreign key (cliente_id, tenant_id) references public.cliente (id, tenant_id) on delete cascade,
  constraint vigia_contacto_estado_dominio check (estado in ('activo', 'baja', 'suprimido')),
  constraint vigia_contacto_telefono_forma check (
    (estado <> 'suprimido' and telefono ~ '^[1-9][0-9]{7,14}$')
    or (estado = 'suprimido' and telefono = 'suprimido:' || telefono_hash)
  ),
  constraint vigia_contacto_hash_forma check (telefono_hash ~ '^[0-9a-f]{64}$'),
  constraint vigia_contacto_consent_origen check (
    consentimiento_origen is null or consentimiento_origen in ('alta_flota', 'mensaje_cliente')
  ),
  constraint vigia_contacto_nombre_largo check (nombre is null or char_length(nombre) <= 120),
  -- Un contacto ACTIVO sin constancia de consentimiento no puede existir: es la
  -- condición para que el agente le escriba.
  constraint vigia_contacto_activo_consentido check (
    estado <> 'activo' or (consentimiento_en is not null and optout_en is null)
  )
);
-- Un número ACTIVO = una flota (ver encabezado).
create unique index if not exists vigia_contacto_telefono_activo_uq
  on public.vigia_contacto (telefono) where estado = 'activo';
create index if not exists vigia_contacto_tenant_idx
  on public.vigia_contacto (tenant_id, estado, created_at desc);
create index if not exists vigia_contacto_cliente_idx
  on public.vigia_contacto (tenant_id, cliente_id);
comment on table public.vigia_contacto is
  '0400: allowlist de clientes finales que la flota autorizó para el Vigía (con consentimiento). Un número activo pertenece a UNA flota.';

-- ── Conversaciones ─────────────────────────────────────────────────────────
create table if not exists public.vigia_conversacion (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenant(id) on delete cascade,
  contacto_id         uuid not null,
  cliente_id          uuid not null,
  -- El viaje del que se está hablando (el último que el agente identificó).
  viaje_id            uuid,
  estado              text not null default 'activa',
  -- Quién lleva el hilo: el agente redacta borradores; si un humano lo toma,
  -- el agente deja de redactar y solo registra.
  control             text not null default 'agente',
  tomada_por          uuid,
  tomada_en           timestamptz,
  ultima_entrada_en   timestamptz,
  ultima_salida_en    timestamptz,
  -- Desde cuándo espera el cliente (su mensaje más viejo sin respuesta).
  -- NULL = nadie espera. Es lo que el SLA mide.
  sin_respuesta_desde timestamptz,
  -- Insistencia: mensajes del cliente desde la última respuesta.
  entradas_sin_respuesta int not null default 0,
  molestia_nivel      smallint not null default 0,
  molestia_motivos    text[] not null default '{}',
  molestia_en         timestamptz,
  -- El nivel más alto ya avisado EN ESTE ciclo de espera (0 = ninguno).
  escalamiento_nivel  smallint not null default 0,
  escalado_en         timestamptz,
  -- Un humano ya se hizo cargo de la excepción: se detiene la escalera.
  atendida_en         timestamptz,
  atendida_por        uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  cerrada_en          timestamptz,
  constraint vigia_conversacion_id_tenant_key unique (id, tenant_id),
  constraint vigia_conversacion_contacto_tenant_fkey
    foreign key (contacto_id, tenant_id) references public.vigia_contacto (id, tenant_id) on delete cascade,
  constraint vigia_conversacion_cliente_tenant_fkey
    foreign key (cliente_id, tenant_id) references public.cliente (id, tenant_id) on delete cascade,
  constraint vigia_conversacion_viaje_tenant_fkey
    foreign key (viaje_id, tenant_id) references public.viaje (id, tenant_id) on delete set null (viaje_id),
  constraint vigia_conversacion_estado_dominio check (estado in ('activa', 'cerrada')),
  constraint vigia_conversacion_control_dominio check (control in ('agente', 'humano')),
  constraint vigia_conversacion_molestia_rango check (molestia_nivel between 0 and 3),
  constraint vigia_conversacion_escalamiento_rango check (escalamiento_nivel between 0 and 2),
  constraint vigia_conversacion_contadores check (entradas_sin_respuesta >= 0),
  constraint vigia_conversacion_humano_tiene_quien check (control <> 'humano' or tomada_en is not null)
);
-- UNA conversación activa por contacto: dos entrantes simultáneos no abren dos hilos.
create unique index if not exists vigia_conversacion_activa_uq
  on public.vigia_conversacion (contacto_id) where estado = 'activa';
create index if not exists vigia_conversacion_tenant_idx
  on public.vigia_conversacion (tenant_id, estado, updated_at desc);
-- Lo que el cron del SLA mira: hilos activos donde alguien espera.
create index if not exists vigia_conversacion_espera_idx
  on public.vigia_conversacion (sin_respuesta_desde)
  where estado = 'activa' and sin_respuesta_desde is not null;
comment on table public.vigia_conversacion is
  '0400: un hilo activo por contacto. sin_respuesta_desde es el reloj del SLA; control = quién lleva el hilo (agente o humano).';

-- ── Mensajes ───────────────────────────────────────────────────────────────
create table if not exists public.vigia_mensaje (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenant(id) on delete cascade,
  conversacion_id  uuid not null,
  direccion        text not null,
  autor            text not null,
  -- El id de WhatsApp: dedupe de lo entrante (Meta reentrega) y constancia de lo saliente.
  wamid            text,
  tipo             text not null default 'texto',
  texto            text,
  intencion        text,
  confianza        numeric(3,2),
  clasificador     text,
  senales          text[] not null default '{}',
  estado           text not null,
  respuesta_a      uuid,
  datos_respaldo   jsonb,
  riesgo           text,
  autoenviado      boolean not null default false,
  editado          boolean not null default false,
  aprobado_por     uuid,
  aprobado_en      timestamptz,
  motivo_rechazo   text,
  enviado_en       timestamptz,
  via              text,
  error            text,
  aviso_gerente_en timestamptz,
  created_at       timestamptz not null default now(),
  constraint vigia_mensaje_id_tenant_key unique (id, tenant_id),
  constraint vigia_mensaje_conversacion_tenant_fkey
    foreign key (conversacion_id, tenant_id) references public.vigia_conversacion (id, tenant_id) on delete cascade,
  constraint vigia_mensaje_respuesta_a_fkey
    foreign key (respuesta_a, tenant_id) references public.vigia_mensaje (id, tenant_id) on delete set null (respuesta_a),
  constraint vigia_mensaje_direccion_dominio check (direccion in ('entrante', 'saliente')),
  constraint vigia_mensaje_autor_dominio check (autor in ('cliente', 'agente', 'humano')),
  constraint vigia_mensaje_autor_coherente check (
    (direccion = 'entrante' and autor = 'cliente') or (direccion = 'saliente' and autor in ('agente', 'humano'))
  ),
  constraint vigia_mensaje_tipo_dominio check (tipo in ('texto', 'imagen', 'audio', 'documento', 'ubicacion', 'otro')),
  constraint vigia_mensaje_estado_dominio check (
    estado in ('recibido', 'borrador', 'pendiente_aprobacion', 'aprobado', 'enviado', 'rechazado', 'fallido', 'descartado')
  ),
  constraint vigia_mensaje_estado_coherente check ((direccion = 'entrante') = (estado = 'recibido')),
  constraint vigia_mensaje_intencion_dominio check (
    intencion is null or intencion in ('ubicacion', 'eta', 'documentos', 'factura_pod', 'queja', 'pide_humano', 'baja', 'saludo', 'otro')
  ),
  constraint vigia_mensaje_clasificador_dominio check (clasificador is null or clasificador in ('reglas', 'modelo', 'ninguno')),
  constraint vigia_mensaje_confianza_rango check (confianza is null or confianza between 0 and 1),
  constraint vigia_mensaje_riesgo_dominio check (riesgo is null or riesgo in ('bajo', 'medio', 'alto')),
  constraint vigia_mensaje_via_dominio check (via is null or via in ('texto', 'botones', 'plantilla')),
  constraint vigia_mensaje_texto_largo check (texto is null or char_length(texto) <= 4000),
  -- Un «enviado» sin hora ni vía es una constancia a medias.
  constraint vigia_mensaje_enviado_completo check (estado <> 'enviado' or (enviado_en is not null and via is not null)),
  -- Aprobado por nadie solo es válido si fue el modo autoenviar (y deja rastro).
  constraint vigia_mensaje_aprobado_tiene_quien check (
    estado not in ('aprobado', 'enviado') or aprobado_por is not null or autoenviado
  ),
  constraint vigia_mensaje_autoenviado_solo_agente check (not autoenviado or autor = 'agente')
);
-- Dedupe de lo entrante y constancia de lo saliente: un wamid es un mensaje por flota.
create unique index if not exists vigia_mensaje_wamid_uq
  on public.vigia_mensaje (tenant_id, wamid) where wamid is not null;
-- UNA respuesta del agente por mensaje entrante: dos pasadas concurrentes no
-- redactan dos borradores para el mismo mensaje.
create unique index if not exists vigia_mensaje_una_respuesta_agente_uq
  on public.vigia_mensaje (tenant_id, respuesta_a)
  where autor = 'agente' and respuesta_a is not null;
create index if not exists vigia_mensaje_conversacion_idx
  on public.vigia_mensaje (conversacion_id, created_at, id);
create index if not exists vigia_mensaje_cola_idx
  on public.vigia_mensaje (tenant_id, created_at)
  where estado = 'pendiente_aprobacion';
create index if not exists vigia_mensaje_creado_idx
  on public.vigia_mensaje (created_at);
comment on table public.vigia_mensaje is
  '0400: mensajes del hilo con el cliente. Una respuesta del agente nace en borrador/pendiente_aprobacion; solo un humano (o el modo autoenviar de la flota, con autoenviado=true) la pasa a aprobado. Retención: vigia_purgar.';
comment on column public.vigia_mensaje.datos_respaldo is
  'Los datos reales del viaje con los que se redactó la respuesta (posición, último hito, documentos faltantes…). Es la prueba de que cada cifra del texto salió de un dato.';

-- ── Bitácora (append-only, sin texto ni teléfono) ──────────────────────────
create table if not exists public.vigia_evento (
  id                bigint generated always as identity primary key,
  tenant_id         uuid not null references public.tenant(id) on delete cascade,
  conversacion_id   uuid,
  tipo              text not null,
  -- Idempotencia de las acciones que no deben repetirse (un nivel de
  -- escalamiento por ciclo de espera). NULL = no aplica.
  clave             text,
  nivel             smallint,
  actor_user_id     uuid,
  destinatario_hash text,
  detalle           jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  constraint vigia_evento_conversacion_tenant_fkey
    foreign key (conversacion_id, tenant_id) references public.vigia_conversacion (id, tenant_id) on delete cascade,
  constraint vigia_evento_tipo_dominio check (tipo in (
    'entrante', 'borrador', 'aprobado', 'rechazado', 'enviado', 'autoenviado', 'fallo_envio',
    'tomada', 'devuelta', 'cerrada', 'molestia', 'sin_respuesta', 'escalada', 'sin_destinatario',
    'optout', 'alta', 'baja_manual', 'suprimido', 'spam', 'sin_dato', 'inyeccion', 'otro_cliente'
  )),
  constraint vigia_evento_nivel_rango check (nivel is null or nivel between 0 and 3),
  constraint vigia_evento_hash_forma check (destinatario_hash is null or destinatario_hash ~ '^[0-9a-f]{64}$')
);
create unique index if not exists vigia_evento_clave_uq
  on public.vigia_evento (tenant_id, clave) where clave is not null;
create index if not exists vigia_evento_conversacion_idx
  on public.vigia_evento (conversacion_id, id);
create index if not exists vigia_evento_tenant_idx
  on public.vigia_evento (tenant_id, created_at desc);
comment on table public.vigia_evento is
  '0400: bitácora append-only del Vigía (entrantes, borradores, aprobaciones, envíos, molestias, escalamientos por nivel). NO guarda texto del cliente ni teléfonos: solo ids y hashes.';

-- ── RLS ────────────────────────────────────────────────────────────────────
alter table public.vigia_config enable row level security;
alter table public.vigia_contacto enable row level security;
alter table public.vigia_conversacion enable row level security;
alter table public.vigia_mensaje enable row level security;
alter table public.vigia_evento enable row level security;

drop policy if exists tenant_lee on public.vigia_config;
create policy tenant_lee on public.vigia_config for select
  using ((tenant_id = any(get_user_tenant_ids()) and ve_atencion_cliente()) or is_superadmin());
drop policy if exists tenant_lee on public.vigia_contacto;
create policy tenant_lee on public.vigia_contacto for select
  using ((tenant_id = any(get_user_tenant_ids()) and ve_atencion_cliente()) or is_superadmin());
drop policy if exists tenant_lee on public.vigia_conversacion;
create policy tenant_lee on public.vigia_conversacion for select
  using ((tenant_id = any(get_user_tenant_ids()) and ve_atencion_cliente()) or is_superadmin());
drop policy if exists tenant_lee on public.vigia_mensaje;
create policy tenant_lee on public.vigia_mensaje for select
  using ((tenant_id = any(get_user_tenant_ids()) and ve_atencion_cliente()) or is_superadmin());
drop policy if exists tenant_lee on public.vigia_evento;
create policy tenant_lee on public.vigia_evento for select
  using ((tenant_id = any(get_user_tenant_ids()) and ve_atencion_cliente()) or is_superadmin());

-- Escritura: ninguna política — solo service_role, que es quien escribe.
revoke all on table public.vigia_config, public.vigia_contacto, public.vigia_conversacion,
  public.vigia_mensaje, public.vigia_evento from public, anon, authenticated;
grant select on table public.vigia_config, public.vigia_contacto, public.vigia_conversacion,
  public.vigia_mensaje, public.vigia_evento to authenticated;
grant select, insert, update, delete on table public.vigia_config, public.vigia_contacto,
  public.vigia_conversacion, public.vigia_mensaje to service_role;
grant select, insert, delete on table public.vigia_evento to service_role;
grant usage, select on sequence public.vigia_evento_id_seq to service_role;

-- ── Ingesta atómica de un mensaje entrante ─────────────────────────────────
-- UNA transacción: abre (o reutiliza) la conversación activa del contacto,
-- inserta el mensaje con dedupe por wamid y actualiza el reloj del SLA y el
-- contador de insistencia. El mismo wamid repetido (Meta reentrega) NO cambia
-- nada y devuelve duplicado = true. El lock por contacto serializa dos entrantes
-- simultáneos del mismo cliente (si no, ambos cuentan la insistencia sobre el
-- mismo valor viejo).
create or replace function public.vigia_recibir_mensaje(
  p_tenant uuid, p_contacto uuid, p_wamid text, p_tipo text, p_texto text,
  p_ahora timestamptz default now()
) returns table (
  mensaje_id uuid, conversacion_id uuid, duplicado boolean,
  entradas_sin_respuesta integer, sin_respuesta_desde timestamptz,
  control text, cliente_id uuid, viaje_id uuid
)
language plpgsql security definer
set search_path = ''
as $$
declare
  v_contacto public.vigia_contacto%rowtype;
  v_conv public.vigia_conversacion%rowtype;
  v_msg uuid;
  v_ahora timestamptz := least(coalesce(p_ahora, clock_timestamp()), clock_timestamp());
begin
  select * into v_contacto from public.vigia_contacto
   where id = p_contacto and tenant_id = p_tenant and estado = 'activo';
  if not found then
    raise exception 'contacto no autorizado para el vigía' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_contacto::text, 4));

  select * into v_conv from public.vigia_conversacion
   where contacto_id = p_contacto and tenant_id = p_tenant and estado = 'activa';
  if not found then
    insert into public.vigia_conversacion (tenant_id, contacto_id, cliente_id)
    values (p_tenant, p_contacto, v_contacto.cliente_id)
    returning * into v_conv;
  end if;

  insert into public.vigia_mensaje (tenant_id, conversacion_id, direccion, autor, wamid, tipo, texto, estado, created_at)
  values (p_tenant, v_conv.id, 'entrante', 'cliente', nullif(btrim(p_wamid), ''),
          coalesce(p_tipo, 'texto'), left(p_texto, 4000), 'recibido', v_ahora)
  on conflict (tenant_id, wamid) where wamid is not null do nothing
  returning id into v_msg;

  if v_msg is null then
    -- Repetido: se devuelve el mensaje que ya existía, sin tocar el hilo.
    select m.id into v_msg from public.vigia_mensaje m
     where m.tenant_id = p_tenant and m.wamid = nullif(btrim(p_wamid), '');
    return query select v_msg, v_conv.id, true, v_conv.entradas_sin_respuesta,
      v_conv.sin_respuesta_desde, v_conv.control, v_conv.cliente_id, v_conv.viaje_id;
    return;
  end if;

  update public.vigia_conversacion c set
    ultima_entrada_en = greatest(coalesce(c.ultima_entrada_en, v_ahora), v_ahora),
    sin_respuesta_desde = coalesce(c.sin_respuesta_desde, v_ahora),
    entradas_sin_respuesta = c.entradas_sin_respuesta + 1,
    updated_at = clock_timestamp()
   where c.id = v_conv.id
   returning * into v_conv;

  return query select v_msg, v_conv.id, false, v_conv.entradas_sin_respuesta,
    v_conv.sin_respuesta_desde, v_conv.control, v_conv.cliente_id, v_conv.viaje_id;
end $$;
revoke all on function public.vigia_recibir_mensaje(uuid, uuid, text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.vigia_recibir_mensaje(uuid, uuid, text, text, text, timestamptz) to service_role;

-- ── Retención ──────────────────────────────────────────────────────────────
-- Borra los mensajes más viejos que la retención de SU flota (180 días por
-- omisión) y las conversaciones cerradas que se quedaron sin mensajes. Acotada
-- por lote. La corre el cron `vigia`.
create or replace function public.vigia_purgar(
  p_limite integer default 500
) returns integer
language plpgsql security definer
set search_path = ''
as $$
declare v_n integer; v_c integer;
begin
  if p_limite < 1 or p_limite > 10000 then raise exception 'límite de purga inválido'; end if;
  with viejos as (
    select m.id from public.vigia_mensaje m
      left join public.vigia_config c on c.tenant_id = m.tenant_id
     where m.created_at < now() - make_interval(days => coalesce(c.retencion_dias, 180))
     order by m.created_at limit p_limite
  )
  delete from public.vigia_mensaje m using viejos v where m.id = v.id;
  get diagnostics v_n = row_count;

  delete from public.vigia_conversacion c
   where c.estado = 'cerrada'
     and c.cerrada_en < now() - interval '30 days'
     and not exists (select 1 from public.vigia_mensaje m where m.conversacion_id = c.id);
  get diagnostics v_c = row_count;
  return v_n + v_c;
end $$;
revoke all on function public.vigia_purgar(integer) from public, anon, authenticated;
grant execute on function public.vigia_purgar(integer) to service_role;

-- ── ARCO · cancelación de un cliente final ─────────────────────────────────
-- Borra los mensajes y las conversaciones del contacto y lo deja `suprimido`
-- SIN teléfono en claro (queda solo su hash, para no reabrirlo por error y para
-- que la constancia diga a quién se le suprimió sin guardarlo). También borra
-- la fila de ventana de 24 h de ese número. La bitácora conserva solo ids.
create or replace function public.vigia_suprimir_contacto(
  p_tenant uuid, p_contacto uuid
) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_tel text; v_hash text; v_msgs integer; v_convs integer;
begin
  select telefono, telefono_hash into v_tel, v_hash from public.vigia_contacto
   where id = p_contacto and tenant_id = p_tenant for update;
  if not found then raise exception 'contacto inexistente en esta flota' using errcode = 'P0001'; end if;

  delete from public.vigia_mensaje m using public.vigia_conversacion c
   where m.conversacion_id = c.id and c.contacto_id = p_contacto and c.tenant_id = p_tenant and m.tenant_id = p_tenant;
  get diagnostics v_msgs = row_count;
  delete from public.vigia_conversacion where contacto_id = p_contacto and tenant_id = p_tenant;
  get diagnostics v_convs = row_count;

  if v_tel ~ '^[1-9][0-9]{7,14}$' then
    delete from public.wa_ventana_contacto where telefono = v_tel;
  end if;

  update public.vigia_contacto set
    estado = 'suprimido', telefono = 'suprimido:' || telefono_hash, nombre = null,
    consentimiento_en = null, consentimiento_origen = null, aviso_privacidad_en = null,
    gerente_user_id = null, suprimido_en = now(), updated_at = now()
   where id = p_contacto and tenant_id = p_tenant;

  insert into public.vigia_evento (tenant_id, tipo, destinatario_hash, detalle)
  values (p_tenant, 'suprimido', v_hash, jsonb_build_object('mensajes', v_msgs, 'conversaciones', v_convs));
  return jsonb_build_object('mensajes', v_msgs, 'conversaciones', v_convs);
end $$;
revoke all on function public.vigia_suprimir_contacto(uuid, uuid) from public, anon, authenticated;
grant execute on function public.vigia_suprimir_contacto(uuid, uuid) to service_role;

-- ── El rol de modelo del Vigía ─────────────────────────────────────────────
-- `agente_definicion_modelo_rol_dominio` se enumera ENTERO cada vez (0125/0311):
-- agente_definicion_modelo_rol_dominio.test.ts lo cruza contra ModelRole.
-- Se recrea con la lista COMPLETA más `vigia_cliente`.
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'agente_definicion_modelo_rol_dominio'
      and conrelid = 'public.agente_definicion'::regclass
  ) then
    alter table public.agente_definicion drop constraint agente_definicion_modelo_rol_dominio;
  end if;
  alter table public.agente_definicion
    add constraint agente_definicion_modelo_rol_dominio
    check (modelo_rol is null or modelo_rol in (
      'ocr', 'cuadre', 'cuadre_fallback', 'chat', 'back_office', 'analisis', 'extraccion',
      'marketing', 'codigo', 'codigo_escritura', 'qa', 'piloto', 'transcripcion', 'contador',
      'vigia_cliente'
    ));
end $$;
