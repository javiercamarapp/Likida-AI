-- ═══════════════════════════════════════════════════════════════════════════
-- 0118 — `prospecto_contacto`: el historial que la cadencia necesita para no
-- duplicarse ni saltarse.
--
-- Fase 2 pieza 2 del blueprint (16-ago-2026). La tabla `prospecto` (0105)
-- tiene el kanban pero no un log de "qué se le mandó, cuándo, y qué
-- contestó": el SDR (C8) necesita saber si ya salió el correo del día 0
-- antes de mandar el del día 2, y el censo son 828 leads FINITOS — un lead
-- quemado por un duplicado no se repone.
--
-- La regla que esta tabla sostiene (encargo de la Fase 2, literal): "un lead
-- marcado contactado no se vuelve a tocar sin pasar primero por el historial
-- de contactos".
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.prospecto_contacto (
  id           uuid primary key default gen_random_uuid(),
  prospecto_id uuid not null references public.prospecto(id) on delete cascade,
  canal        text not null
                 constraint prospecto_contacto_canal_dominio check (canal in
                   ('correo', 'linkedin', 'llamada', 'whatsapp', 'presencial', 'otro')),
  -- salida = Likida le escribió; respuesta = el prospecto contestó.
  direccion    text not null
                 constraint prospecto_contacto_direccion_dominio check (direccion in ('salida', 'respuesta')),
  -- Si la salida nació en la cola de aprobación, la pieza queda ligada: es
  -- la trazabilidad "qué se le mandó exactamente" sin copiar el cuerpo.
  pieza_id     uuid references public.cola_aprobacion(id) on delete set null,
  -- Qué pasó, en una línea. SIN el cuerpo completo ni datos personales de
  -- más: el cuerpo vive en la pieza; esto es el índice de la relación.
  resumen      text not null
                 constraint prospecto_contacto_resumen_no_vacio check (length(trim(resumen)) > 0),
  -- Quién lo registró. NULL = lo registró el sistema (p.ej. al marcar
  -- enviada una pieza aprobada).
  actor_id     uuid references public.app_user(id) on delete set null,
  ocurrio_en   timestamptz not null default now()
);

comment on table public.prospecto_contacto is
  'El historial de contactos por prospecto (Fase 2): cada salida y cada respuesta, con canal y fecha. Es lo que impide que la cadencia 0/2/5/10 se duplique o se salte — el censo son 828 leads finitos y un duplicado quema un lead que no se repone. Deny-all: solo el servidor.';

alter table public.prospecto_contacto enable row level security;

-- La consulta de la cadencia: el historial de UN prospecto, cronológico.
create index if not exists prospecto_contacto_historial_idx
  on public.prospecto_contacto (prospecto_id, ocurrio_en);
