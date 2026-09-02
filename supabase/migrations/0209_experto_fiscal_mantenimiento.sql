-- ═══════════════════════════════════════════════════════════════════════════
-- 0209 — FASE 9 DEL PLAN MAESTRO: el experto fiscal se enciende y el
-- mantenimiento gana su escritor.
--
-- Dos piezas que comparten fase, no tabla:
--
--   1. `experto_fiscal` pasa de 'disenado' a 'vivo'. Lo que se enciende no es
--      una promesa: sus dos rutinas locales (dof-diario 21:30 y la profundidad
--      dominical) corren desde el 16-ago, y desde hoy el corpus de `normas/`
--      es consultable en el chat del panel por la tool `consultar_normas`
--      (temas cerrados; `guardiaFundamento` sigue siendo el candado — el
--      modelo no puede citar lo que la tool no le devolvió en el turno).
--
--   2. `mantenimiento` (0047) tenía lectores y ningún escritor: `getUnidades`
--      contaba órdenes de una tabla a la que ninguna pluma llegaba. Ahora:
--        · la avería AUTORIZADA de talacha abre su orden correctiva
--          (incidencia_id, una orden por avería — unique parcial);
--        · `rutina_mantenimiento` guarda las preventivas por días y/o km, y
--          el panel PROPONE las vencidas — la orden la abre un humano
--          (rutina_id en la orden; una orden no cerrada por rutina+unidad).
--      El odómetro (`unidad.km_actual`) es declarado: una rutina por km sin
--      odómetro no se evalúa y el motor lo dice (mantenimiento.ts).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. El experto fiscal, vivo ─────────────────────────────────────────────
update public.agente_definicion
set estado = 'vivo',
    descripcion = 'La memoria normativa del producto. Dos rutinas locales (DOF diario 21:30 con veredicto CAMBIO NORMATIVO; profundidad dominical que re-verifica fichas y caza drift código-vs-ley) mantienen `normas/`; el chat del panel consulta ese corpus con consultar_normas (fundamento citado, jerarquía y estado de verificación a la vista — lo sin verificar se declara, jamás se afirma). No dictamina: prepara con fuente y manda al fiscalista humano lo que el corpus no cubre.',
    actualizado_en = now()
where id = 'experto_fiscal';

-- ── 2a. La orden que nace de una avería firmada ────────────────────────────
alter table public.mantenimiento
  add column if not exists incidencia_id uuid,
  add column if not exists rutina_id     uuid;

-- FK COMPUESTA de la casa (0028/0145): la avería de la flota A no puede
-- abrirle órdenes al taller de la flota B. `incidencia` trae su
-- unique (id, tenant_id) desde la 0198. Borrar la incidencia (se va con el
-- viaje) NO borra la orden: el rastro de taller es del activo, no del viaje —
-- set null acotado a la columna (forma de la 0203).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'mantenimiento_incidencia_tenant_fkey' and conrelid = 'public.mantenimiento'::regclass
  ) then
    alter table public.mantenimiento
      add constraint mantenimiento_incidencia_tenant_fkey
      foreign key (incidencia_id, tenant_id) references public.incidencia (id, tenant_id)
      on delete set null (incidencia_id);
  end if;
end $$;

-- Una avería = a lo más UNA orden. El webhook de WhatsApp reintenta; sin este
-- candado, cada reintento del "autorizo" abriría otra orden y el taller
-- pintaría tres fallas donde hubo una.
create unique index if not exists mantenimiento_incidencia_unica
  on public.mantenimiento (tenant_id, incidencia_id)
  where incidencia_id is not null;

-- ── 2b. Las rutinas preventivas ────────────────────────────────────────────
create table if not exists public.rutina_mantenimiento (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenant(id) on delete cascade,
  nombre     text not null,
  -- Cadencias: al menos una. NULL = ese reloj no aplica (no "0 días").
  cada_dias  int,
  cada_km    int,
  activa     boolean not null default true,
  creada_en  timestamptz not null default now(),
  -- Quién la declaró; se conserva aunque el usuario se borre (el pacto de
  -- taller sigue siendo el pacto — criterio de politica_detencion 0207).
  creada_por uuid references public.app_user(id) on delete set null,
  constraint rutina_mantenimiento_nombre_forma check (length(btrim(nombre)) between 1 and 80),
  constraint rutina_mantenimiento_dias_sanos check (cada_dias is null or (cada_dias >= 1 and cada_dias <= 100000)),
  constraint rutina_mantenimiento_km_sanos check (cada_km is null or (cada_km >= 1 and cada_km <= 100000)),
  -- Sin reloj no hay rutina: una rutina sin cadencia jamás vencería y viviría
  -- como promesa muerta en el panel.
  constraint rutina_mantenimiento_con_reloj check (cada_dias is not null or cada_km is not null),
  -- Para FKs compuestas futuras (el precio del aislamiento, 0028).
  constraint rutina_mantenimiento_id_tenant_key unique (id, tenant_id)
);

-- Dos rutinas con el mismo nombre serían dos relojes contando el mismo
-- servicio: el segundo intento edita, no duplica.
create unique index if not exists rutina_mantenimiento_nombre_unico
  on public.rutina_mantenimiento (tenant_id, lower(btrim(nombre)));

comment on table public.rutina_mantenimiento is
  'Rutinas preventivas de la flota, por días y/o km ("lo que ocurra primero"). Las vencidas se PROPONEN en el panel de unidades; la orden la abre un humano. El único escritor es mantenimiento.ts.';

-- Mismo doble candado que 0196/0198/0207: RLS deny-all + solo service_role.
alter table public.rutina_mantenimiento enable row level security;
revoke all on table public.rutina_mantenimiento from public, anon, authenticated;
grant select, insert, update, delete on table public.rutina_mantenimiento to service_role;

-- La orden que nace de una rutina la referencia — FK compuesta, y borrar la
-- rutina no borra el historial de servicios (set null acotado).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'mantenimiento_rutina_tenant_fkey' and conrelid = 'public.mantenimiento'::regclass
  ) then
    alter table public.mantenimiento
      add constraint mantenimiento_rutina_tenant_fkey
      foreign key (rutina_id, tenant_id) references public.rutina_mantenimiento (id, tenant_id)
      on delete set null (rutina_id);
  end if;
end $$;

-- Una rutina con orden YA ABIERTA en una unidad no abre otra (el doble clic
-- del panel pierde aquí, no en un check-then-act).
create unique index if not exists mantenimiento_rutina_abierta_unica
  on public.mantenimiento (tenant_id, rutina_id, unidad_id)
  where rutina_id is not null and estado <> 'cerrada';

comment on column public.mantenimiento.incidencia_id is
  'La avería de talacha que abrió esta orden (0209). NULL = la orden no nació de una avería. Una avería abre a lo más una orden (unique parcial).';
comment on column public.mantenimiento.rutina_id is
  'La rutina preventiva que propuso esta orden (0209). NULL = correctiva o capturada a mano. El reloj de la rutina se alimenta SOLO de órdenes cerradas con rutina_id.';
