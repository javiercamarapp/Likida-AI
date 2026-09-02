-- ═══════════════════════════════════════════════════════════════════════════
-- 0235 — LOS NUEVE QUE CIERRAN LA COMPAÑÍA AGENTE. Con esta migración
-- `agente_definicion` deja de tener una sola fila en 'disenado': 60 de 60
-- vivas, y ni una promesa sin motor.
--
--   dirección (3): automejora · especialistas_incidente · fundraising
--   leads     (6): scorer · dossier · vigia · demo_prep · propuestas · cazador
--
-- Los nueve existen en el catálogo desde la 0125 (blueprint escrito, cero
-- código). Hoy ganan motor —src/lib/likida/agentes/direccion.ts y
-- .../leads.ts— y esta migración hace las altas declarativas del patrón
-- 0215/0216/0218/0219/0230:
--
--   1. El flip en `agente_definicion`: 'vivo' + runner_habilitado + techo
--      declarado + disparador 'cron'. CINCO de los nueve venían con disparador
--      'manual' (especialistas_incidente, scorer, dossier, demo_prep,
--      propuestas): el runner solo despacha lo que dispara por reloj (candado
--      2), y los cinco motores ya saben irse en silencio cuando su periodo, su
--      empresa o su expediente ya tienen pieza. Los otros cuatro (automejora,
--      fundraising, vigia, cazador) ya eran 'cron' desde la 0125.
--      `modelo_rol` pasa a NULL en los nueve, y eso NO es un olvido: la
--      convención de la 0125 es NULL = no usa modelo de texto, y los nueve
--      motores construidos son deterministas de punta a punta. LOS NUEVE
--      traían un `modelo_rol` declarado por el BLUEPRINT ('back_office' en los
--      cinco de leads que puntúan y fichan, 'analisis' en los tres de
--      dirección, 'extraccion' en cazador) — el blueprint imaginaba un LLM
--      redactando. El motor real no llama a ninguno, y dejar el rol puesto
--      haría que el catálogo contara una cosa distinta de la que corre.
--      El techo se declara en los nueve porque el candado 3 del runner lo
--      exige, y porque el día que alguno redacte con modelo el freno ya está
--      puesto sin que nadie tenga que acordarse.
--   2. El dominio del interruptor (0110) crece con los nueve kill switches.
--      Un agente autónomo sin palanca no corre — candado 1 del runner.
--   3. `cola_pieza_direccion_por_periodo` y `cola_pieza_leads_por_periodo`:
--      UNA pieza por (agente, clave). El título es determinista —por semana,
--      por mes, por empresa o por expediente, según el agente— y estos índices
--      únicos parciales son el árbitro de la carrera entre dos pasadas del
--      runner (estándar §7: la idempotencia es un constraint, no un `if`).
--      Parciales a estos nueve a propósito, por la misma razón que los de la
--      0215/0218/0219/0230: el Redactor titula sus piezas con el asunto del
--      correo y dos prospectos pueden compartir asunto legítimamente.
--
-- LO QUE ESTA MIGRACIÓN NO HACE, Y ES LA MITAD DEL DISEÑO:
--
--   · NO crea una tabla nueva. Los nueve motores LEEN lo que ya existe
--     (agente_corrida, cron_latido, interruptor, cola_aprobacion, incidencia,
--     flota_poliza, proveedor_emergencia, contacto_emergencia, suscripcion,
--     plan, factura_saas, prospecto y sus satélites). Un agente que exige
--     tabla nueva para poder decir algo suele ser un agente que todavía no
--     sabe qué decir.
--   · NO siembra un solo dato de negocio: ni un precio, ni un teléfono, ni un
--     prospecto. Sembrar un dato desde una migración lo convierte en verdad
--     sin que nadie lo haya declarado — y en el caso de un teléfono de
--     emergencia, en una llamada a un desconocido el peor día.
--   · NO le da a `cazador` permiso de insertar en `prospecto`. El blueprint lo
--     describía reactivando el scraper del censo; ese scraper vive en otro
--     repo y corre fuera de este servidor. Aquí no hay web, así que el motor
--     produce el ENCARGO de caza sobre lo que ya está capturado. Una migración
--     que le abriera la puerta a insertar empresas inventadas sería el error
--     caro: después alguien les escribiría.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. El flip: vivos, con techo y con reloj ───────────────────────────────

