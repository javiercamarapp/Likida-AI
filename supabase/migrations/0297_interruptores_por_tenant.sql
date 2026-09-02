-- ═══════════════════════════════════════════════════════════════════════════
-- 0297 — INTERRUPTORES POR TENANT DEL PIPELINE DEL CHOFER (ADM-6, auditoría 24).
--
-- `interruptor` (0110) es GLOBAL POR AGENTE, a propósito: los crons barren
-- todas las flotas en una sola corrida y la palanca corta el barrido entero.
-- Pero el pipeline que un chofer ejercita por WhatsApp (recepción, OCR,
-- cuadre) NO es un cron — corre por WEBHOOK, una flota a la vez — y hoy no
-- tiene NINGUNA palanca: las 58 de `interruptor` son de agentes de back
-- office y `global` apagaría TODAS las flotas a la vez. Si el OCR de UNA
-- flota empieza a gastar de más o a fallar, la única opción hoy es apagar el
-- producto entero.
--
-- TABLA PROPIA, NO UNA COLUMNA EN `interruptor`: esa tabla es deny-all con un
-- dominio GLOBAL por diseño (comentario de la 0110: "duplicaría la config
-- por flota que ya existe"). Mezclar aquí un `tenant_id` nullable habría
-- hecho que CADA lectura de los crons (que preguntan por 'global' y
-- 'agente:*', nunca por tenant) tuviera que filtrar `tenant_id is null` a
-- mano — un solo `WHERE` olvidado filtra de menos y una palanca de flota
-- apagaría a todas. Una tabla nueva, con su propia PK (tenant_id, pipeline),
-- hace ese error estructuralmente imposible.
--
-- MISMO CONTRATO QUE `interruptor`: SIN FILA = ENCENDIDO (el pipeline corre
-- por default; una fila solo existe cuando alguien tocó la palanca), y
-- apagado exige motivo (mismo CHECK). `pipeline` tiene dominio cerrado a los
-- TRES pasos del camino del chofer — el mismo que `qa-tipos.ts` y
-- `qa-escenarios.ts` ya ejercitan en el panel de QA.
--
-- RLS DENY-ALL: mismo patrón que `interruptor` — solo el servidor
-- (service-role) la toca, desde server actions de /admin que re-gatean
-- superadmin.
--
-- LA APLICACIÓN DE ESTA PALANCA (que `processor.ts` la consulte antes de
-- invocar el modelo de OCR/cuadre, o que el webhook la consulte antes de
-- aceptar el mensaje) vive fuera de este agente — requiere tocar
-- `lib/likida/processor.ts`, que no es archivo propio de esta ronda. Ver
-- CIERRE.md para el diff propuesto. Esta migración deja LISTO el
-- almacenamiento, la bitácora y la pantalla de /admin para prender la
-- palanca en cuanto ese cableado exista.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.interruptor_tenant (
  tenant_id    uuid not null references public.tenant(id) on delete cascade,
  -- Los tres pasos del camino del chofer por WhatsApp: recepción/router,
  -- OCR de la foto del ticket, y el cuadre final. Dominio cerrado — un
  -- nombre inventado rebota aquí, no falla en silencio en un cron que nunca
  -- lo consultaría (mismo criterio que `interruptor_id_dominio`, 0110).
  pipeline     text not null check (pipeline in ('whatsapp', 'ocr', 'cuadre')),
  apagado      boolean not null default false,
  -- Obligatorio al apagar (CHECK abajo); se limpia al encender.
  motivo       text,
  -- Quién movió la palanca por última vez. `set null` y no cascade: borrar
  -- la cuenta de quien apagó algo no debe re-encenderlo ni borrar la
  -- evidencia (mismo criterio que `interruptor.cambiado_por`).
  cambiado_por uuid references public.app_user(id) on delete set null,
  cambiado_en  timestamptz not null default now(),

  primary key (tenant_id, pipeline),

  -- Apagado ⇒ motivo no vacío. Mismo CHECK que `interruptor` (0110): apagar
  -- sin decir por qué deja una bomba sin nota, y espacios en blanco no son
  -- un porqué.
  constraint interruptor_tenant_apagado_con_motivo check (
    not apagado or (motivo is not null and length(btrim(motivo)) > 0)
  )
);

create index if not exists interruptor_tenant_tenant_idx on public.interruptor_tenant(tenant_id);

comment on table public.interruptor_tenant is
  'Kill switch por flota del pipeline del chofer (0297, ADM-6 auditoría 24). SIN FILA = ENCENDIDO. A diferencia de interruptor (0110, global por agente), este apaga UN PASO (whatsapp/ocr/cuadre) de UNA sola flota — el webhook la consulta antes de aceptar/procesar, no un cron que barre todas. Deny-all: lo escribe solo el servidor (server actions de /admin, re-gatean superadmin).';
comment on column public.interruptor_tenant.pipeline is
  'El paso del camino del chofer: whatsapp (recepción/router), ocr (lectura de la foto), cuadre (cierre de la liquidación).';
comment on column public.interruptor_tenant.motivo is
  'Por qué se apagó — obligatorio con apagado=true. Al encender vuelve a null.';
comment on column public.interruptor_tenant.cambiado_por is
  'app_user que movió la palanca. La bitácora (0053, entidad=''interruptor'') guarda el historial completo; aquí solo el último toque.';

-- Deny-all: enable SIN políticas. Todo acceso es service-role del servidor.
alter table public.interruptor_tenant enable row level security;
