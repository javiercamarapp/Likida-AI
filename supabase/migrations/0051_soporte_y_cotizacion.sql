-- ═══════════════════════════════════════════════════════════════════════════
-- 0051 — SOPORTE y COTIZACIONES: las dos pantallas que quedaban sin base.
--
-- `dashboard/soporte`: "No hay tabla de tickets, ni cola, ni reloj de SLA.
-- Nada de lo que esta sección mediría se está registrando hoy."
--
-- `dashboard/cotizador`: "no hay tabla de precios por ruta, ni por kilómetro,
-- ni por tonelada" — la mitad de precios la resolvió `tarifa` (0048); lo que
-- falta es dónde vive una cotización mientras el cliente la piensa.
--
-- EL RELOJ DE SLA NO SE GUARDA, SE DERIVA. `vence_en` se calcula al abrir el
-- ticket (`abierto_en + sla_horas`) y se guarda una sola vez; el "cuánto
-- falta" se resta contra `now()` al leer. Guardar un contador que alguien
-- tenga que refrescar produce SLAs que se vencen en la base y no en la
-- pantalla, que es la forma más silenciosa de incumplir uno.
--
-- LA COTIZACIÓN NO SE CONVIERTE SOLA EN VIAJE. `viaje_id` se llena cuando
-- alguien la acepta, y el estado pasa a 'ganada'. Que un borrador se vuelva
-- operación sin que nadie lo apruebe es como se despachan camiones que nadie
-- pidió.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Tickets de soporte ─────────────────────────────────────────────────────
create table if not exists public.ticket_soporte (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenant(id) on delete cascade,
  -- Quién lo abrió. NULL si lo abrió Likida (superadmin) a nombre de la flota.
  abierto_por  uuid references public.app_user(id) on delete set null,
  viaje_id     uuid references public.viaje(id) on delete set null,
  asunto       text not null,
  descripcion  text,
  categoria    text not null default 'otro',
  prioridad    text not null default 'media',
  estado       text not null default 'abierto',
  sla_horas    int,
  abierto_en   timestamptz not null default now(),
  -- Se escribe al abrir, a partir de `sla_horas`. NULL = sin SLA pactado, y
  -- la cola dice "sin SLA" en vez de "vencido".
  vence_en     timestamptz,
  resuelto_en  timestamptz,
  constraint ticket_categoria_dominio
    check (categoria in ('facturacion', 'operacion', 'tecnico', 'cuenta', 'otro')),
  constraint ticket_prioridad_dominio check (prioridad in ('baja', 'media', 'alta', 'urgente')),
  constraint ticket_estado_dominio check (estado in ('abierto', 'en_proceso', 'esperando', 'resuelto', 'cerrado')),
  -- Un ticket resuelto tiene fecha de resolución y uno abierto no. Sin esto,
  -- el tiempo de respuesta se calcula contra NULL y sale 0 — que se lee como
  -- "se contestó al instante".
  constraint ticket_cierre_coherente
    check ((estado in ('resuelto', 'cerrado')) = (resuelto_en is not null)),
  constraint ticket_sla_sano check (sla_horas is null or (sla_horas > 0 and sla_horas <= 720))
);

comment on column public.ticket_soporte.vence_en is
  'abierto_en + sla_horas, escrito al abrir. NULL = sin SLA pactado; la cola dice "sin SLA", nunca "vencido".';

create index if not exists ticket_cola_idx on public.ticket_soporte (tenant_id, estado, prioridad, vence_en);

-- ── La conversación del ticket ─────────────────────────────────────────────
create table if not exists public.ticket_mensaje (
  id         uuid primary key default gen_random_uuid(),
  ticket_id  uuid not null references public.ticket_soporte(id) on delete cascade,
  autor_id   uuid references public.app_user(id) on delete set null,
  cuerpo     text not null,
  -- Una nota interna no la ve el cliente. Va en la misma tabla y no en otra
  -- porque el hilo es uno solo: separarlas hace que el orden cronológico
  -- dependa de mezclar dos consultas, y ahí es donde se pierde una respuesta.
  interna    boolean not null default false,
  creado_en  timestamptz not null default now()
);

