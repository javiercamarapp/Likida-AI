-- ═══════════════════════════════════════════════════════════════════════════
-- 0218 — LOS 6 AGENTES DE ÉXITO DEL CLIENTE, VIVOS EN EL RUNNER
-- (compañía agente, departamento `exito_cliente`: onboarding_cliente,
-- exito_cliente, retencion, cobranza_saas, soporte y atencion_faq).
--
-- Los seis ya existían como FILAS 'disenado' desde la 0125 (blueprints en
-- 03-Atencion-al-Cliente, 04-Cobranza y 12-Agentes-del-Ciclo). Esta migración
-- los enciende con los candados del runner (0123): estado vivo +
-- runner_habilitado + presupuesto_dia_usd DECLARADO + kill switch propio.
--
-- CINCO SON DETERMINISTAS Y UNO GASTA MODELO. onboarding_cliente,
-- exito_cliente, retencion, cobranza_saas y soporte no llaman a ningún modelo
-- (motor en `agentes/exito.ts`): sus partes son plantilla fija sobre cifras
-- que el sistema ya contó, así que «nunca inventar una cifra» se cumple por
-- construcción — no hay quién la invente. Su `presupuesto_dia_usd` de $0.10 es
-- el candado FORMAL del runner (sin techo declarado no corre) y su gasto
-- medido es $0. `atencion_faq` sí redacta con LLM (motor en `agentes/faq.ts`,
-- rol back_office) y por eso lleva techo real de $1.00/día, que el runner
-- compara contra el gasto MEDIDO en `agente_corrida.costo_usd` antes de cada
-- pasada, igual que la máquina de prospección de la 0217.
--
-- DOS CAMBIAN DE DISPARADOR. `soporte` y `atencion_faq` nacieron 'manual' en
-- la 0125 (eran documento sin código: los disparaba una persona). El runner
-- solo despacha `disparador = 'cron'`, y lo que estos motores hacen —vigilar
-- el reloj del SLA, preparar borradores de tickets que llegan a cualquier
-- hora— es trabajo de reloj. Pasan a 'cron'; el botón manual sigue existiendo
-- porque el runner acepta `soloAgente`.
--
-- TRES CORRECCIONES DE `modelo_rol` frente a la 0125: allí se declaró lo que
-- el blueprint PROPONÍA; aquí se declara lo que el código HACE. Los cinco
-- deterministas quedan en NULL (no usan modelo de texto) y `atencion_faq` en
-- 'back_office'. Un catálogo que promete un modelo que nadie llama miente
-- sobre el costo del agente.
--
-- LO QUE NINGUNO DE LOS SEIS HACE SOLO (y los blueprints coinciden): escribirle
-- al cliente. No hay canal de correo al cliente aprobado — la secuencia de
-- onboarding día 0/1/3/7 sale como AVISO AL OPERADOR, el reporte de valor y los
-- recordatorios de cobranza salen como BORRADORES a `cola_aprobacion`, y el
-- borrador de un ticket es eso: un borrador. Lo único que sale sin esperar a
-- que alguien abra la bandeja son las alertas al OPERADOR (onboarding muerto,
-- SLA vencido), que van a Javier, no a la flota.
--
-- Dos piezas más:
--   1. El dominio del interruptor (0110/0122) gana los 6 kill switches — sin
--      ellos el runner ni los despacha (candado 1). La recreación ENUMERA LOS
--      26 valores: las migraciones corren en orden numérico, así que esta es
--      la última y define el dominio final; enumerar solo los míos borraría
--      del CHECK las palancas de los 20 agentes anteriores (el mismo aviso
--      que dejó escrito la 0216).
--   2. `cola_parte_exito_por_periodo` — UNA pieza por (agente, título). Los
--      títulos son deterministas por periodo («Onboarding — 2026-08-27»),
--      por factura y hito («Cobranza SaaS — LKAB2026 08 — D+7») o por ticket
--      («FAQ — ticket a1b2c3d4»), y este índice único parcial es el árbitro
--      de la carrera entre dos pasadas del runner (estándar técnico §7: la
--      idempotencia es un constraint, jamás un `if`). Parcial a estos seis a
--      propósito, igual que el de la 0215: el Redactor titula sus piezas con
--      el asunto del correo y DOS prospectos pueden compartir asunto
--      legítimamente.
--
-- SIN TABLAS NUEVAS, a propósito: la pieza en `cola_aprobacion` ES el
-- artefacto y ES el sello. Los agentes de dirección (0216) necesitaron
-- `reporte_direccion` porque MANDAN un correo y el sello tenía que escribirse
-- después de que el canal aceptara; estos seis no mandan nada, así que una
-- tabla de sello aparte solo duplicaría la fila que la bandeja ya guarda.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Los seis kill switches (patrón 0122/0215/0216/0217) ─────────────────
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
    'agente:enriquecedor', 'agente:sdr', 'agente:enviador',
    'agente:onboarding_cliente', 'agente:exito_cliente', 'agente:retencion',
    'agente:cobranza_saas', 'agente:soporte', 'agente:atencion_faq'
  )
);

