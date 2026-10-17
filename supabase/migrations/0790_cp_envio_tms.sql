-- ═══════════════════════════════════════════════════════════════════════════
-- 0790 — Carta Porte: envíos a la plantilla/API del sistema del cliente (TMS), configuración de salida,
--        revisor asignado y eventos del envío.
--
-- Qué es: el documento que la flota aprueba se TRADUCE a la plantilla del sistema de su cliente y se sube
-- (por su API o a mano). El reque se sigue haciendo a mano allá; si el reque todavía no existe, el envío se
-- queda PENDIENTE y se reintenta cada cierto tiempo, avisando UNA sola vez a la oficina y dejando el repositorio
-- de lo pendiente en este software (no en el correo ya recibido). Aquí solo viven los datos y los candados; la
-- máquina de estados, el backoff y el puerto al TMS son código aparte.
--
--   · cp_envio_tms: un envío por documento ACTIVO (índice parcial único) con su llave de idempotencia, su estado,
--     el lease del reintento (reloj de la BASE) y el candado de la alerta única. `errores` y `ultimo_error` guardan
--     solo hoja/fila/campo/código, NUNCA el contenido de los campos del documento (regla de retención de la 0420) y
--     están acotados a 8 KB.
--   · cp_salida_config: una fila por flota con los valores de ARRANQUE (el cliente no definió reintentos, frecuencia
--     ni destinatario): defaults declarados y editables, no decisiones del cliente.
--   · cp_documento.revisor_asignado: a quién le toca revisar (solo ADD COLUMN; ninguna RPC existente se toca).
--   · cp_documento_evento.tipo: el CHECK se recrea ENTERO (los 18 vigentes de la 0670 + 8 nuevos).
--   · RPC propias (security definer, solo service_role): cp_envio_reclamar (lease), cp_envio_marcar_alerta y
--     cp_envio_liberar_alerta (candado de alerta única, mismo patrón del aviso único de la 0641).
--
-- No redefine ninguna función ni constraint de la 0420–0695 salvo el CHECK de tipos de evento (reescrito entero).
-- Deny-all + service_role. FK compuestas (id, tenant_id): un envío no cuelga de un documento de otra flota.
-- Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Envíos al TMS ───────────────────────────────────────────────────────────
create table if not exists public.cp_envio_tms (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenant(id) on delete cascade,
  documento_id      uuid not null,
  -- La versión del documento con la que se armó la plantilla: si el documento cambia, el envío viejo no vale.
  version_doc       int  not null,
  idempotency_key   text not null,
  estado            text not null default 'pendiente_prechequeo',
  plantilla         text not null default 'normal',
  plantilla_sha256  text,
  intentos          int  not null default 0,
  proxima_revision  timestamptz,
  procesando_hasta  timestamptz,
  referencia_tms    text,
  -- Solo códigos, hoja, fila y nombre de campo; nunca el valor del campo.
  ultimo_error      jsonb,
  errores           jsonb not null default '[]'::jsonb,
  alerta_enviada_en timestamptz,
  enviado_en        timestamptz,
  causa_pendiente   text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint cp_envio_tms_doc_tenant_fkey
    foreign key (documento_id, tenant_id) references public.cp_documento (id, tenant_id) on delete cascade,
  constraint cp_envio_tms_id_tenant_key unique (id, tenant_id),
  constraint cp_envio_tms_llave_unica unique (tenant_id, idempotency_key),
  constraint cp_envio_tms_estado_dominio check (estado in (
    'pendiente_prechequeo', 'pendiente_reque', 'listo', 'enviando', 'enviado',
    'rechazado_tms', 'error_transitorio', 'subido_a_mano', 'descartado'
  )),
  constraint cp_envio_tms_plantilla_dominio check (plantilla in ('normal', 'nueva')),
  constraint cp_envio_tms_version_doc check (version_doc >= 1),
  constraint cp_envio_tms_intentos check (intentos >= 0),
  constraint cp_envio_tms_llave_largo check (char_length(idempotency_key) between 8 and 200),
  constraint cp_envio_tms_sha_forma check (plantilla_sha256 is null or plantilla_sha256 ~ '^[0-9a-f]{64}$'),
  constraint cp_envio_tms_referencia_largo check (referencia_tms is null or char_length(referencia_tms) <= 200),
  constraint cp_envio_tms_causa_largo check (causa_pendiente is null or char_length(causa_pendiente) <= 200),
  constraint cp_envio_tms_errores_forma check (jsonb_typeof(errores) = 'array'),
  constraint cp_envio_tms_errores_tope check (pg_column_size(errores) <= 8192),
  constraint cp_envio_tms_ultimo_error_tope check (ultimo_error is null or pg_column_size(ultimo_error) <= 8192),
  constraint cp_envio_tms_enviado_coherente check (estado <> 'enviado' or enviado_en is not null)
);
-- Un solo envío ACTIVO por documento. Los terminales (enviado, rechazado, subido a mano, descartado) no estorban:
-- un documento corregido puede volver a enviarse.
create unique index if not exists cp_envio_tms_activo_uq
  on public.cp_envio_tms (tenant_id, documento_id)
  where estado not in ('descartado', 'rechazado_tms', 'subido_a_mano', 'enviado');
