-- ═══════════════════════════════════════════════════════════════════════════
-- 0460 — El patio del jefe de tráfico y la invitación del operador por WhatsApp.
--
-- LOOP PUNTA A PUNTA, W2 «producto» (1-oct-2026). El cliente de demo tiene patios,
-- jefes de tráfico por patio y capturistas. Hasta hoy el panel no tenía patios
-- (`terminal` huérfana), el encargado no podía corregir un teléfono ni dar de
-- baja a un chofer, y el alta de 250 choferes terminaba en «avísales tú».
--
-- QUÉ CAMBIA, y por qué lo tiene que garantizar la base:
--
--  1. `app_user.terminal_id` — el PATIO de un jefe de tráfico (rol encargado).
--     NULL = sin patio = ve y corrige toda la flota (el dueño, el contador y un
--     encargado de oficina central). Con patio, el panel solo le deja corregir
--     operadores, unidades y jornadas DE SU PATIO. La FK compuesta
--     `(terminal_id, tenant_id) → terminal(id, tenant_id)` es el molde de la
--     0298: un jefe de la flota A no puede quedar amarrado a un patio de la
--     flota B aunque alguien mande el uuid correcto de otra flota. `on delete
--     set null (terminal_id)`: borrar un patio no borra usuarios, y el jefe
--     queda SIN patio (visible: la pantalla de Patios lo dice antes de borrar).
--     Solo `service_role` escribe `app_user` (la policy `app_user_self` es de
--     SELECT): un jefe no puede quitarse su propio patio desde el navegador.
--
--  2. `operador.invitacion_enviada_en` / `invitacion_via` — la constancia de que
--     a ese chofer ya se le mandó la invitación por WhatsApp. Es lo que vuelve
--     IDEMPOTENTE el envío masivo: la invitación se RECLAMA con un UPDATE
--     condicionado a `invitacion_enviada_en is null` (dos submits a la vez no
--     le mandan dos plantillas al mismo chofer) y se suelta si Meta la rechaza.
--     Son datos operativos de la ficha del operador: los cubre la misma
--     cancelación ARCO que la fila (0262) y no llevan texto libre.
--
-- Idempotente: `if not exists` y guardas `pg_constraint`.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. El patio del jefe ─────────────────────────────────────────────────────
alter table public.app_user
  add column if not exists terminal_id uuid references public.terminal(id) on delete set null;

create index if not exists app_user_terminal_id_idx on public.app_user (terminal_id)
  where terminal_id is not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'app_user_terminal_tenant_fkey' and conrelid = 'public.app_user'::regclass
  ) then
    -- `terminal_id_tenant_key` = unique (id, tenant_id) en terminal (0145).
    -- Con `tenant_id` NULL (superadmin) la FK compuesta no se evalúa (MATCH
    -- SIMPLE): un superadmin no tiene patio ni lo necesita.
    alter table public.app_user
      add constraint app_user_terminal_tenant_fkey
      foreign key (terminal_id, tenant_id) references public.terminal (id, tenant_id)
      on delete set null (terminal_id);
  end if;
end $$;

comment on column public.app_user.terminal_id is
  'Patio del jefe de tráfico (0460). NULL = sin patio: ve y corrige toda la flota. Con patio, el panel solo le deja corregir operadores, unidades y jornadas de ese patio. FK compuesta con tenant_id (molde 0298). Solo service_role escribe app_user.';

-- ── 2. La constancia de la invitación al operador ────────────────────────────
alter table public.operador
  add column if not exists invitacion_enviada_en timestamptz,
  add column if not exists invitacion_via text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'operador_invitacion_via_dominio' and conrelid = 'public.operador'::regclass
  ) then
    alter table public.operador
      add constraint operador_invitacion_via_dominio
      check (invitacion_via is null or invitacion_via in ('texto', 'botones', 'plantilla', 'reclamada'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'operador_invitacion_coherente' and conrelid = 'public.operador'::regclass
  ) then
    -- O las dos o ninguna: una vía sin fecha (o al revés) es una constancia a medias.
    alter table public.operador
      add constraint operador_invitacion_coherente
      check ((invitacion_enviada_en is null) = (invitacion_via is null));
  end if;
end $$;

comment on column public.operador.invitacion_enviada_en is
  'Cuándo se le mandó la invitación por WhatsApp (0460). NULL = pendiente. Se RECLAMA con un UPDATE condicionado a NULL (idempotencia entre dos envíos simultáneos) y se vuelve a NULL si Meta la rechaza.';
comment on column public.operador.invitacion_via is
  'Canal de la invitación (0460): texto/botones (ventana abierta), plantilla (fuera de ventana) o reclamada (reservada por un envío en curso, todavía sin respuesta de Meta). NULL = no enviada.';

-- Los pendientes de invitar, por flota: lo que el panel cuenta y el envío masivo recorre.
create index if not exists operador_invitacion_pendiente_idx
  on public.operador (tenant_id)
  where activo and invitacion_enviada_en is null;