-- Los nueve son deterministas: sin modelo, techo formal de $0.10 (el mismo
-- criterio de la 0219 y la 0230 — deterministas de punta a punta, pero el
-- candado 3 se declara igual).
update public.agente_definicion
set estado              = 'vivo',
    runner_habilitado   = true,
    disparador          = 'cron',
    presupuesto_dia_usd = 0.10,
    modelo_rol          = null,
    actualizado_en      = now()
where id in ('automejora', 'especialistas_incidente', 'fundraising',
             'scorer', 'dossier', 'vigia', 'demo_prep', 'propuestas', 'cazador');

-- Las descripciones del catálogo pasan de decir el DISEÑO a decir lo
-- CONSTRUIDO — que es justo el drift que el agente de documentación caza: un
-- flip de estado sin nota deja el catálogo contando lo de antes.

update public.agente_definicion set
  descripcion = 'Lee la telemetría de la propia compañía agente (0235) y propone qué palanca mover: fallos por agente con el error REAL que anotó la corrida, agentes que corren sin dejar pieza, gasto MEDIDO por agente (las corridas con costo NULL se cuentan aparte — NULL no es cero) y los crons que no laten. Solo propone apagar a quien falló más de la mitad de sus corridas: un fallo aislado se reintenta solo. NO mueve ninguna palanca, NO cambia ningún prompt: deja el parte en la bandeja. Todavía NO lee los diffs cuerpo/cuerpo_final que pedía el blueprint — no hay corpus de rechazos con volumen, y un patrón de tres casos es una superstición.',
  actualizado_en = now()
where id = 'automejora';

update public.agente_definicion set
  descripcion = 'Con un incidente de emergencia abierto (siniestro, robo, emergencia médica, varado, bloqueo) arma el parte de a quién llamar y con qué datos (0235). Los teléfonos salen SOLO de la base de esa flota — flota_poliza.telefono_siniestros, proveedor_emergencia.telefono (rotulado con si alguien lo verificó) y contacto_emergencia — y ni uno se deduce. hay_lesionados NULL significa NO PREGUNTADO: sobre un NULL no propone avisarle a ninguna familia y lo dice. LIKIDA NUNCA MARCA: una llamada automática abre un siniestro, que es dinero y acto jurídico (0198). Este agente pone el dato en la mano y se hace a un lado.',
  actualizado_en = now()
where id = 'especialistas_incidente';

update public.agente_definicion set
  descripcion = 'El parte de métricas para inversionistas con las cifras REALES (0235): MRR sobre suscripciones activas × precio declarado del plan, cobrado histórico de factura_saas, flotas, pipeline por etapa y liquidaciones. Si UNA sola suscripción activa está en un plan con precio_mensual NULL, el MRR entero sale INDETERMINADO — no parcial y no cero: un MRR al que le falta un cliente acaba citado en una junta como si fuera el total. La mitad del parte es la lista EXPLÍCITA de lo que todavía no existe (churn, CAC, LTV, runway, TAM, crecimiento MoM) con la razón de cada hueco. Cero proyecciones.',
  actualizado_en = now()
where id = 'fundraising';

update public.agente_definicion set
  descripcion = 'Puntúa la señal REAL del prospecto (0235) sobre cinco señales que constan o no constan: tamaño de flota, sitio web, correos hallados, vacante publicada y giro SCIAN. Con menos de tres, NO le pone número: declara SEÑAL INSUFICIENTE y lista qué falta averiguar. La razón es que similitud_icp_pct suma ceros por AUSENCIA, y un 0 se lee como «mal prospecto» cuando lo que pasa es que nadie investigó a esa empresa. Con señal suficiente CITA el derivado de la base (0140/0143); no lo recalcula, para que no puedan divergir.',
  actualizado_en = now()
where id = 'scorer';

update public.agente_definicion set
  descripcion = 'La ficha de una página para el vendedor (0235), con la raya entre lo verificado y lo que solo se supone: cada línea dice de dónde salió, un origen `inferido` de prospecto_persona se rotula como NO VERIFICADO, y un dossier sin fuentes registradas se declara no verificado entero. LEE prospecto_dossier; NO lo escribe — ese registro lo llena el investigador (0217) con lo que leyó de la web, y sobrescribirlo con una consolidación de lo que ya estaba le borraría la investigación. No inventa historia de empresa ni contactos: lo que no consta se imprime como NO CONSTA.',
  actualizado_en = now()
where id = 'dossier';