create index if not exists ticket_mensaje_hilo_idx on public.ticket_mensaje (ticket_id, creado_en);

-- ── Cotizaciones ───────────────────────────────────────────────────────────
create table if not exists public.cotizacion (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenant(id) on delete cascade,
  cliente_id     uuid references public.cliente(id) on delete set null,
  folio          text,
  origen         text not null,
  destino        text not null,
  km             int,
  -- Lo que la flota calcula que le va a costar (diésel + casetas + viáticos).
  costo_estimado numeric(12,2),
  -- Lo que se le cotiza al cliente. Si falta, la cotización está a medias y
  -- la pantalla lo dice: NO se deriva del costo con un margen supuesto.
  precio         numeric(12,2),
  moneda         text not null default 'MXN',
  estado         text not null default 'borrador',
  vigente_hasta  date,
  -- Se llena SOLO cuando alguien acepta la cotización. Una cotización no se
  -- vuelve viaje sola.
  viaje_id       uuid references public.viaje(id) on delete set null,
  creada_en      timestamptz not null default now(),
  constraint cotizacion_estado_dominio
    check (estado in ('borrador', 'enviada', 'ganada', 'perdida', 'vencida')),
  constraint cotizacion_km_sanos check (km is null or (km > 0 and km < 20000)),
  constraint cotizacion_importes check (
    (costo_estimado is null or costo_estimado >= 0) and (precio is null or precio >= 0)),
  -- Ganada exige precio y viaje: sin precio no se sabe por cuánto se ganó, y
  -- sin viaje la operación no existe. Es el único estado que cierra el ciclo.
  constraint cotizacion_ganada_completa
    check (estado <> 'ganada' or (precio is not null and viaje_id is not null))
);

create unique index if not exists cotizacion_folio_unico
  on public.cotizacion (tenant_id, folio) where folio is not null;

comment on column public.cotizacion.precio is
  'Lo que se le cotiza al cliente. NULL = a medias, y se dice; NO se deriva del costo con un margen supuesto.';

create index if not exists cotizacion_tenant_estado_idx on public.cotizacion (tenant_id, estado, creada_en desc);

-- ── RLS ────────────────────────────────────────────────────────────────────
--
-- Soporte es de OFICINA, no de dinero: el encargado abre y sigue tickets, así
-- que basta `not is_operador()` (criterio de la 0047).
-- La cotización SÍ es dinero: lleva precio y margen → `ve_finanzas()` (0048).
alter table public.ticket_soporte enable row level security;
alter table public.ticket_mensaje enable row level security;
alter table public.cotizacion     enable row level security;

create policy tenant_data on public.ticket_soporte for all
  using ((tenant_id = any(get_user_tenant_ids()) and not is_operador()) or is_superadmin())
  with check ((tenant_id = any(get_user_tenant_ids()) and not is_operador()) or is_superadmin());

-- Hereda el tenant de su ticket por EXISTS: una segunda copia del tenant_id
-- se puede desincronizar de la primera y ahí nace la fuga.
create policy tenant_data on public.ticket_mensaje for all
  using (exists (
    select 1 from public.ticket_soporte t
     where t.id = ticket_id
       and ((t.tenant_id = any(get_user_tenant_ids()) and not is_operador()) or is_superadmin())))
  with check (exists (
    select 1 from public.ticket_soporte t
     where t.id = ticket_id
       and ((t.tenant_id = any(get_user_tenant_ids()) and not is_operador()) or is_superadmin())));

create policy tenant_finanzas on public.cotizacion for all
  using ((tenant_id = any(get_user_tenant_ids()) and ve_finanzas()) or is_superadmin())
  with check ((tenant_id = any(get_user_tenant_ids()) and ve_finanzas()) or is_superadmin());
