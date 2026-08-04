-- ═══════════════════════════════════════════════════════════════════════════
-- 0053 — Lo último que las pantallas declaraban sin base: invitaciones,
--        bitácora, derechos ARCO, campañas y la licencia del operador.
--
-- Sale de recorrer las 55 páginas de los dos paneles y leer lo que cada una
-- dice que le falta, en sus propias palabras:
--
--   · `dashboard/usuarios`  — "Invitar a alguien nuevo, cambiarle el rol o
--     darlo de baja desde aquí todavía no existe."          → `invitacion`
--   · `admin/equipo`        — "última sesión, audit log de acciones/
--     impersonations — no se registra hoy."          → `bitacora_auditoria`
--   · `admin/compliance`    — "Solicitudes ARCO abiertas, datos por vencer
--     retención, audit log completo."                     → `solicitud_arco`
--   · `admin/comunicacion`  — "historial de envíos con métricas" → `campania`
--     y `envio_mensaje`
--   · `dashboard/operadores`— "Licencia y su vencimiento no aparecen porque
--     `operador` no los guarda."                → columnas en `operador`
--
-- LA BITÁCORA ES APPEND-ONLY, y no por gusto: un registro de auditoría que su
-- propio dueño puede editar no sirve como evidencia ante nadie. Se niega
-- UPDATE y DELETE a todos los roles de la app; solo la service role escribe, y
-- solo inserta.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Invitaciones de usuario ────────────────────────────────────────────────
--
-- El alta NO crea la cuenta: crea una invitación con token. La cuenta nace
-- cuando la persona entra por su magic link y acepta. Al revés —crear el
-- `app_user` de una vez— deja cuentas fantasma de gente que nunca entró, y
-- esas cuentas ya cuentan para los límites del plan.
create table if not exists public.invitacion (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenant(id) on delete cascade,
  email       text not null,
  rol         text not null,
  -- Hash del token, NUNCA el token. Si la tabla se filtra, los enlaces vivos
  -- no se pueden usar: es el mismo criterio de una contraseña.
  token_hash  text not null,
  invitado_por uuid references public.app_user(id) on delete set null,
  expira_en   timestamptz not null,
  aceptada_en timestamptz,
  revocada_en timestamptz,
  creada_en   timestamptz not null default now(),
  constraint invitacion_rol_dominio
    check (rol in ('flota_admin', 'contador', 'encargado', 'operador')),
  -- Una invitación aceptada y revocada a la vez no significa nada.
  constraint invitacion_no_ambos check (not (aceptada_en is not null and revocada_en is not null))
);

-- Una invitación VIVA por correo y flota. Sin esto, dos invitaciones abiertas
-- para el mismo correo dan dos roles distintos según cuál se abra primero.
create unique index if not exists invitacion_viva_unica
  on public.invitacion (tenant_id, lower(email))
  where aceptada_en is null and revocada_en is null;

create unique index if not exists invitacion_token_unico on public.invitacion (token_hash);

comment on table public.invitacion is
  'Alta de usuarios por invitacion. NO crea el app_user: eso pasa cuando la persona entra y acepta. Crearlo antes deja cuentas fantasma que ya cuentan para el limite del plan.';
comment on column public.invitacion.token_hash is
  'Hash del token, nunca el token. Si la tabla se filtra, los enlaces vivos no sirven.';

create index if not exists invitacion_tenant_idx on public.invitacion (tenant_id, creada_en desc);

-- ── Bitácora de auditoría (append-only) ────────────────────────────────────
create table if not exists public.bitacora_auditoria (
  id          bigserial primary key,
  -- NULL cuando la acción es de plataforma (superadmin sin tenant).
  tenant_id   uuid references public.tenant(id) on delete set null,
  actor_id    uuid references public.app_user(id) on delete set null,
  actor_email text,
  accion      text not null,
  entidad     text,
  entidad_id  text,
  -- Contexto de la acción. Sin datos personales ni secretos: esta tabla se
  -- conserva más tiempo que casi todo lo demás, y lo que se guarda aquí
  -- sobrevive a un borrado ARCO de la tabla de origen.
  detalle     jsonb,
  ip          inet,
  ocurrio_en  timestamptz not null default now()
);

comment on table public.bitacora_auditoria is
  'Append-only. Un registro de auditoria que su dueno puede editar no sirve como evidencia: se niega UPDATE y DELETE a todos los roles de la app.';
comment on column public.bitacora_auditoria.detalle is
  'Contexto sin datos personales ni secretos: esta tabla sobrevive a un borrado ARCO de la tabla de origen.';

create index if not exists bitacora_tenant_idx on public.bitacora_auditoria (tenant_id, ocurrio_en desc);
create index if not exists bitacora_actor_idx on public.bitacora_auditoria (actor_id, ocurrio_en desc);
create index if not exists bitacora_accion_idx on public.bitacora_auditoria (accion, ocurrio_en desc);

-- ── Derechos ARCO (LFPDPPP) ────────────────────────────────────────────────
--
-- El titular de los datos es el OPERADOR, no la flota: Likida es encargado del
-- tratamiento y la flota es responsable. El plazo legal de respuesta son 20
-- días hábiles (LFPDPPP art. 32) y por eso `vence_en` se guarda: un plazo que
-- se calcula al leer se vence sin que nadie lo vea.
create table if not exists public.solicitud_arco (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenant(id) on delete cascade,
  operador_id  uuid references public.operador(id) on delete set null,
  -- Se guarda aparte del FK porque el titular puede pedir la SUPRESIÓN de su
  -- fila en `operador`, y la solicitud tiene que seguir siendo auditable
  -- después de eso.
  titular_ref  text,
  tipo         text not null,
  canal        text,
  estado       text not null default 'recibida',
  recibida_en  timestamptz not null default now(),
  vence_en     date not null,
  resuelta_en  timestamptz,
  resolucion   text,
  constraint arco_tipo_dominio check (tipo in ('acceso', 'rectificacion', 'cancelacion', 'oposicion')),
  constraint arco_estado_dominio check (estado in ('recibida', 'en_proceso', 'resuelta', 'improcedente')),
  constraint arco_cierre_coherente
    check ((estado in ('resuelta', 'improcedente')) = (resuelta_en is not null))
);