update public.agente_definicion set
  descripcion = 'Vigila a los prospectos ya tocados y levanta la mano por tres señales medidas sobre prospecto_contacto (0235): CONTESTÓ y nadie le ha vuelto (la señal más fuerte y la que más rápido se enfría), se venció el plazo de la cadencia 0/2/5/10 sin respuesta, o la etapa afirma un contacto que el historial no registra. «Nunca se le tocó» y «hace mucho» se guardan y se leen distinto. NO devuelve leads al pool, NO cambia etapas y NO manda el seguimiento: eso lo redacta el SDR y lo manda el enviador (0217), los dos por la bandeja.',
  actualizado_en = now()
where id = 'vigia';

update public.agente_definicion set
  descripcion = 'El brief de la demo agendada (0235): quién es la empresa, qué dolor declaró ella misma (vacante y urgencia), qué números SUYOS conocemos y con qué respaldo. Separa lo MEDIDO (num_unidades) de lo SUPUESTO (viajes_mes_estimado = unidades × 18, supuesto de sector de la 0140) en vez de mezclarlos. Dice explícitamente que «agendada» es la ETAPA del embudo y no una cita: Likida no tiene tabla de calendario y este brief no sabe el día ni la hora. Sin tamaño de flota capturado lo declara como la primera pregunta de la llamada, no lo estima.',
  actualizado_en = now()
where id = 'demo_prep';

update public.agente_definicion set
  descripcion = 'El borrador de propuesta para un prospecto en negociación con el pricing REAL de la base (0235): lee `plan` y cita precio_mensual tal cual. Un plan con precio_mensual NULL sale SIN CIFRA y con el hueco marcado — no se toma el precio de un plan parecido, no se promedia y no se pone «desde $X»: la 0052 sembró los planes sin precio con la razón escrita de que «un precio de ejemplo termina en una propuesta», y ésta es esa propuesta. Tampoco afirma descuentos, plazos, condiciones de pago ni ROI: nada de eso está declarado. Y jamás dice «clientes reales».',
  actualizado_en = now()
where id = 'propuestas';

update public.agente_definicion set
  descripcion = 'El ENCARGO de caza sobre lo que YA está en la base (0235): el perfil (giro, ciudad, mediana de flota) de los prospectos que de verdad avanzaron —y si son menos de cinco, dice que no hay perfil en vez de retratar dos anécdotas—, las celdas giro × ciudad donde nadie ha tocado a nadie, y los que están en estado nuevo sin un solo contacto registrado. NO busca empresas en internet y NO da de alta prospectos: este servidor no navega la web, el scraper del censo vive en otro repo, y una empresa inventada en el CRM termina en un correo a una dirección que nadie verificó.',
  actualizado_en = now()
where id = 'cazador';

