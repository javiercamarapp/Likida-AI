-- ═══════════════════════════════════════════════════════════════════════════
-- 0110 — EL KILL SWITCH REAL (informe de consolas SV, piezas 2 y 5).
--
-- Cuando el primer cliente real esté en WhatsApp y un agente se porte mal,
-- Javier necesita apagarlo en cinco segundos desde el teléfono. Hoy la única
-- palanca es un redeploy de Vercel o tumbar una variable de entorno — minutos
-- en el mejor caso, y un martillo que apaga TODO cuando el problema es UN
-- agente. Esta migración pone la palanca en la base: una tabla chica que los
-- crons consultan antes de trabajar.
--
-- LA LLAVE ES EL NOMBRE. `id` es texto y ES el interruptor: 'global' apaga
-- todo el trabajo programado; 'agente:cobranza' apaga solo a ese agente. El
-- dominio se vigila con CHECK contra el catálogo REAL de agentes (el de
-- `agente_corrida`, 0102 + 0105) — un interruptor con nombre inventado no
-- apagaría nada y viviría para siempre dando la impresión de que sí.
--
-- SIN FILAS SEMBRADAS, A PROPÓSITO: SIN FILA = ENCENDIDO. El default seguro
-- es que el sistema corre; un interruptor solo existe cuando alguien lo tocó.
-- Sembrar ocho filas en 'encendido' solo agregaría un estado más que puede
-- desincronizarse del catálogo (un agente nuevo sin fila quedaría en el mismo
-- caso que hoy: sin fila = corre).
--
-- APAGAR EXIGE MOTIVO (CHECK): apagar sin decir por qué deja una bomba sin
-- nota — tres semanas después nadie sabe si ya se puede encender o si sigue
-- vivo el incidente que lo apagó. Encender no lo exige: encender ES volver al
-- default.
--
-- GLOBAL POR AGENTE, NO POR TENANT (v1): los crons barren todas las flotas en
-- una sola corrida; el interruptor corta el barrido entero. Apagar "cobranza
-- solo para la flota X" es config de esa flota (tenant.config), no de esta
-- tabla — mezclar los dos niveles aquí duplicaría la config por flota que ya
-- existe.
--
-- RLS DENY-ALL (enable sin policies): el interruptor lo lee y lo escribe el
-- SERVIDOR con service-role (crons y server actions de /admin, que re-gatean
-- superadmin antes de tocar nada). Mismo patrón que `api_idempotencia` (0098)
-- y `prospecto` (0105). Sin SECURITY DEFINER: no hay función aquí que lo
-- necesite.
--
-- ── `impersonacion_dia` — el dedup del "ver como" firmado ──────────────────
--
-- La otra pieza del informe (3): todo acceso "ver como" de un superadmin a
-- una flota real queda FIRMADO en `bitacora_auditoria`. Registrar cada carga
-- de página sería ruido (una sesión de revisión son decenas de páginas), así
-- que se firma UNA vez por (actor, flota, día MX). La bitácora (0053) no
-- tiene un unique aplicable — es append-only y jamás se le agregaría uno que
-- rebote escrituras legítimas —, así que el dedup vive en esta tabla chica:
-- el insert que GANA el PK es el que escribe la bitácora; el que pierde no
-- escribe nada. Crece a lo sumo (superadmins × flotas × días): hoy un actor.
-- SIN purga a propósito: engancharla a `mantenimiento_de_datos` tocaría la
-- RPC compartida (que otra ronda está tocando) por una tabla que tardará
-- años en pesar un MB.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.interruptor (
  -- El NOMBRE del interruptor, p. ej. 'agente:cobranza' o 'global'.
  id           text primary key,
  apagado      boolean not null default false,
  -- Obligatorio al apagar (CHECK abajo); se limpia al encender.
  motivo       text,
  -- Quién movió la palanca por última vez. `set null` y no cascade: borrar la
  -- cuenta de quien apagó algo no debe re-encenderlo ni borrar la evidencia.
  cambiado_por uuid references public.app_user(id) on delete set null,
  cambiado_en  timestamptz not null default now(),

  -- El catálogo real: 'global' + los 7 agentes del dominio de agente_corrida
  -- (0102 + ventas en 0105). Un nombre inventado rebota aquí, no falla en
  -- silencio en el cron que nunca lo consultaría.
  constraint interruptor_id_dominio check (
    id in (
      'global',
      'agente:liquidacion', 'agente:facturas', 'agente:cobranza',
      'agente:conductores', 'agente:peajes', 'agente:proveedores',
      'agente:ventas'
    )
  ),
  -- Apagado ⇒ motivo no vacío. Apagar sin decir por qué deja una bomba sin
  -- nota; espacios en blanco no son un porqué.
  constraint interruptor_apagado_con_motivo check (
    not apagado or (motivo is not null and length(btrim(motivo)) > 0)
  )
);

comment on table public.interruptor is
  'Kill switch (0110). SIN FILA = ENCENDIDO: una fila solo existe cuando alguien tocó la palanca. Los crons consultan ''global'' y su ''agente:*'' antes de trabajar (fail-closed: si no se puede leer, se lee como apagado). Global por agente en v1, no por tenant. Lo escribe solo el servidor (deny-all).';
comment on column public.interruptor.id is
  'El nombre ES la llave: ''global'' o ''agente:<id del catálogo de agente_corrida>''.';
comment on column public.interruptor.motivo is
  'Por qué se apagó — obligatorio con apagado=true (interruptor_apagado_con_motivo). Al encender vuelve a null.';
comment on column public.interruptor.cambiado_por is
  'app_user que movió la palanca. La bitácora (0053) guarda el historial completo; aquí solo el último toque.';

-- Deny-all: enable SIN políticas. Todo acceso es service-role del servidor.
alter table public.interruptor enable row level security;

-- ── El dedup de la impersonación firmada ───────────────────────────────────

create table if not exists public.impersonacion_dia (
  actor_id  uuid not null references public.app_user(id) on delete cascade,
  tenant_id uuid not null references public.tenant(id) on delete cascade,
  -- Día MX (America/Mexico_City), calculado por el servidor al registrar.
  dia       date not null,
  primary key (actor_id, tenant_id, dia)
);

comment on table public.impersonacion_dia is
  'Dedup del "ver como" firmado (0110): una fila por (superadmin, flota, día MX). El insert que gana el PK escribe la entrada en bitacora_auditoria; el que pierde no escribe nada. Jamás bloquea la resolución del tenant: un fallo aquí se loguea y la página sigue.';

-- Deny-all también: la escribe únicamente resolverTenantEfectivo vía
-- service-role; nadie la consulta desde una sesión.
alter table public.impersonacion_dia enable row level security;
