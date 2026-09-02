-- ═══════════════════════════════════════════════════════════════════════════
-- 0219 — EL BACK OFFICE RESTANTE SE ENCIENDE: vigilante_calidad,
-- documentacion, legal_compliance y talento pasan de 'disenado' a VIVOS.
--
-- Los cuatro existen en el catálogo desde la 0125 (blueprint escrito, cero
-- código). Hoy ganan motor (src/lib/likida/agentes/backoffice.ts) y esta
-- migración hace las altas declarativas del patrón 0215/0216:
--
--   1. El flip en `agente_definicion`: 'vivo' + runner_habilitado + techo
--      declarado. `modelo_rol` pasa a NULL por la convención de la 0125
--      (NULL = no usa modelo de texto), que es la verdad de este motor:
--      los cuatro son deterministas de punta a punta. El techo se declara
--      igual porque el candado 3 del runner lo exige y porque el día que
--      alguno redacte con modelo el freno ya está puesto.
--      `talento` cambia además de disparador 'manual' a 'cron': el runner
--      solo despacha lo que dispara por reloj (candado 2), y su motor ya
--      sabe irse en silencio cuando no hay vacantes abiertas.
--   2. El dominio del interruptor (0110) crece con los cuatro kill switches.
--      Un agente autónomo sin palanca no corre — candado 1 del runner.
--   3. `cola_parte_backoffice_por_periodo`: UN parte por (agente, periodo).
--      El título es determinista por semana y este índice único parcial es
--      el árbitro de la carrera entre dos pasadas del runner (estándar §7:
--      la idempotencia es un constraint, no un `if`). Parcial a los cuatro
--      a propósito, por la misma razón que el de la 0215: el Redactor titula
--      sus piezas con el asunto del correo y dos prospectos pueden compartir
--      asunto legítimamente.
--   4. `pendiente_societario` — el registro DECLARATIVO de los pendientes
--      corporativos que están bloqueados fuera del código (los declara
--      Javier; el agente los lee y los pone enfrente). Las dos filas que se
--      siembran salen del blueprint de legal-compliance y van SIN fecha
--      objetivo: una fecha inventada por una migración sería un compromiso
--      que nadie asumió.
--   5. `vacante` y `candidato` — el registro mínimo de talento. Hoy hay CERO
--      vacantes: la tabla nace vacía a propósito y el agente lo dice en su
--      corrida. `candidato` guarda DATOS PERSONALES de gente que no contrató
--      nada, así que nace con el doble candado más duro del repo (RLS sin
--      policies + grants solo a service_role) y entra al circuito ARCO.
--
-- LO QUE ESTA MIGRACIÓN NO HACE: no siembra vacantes, ni candidatos, ni
-- fechas societarias. Sembrar un dato de negocio desde una migración lo
-- convierte en verdad sin que nadie lo haya declarado.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. El flip: vivos, con techo, sin modelo (deterministas) ───────────────
update public.agente_definicion
set estado              = 'vivo',
    runner_habilitado   = true,
    disparador          = 'cron',
    presupuesto_dia_usd = 0.10,
    modelo_rol          = null,
    actualizado_en      = now()
where id in ('vigilante_calidad', 'documentacion', 'legal_compliance', 'talento');

-- Las descripciones del catálogo pasan de decir el DISEÑO a decir lo
-- CONSTRUIDO — que es justo el drift que el agente de documentación caza:
-- un flip de estado sin nota deja el catálogo contando lo de antes.
update public.agente_definicion set
  descripcion = 'Audita la CONDUCTA de los otros agentes con datos reales (0219): tasa de fallo por agente, verde vacío (dijo ok y no hizo nada), costo por corrida contra su PROPIA historia, y las piezas que un humano rechazó. Parte semanal con evidencia por hallazgo. NO audita código: eso es del auditor de código.',
  actualizado_en = now()
where id = 'vigilante_calidad';

update public.agente_definicion set
  descripcion = 'Caza el drift documental de la compañía agente (0219): compara el catálogo VIVO (agente_definicion) contra el censo que él mismo dejó en su parte anterior — altas, bajas, flips de estado sin nota y agentes vivos sin descripción útil — y produce el resumen citable «qué cambió esta semana».',
  actualizado_en = now()
where id = 'documentacion';

update public.agente_definicion set
  descripcion = 'Los relojes legales de LIKIDA-empresa (0219): aviso de privacidad efectivamente publicado (se pide la ruta, no se supone), datos legales declarados (LEGAL_*), solicitudes ARCO pendientes con el plazo del art. 31 LFPDPPP y los pendientes societarios declarados. Prepara; jamás firma ni contesta a una autoridad.',
  actualizado_en = now()
where id = 'legal_compliance';

update public.agente_definicion set
  descripcion = 'Registro de vacantes y criba determinista de candidatos (0219). Con cero vacantes abiertas anota su corrida y se va: despierta cuando se declara una vacante. La criba puntúa por requisitos DECLARADOS y nunca descarta — marca cribado con motivo y el humano decide. Datos de candidatos = datos personales: deny-all y ARCO.',
  actualizado_en = now()