-- ── 2. Los nueve kill switches (candado 1 del runner) ──────────────────────
-- La lista recrea el dominio COMPLETO a propósito (mismo razonamiento que la
-- 0215/0216/0217/0218/0219/0230 y la correctiva 0227): las migraciones corren
-- en orden numérico, así que la recreación más alta define el dominio final —
-- enumerar solo los míos borraría del CHECK las palancas de los agentes
-- anteriores. Un valor de más no enciende nada (SIN FILA = ENCENDIDO); uno de
-- menos rompe la palanca de otro agente en silencio, que es el fallo caro y el
-- que ya rompió producción una vez.
--
-- Los 49 primeros son la lista de la 0234 copiada TAL CUAL: global + 8 de
-- flota/redactor + 4 financieros + 4 de dirección + 3 de prospección + 6 de
-- éxito + 4 de back office + 10 de crecimiento + la descarga del SAT + 8 de
-- ingeniería. Los 9 de abajo son los de esta migración. Total: 58.
--
-- LOS 8 DE INGENIERÍA SE ABSORBIERON EN EL REBASE, Y ESE ES EL PUNTO. Esta
-- migración se escribió cuando la 0234 todavía no estaba en master y enumeraba
-- 50 valores. La 0234 entró antes, con los suyos, y al rebasar había que
-- recontarlos: si esta lista se hubiera quedado en 50, apagar a
-- `agente:seguridad` habría rebotado con check_violation el día que hiciera
-- falta. Es exactamente el incidente que la 0227 corrigió, repetido — y la
-- razón por la que la regla dice CONTAR el dominio vigente en cada rebase en
-- vez de confiar en el número que traía el PR.
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
    -- Los 4 de dirección que MANDAN CORREO (0216).
    'agente:kpi_whatsapp', 'agente:desempeno_startup',
    'agente:orquestador', 'agente:orquestador_semanal',
    -- La máquina de prospección (0217).
    'agente:enriquecedor', 'agente:sdr', 'agente:enviador',
    -- Los 6 de éxito del cliente (0218).
    'agente:soporte', 'agente:onboarding_cliente', 'agente:exito_cliente',
    'agente:atencion_faq', 'agente:cobranza_saas', 'agente:retencion',
    -- Los 4 del back office restante (0219).
    'agente:vigilante_calidad', 'agente:documentacion',
    'agente:legal_compliance', 'agente:talento',
    -- Los 10 de crecimiento (0230).
    'agente:contenido_fiscal', 'agente:lead_magnet', 'agente:seo_distribucion',
    'agente:guiones', 'agente:noticias_mercado', 'agente:promos_diarias',
    'agente:visuales', 'agente:video_demo', 'agente:video_marketing',
    'agente:alianzas',
    -- La descarga masiva del SAT (0231).
    'agente:descarga_sat',
    -- Los 8 de ingeniería (0234), la ola paralela que entró antes que ésta.
    'agente:migraciones', 'agente:seguridad', 'agente:rendimiento',
    'agente:pruebas', 'agente:auditor_codigo', 'agente:releases',
    'agente:producto', 'agente:datos_instrumentacion',
    -- Los 3 de dirección que van a la BANDEJA (0235). Ninguno ejecuta nada:
    -- automejora PROPONE mover una palanca y no la mueve, el de incidentes
    -- prepara la llamada y no marca, fundraising deja el parte y no lo manda.
    -- Aun así llevan la suya: son los que Javier lee para decidir, y una
    -- fuente que empieza a mentir tiene que poderse callar con un click.
    'agente:automejora', 'agente:especialistas_incidente', 'agente:fundraising',
    -- Los 6 de leads (0235), los últimos del catálogo. Preparan lo que después
    -- se le manda a una empresa real: si uno empieza a fabricar ruido, apagarlo
    -- no puede exigir apagar la prospección entera.
    'agente:scorer', 'agente:dossier', 'agente:vigia',
    'agente:demo_prep', 'agente:propuestas', 'agente:cazador'
  )
);

comment on constraint interruptor_id_dominio on public.interruptor is
  'El dominio COMPLETO de palancas (58 al 0235 — el catálogo entero de la compañía agente, 60/60 vivos, más la global). Cada migración que enciende agentes lo RECREA enumerando todo el catálogo: la recreación más alta gana, y una que enumere solo los suyos borraría en silencio las palancas anteriores (el incidente que la 0227 corrigió). El espejo en código es INTERRUPTORES en src/lib/likida/interruptores.ts.';

-- ── 3. Una pieza por periodo — el árbitro de la carrera ────────────────────
--
-- Dos índices y no uno, uno por departamento, por la misma razón por la que
-- hay uno por ola desde la 0215: cada `where ... in (...)` es la lista de esa
-- ola y se lee de un vistazo. Un índice único gigante que fuera creciendo
-- migración tras migración obligaría a releer treinta ids para saber si el
-- Redactor sigue afuera.

create unique index if not exists cola_pieza_direccion_por_periodo
  on public.cola_aprobacion (agente, titulo)
  where agente in ('automejora', 'especialistas_incidente', 'fundraising');

comment on index public.cola_pieza_direccion_por_periodo is
  'UNA pieza por (agente, clave) para los 3 de dirección que encolan (0235). La clave del título es determinista y distinta en cada uno: la SEMANA en automejora, el MES en fundraising y el EXPEDIENTE en especialistas_incidente — un incidente que sigue abierto mañana no necesita un parte nuevo con los mismos teléfonos. Parcial a estos tres: las piezas del Redactor titulan por asunto y pueden repetirse entre prospectos.';

create unique index if not exists cola_pieza_leads_por_periodo
  on public.cola_aprobacion (agente, titulo)
  where agente in ('scorer', 'dossier', 'vigia', 'demo_prep', 'propuestas', 'cazador');

comment on index public.cola_pieza_leads_por_periodo is
  'UNA pieza por (agente, clave) para los 6 de leads (0235). La clave es la SEMANA en scorer y cazador, el DÍA en vigia, y la EMPRESA en dossier, demo_prep y propuestas — la ficha de una empresa no se rehace cada semana, y dos pasadas del runner que compitan por la misma las resuelve la base: gana exactamente una. Parcial a estos seis por la misma razón que los índices de la 0215/0218/0219/0230.';