comment on table public.solicitud_arco is
  'Derechos ARCO del titular (el OPERADOR). Likida es encargado y la flota responsable. vence_en se guarda porque un plazo calculado al leer se vence sin que nadie lo vea (LFPDPPP art. 32).';

create index if not exists arco_pendientes_idx on public.solicitud_arco (tenant_id, estado, vence_en);

-- ── Campañas y envíos ──────────────────────────────────────────────────────
--
-- Sirve a dos cosas a la vez: el historial de comunicación que pedía
-- `admin/comunicacion`, y el registro de CADA plantilla de WhatsApp que
-- Likida manda (Fase 1). Sin esta tabla, un envío fallido no deja rastro y el
-- panel no puede decir "se intentó y falló" — que es justo lo que un botón
-- que falla en silencio necesita para dejar de ser peor que no tenerlo.
create table if not exists public.campania (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid references public.tenant(id) on delete cascade,
  nombre     text not null,
  plantilla  text,
  estado     text not null default 'borrador',
  creada_por uuid references public.app_user(id) on delete set null,
  creada_en  timestamptz not null default now(),
  enviada_en timestamptz,
  constraint campania_estado_dominio check (estado in ('borrador', 'enviando', 'enviada', 'cancelada'))
);

create table if not exists public.envio_mensaje (
  id          bigserial primary key,
  tenant_id   uuid references public.tenant(id) on delete cascade,
  campania_id uuid references public.campania(id) on delete set null,
  telefono    text not null,
  plantilla   text,
  canal       text not null default 'whatsapp',
  estado      text not null default 'encolado',
  -- El id que devuelve Meta. Sin él no se puede casar un webhook de estado
  -- con el envío que lo produjo.
  proveedor_id text,
  -- El error EXACTO del proveedor. Un envío fallido sin motivo obliga a
  -- adivinar si fue la plantilla, la ventana de 24 h o el número.
  error       text,
  enviado_en  timestamptz,
  creado_en   timestamptz not null default now(),
  constraint envio_estado_dominio
    check (estado in ('encolado', 'enviado', 'entregado', 'leido', 'fallido')),
  constraint envio_fallido_tiene_error check (estado <> 'fallido' or error is not null)
);

comment on column public.envio_mensaje.error is
  'El error exacto del proveedor. Sin el, un envio fallido obliga a adivinar si fue la plantilla, la ventana de 24h o el numero.';

create unique index if not exists envio_proveedor_unico
  on public.envio_mensaje (proveedor_id) where proveedor_id is not null;
create index if not exists envio_tenant_idx on public.envio_mensaje (tenant_id, creado_en desc);
create index if not exists envio_campania_idx on public.envio_mensaje (campania_id, estado);

-- ── La licencia del operador ───────────────────────────────────────────────
alter table public.operador add column if not exists licencia text;
alter table public.operador add column if not exists licencia_tipo text;
alter table public.operador add column if not exists licencia_vence date;

comment on column public.operador.licencia_vence is
  'NULL = no capturada. La pantalla dice "sin licencia registrada"; una fecha inventada haria que un operador salga vencido o vigente sin serlo.';

create index if not exists operador_licencia_vence_idx
  on public.operador (tenant_id, licencia_vence) where licencia_vence is not null;

-- ── RLS ────────────────────────────────────────────────────────────────────
alter table public.invitacion         enable row level security;
alter table public.bitacora_auditoria enable row level security;
alter table public.solicitud_arco     enable row level security;
alter table public.campania           enable row level security;
alter table public.envio_mensaje      enable row level security;

-- Invitar es administrar la cuenta: flota_admin y superadmin, nadie más.
create policy solo_admin_flota on public.invitacion for all
  using ((tenant_id = any(get_user_tenant_ids()) and administra_flota()) or is_superadmin())
  with check ((tenant_id = any(get_user_tenant_ids()) and administra_flota()) or is_superadmin());

-- APPEND-ONLY: se lee y se inserta, nunca se corrige ni se borra. No hay
-- policy de UPDATE ni de DELETE a propósito — sin policy, RLS los niega.
create policy bitacora_lectura on public.bitacora_auditoria for select
  using ((tenant_id = any(get_user_tenant_ids()) and administra_flota()) or is_superadmin());
create policy bitacora_insercion on public.bitacora_auditoria for insert
  with check (tenant_id = any(get_user_tenant_ids()) or is_superadmin());

create policy solo_admin_flota on public.solicitud_arco for all
  using ((tenant_id = any(get_user_tenant_ids()) and administra_flota()) or is_superadmin())
  with check ((tenant_id = any(get_user_tenant_ids()) and administra_flota()) or is_superadmin());

create policy tenant_data on public.campania for all
  using ((tenant_id = any(get_user_tenant_ids()) and not is_operador()) or is_superadmin())
  with check ((tenant_id = any(get_user_tenant_ids()) and not is_operador()) or is_superadmin());

create policy tenant_data on public.envio_mensaje for all
  using ((tenant_id = any(get_user_tenant_ids()) and not is_operador()) or is_superadmin())
  with check ((tenant_id = any(get_user_tenant_ids()) and not is_operador()) or is_superadmin());
