-- ═══════════════════════════════════════════════════════════════════════════
-- 0213 — COORDINACIÓN CON EL PROVEEDOR (Capa D del agente de ayuda en ruta,
-- blueprint 19). Los números 0210-0212 quedaron reservados a fases paralelas
-- que resultaron no necesitar SQL — el hueco es a propósito, no un error.
--
-- La Capa C (0198 + #113) recomienda; esta capa CONTACTA — pero solo después
-- de que el JEFE lo autoriza con un botón, y solo a un teléfono del directorio
-- de la flota. La máquina de estados del blueprint, acotada a la negociación
-- (en_camino/llegó/completado son de la mesa de control, fase posterior):
--
--   pendiente_plantilla ──┐
--                         ├→ contactado → cotizada → confirmada
--                         │                  └────→ descartada (libera)
--
--   · pendiente_plantilla: el jefe autorizó pero Meta NO aceptó el mensaje
--     (ventana de 24 h cerrada — iniciar conversación exige plantilla
--     aprobada, y correr las plantillas es de la sección E, solo Javier). El
--     mensaje queda PREPARADO en la fila y el jefe recibe el texto listo para
--     reenviarlo él. Si el proveedor nos escribe (la ventana se abre), el
--     mensaje preparado sale en ese momento y el estado avanza — el circuito
--     completo existe; el hueco es solo el disparo inicial, y se declara.
--   · cotizada: el proveedor respondió. Su texto se guarda CRUDO; eta_min y
--     precio solo se llenan si el parser conservador los leyó sin ambigüedad
--     (mismo criterio que extraerMonto de talacha: dos cifras distintas = no
--     se adivina = NULL). El ETA es EL QUE DIJO EL PROVEEDOR, jamás calculado.
--   · confirmada/descartada: decisión del JEFE con botones — la firma es el
--     UPDATE condicional `WHERE estado = 'cotizada'` (el patrón atómico
--     exacto del circuito de talacha: gana exactamente uno, el segundo tap
--     recibe la verdad). Likida jamás compromete dinero ni servicio sola.
--
-- El proveedor se SNAPSHOTEA (nombre y teléfono) al autorizar: el expediente
-- de una emergencia tiene que poder citarse aunque el directorio cambie o la
-- fila del proveedor se borre después — el rastro es de la incidencia, no del
-- catálogo. `proveedor_id` queda como referencia viva mientras exista.
-- ═══════════════════════════════════════════════════════════════════════════

-- `proveedor_emergencia` es DESTINO de FK compuesta por primera vez: el
-- unique (id, tenant_id) que la 0145 les dio a los destinos (redundante en
-- unicidad — id ya es PK — obligatorio para la FK compuesta).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'proveedor_emergencia_id_tenant_key' and conrelid = 'public.proveedor_emergencia'::regclass
  ) then
    alter table public.proveedor_emergencia
      add constraint proveedor_emergencia_id_tenant_key unique (id, tenant_id);
  end if;
end $$;

