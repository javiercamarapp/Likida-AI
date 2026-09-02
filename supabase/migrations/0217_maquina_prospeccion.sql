-- ═══════════════════════════════════════════════════════════════════════════
-- 0217 — LA MÁQUINA DE PROSPECCIÓN (ola 2A de la compañía agente).
--
-- Orden de Javier (27-ago-2026): "antes de enviar investiga completamente la
-- empresa... y después procede a mandar correo a todos los correos que
-- consigue de esa empresa", todos los días. Tres agentes nuevos en el runner
-- — investigador (reusa el id `enriquecedor` del catálogo), `sdr` y
-- `enviador` — sobre la plataforma que ya existe (cola 0117, historial 0118,
-- envío 0120, cadencia atómica 0124, runner 0123).
--
-- Lo que esta migración agrega es el DATO que faltaba:
--   1. `prospecto.sitio_web` — la puerta de la investigación. Sin sitio
--      conocido, el investigador lo dice; no adivina dominios.
--   2. `prospecto_correo` — TODOS los correos hallados de la empresa, cada
--      uno con su fuente (la URL o texto donde apareció LITERALMENTE — el
--      motor rechaza correos que el modelo "recuerde" y no estén en la
--      página). El envío les llega como copias del mismo correo de campaña.
--   3. `prospecto_dossier` — la investigación citable (historia, empleados,
--      flotilla, teléfonos), un dossier por prospecto, el último gana
--      (mismo contrato que el borrador reimpreso de Carta Porte 0214).
--   4. `correo_suprimido` — la lista de bajas GLOBAL. Un rebote, una queja o
--      un "baja" suprimen la dirección para siempre; el enviador la consulta
--      antes de cada envío. Fail-closed: si la lista no se puede leer, no se
--      manda (eso vive en TS, aquí vive la unicidad).
--
-- El envío mismo NO cambia de puerta: sigue siendo la cola de aprobación con
-- su CHECK enviar-solo-aprobado (0117/0120), el tope diario y la cadencia
-- atómica (0124). Lo que cambia es QUIÉN aprueba: el `enviador` puede
-- resolver piezas de campaña automáticamente (resuelto_por_email
-- 'enviador@automatico' — el CHECK 0120 exige el email, no el uuid), por
-- orden explícita del 27-ago. Su kill switch lo detiene sin deploy.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. El sitio de la empresa ──────────────────────────────────────────────
alter table public.prospecto
  add column if not exists sitio_web text;

comment on column public.prospecto.sitio_web is
  'El sitio oficial de la empresa, si se conoce (captura manual o cosecha del censo). Es la puerta del investigador (0217): sin sitio no se investiga la web — no se adivinan dominios.';

-- ── 2. Los correos hallados, con fuente ────────────────────────────────────
create table if not exists public.prospecto_correo (
  id             uuid primary key default gen_random_uuid(),
  prospecto_id   uuid not null references public.prospecto(id) on delete cascade,
  correo         text not null,
  contacto_nombre text,
  puesto         text,
  -- De dónde salió: la URL de la página o 'notas del prospecto'. Obligatoria:
  -- un correo sin fuente es un correo inventado (regla 1 de la casa).
  fuente         text not null,
  agregado_en    timestamptz not null default now(),
  constraint prospecto_correo_formato
    check (correo ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]{2,}$'),
  constraint prospecto_correo_fuente_no_vacia
    check (length(btrim(fuente)) > 0)
);

-- Un correo entra UNA vez por empresa, sin importar mayúsculas: el duplicado
-- del investigador (corre a diario) rebota en la base, no en un `if`.
create unique index if not exists prospecto_correo_unico
  on public.prospecto_correo (prospecto_id, lower(correo));

comment on table public.prospecto_correo is
  'Los correos de la empresa hallados por el investigador (0217), cada uno con su fuente literal. El enviador manda el correo de campaña al principal (prospecto.correo) con copia a estos, menos los suprimidos. Deny-all: solo el servidor.';

alter table public.prospecto_correo enable row level security;
revoke all on table public.prospecto_correo from public, anon, authenticated;
grant select, insert, update, delete on table public.prospecto_correo to service_role;

-- ── 3. El dossier de la investigación ──────────────────────────────────────
create table if not exists public.prospecto_dossier (
  prospecto_id  uuid primary key references public.prospecto(id) on delete cascade,
  -- Los campos que la orden pide, cada uno NULL = "no encontrado" (que es una
  -- salida válida y honesta, jamás un texto inventado).
  historia      text,
  empleados     text,
  flotilla      text,
  telefonos     jsonb,
  -- Hallazgos extra con su fuente cada uno — el formato lo valida el motor.
  datos         jsonb,
  -- Las fuentes consultadas (URLs leídas de verdad). Obligatorio aunque sea
  -- vacío: un dossier sin lista de fuentes no dice de dónde salió nada.
  fuentes       jsonb not null default '[]'::jsonb,
  investigado_en timestamptz not null default now(),
  costo_usd     numeric(10, 4),
  modelo        text
);