where id = 'talento';

-- ── 2. Los cuatro kill switches (candado 1 del runner) ─────────────────────
-- La lista recrea el dominio COMPLETO a propósito (mismo razonamiento que la
-- 0215/0216/0217): las migraciones corren en orden numérico, así que la
-- recreación más alta define el dominio final — enumerar solo los míos
-- borraría del CHECK las palancas de los agentes anteriores. Un valor de más
-- no enciende nada (SIN FILA = ENCENDIDO); uno de menos rompe la palanca de
-- otro agente en silencio, que es el fallo caro.
--
-- Incluye también los seis de `exito_cliente` que la 0218 da de alta (corre
-- ANTES por número): si esa ola aún no aterrizó, seis nombres de más en el
-- CHECK no encienden ni apagan nada; si aterrizó, esta recreación no los
-- borra. El orden numérico es la protección.
alter table public.interruptor drop constraint interruptor_id_dominio;
alter table public.interruptor add constraint interruptor_id_dominio check (
  id in (
    'global',
    -- Los agentes de flota (0102/0105) y el Redactor (0122).
    'agente:liquidacion', 'agente:facturas', 'agente:cobranza',
    'agente:conductores', 'agente:peajes', 'agente:proveedores',
    'agente:ventas', 'agente:redactor',
    -- Los 4 financieros (0215).
    'agente:analista_metricas', 'agente:control_costos',
    'agente:tesoreria', 'agente:cierre_mensual',
    -- Los 4 de dirección (0216).
    'agente:kpi_whatsapp', 'agente:desempeno_startup',
    'agente:orquestador', 'agente:orquestador_semanal',
    -- La máquina de prospección (0217).
    'agente:enriquecedor', 'agente:sdr', 'agente:enviador',
    -- Los 6 de éxito del cliente (0218, ola paralela).
    'agente:soporte', 'agente:onboarding_cliente', 'agente:exito_cliente',
    'agente:atencion_faq', 'agente:cobranza_saas', 'agente:retencion',
    -- Los 4 de esta migración.
    'agente:vigilante_calidad', 'agente:documentacion',
    'agente:legal_compliance', 'agente:talento'
  )
);

-- ── 3. Un parte por periodo — el árbitro de la carrera ─────────────────────
create unique index if not exists cola_parte_backoffice_por_periodo
  on public.cola_aprobacion (agente, titulo)
  where agente in ('vigilante_calidad', 'documentacion', 'legal_compliance', 'talento');

comment on index public.cola_parte_backoffice_por_periodo is
  'UN parte por (agente, periodo) para los 4 del back office restante (0219): el título es determinista por semana y dos pasadas del runner que compitan por el mismo lo resuelve la base — gana exactamente una. Parcial a estos cuatro: las piezas del Redactor titulan por asunto y pueden repetirse entre prospectos.';

-- ── 4. Los pendientes societarios DECLARADOS ───────────────────────────────
create table if not exists public.pendiente_societario (
  -- Clave legible: el parte cita por id y un uuid no se cita.
  id             text primary key
                   constraint pendiente_societario_id_forma check (id ~ '^[a-z0-9_]{2,40}$'),
  titulo         text not null
                   constraint pendiente_societario_titulo_no_vacio check (length(btrim(titulo)) > 0),
  detalle        text,
  estado         text not null default 'bloqueado_por_javier'
                   constraint pendiente_societario_estado_dominio
                   check (estado in ('bloqueado_por_javier', 'en_proceso', 'cerrado')),
  -- NULL = SIN FECHA DECLARADA. El agente la reporta como tal y JAMÁS
  -- inventa una: un plazo puesto por software es un compromiso que nadie
  -- asumió, y el parte legal existe para no hacer esa clase de afirmación.
  fecha_objetivo date,
  cerrado_en     date,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  -- Cerrado ⟺ tiene fecha de cierre (los dos sentidos), mismo criterio que
  -- `arco_cierre_coherente` (0053).
  constraint pendiente_societario_cierre_coherente
    check ((estado = 'cerrado') = (cerrado_en is not null))
);

comment on table public.pendiente_societario is
  'Pendientes corporativos de LIKIDA que están bloqueados FUERA del código y que Javier declara (0219). El agente legal_compliance los LEE y los pone enfrente en su parte semanal; nunca los crea, ni les inventa fecha. Sin tenant: son de la empresa, no de una flota. Deny-all.';
comment on column public.pendiente_societario.fecha_objetivo is
  'NULL = sin fecha declarada. El parte legal escribe «SIN FECHA DECLARADA» — no se rellena con una estimación.';

alter table public.pendiente_societario enable row level security;
revoke all on table public.pendiente_societario from public, anon, authenticated;
grant select, insert, update, delete on table public.pendiente_societario to service_role;