create index if not exists cp_envio_tms_cola_idx
  on public.cp_envio_tms (proxima_revision, id)
  where estado in ('pendiente_prechequeo', 'pendiente_reque', 'listo', 'error_transitorio', 'enviando');
create index if not exists cp_envio_tms_doc_idx on public.cp_envio_tms (tenant_id, documento_id, created_at desc);
comment on table public.cp_envio_tms is
  'Envío de un documento de Carta Porte a la plantilla/API del TMS del cliente (0790): estado, reintentos con lease, alerta única y errores SIN contenido de campos. El reque y el timbrado se hacen a mano en el TMS; aquí solo se prepara y sube la plantilla.';

alter table public.cp_envio_tms enable row level security;
revoke all on public.cp_envio_tms from public, anon, authenticated;
grant select, insert, update, delete on public.cp_envio_tms to service_role;

-- ── Configuración de salida por flota ───────────────────────────────────────
create table if not exists public.cp_salida_config (
  tenant_id                   uuid primary key references public.tenant(id) on delete cascade,
  modo                        text not null default 'descarga',
  plantilla_por_defecto       text not null default 'normal',
  -- VALORES DE ARRANQUE: el cliente no definió reintentos ni frecuencia; son editables.
  reintentos_max              int  not null default 6,
  frecuencia_min              int  not null default 60,
  ventana_inicio              time,
  ventana_fin                 time,
  destinatario_alerta_correo  text,
  destinatario_alerta_usuario uuid references public.app_user(id) on delete set null,
  destinatario_revision_usuario uuid references public.app_user(id) on delete set null,
  destinatario_revision_correo text,
  si_tms_desconocido          text not null default 'retener',
  distancia_formato           text not null default 'texto_km',
  layout                      jsonb,
  updated_by                  uuid references public.app_user(id) on delete set null,
  updated_at                  timestamptz not null default now(),
  constraint cp_salida_config_modo_dominio check (modo in ('descarga', 'api')),
  constraint cp_salida_config_plantilla_dominio check (plantilla_por_defecto in ('normal', 'nueva')),
  constraint cp_salida_config_reintentos_rango check (reintentos_max between 0 and 50),
  constraint cp_salida_config_frecuencia_rango check (frecuencia_min between 5 and 1440),
  constraint cp_salida_config_ventana_par check ((ventana_inicio is null) = (ventana_fin is null)),
  constraint cp_salida_config_correo_alerta check (
    destinatario_alerta_correo is null
    or (char_length(destinatario_alerta_correo) <= 254 and destinatario_alerta_correo ~ '^[^@\s]+@[^@\s]+$')),
  constraint cp_salida_config_correo_revision check (
    destinatario_revision_correo is null
    or (char_length(destinatario_revision_correo) <= 254 and destinatario_revision_correo ~ '^[^@\s]+@[^@\s]+$')),
  constraint cp_salida_config_desconocido_dominio check (si_tms_desconocido in ('retener', 'enviar')),
  constraint cp_salida_config_distancia_dominio check (distancia_formato in ('texto_km', 'numero')),
  constraint cp_salida_config_layout_forma check (layout is null or jsonb_typeof(layout) = 'object'),
  constraint cp_salida_config_layout_tope check (layout is null or pg_column_size(layout) <= 65536)
);
comment on table public.cp_salida_config is
  'Configuración de salida de Carta Porte por flota (0790). Reintentos, frecuencia y destinatarios son valores de ARRANQUE declarados y editables: el cliente aún no los definió.';

alter table public.cp_salida_config enable row level security;
revoke all on public.cp_salida_config from public, anon, authenticated;
grant select, insert, update, delete on public.cp_salida_config to service_role;