create table if not exists public.coordinacion_proveedor (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenant(id) on delete cascade,
  incidencia_id       uuid not null,
  -- Referencia viva al directorio; NULL si la fila del directorio se borró
  -- después (el snapshot de abajo conserva el rastro citable).
  proveedor_id        uuid,
  -- El snapshot: a quién se contactó, con qué número. NOT NULL — sin esto el
  -- expediente no puede decir a quién se le habló.
  proveedor_nombre    text not null,
  proveedor_telefono  text not null,
  estado              text not null default 'pendiente_plantilla'
    check (estado in ('pendiente_plantilla', 'contactado', 'cotizada', 'confirmada', 'descartada')),
  -- Quién autorizó el contacto (el jefe) y cuándo. Se conserva aunque el
  -- usuario se borre: la autorización sigue siendo la autorización.
  autorizada_por      uuid references public.app_user(id) on delete set null,
  autorizada_en       timestamptz not null default now(),
  -- El mensaje que se le manda (o se le mandó) al proveedor, tal cual.
  mensaje_preparado   text not null,
  -- NULL = aún no sale (pendiente_plantilla). Solo se sella cuando Meta
  -- ACEPTÓ el mensaje (lección c2-1: sellar antes de enviar convierte un
  -- fallo transitorio en un silencio permanente).
  contactado_en       timestamptz,
  -- La respuesta del proveedor, CRUDA — la verdad citable. eta/precio solo
  -- si el parser los leyó sin ambigüedad; NULL = no dicho o ambiguo, jamás 0.
  respuesta_cruda     text,
  cotizada_en         timestamptz,
  eta_min             int,
  precio              numeric(12,2),
  -- La decisión del jefe sobre la cotización (confirmada o descartada).
  decidida_por        uuid references public.app_user(id) on delete set null,
  decidida_en         timestamptz,
  created_at          timestamptz not null default now(),
  constraint coordinacion_eta_sano   check (eta_min is null or (eta_min > 0 and eta_min <= 2880)),
  constraint coordinacion_precio_sano check (precio is null or (precio > 0 and precio <> 'NaN'::numeric)),
  -- Las FK COMPUESTAS de la casa (0028/0145): la coordinación de la flota A
  -- no puede colgarse de la incidencia ni del proveedor de la flota B.
  constraint coordinacion_incidencia_tenant_fkey
    foreign key (incidencia_id, tenant_id) references public.incidencia (id, tenant_id)
    on delete cascade,
  -- Borrar el proveedor del directorio NO borra el expediente: set null
  -- acotado a la columna (forma de la 0203); el snapshot queda.
  constraint coordinacion_proveedor_tenant_fkey
    foreign key (proveedor_id, tenant_id) references public.proveedor_emergencia (id, tenant_id)
    on delete set null (proveedor_id)
);

-- UNA negociación viva por incidencia: dos "contactar" concurrentes (dos
-- jefes, doble tap, webhook reentregado) los resuelve la base — gana
-- exactamente uno. `descartada` libera para el siguiente candidato;
-- `confirmada` NO libera: ya hay proveedor comprometido, y contactar a un
-- segundo sería comprometer dos servicios para la misma emergencia.
create unique index if not exists coordinacion_viva_unica
  on public.coordinacion_proveedor (tenant_id, incidencia_id)
  where estado <> 'descartada';

-- Confirmada INCLUIDA: el "ya llegué" del proveedor después de confirmar
-- también tiene que encontrar su expediente (se reenvía al jefe).
create index if not exists coordinacion_telefono_idx
  on public.coordinacion_proveedor (proveedor_telefono)
  where estado <> 'descartada';

comment on table public.coordinacion_proveedor is
  'La negociación con UN proveedor por incidencia de asistencia (Capa D, 0213). El jefe autoriza con botón; Likida escribe SOLO al teléfono del directorio; el ETA es el que dijo el proveedor; confirmar/descartar es firma atómica del jefe (patrón talacha). El único escritor es asistencia_coordinacion.ts, con bitácora en incidencia_evento.';
comment on column public.coordinacion_proveedor.eta_min is
  'Minutos que DIJO el proveedor, leídos sin ambigüedad — jamás calculados por Likida. NULL = no dijo o fue ambiguo (la respuesta_cruda guarda sus palabras).';
comment on column public.coordinacion_proveedor.precio is
  'Precio que DIJO el proveedor, leído sin ambigüedad (criterio extraerMonto). NULL = no dijo o fue ambiguo, jamás $0.';

-- Mismo doble candado que 0196/0198/0207: RLS deny-all + solo service_role.
alter table public.coordinacion_proveedor enable row level security;
revoke all on table public.coordinacion_proveedor from public, anon, authenticated;
grant select, insert, update, delete on table public.coordinacion_proveedor to service_role;