comment on constraint interruptor_id_dominio on public.interruptor is
  'El catálogo cerrado de palancas: global + los 25 agentes autónomos declarados hasta la 0218. Espeja INTERRUPTORES en src/lib/likida/interruptores.ts. Un valor de más no enciende nada (SIN FILA = ENCENDIDO); uno de menos rompe en silencio la palanca de otro agente, y por eso cada recreación enumera TODOS.';

-- ── 2. Los seis, vivos y con techo ─────────────────────────────────────────
-- La descripción dice lo que el agente HACE hoy, no lo que promete.
update public.agente_definicion set
  estado = 'vivo', runner_habilitado = true, presupuesto_dia_usd = 0.10,
  modelo_rol = null, actualizado_en = now(),
  descripcion = 'Parte diario del onboarding: mide las cinco casillas medibles de /admin/flotas por flota (teléfono del jefe, conectores probados, política propia, avisos, primer viaje), marca la que lleva vencido su día de la secuencia 0/1/3/7 y dice dónde se resuelve. Una casilla que no se pudo medir NO cuenta como pendiente. ROJO al operador si una flota lleva 14 días sin un solo viaje. Determinista; no le escribe al cliente.'
  where id = 'onboarding_cliente';
update public.agente_definicion set
  estado = 'vivo', runner_habilitado = true, presupuesto_dia_usd = 0.10,
  modelo_rol = null, actualizado_en = now(),
  descripcion = 'Dos productos: el parte de SILENCIO (flotas sin un viaje, un gasto ni una conversación en 14 días, teniendo historia) y el REPORTE MENSUAL DE VALOR por flota desde el día 3, con cifras reales del mes —viajes liquidados, comprobado, IVA y peaje acreditables, diésel elegible— cada una con su consulta nombrada. El reporte va como borrador a la bandeja: lo manda Javier, no el agente.'
  where id = 'exito_cliente';
update public.agente_definicion set
  estado = 'vivo', runner_habilitado = true, presupuesto_dia_usd = 0.10,
  modelo_rol = null, actualizado_en = now(),
  descripcion = 'Parte semanal de gatillos: RIESGO por caída de uso semana contra semana (con piso de 3 viajes: un −50% de 2 a 1 no es señal) y por corridas repetidas en fallo de esa flota; EXPANSIÓN por subida sostenida. Cada gatillo va con su evidencia en conteos de base, y sin base para el porcentaje se dice «sin base» en vez de inventar un ∞%.'
  where id = 'retencion';
update public.agente_definicion set
  estado = 'vivo', runner_habilitado = true, presupuesto_dia_usd = 0.10,
  modelo_rol = null, actualizado_en = now(),
  descripcion = 'Dunning de las mensualidades de LIKIDA (factura_saas, no la cobranza a los clientes de la flota): cadencia −3/0/+3/+7/+15 contra el vencimiento, una PROPUESTA de recordatorio por factura y por hito a la bandeja. Nada sale solo: no hay canal de correo al cliente aprobado. Con 0 suscripciones el parte lo dice, que es su trabajo.'
  where id = 'cobranza_saas';
update public.agente_definicion set
  estado = 'vivo', runner_habilitado = true, disparador = 'cron',
  presupuesto_dia_usd = 0.10, modelo_rol = null, actualizado_en = now(),
  descripcion = 'Vigila el reloj de los tickets vivos: SLA vencido, por vencer (≤4 h), sin SLA pactado —que no es «vencido»— y sin una sola respuesta en el hilo. Los vencidos se escalan al operador en el momento, sin esperar a que alguien abra la bandeja. No contesta tickets: los pone enfrente.'
  where id = 'soporte';
update public.agente_definicion set
  estado = 'vivo', runner_habilitado = true, disparador = 'cron',
  presupuesto_dia_usd = 1.00, modelo_rol = 'back_office', actualizado_en = now(),
  descripcion = 'Prepara el BORRADOR de respuesta de un ticket citando SOLO el corpus verificado de normas/. Si el ticket no matchea el corpus, la pieza dice «esto lo contesta un humano» con el motivo. Lo que el modelo redacta pasa por dos guardias deterministas (cifrasRespaldadas y guardiaFundamento); si cualquiera truena, sale el borrador de citas literales. Único de los seis que gasta modelo.'
  where id = 'atencion_faq';

-- ── 3. Una pieza por periodo — el árbitro de la carrera ────────────────────
create unique index if not exists cola_parte_exito_por_periodo
  on public.cola_aprobacion (agente, titulo)
  where agente in ('onboarding_cliente', 'exito_cliente', 'retencion',
                   'cobranza_saas', 'soporte', 'atencion_faq');

comment on index public.cola_parte_exito_por_periodo is
  'UNA pieza de éxito del cliente por (agente, título) (0218). El título es determinista por periodo, por factura y hito, o por ticket, y dos pasadas del runner que compitan por el mismo lo resuelve la base: gana exactamente una y la perdedora no duplica nada. Parcial a los seis agentes de exito_cliente, por lo mismo que el de la 0215: las piezas del Redactor titulan por asunto de correo y pueden repetirse entre prospectos legítimamente.';