-- ── Revisor asignado (solo ADD COLUMN) ──────────────────────────────────────
alter table public.cp_documento
  add column if not exists revisor_asignado uuid references public.app_user(id) on delete set null;
comment on column public.cp_documento.revisor_asignado is
  'Usuario de la oficina al que le toca revisar este documento (0790); NULL = sin asignar (le llega a quien configure cp_salida_config).';

-- ── Tipos de evento: la lista ENTERA (0670) + los del envío ────────────────
alter table public.cp_documento_evento drop constraint if exists cp_documento_evento_tipo_dominio;
alter table public.cp_documento_evento
  add constraint cp_documento_evento_tipo_dominio
  check (tipo in (
    'recibido', 'duplicado_recibido', 'extraccion_iniciada', 'extraccion_ok', 'extraccion_fallida',
    'escalada', 'revision_abierta', 'campo_corregido', 'aprobado', 'rechazado', 'reabierto',
    'salida_viaje', 'exportado', 'perfil_aprendido', 'purgado', 'aviso_oficina', 'reintentos_agotados',
    'dividido',
    'envio_preparado', 'envio_pendiente_reque', 'envio_enviado', 'envio_rechazado', 'envio_error',
    'envio_alertado', 'envio_subido_a_mano', 'revisor_asignado'
  ));

-- ── RPC ─────────────────────────────────────────────────────────────────────
-- Toma hasta p_limite envíos vencidos y les pone un lease con el reloj de la BASE: dos corridas concurrentes
-- nunca reciben la misma fila (FOR UPDATE SKIP LOCKED + lease). No cambia el estado: lo decide el worker.
-- Elegible: estado vivo, ya le toca (proxima_revision nula o pasada) y sin lease vigente.
create or replace function public.cp_envio_reclamar(p_limite int default 10, p_lease_segundos int default 120)
returns table (id uuid, tenant_id uuid, documento_id uuid, estado text, intentos int, idempotency_key text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_limite is null or p_limite < 1 or p_limite > 200 then
    raise exception 'cp_envio_reclamar: p_limite fuera de rango (1-200)';
  end if;
  if p_lease_segundos is null or p_lease_segundos < 30 or p_lease_segundos > 900 then
    raise exception 'cp_envio_reclamar: p_lease_segundos fuera de rango (30-900)';
  end if;
  return query
  with elegibles as (
    select e.id
      from public.cp_envio_tms e
     where e.estado in ('pendiente_prechequeo', 'pendiente_reque', 'listo', 'error_transitorio', 'enviando')
       and (e.proxima_revision is null or e.proxima_revision <= now())
       and (e.procesando_hasta is null or e.procesando_hasta < now())
     order by coalesce(e.proxima_revision, e.created_at), e.id
     limit p_limite
       for update skip locked
  )
  update public.cp_envio_tms e
     set procesando_hasta = now() + make_interval(secs => p_lease_segundos),
         intentos = e.intentos + 1,
         updated_at = now()
    from elegibles
   where e.id = elegibles.id
  returning e.id, e.tenant_id, e.documento_id, e.estado, e.intentos, e.idempotency_key;
end;
$$;
revoke all on function public.cp_envio_reclamar(int, int) from public, anon, authenticated;
grant execute on function public.cp_envio_reclamar(int, int) to service_role;

-- «Avisar a la oficina UNA vez por envío»: UPDATE condicional atómico. No toca updated_at.
create or replace function public.cp_envio_marcar_alerta(p_tenant uuid, p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare n int;
begin
  update public.cp_envio_tms e
     set alerta_enviada_en = now()
   where e.id = p_id and e.tenant_id = p_tenant and e.alerta_enviada_en is null;
  get diagnostics n = row_count;
  return n > 0;
end;
$$;
revoke all on function public.cp_envio_marcar_alerta(uuid, uuid) from public, anon, authenticated;
grant execute on function public.cp_envio_marcar_alerta(uuid, uuid) to service_role;

-- Suelta el candado cuando el aviso NO salió (rechazo definitivo): se puede reintentar.
create or replace function public.cp_envio_liberar_alerta(p_tenant uuid, p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare n int;
begin
  update public.cp_envio_tms e
     set alerta_enviada_en = null
   where e.id = p_id and e.tenant_id = p_tenant and e.alerta_enviada_en is not null;
  get diagnostics n = row_count;
  return n > 0;
end;
$$;
revoke all on function public.cp_envio_liberar_alerta(uuid, uuid) from public, anon, authenticated;
grant execute on function public.cp_envio_liberar_alerta(uuid, uuid) to service_role;
