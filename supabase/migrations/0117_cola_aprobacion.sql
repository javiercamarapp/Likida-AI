-- ═══════════════════════════════════════════════════════════════════════════
-- 0117 — La cola de aprobación GENÉRICA: donde espera todo lo que un agente
-- redacta y un humano decide.
--
-- Fase 2 pieza 1 del blueprint (16-ago-2026). Es la dependencia que más
-- agentes toca (C5, C10, S1, S3, G1-G7, F1 — ORGANIGRAMA §2): hoy solo
-- existe la cola específica de facturas de proveedor; todo lo demás que un
-- agente redacte le llega a Javier suelto y lo pega a mano.
--
-- LAS TRES DECISIONES DE DISEÑO (panel-de-adquisicion.md §3, heredadas):
--
--  1. UNA tabla con PRIORIDAD, DOS bandejas en pantalla. El correo frío
--     (normal, 20-40/día) y la respuesta a ads (urgente, SLA en minutos) NO
--     se mezclan en una lista — el panel las pinta separadas. Una sola cola
--     con etiqueta reproduce el problema que agente-respuesta-a-ads §5.5 ya
--     resolvió por escrito.
--
--  2. EL CANDADO ES DE BASE, NO DE UI: ninguna ruta de "enviar" puede
--     ejecutarse sobre una fila que no esté aprobada — el CHECK
--     `cola_enviado_solo_aprobado` lo hace imposible de saltar por código
--     (mismo principio que el candado fiscal de dos llaves, checklist A3).
--
--  3. LAS TRES ACCIONES, NI UNA MÁS: aprobar tal cual, editar-y-aprobar
--     (la versión editada queda en `cuerpo_final`; el diff contra `cuerpo`
--     es lo que un día aprenderá qué edita más la gente), rechazar con
--     motivo OBLIGATORIO (CHECK — un rechazo sin motivo se vuelve a proponer
--     igual la próxima vez).
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.cola_aprobacion (
  id              uuid primary key default gen_random_uuid(),
  -- Qué clase de pieza es ('correo_frio', 'respuesta_ads', 'post',
  -- 'propuesta', …). Texto libre acotado, no CHECK: los tipos crecen con los
  -- agentes y cada tipo nuevo no debe ser una migración (la lección de la
  -- 0116, aplicada desde el día uno).
  tipo            text not null
                    constraint cola_tipo_forma check (tipo ~ '^[a-z0-9_]{2,40}$'),
  prioridad       text not null default 'normal'
                    constraint cola_prioridad_dominio check (prioridad in ('normal', 'urgente')),
  -- Quién la preparó: un agente DECLARADO. La FK es la trazabilidad mínima.
  agente          text not null references public.agente_definicion(id),
  -- De quién es la pieza: NULL = de Likida (prospección, contenido);
  -- con tenant = de una flota (borrador de respuesta a SU ticket, p.ej.).
  tenant_id       uuid references public.tenant(id) on delete cascade,
  -- El prospecto al que pertenece, si aplica (correo frío, respuesta a ads).
  prospecto_id    uuid references public.prospecto(id) on delete set null,
  titulo          text not null,
  -- El borrador COMPLETO, tal como el agente lo preparó.
  cuerpo          text not null,
  -- Trazabilidad: de dónde salió cada dato del borrador (la regla de
  -- agentes-ia-de-ventas: "cada afirmación debe existir en la fuente de
  -- verdad"). Conteos y referencias, sin datos personales de más.
  fuentes         jsonb,
  estado          text not null default 'pendiente'
                    constraint cola_estado_dominio check (estado in ('pendiente', 'aprobado', 'rechazado')),
  -- Si el humano editó al aprobar: la versión que SALE. NULL = salió tal cual.
  cuerpo_final    text,
  motivo_rechazo  text,
  resuelto_por    uuid references public.app_user(id) on delete set null,
  resuelto_en     timestamptz,
  -- Cuándo se ENVIÓ de verdad (lo marca el camino de envío, no la aprobación).
  enviado_en      timestamptz,
  creado_en       timestamptz not null default now(),

  -- EL CANDADO: enviar solo aprobado — constraint de base, no validación de UI.
  constraint cola_enviado_solo_aprobado check (enviado_en is null or estado = 'aprobado'),
  -- Un rechazo sin motivo no es un rechazo.
  constraint cola_rechazo_con_motivo check (estado <> 'rechazado' or (motivo_rechazo is not null and length(trim(motivo_rechazo)) > 0)),
  -- Resuelto ⟺ tiene fecha y actor de resolución (los dos sentidos).
  constraint cola_resolucion_coherente check ((estado = 'pendiente') = (resuelto_en is null)),
  -- El cuerpo editado solo existe en una pieza aprobada.
  constraint cola_edicion_solo_aprobada check (cuerpo_final is null or estado = 'aprobado')
);

comment on table public.cola_aprobacion is
  'La cola de aprobación genérica (Fase 2 pieza 1): todo lo que un agente redacta espera aquí una de TRES acciones humanas — aprobar, editar-y-aprobar, rechazar con motivo. El CHECK cola_enviado_solo_aprobado hace imposible enviar sin aprobación desde cualquier código. prioridad separa las DOS bandejas (normal=correo frío 20-40/día, urgente=respuesta a ads con SLA en minutos) que el panel pinta aparte. Deny-all: solo el servidor.';

-- Deny-all (mismo criterio que interruptor/prospecto/agente_definicion).
alter table public.cola_aprobacion enable row level security;

-- La consulta del panel: pendientes por bandeja, los más viejos primero.
create index if not exists cola_pendientes_idx
  on public.cola_aprobacion (prioridad, creado_en)
  where estado = 'pendiente';
