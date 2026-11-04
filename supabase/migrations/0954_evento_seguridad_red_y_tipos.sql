-- 0954 — evento_seguridad: huella de red, user-agent, estado de aviso y los tipos que faltaban (CT-SEG-11, F1 lote B, carril L1I).
--
-- HOY (medido en el código, 4-nov-2026): la tabla guarda quién (`actor`) y qué, pero NO desde dónde: ni IP ni user-agent. Y los
-- únicos escritores son siete detectores de webhooks/copiloto/guardia. No hay registro de login fallido, de llave v1 inválida,
-- de ruta negada por el perfil, de exportes de dinero ni de cambios de rol. Esta migración prepara la tabla; el registro
-- (RPC con tope por huella) vive en la 0955.
--
-- DECISIÓN DE PRIVACIDAD (por qué huella y no IP):
--   · La IP completa es dato personal y no hace falta para lo que se pregunta aquí («¿es la misma fuente la que insiste?»).
--   · Se guarda `ip_hash` = HMAC-SHA256(sal secreta, red truncada) cortado a 32 hex: la red truncada es /24 en IPv4 y /48 en IPv6
--     (el truncado se hace en la aplicación, ANTES de hashear). Truncar reduce la identificabilidad; la sal impide recorrer el
--     espacio de 2^24 redes para recuperarla. Permite agrupar «misma red» y detectar ráfagas sin conservar la dirección.
--   · Sin la sal configurada (SEGURIDAD_SAL_RED) la aplicación NO guarda ip_hash (queda null): no se inventa una huella sin sal.
--   · La huella y el user-agent se ANONIMIZAN a los 30 días (función `anonimizar_red_evento_seguridad`, 0955); la fila del
--     evento sigue su retención por severidad de la 0680 (90/180/365).
--
-- ADITIVA E IDEMPOTENTE. Compatible con el código anterior: columnas nuevas con default/nulas, el check de `tipo`/`origen` solo
-- se AMPLÍA (todo valor viejo sigue válido), y el RPC viejo (`registrar_evento_seguridad`) no se toca. No puede fallar con filas
-- existentes: ninguna restricción nueva se evalúa contra ellas (las columnas nuevas son nulas o 0, y el check ampliado es NOT VALID).
--
-- REVERSA (manual, en este orden):
--   drop index if exists public.idx_evento_seguridad_ip, public.idx_evento_seguridad_por_avisar, public.idx_evento_seguridad_origen_fecha;
--   alter table public.evento_seguridad drop column if exists ip_hash, drop column if exists ua, drop column if exists avisos_enviados,
--     drop column if exists repeticiones_avisadas, drop column if exists ultimo_aviso_en;
--   -- y volver a los checks de la 0133 (origen/tipo sin los valores nuevos) solo si no quedan filas con ellos.
begin;

alter table public.evento_seguridad
  add column if not exists ip_hash text,
  add column if not exists ua text,
  -- Estado del barrido de avisos: cuántas veces se avisó este incidente (tope 3) y hasta cuántas repeticiones iba entonces.
  add column if not exists avisos_enviados integer not null default 0,
  add column if not exists repeticiones_avisadas integer not null default 0,
  add column if not exists ultimo_aviso_en timestamptz;

do $$ begin
  alter table public.evento_seguridad
    add constraint evento_seguridad_ip_hash_forma check (ip_hash is null or ip_hash ~ '^[0-9a-f]{32}$');
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.evento_seguridad
    add constraint evento_seguridad_ua_largo check (ua is null or char_length(ua) <= 200);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.evento_seguridad
    add constraint evento_seguridad_avisos_tope check (avisos_enviados between 0 and 3);
exception when duplicate_object then null; end $$;

-- Los check de la 0133 eran en línea (nombre automático). Se reemplazan por la lista AMPLIADA; NOT VALID porque todo lo existente
-- ya cumplía la lista vieja (un subconjunto) y así el cambio no recorre la tabla bajo lock.
alter table public.evento_seguridad drop constraint if exists evento_seguridad_origen_check;
alter table public.evento_seguridad add constraint evento_seguridad_origen_check check (origen in (
  'wa_webhook', 'stripe_webhook', 'correo_webhook', 'copiloto',
  'api_v1', 'chat', 'ratelimit', 'auth', 'otro',
  'export'
)) not valid;

alter table public.evento_seguridad drop constraint if exists evento_seguridad_tipo_check;
alter table public.evento_seguridad add constraint evento_seguridad_tipo_check check (tipo in (
  'firma_invalida', 'intent_invalido', 'step_up_rechazado', 'rate_limit',
  'inyeccion_prompt', 'acceso_denegado', 'cifra_sin_respaldo',
  'payload_excesivo', 'otro',
  'login_fallido', 'llave_invalida', 'api_negada', 'exporte_dinero', 'cambio_rol'
)) not valid;

create index if not exists idx_evento_seguridad_ip
  on public.evento_seguridad (ip_hash, creado_en desc) where ip_hash is not null;
create index if not exists idx_evento_seguridad_por_avisar
  on public.evento_seguridad (creado_en desc) where severidad = 'alta' and avisos_enviados < 3;
create index if not exists idx_evento_seguridad_origen_fecha
  on public.evento_seguridad (origen, creado_en desc);

comment on column public.evento_seguridad.ip_hash is
  '0954: HMAC-SHA256 con sal secreta de la red truncada (/24 IPv4, /48 IPv6), 32 hex. Nunca la IP. Se anonimiza a los 30 dias (0955). Null si no habia sal.';
comment on column public.evento_seguridad.ua is
  '0954: user-agent recortado a 200 caracteres y sin caracteres de control. Se anonimiza a los 30 dias (0955).';

commit;