-- Los dos que el blueprint de legal-compliance nombra como bloqueados por
-- Javier. Se siembran SIN fecha: el registro existe para que el reloj se vea,
-- no para fingir que hay un calendario.
insert into public.pendiente_societario (id, titulo, detalle, estado) values
  ('sapi', 'Constitución/conversión a SAPI de C.V.',
   'Declarado bloqueado por Javier: depende de notario y de la decisión societaria. Sin fecha objetivo declarada.',
   'bloqueado_por_javier'),
  ('marca_impi', 'Registro de la marca Likida ante el IMPI',
   'Declarado bloqueado por Javier: depende del trámite ante el IMPI. Sin fecha objetivo declarada.',
   'bloqueado_por_javier')
on conflict (id) do nothing;

-- ── 5. El registro mínimo de talento ───────────────────────────────────────
create table if not exists public.vacante (
  id          uuid primary key default gen_random_uuid(),
  -- Clave legible y única: el parte la cita y la criba se lee por ella.
  clave       text not null
                constraint vacante_clave_forma check (clave ~ '^[a-z0-9_-]{2,40}$'),
  titulo      text not null
                constraint vacante_titulo_no_vacio check (length(btrim(titulo)) > 0),
  estado      text not null default 'abierta'
                constraint vacante_estado_dominio check (estado in ('abierta', 'pausada', 'cerrada')),
  -- {"obligatorios": [...], "deseables": [...]} — la VARA de la criba. NULL
  -- o vacío = sin vara: el motor puntúa NULL y lo dice, jamás un 0.
  requisitos  jsonb,
  notas       text,
  abierta_en  date not null default (now() at time zone 'America/Mexico_City')::date,
  cerrada_en  date,
  creado_en   timestamptz not null default now(),
  constraint vacante_clave_unica unique (clave),
  constraint vacante_cierre_coherente check ((estado = 'cerrada') = (cerrada_en is not null))
);

comment on table public.vacante is
  'Vacantes internas de Likida (0219). Las declara una persona; el agente talento solo las LEE. Con cero filas abiertas el agente anota su corrida y se va — «sin vacantes abiertas» es el estado normal hoy, no un fallo.';

alter table public.vacante enable row level security;
revoke all on table public.vacante from public, anon, authenticated;
grant select, insert, update, delete on table public.vacante to service_role;

create table if not exists public.candidato (
  id           uuid primary key default gen_random_uuid(),
  vacante_id   uuid not null references public.vacante(id) on delete cascade,
  nombre       text not null
                 constraint candidato_nombre_no_vacio check (length(btrim(nombre)) > 0),
  -- Guardado ya normalizado: dos ortografías del mismo correo serían dos
  -- candidatos, y el índice único de abajo no las vería.
  correo       text not null
                 constraint candidato_correo_forma
                 check (correo = lower(btrim(correo)) and correo ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  -- El CV/perfil en texto: es lo ÚNICO contra lo que la criba compara.
  perfil       text,
  fuente       text,
  estado       text not null default 'recibido'
                 constraint candidato_estado_dominio
                 check (estado in ('recibido', 'cribado', 'entrevista', 'descartado', 'contratado')),
  -- NULL = sin vara (la vacante no declara requisitos) o sin perfil que
  -- cribar. Nunca un 0: un 0 es una calificación, un NULL es «no se midió».
  puntaje      int
                 constraint candidato_puntaje_rango check (puntaje is null or (puntaje between 0 and 100)),
  motivo       text,
  criba        jsonb,
  recibido_en  timestamptz not null default now(),
  cribado_en   timestamptz,
  -- Cribado ⟺ salió de 'recibido' (los dos sentidos): un candidato que
  -- avanzó sin dejar cuándo se le miró no es auditable.
  constraint candidato_criba_coherente check ((estado = 'recibido') = (cribado_en is null))
);

comment on table public.candidato is
  'Candidatos a una vacante interna (0219). DATOS PERSONALES de gente que no contrató nada: deny-all (RLS sin policies + grants solo a service_role) y sujeto a ARCO como cualquier titular. La criba del agente marca `cribado` con puntaje y motivo — jamás descarta: eso lo decide una persona.';
comment on column public.candidato.puntaje is
  'NULL = no se pudo puntuar (la vacante no declara requisitos, o el candidato no trae perfil). Nunca 0 por omisión.';

-- El mismo correo no entra dos veces a la misma vacante (la idempotencia de
-- una carga repetida es un constraint, no un `if` del importador).
create unique index if not exists candidato_por_vacante
  on public.candidato (vacante_id, correo);
-- La consulta del agente: los que faltan por cribar, los más viejos primero.
create index if not exists candidato_por_cribar_idx
  on public.candidato (vacante_id, recibido_en)
  where estado = 'recibido';

alter table public.candidato enable row level security;
revoke all on table public.candidato from public, anon, authenticated;
grant select, insert, update, delete on table public.candidato to service_role;