comment on table public.prospecto_dossier is
  'La investigación completa de la empresa (0217): historia, empleados, flotilla, teléfonos — cada dato con fuente, NULL = no encontrado. Un dossier por prospecto, el último gana (upsert). Lo consume el Redactor como hechos verificados y el vendedor como ficha. Deny-all: solo el servidor.';

alter table public.prospecto_dossier enable row level security;
revoke all on table public.prospecto_dossier from public, anon, authenticated;
grant select, insert, update, delete on table public.prospecto_dossier to service_role;

-- ── 4. La lista de bajas ───────────────────────────────────────────────────
create table if not exists public.correo_suprimido (
  correo    text primary key,
  -- Por qué se suprimió: rebote / queja / baja pedida / manual. Obligatorio.
  motivo    text not null,
  creado_en timestamptz not null default now(),
  constraint correo_suprimido_minusculas check (correo = lower(correo)),
  constraint correo_suprimido_motivo_no_vacio check (length(btrim(motivo)) > 0)
);

comment on table public.correo_suprimido is
  'La lista global de direcciones a las que NO se escribe (0217): rebotes y quejas del webhook de entrega (0124) y bajas pedidas. El enviador la consulta fail-closed antes de cada envío. Suprimir es para siempre; quitar una fila es decisión manual.';

alter table public.correo_suprimido enable row level security;
revoke all on table public.correo_suprimido from public, anon, authenticated;
grant select, insert, update, delete on table public.correo_suprimido to service_role;

-- ── 5. Los tres agentes, al catálogo y al runner ───────────────────────────
-- El investigador REUSA el id `enriquecedor` (ya sembrado 0123/0181-era):
-- mismo lugar del organigrama, motor nuevo. Presupuestos conservadores — el
-- runner no corre agentes sin techo declarado, y el techo se compara contra
-- el gasto MEDIDO en agente_corrida (runner.ts).
update public.agente_definicion
set estado = 'vivo', disparador = 'cron', runner_habilitado = true,
    presupuesto_dia_usd = coalesce(presupuesto_dia_usd, 2.00),
    descripcion = 'El investigador (C3, motor 0217): investiga la empresa completa — historia, contactos, TODOS los correos, teléfonos, empleados, flotilla — leyendo su sitio real; cada dato con fuente literal, "no encontrado" es salida válida. Jamás inventa un contacto ni compra datos.'
where id = 'enriquecedor';

update public.agente_definicion
set estado = 'vivo', disparador = 'cron', runner_habilitado = true,
    presupuesto_dia_usd = coalesce(presupuesto_dia_usd, 1.00),
    descripcion = 'El SDR (C8, motor 0217): seguimientos +3/+7 días SOLO a quien no contestó, máximo dos, a la cola de aprobación. Una respuesta, un rebote o una queja detienen su cadencia. El cierre es humano.'
where id = 'sdr';

insert into public.agente_definicion (id, nombre, departamento, disparador, estado, descripcion, runner_habilitado, presupuesto_dia_usd) values
  ('enviador', 'Enviador de Campaña', 'leads', 'cron', 'vivo',
   'La puerta de salida diaria (0217, orden del 27-ago): resuelve y envía las piezas de campaña por Resend — al correo principal con copia a todos los hallados de la empresa, menos suprimidos — respetando tope diario, cadencia atómica 48h (0124) y lista de bajas. No redacta: solo envía lo que el Redactor/SDR fabricaron. Su kill switch lo detiene sin deploy.',
   true, 0.10)
on conflict (id) do nothing;

-- ── 6. Los kill switches (patrón 0122: el CHECK se reescribe completo — la
-- lista trae TODOS los previos: los 4 financieros de la 0215 y los 4 de
-- dirección de la 0216, que corren antes) ──────────────────────────────────
alter table public.interruptor drop constraint interruptor_id_dominio;
alter table public.interruptor add constraint interruptor_id_dominio check (
  id in (
    'global',
    'agente:liquidacion', 'agente:facturas', 'agente:cobranza',
    'agente:conductores', 'agente:peajes', 'agente:proveedores',
    'agente:ventas', 'agente:redactor',
    'agente:analista_metricas', 'agente:control_costos',
    'agente:tesoreria', 'agente:cierre_mensual',
    'agente:kpi_whatsapp', 'agente:desempeno_startup',
    'agente:orquestador', 'agente:orquestador_semanal',
    'agente:enriquecedor', 'agente:sdr', 'agente:enviador'
  )
);
