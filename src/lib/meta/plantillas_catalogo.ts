// ═══════════════════════════════════════════════════════════════════════════
// CATÁLOGO VERSIONADO DE PLANTILLAS DE WHATSAPP (Meta).
//
// UNA sola fuente de verdad: de aquí salen (a) los nombres que usa el código,
// (b) el documento docs/operacion/plantillas-meta.md (una prueba lo mantiene en
// sincronía), (c) el cuerpo que se manda a aprobación de Meta y (d) la
// verificación del estado de aprobación (plantillas_estado.ts).
//
// ── VERSIONADO ─────────────────────────────────────────────────────────────
// Una plantilla aprobada NO se edita: Meta no deja cambiar el texto de una
// plantilla aprobada sin volver a someterla, y cada nombre+idioma es único. Un
// cambio de texto = nombre nuevo (`..._v2`) y se retira la vieja cuando nadie la
// mande. `version` es el sufijo numérico del nombre, o 1 si no lo trae.
//
// ── HONESTIDAD SOBRE LO YA EXISTENTE ───────────────────────────────────────
// De las plantillas que el código ya manda, el repo conserva el NOMBRE y los
// PARÁMETROS que se envían, pero NO el texto exacto que Meta aprobó (se crearon a
// mano en el panel de Meta: ver docs/auditoria-back-office/CIERRE.md). Las que
// traen `textoVerificado: false` llevan un texto RECONSTRUIDO a partir de lo que
// el código manda y de lo que el aviso dice: hay que cotejarlo contra Meta con
// `scripts/verificar-plantillas-meta.ts` y corregir aquí lo que difiera. Como el
// envío solo manda parámetros, un texto de catálogo distinto del de Meta no rompe
// el envío; sí rompe la prueba de «cuerpo del catálogo = cuerpo en Meta».
//
// ── REGLAS DE META QUE VALIDA `validarCatalogo` ────────────────────────────
// Categoría UTILITY (transaccional/operativo; nunca promocional), nombre en
// minúsculas con guion bajo, variables {{1}}…{{n}} consecutivas, cuerpo ≤ 1,024
// caracteres, sin variable al inicio ni al final del cuerpo (Meta lo rechaza),
// encabezado de texto ≤ 60, botones de texto ≤ 25 caracteres y ≤ 10 botones.
// Fuente: https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/overview
//
// ── POR QUÉ NINGUNA LLEVA «PEDIR UBICACIÓN» ────────────────────────────────
// Meta no ofrece botón de solicitud de ubicación en plantillas (ver
// plantilla_payload.ts). Las plantillas del conductor que necesitan la posición
// traen un botón de respuesta rápida «Compartir ubicación»; al apretarlo el
// chofer abre la ventana y el sistema contesta con `enviarSolicitudUbicacion`.
//
// ── PAYLOAD DE LOS BOTONES DE RESPUESTA RÁPIDA ─────────────────────────────
// Convención: `<payloadPrefijo>:<viaje_id>` (≤ 128 caracteres). El webhook
// entrega ese texto como cuerpo del mensaje del botón (ver route.ts, «BOTÓN
// APRETADO»). Quien interprete el botón (Agente 5) parte por el primer `:`.
// EXCEPCIÓN: los botones de los recordatorios (`recordatorio_registrar`,
// `recordatorio_problema`) llevan además el hito al que se refieren,
// `<prefijo>:<viaje_id>:<hito>`, para que un recordatorio viejo no registre el
// hito que hoy toca (conductor/tipos.ts, `leerBotonConductor`).
// ═══════════════════════════════════════════════════════════════════════════
import type { OpcionesPlantilla, BotonPlantilla } from './plantilla_payload';

export type CategoriaPlantilla = 'UTILITY';

export type BotonCatalogo =
  | { tipo: 'QUICK_REPLY'; texto: string; payloadPrefijo: string }
  /** URL fija (sin variable). */
  | { tipo: 'URL'; texto: string; url: string };

export type EncabezadoCatalogo =
  | { tipo: 'TEXT'; texto: string; ejemplo?: string }
  | { tipo: 'DOCUMENT' }
  | { tipo: 'IMAGE' };

export type AgenteDestino =
  | 'chofer_asignacion' | 'chofer_cobranza' | 'oficina' | 'facturacion' | 'privacidad_arco'
  | 'gps' | 'asistencia' | 'mis_reglas' | 'agente5_conductor' | 'onboarding_operador' | 'vigia_cliente'
  | 'liquidacion_externa' | 'jornada';

export interface PlantillaCatalogo {
  nombre: string;
  version: number;
  categoria: CategoriaPlantilla;
  /** Idioma con el que se APRUEBA y con el que hay que pedirla al enviar. */
  idioma: 'es_MX' | 'es';
  agente: AgenteDestino;
  proposito: string;
  /** Quién la usa hoy (archivo) o `null` si aún no tiene llamador. */
  llamador: string | null;
  encabezado?: EncabezadoCatalogo;
  /** Texto EXACTO del cuerpo, con {{1}}…{{n}}. */
  cuerpo: string;
  /** Un ejemplo por variable (Meta lo exige al crear la plantilla). */
  ejemplos: string[];
  /** Qué es cada variable, en orden (para el llamador y para el doc). */
  variables: string[];
  botones: BotonCatalogo[];
  /** `false` = el texto es una reconstrucción; cotejar contra Meta. */
  textoVerificado: boolean;
  estado: 'en_uso' | 'nueva_para_aprobacion';
}

const ES_MX = 'es_MX' as const;

export const CATALOGO_PLANTILLAS: readonly PlantillaCatalogo[] = [
  // ── Existentes (el código ya las manda) ─────────────────────────────────
  {
    nombre: 'viaje_asignado', version: 1, categoria: 'UTILITY', idioma: ES_MX, agente: 'chofer_asignacion',
    proposito: 'Avisar al chofer que le asignaron un viaje (inicia la conversación).',
    llamador: 'src/lib/likida/notificar.ts',
    cuerpo: 'Te asignaron un viaje en Likida.\n{{1}}\n{{2}}\n{{3}}\n{{4}}\nManda por aquí la foto de cada ticket. Al cerrar el viaje te llega tu liquidación.',
    ejemplos: ['Viaje F-1042', 'Ruta: Guadalajara → Monterrey', 'Salida: 02/10/2026', 'Unidad ECO-114, anticipo $3,000.00'],
    variables: ['folio', 'ruta', 'salida', 'unidad y anticipo'],
    botones: [], textoVerificado: false, estado: 'en_uso',
  },
  {
    nombre: 'recordatorio_cierre', version: 1, categoria: 'UTILITY', idioma: ES_MX, agente: 'chofer_cobranza',
    proposito: 'Recordar al chofer que cierre su viaje (cobranza de comprobantes y recordatorio de aceptación) cuando su ventana de 24 h está cerrada.',
    llamador: 'src/lib/likida/agentes/cobranza.ts, src/lib/likida/escalar_viaje.ts',
    cuerpo: 'Recordatorio de Likida: {{1}}, tienes pendiente cerrar el viaje {{2}}. Manda por aquí los tickets que falten y escribe LISTO para recibir tu liquidación.',
    ejemplos: ['Juan Pérez', 'F-1042'],
    variables: ['nombre del chofer', 'folio'],
    botones: [], textoVerificado: false, estado: 'en_uso',
  },
  {
    nombre: 'cobranza_gastos_v1', version: 1, categoria: 'UTILITY', idioma: ES_MX, agente: 'chofer_cobranza',
    proposito: 'Cobranza por GASTO (Agente 7): avisar al chofer, con un solo mensaje fusionado, cuántos gastos suyos siguen sin comprobante y cuál es el primero, cuando su ventana de 24 h está cerrada.',
    llamador: 'src/lib/likida/agentes/cobranza_gasto.ts',
    cuerpo: 'Recordatorio de Likida: {{1}}, tienes pendientes los comprobantes de {{2}} de tus gastos. El primero: {{3}}. Manda por aquí la foto del ticket o el XML de la factura.',
    ejemplos: ['Juan Pérez', '2', 'Diésel $1,200.00 del 29 sept: falta la factura (CFDI)'],
    variables: ['nombre del chofer', 'cuántos gastos', 'el gasto más atrasado y qué comprobante le falta (una sola línea)'],
    botones: [], textoVerificado: true, estado: 'nueva_para_aprobacion',
  },
  {
    nombre: 'aviso_operacion_v1', version: 1, categoria: 'UTILITY', idioma: ES_MX, agente: 'oficina',
    proposito: 'Aviso genérico de operación al jefe/oficina cuando su ventana está cerrada (asistencia, cierre de liquidación).',
    llamador: 'src/lib/meta/aviso_oficina.ts',
    cuerpo: 'Aviso de operación de {{1}}: {{2}}. Detalle en {{3}}. Likida.',
    ejemplos: ['Juan Pérez', 'sigue reportando lesionados', 'https://app.likida.ai/dashboard/asistencia'],
    variables: ['chofer', 'resumen (≤ 60 caracteres)', 'liga al panel o al mapa'],
    botones: [], textoVerificado: false, estado: 'en_uso',
  },
  {
    nombre: 'plazo_factura', version: 1, categoria: 'UTILITY', idioma: ES_MX, agente: 'facturacion',
    proposito: 'Avisar que hay tickets con plazo de facturación por vencer (respaldo fuera de ventana).',
    llamador: 'src/lib/likida/facturacion/avisar.ts',
    cuerpo: 'Tienes {{1}} ticket(s) con plazo de facturación por vencer. Entra a tu panel de Likida para revisarlos.',
    ejemplos: ['3'],
    variables: ['cuántos tickets'],
    botones: [], textoVerificado: false, estado: 'en_uso',
  },
  {
    nombre: 'respuesta_arco_v2', version: 2, categoria: 'UTILITY', idioma: 'es', agente: 'privacidad_arco',
    proposito: 'Entregar la respuesta a una solicitud ARCO cuando el titular está fuera de la ventana. OJO: se aprobó en idioma `es`, no `es_MX` (client.ts).',
    llamador: 'src/lib/meta/client.ts (enviarRespuestaArco)',
    cuerpo: 'Respuesta a tu solicitud de derechos ARCO de parte de {{1}}: {{2}} Si tienes dudas, responde a este mensaje.',
    ejemplos: ['Transportes del Norte SA de CV', 'tu solicitud fue atendida'],
    variables: ['razón social de la flota', 'resolución'],
    botones: [], textoVerificado: false, estado: 'en_uso',
  },
  {
    nombre: 'gps_alerta_critica', version: 1, categoria: 'UTILITY', idioma: ES_MX, agente: 'gps',
    proposito: 'Alerta GPS crítica con botón de acuse (se encola en wa_outbox con llave de idempotencia).',
    llamador: 'src/lib/meta/client.ts (encolarBotonesWhatsApp)',
    cuerpo: 'Alerta GPS de Likida: {{1}} Responde con el botón para acusar de recibido.',
    ejemplos: ['La unidad ECO-114 salió de su geocerca a las 02:10.'],
    variables: ['texto de la alerta'],
    botones: [{ tipo: 'QUICK_REPLY', texto: 'Enterado', payloadPrefijo: 'gps_ack' }],
    textoVerificado: false, estado: 'en_uso',
  },
  {
    nombre: 'siniestro_reportado_v1', version: 1, categoria: 'UTILITY', idioma: ES_MX, agente: 'asistencia',
    proposito: 'Avisar de una incidencia en carretera al jefe (fase 0 de asistencia).',
    llamador: 'scripts/mandar-plantillas-meta-fase0.sh',
    cuerpo: 'Incidencia en carretera: {{1}} reportó una incidencia. Tipo: {{2}}. Última ubicación conocida: {{3}}. Responde este mensaje para coordinar la atención.',
    ejemplos: ['Juan Pérez', 'choque', 'Carretera 180, km 45, cerca de Valladolid'],
    variables: ['chofer', 'tipo de incidencia', 'última ubicación'],
    botones: [], textoVerificado: true, estado: 'en_uso',
  },
  {
    nombre: 'siniestro_sin_atender_v1', version: 1, categoria: 'UTILITY', idioma: ES_MX, agente: 'asistencia',
    proposito: 'Escalar una incidencia que lleva tiempo sin atenderse.',
    llamador: 'scripts/mandar-plantillas-meta-fase0.sh',
    cuerpo: 'La incidencia de {{1}} sigue sin atenderse desde hace {{2}}. Último estado: {{3}}. Responde este mensaje ahora para tomar el caso.',
    ejemplos: ['Juan Pérez', '10 minutos', 'N2, sin respuesta del jefe'],
    variables: ['chofer', 'tiempo sin atender', 'último estado'],
    botones: [], textoVerificado: true, estado: 'en_uso',
  },

  // ── Nuevas ──────────────────────────────────────────────────────────────
  {
    nombre: 'regla_aviso_v1', version: 1, categoria: 'UTILITY', idioma: ES_MX, agente: 'mis_reglas',
    proposito: 'Respaldo de «Mis reglas»: la regla que la flota confirmó encontró casos nuevos y su ventana de 24 h está cerrada.',
    llamador: 'src/lib/likida/reglas/vigilante.ts',
    cuerpo: 'Tu regla de Likida encontró {{1}} caso(s) nuevo(s): {{2}} Revisa el detalle de cada caso en «Mis reglas» ({{3}}).',
    ejemplos: ['2', 'avisarte cuando entre un comprobante de casetas por más de $3,000.00.', 'https://app.likida.ai/dashboard/reglas'],
    variables: ['número de casos nuevos', 'frase que la persona confirmó (≤ 120 caracteres)', 'liga a «Mis reglas»'],
    botones: [], textoVerificado: true, estado: 'nueva_para_aprobacion',
  },
  {
    nombre: 'conductor_solicitud_llegada_carga_v1', version: 1, categoria: 'UTILITY', idioma: ES_MX, agente: 'agente5_conductor',
    proposito: 'Pedir al chofer que reporte su llegada a cargar (cita de carga próxima).',
    llamador: 'src/lib/likida/conductor/ejecutor.ts',
    cuerpo: 'Hola {{1}}, tu viaje {{2}} tiene cita de carga en {{3}} a las {{4}}. Cuando llegues, toca «Ya llegué» para registrar tu llegada.',
    ejemplos: ['Juan', 'F-1042', 'Planta Zapopan', '08:00'],
    variables: ['nombre del chofer', 'folio', 'lugar de carga', 'hora de la cita'],
    botones: [
      { tipo: 'QUICK_REPLY', texto: 'Ya llegué', payloadPrefijo: 'hito_llegada_carga' },
      { tipo: 'QUICK_REPLY', texto: 'Voy con retraso', payloadPrefijo: 'hito_retraso_carga' },
      { tipo: 'QUICK_REPLY', texto: 'Compartir ubicación', payloadPrefijo: 'pedir_ubicacion' },
    ],
    textoVerificado: true, estado: 'nueva_para_aprobacion',
  },
  {
    nombre: 'conductor_contacto_anden_v1', version: 1, categoria: 'UTILITY', idioma: ES_MX, agente: 'agente5_conductor',
    proposito: 'Pedir al chofer el contacto en andén una vez que llegó a cargar.',
    llamador: null,
    cuerpo: 'Hola {{1}}, ya registramos tu llegada a {{2}} del viaje {{3}}. Responde con el nombre y teléfono de la persona que te recibe en el andén, o toca «Aún no tengo contacto».',
    ejemplos: ['Juan', 'Planta Zapopan', 'F-1042'],
    variables: ['nombre del chofer', 'lugar', 'folio'],
    botones: [
      { tipo: 'QUICK_REPLY', texto: 'Aún no tengo contacto', payloadPrefijo: 'hito_sin_contacto_anden' },
    ],
    textoVerificado: true, estado: 'nueva_para_aprobacion',
  },
  {
    nombre: 'conductor_salida_carga_v1', version: 1, categoria: 'UTILITY', idioma: ES_MX, agente: 'agente5_conductor',
    proposito: 'Confirmar la salida de la carga (y pedir la foto de la carta porte o remisión).',
    llamador: 'src/lib/likida/conductor/ejecutor.ts',
    cuerpo: 'Hola {{1}}, ¿ya saliste de la carga del viaje {{2}}? Toca «Ya salí» para registrar tu salida y manda por aquí la foto de tu carta porte o remisión.',
    ejemplos: ['Juan', 'F-1042'],
    variables: ['nombre del chofer', 'folio'],
    botones: [
      { tipo: 'QUICK_REPLY', texto: 'Ya salí', payloadPrefijo: 'hito_salida_carga' },
      { tipo: 'QUICK_REPLY', texto: 'Sigo cargando', payloadPrefijo: 'hito_sigue_cargando' },
    ],
    textoVerificado: true, estado: 'nueva_para_aprobacion',
  },
  {
    nombre: 'conductor_llegada_descarga_v1', version: 1, categoria: 'UTILITY', idioma: ES_MX, agente: 'agente5_conductor',
    proposito: 'Pedir que reporte su llegada al destino de descarga.',
    llamador: 'src/lib/likida/conductor/ejecutor.ts',
    cuerpo: 'Hola {{1}}, tu viaje {{2}} descarga en {{3}}. Cuando llegues, toca «Ya llegué» para registrar tu llegada.',
    ejemplos: ['Juan', 'F-1042', 'CEDIS Monterrey'],
    variables: ['nombre del chofer', 'folio', 'lugar de descarga'],
    botones: [
      { tipo: 'QUICK_REPLY', texto: 'Ya llegué', payloadPrefijo: 'hito_llegada_descarga' },
      { tipo: 'QUICK_REPLY', texto: 'Compartir ubicación', payloadPrefijo: 'pedir_ubicacion' },
    ],
    textoVerificado: true, estado: 'nueva_para_aprobacion',
  },
  {
    nombre: 'conductor_salida_descarga_v1', version: 1, categoria: 'UTILITY', idioma: ES_MX, agente: 'agente5_conductor',
    proposito: 'Confirmar el fin de la descarga y pedir la foto del comprobante de entrega (POD).',
    llamador: 'src/lib/likida/conductor/ejecutor.ts',
    cuerpo: 'Hola {{1}}, ¿ya terminaste de descargar el viaje {{2}}? Toca «Ya salí» para registrar tu salida y manda por aquí la foto del comprobante de entrega.',
    ejemplos: ['Juan', 'F-1042'],
    variables: ['nombre del chofer', 'folio'],
    botones: [
      { tipo: 'QUICK_REPLY', texto: 'Ya salí', payloadPrefijo: 'hito_salida_descarga' },
      { tipo: 'QUICK_REPLY', texto: 'Sigo descargando', payloadPrefijo: 'hito_sigue_descargando' },
    ],
    textoVerificado: true, estado: 'nueva_para_aprobacion',
  },
  {
    nombre: 'conductor_recordatorio_1_v1', version: 1, categoria: 'UTILITY', idioma: ES_MX, agente: 'agente5_conductor',
    proposito: 'Recordatorio escalonado 1 de 3: un hito del viaje sigue sin registrarse.',
    llamador: 'src/lib/likida/conductor/ejecutor.ts',
    cuerpo: 'Hola {{1}}, todavía no tenemos registrado «{{2}}» del viaje {{3}}. Toca «Registrar ahora» o responde por aquí.',
    ejemplos: ['Juan', 'tu llegada a cargar', 'F-1042'],
    variables: ['nombre del chofer', 'hito pendiente', 'folio'],
    botones: [
      { tipo: 'QUICK_REPLY', texto: 'Registrar ahora', payloadPrefijo: 'recordatorio_registrar' },
      { tipo: 'QUICK_REPLY', texto: 'Tengo un problema', payloadPrefijo: 'recordatorio_problema' },
    ],
    textoVerificado: true, estado: 'nueva_para_aprobacion',
  },
  {
    nombre: 'conductor_recordatorio_2_v1', version: 1, categoria: 'UTILITY', idioma: ES_MX, agente: 'agente5_conductor',
    proposito: 'Recordatorio escalonado 2 de 3.',
    llamador: 'src/lib/likida/conductor/ejecutor.ts',
    cuerpo: 'Hola {{1}}, segundo aviso: sigue pendiente «{{2}}» del viaje {{3}} desde hace {{4}}. Si ya lo hiciste, toca «Registrar ahora»; si tienes un problema, dinos qué pasó.',
    ejemplos: ['Juan', 'tu salida de la carga', 'F-1042', '30 minutos'],
    variables: ['nombre del chofer', 'hito pendiente', 'folio', 'tiempo pendiente'],
    botones: [
      { tipo: 'QUICK_REPLY', texto: 'Registrar ahora', payloadPrefijo: 'recordatorio_registrar' },
      { tipo: 'QUICK_REPLY', texto: 'Tengo un problema', payloadPrefijo: 'recordatorio_problema' },
    ],
    textoVerificado: true, estado: 'nueva_para_aprobacion',
  },
  {
    nombre: 'conductor_recordatorio_3_v1', version: 1, categoria: 'UTILITY', idioma: ES_MX, agente: 'agente5_conductor',
    proposito: 'Recordatorio escalonado 3 de 3: último aviso antes de escalar al jefe de tráfico.',
    llamador: 'src/lib/likida/conductor/ejecutor.ts',
    cuerpo: 'Hola {{1}}, último aviso antes de avisar a tu jefe de tráfico: «{{2}}» del viaje {{3}} sigue pendiente desde hace {{4}}. Responde ahora para evitar la escalación.',
    ejemplos: ['Juan', 'tu llegada a descarga', 'F-1042', '1 hora'],
    variables: ['nombre del chofer', 'hito pendiente', 'folio', 'tiempo pendiente'],
    botones: [
      { tipo: 'QUICK_REPLY', texto: 'Registrar ahora', payloadPrefijo: 'recordatorio_registrar' },
      { tipo: 'QUICK_REPLY', texto: 'Tengo un problema', payloadPrefijo: 'recordatorio_problema' },
    ],
    textoVerificado: true, estado: 'nueva_para_aprobacion',
  },
  {
    nombre: 'conductor_llegada_carga_sin_cita_v1', version: 1, categoria: 'UTILITY', idioma: ES_MX, agente: 'agente5_conductor',
    proposito: 'Pedir al chofer que reporte su llegada a cargar cuando el viaje NO trae cita de carga capturada.',
    llamador: 'src/lib/likida/conductor/ejecutor.ts',
    cuerpo: 'Hola {{1}}, tu viaje {{2}} carga en {{3}}. Cuando llegues, toca «Ya llegué» para registrar tu llegada.',
    ejemplos: ['Juan', 'F-1042', 'Planta Zapopan'],
    variables: ['nombre del chofer', 'folio', 'lugar de carga'],
    botones: [
      { tipo: 'QUICK_REPLY', texto: 'Ya llegué', payloadPrefijo: 'hito_llegada_carga' },
      { tipo: 'QUICK_REPLY', texto: 'Voy con retraso', payloadPrefijo: 'hito_retraso_carga' },
      { tipo: 'QUICK_REPLY', texto: 'Compartir ubicación', payloadPrefijo: 'pedir_ubicacion' },
    ],
    textoVerificado: true, estado: 'nueva_para_aprobacion',
  },
  {
    nombre: 'conductor_solicitud_regreso_v1', version: 1, categoria: 'UTILITY', idioma: ES_MX, agente: 'agente5_conductor',
    proposito: 'Preguntar al chofer si ya va de regreso (hito de regreso) después de la descarga.',
    llamador: 'src/lib/likida/conductor/ejecutor.ts',
    cuerpo: 'Hola {{1}}, ya registramos tu salida de la descarga del viaje {{2}}. Cuando vayas de regreso, toca «Voy de regreso» para avisarnos.',
    ejemplos: ['Juan', 'F-1042'],
    variables: ['nombre del chofer', 'folio'],
    botones: [
      { tipo: 'QUICK_REPLY', texto: 'Voy de regreso', payloadPrefijo: 'hito_regreso' },
      { tipo: 'QUICK_REPLY', texto: 'Aún no', payloadPrefijo: 'hito_aun_no_regreso' },
    ],
    textoVerificado: true, estado: 'nueva_para_aprobacion',
  },
  {
    nombre: 'convenio_instrucciones_despacho_v1', version: 1, categoria: 'UTILITY', idioma: ES_MX, agente: 'agente5_conductor',
    proposito: 'Al despachar el viaje: las instrucciones de operación del convenio del cliente (puerta, con quién reportarse, documentos, peculiaridades), una sola línea.',
    llamador: 'src/lib/likida/convenios/envio.ts',
    cuerpo: 'Hola {{1}}, estas son las instrucciones de tu viaje {{2}} ({{3}}): {{4}} Si tienes dudas, escríbeme «¿por dónde entro?» o avisa a tu jefe de tráfico.',
    ejemplos: ['Juan', 'F-1042', 'Planta Zapopan → CEDIS Tlaquepaque', 'Por dónde entras: puerta 3, lado poniente · Con quién te reportas: caseta de vigilancia'],
    variables: ['nombre del chofer', 'folio', 'ruta origen → destino', 'instrucciones en una línea'],
    botones: [],
    textoVerificado: true, estado: 'nueva_para_aprobacion',
  },
  {
    nombre: 'convenio_instrucciones_acercamiento_v1', version: 1, categoria: 'UTILITY', idioma: ES_MX, agente: 'agente5_conductor',
    proposito: 'Al acercarse a la planta (geocerca): recordar al chofer las instrucciones de ESA planta, una sola línea.',
    llamador: 'src/lib/likida/convenios/acercamiento.ts',
    cuerpo: 'Hola {{1}}, ya vas llegando a {{2}} (viaje {{3}}). Recuerda: {{4}} Cualquier duda, avisa a tu jefe de tráfico.',
    ejemplos: ['Juan', 'Planta Zapopan', 'F-1042', 'Por dónde entras: puerta 3, lado poniente · Documentos que llevas: carta porte y orden de compra'],
    variables: ['nombre del chofer', 'planta', 'folio', 'instrucciones en una línea'],
    botones: [],
    textoVerificado: true, estado: 'nueva_para_aprobacion',
  },
  {
    nombre: 'aviso_jefe_trafico_v1', version: 1, categoria: 'UTILITY', idioma: ES_MX, agente: 'agente5_conductor',
    proposito: 'Escalación al jefe de tráfico: un chofer no registró un hito tras los tres recordatorios.',
    llamador: 'src/lib/likida/conductor/ejecutor.ts',
    cuerpo: 'Atención, jefe de tráfico: {{1}} no ha registrado «{{2}}» del viaje {{3}} ({{4}}). Última ubicación conocida: {{5}}. Revísalo en el tablero o llámale.',
    ejemplos: ['Juan Pérez', 'su llegada a descarga', 'F-1042', 'sin respuesta a 3 recordatorios', 'Carretera 15D km 120'],
    variables: ['chofer', 'hito pendiente', 'folio', 'motivo de la escalación', 'última ubicación conocida'],
    botones: [
      { tipo: 'QUICK_REPLY', texto: 'Ya lo atiendo', payloadPrefijo: 'jefe_atiendo' },
      { tipo: 'URL', texto: 'Abrir tablero', url: 'https://app.likida.ai/dashboard/despacho' },
    ],
    textoVerificado: true, estado: 'nueva_para_aprobacion',
  },
  {
    nombre: 'conductor_llegada_sin_confirmar_v1', version: 1, categoria: 'UTILITY', idioma: ES_MX, agente: 'agente5_conductor',
    proposito: 'Avisar al jefe de tráfico que un chofer dijo «ya llegué» y ninguna posición lo respalda (o el viaje no tiene sitio contra el cual compararlo). Apagado por omisión: lo enciende cada flota en la configuración del Conductor.',
    llamador: 'src/lib/likida/conductor/alertas_llegada.ts',
    cuerpo: 'Aviso para el jefe de tráfico: {{1}} avisó que llegó a {{2}} (viaje {{3}}) y {{4}}. Revísalo en el tablero de hitos de Likida antes de darlo por bueno.',
    ejemplos: ['Juan Pérez', 'la carga de Planta Zapopan', 'F-1042', 'ninguna posición la respalda todavía'],
    variables: ['chofer', 'carga o descarga, con el sitio', 'folio', 'por qué quedó sin confirmar (una línea)'],
    botones: [],
    textoVerificado: true, estado: 'nueva_para_aprobacion',
  },
  {
    nombre: 'operador_invitacion_v1', version: 1, categoria: 'UTILITY', idioma: ES_MX, agente: 'onboarding_operador',
    proposito: 'Invitar al chofer recién dado de alta (alta masiva o ficha) a escribirle a Likida: inicia su conversación y abre la ventana de 24 h. Solo se manda si la flota lo confirma.',
    llamador: 'src/lib/likida/invitacion_operador.ts',
    cuerpo: 'Hola {{1}}, {{2}} te dio de alta en Likida para que mandes por WhatsApp las fotos de tus tickets y comprobantes de viaje. Responde a este mensaje con un «Hola» para empezar; aquí mismo te llegan tus viajes y tu liquidación.',
    ejemplos: ['Juan Pérez', 'Transportes del Norte'],
    variables: ['nombre del chofer', 'nombre de la flota'],
    botones: [], textoVerificado: true, estado: 'nueva_para_aprobacion',
  },
  // ── Agente 4 — Vigía de servicio al cliente (mig. 0400) ─────────────────
  {
    nombre: 'vigia_respuesta_cliente_v1', version: 1, categoria: 'UTILITY', idioma: ES_MX, agente: 'vigia_cliente',
    proposito: 'Respuesta de la flota a un CLIENTE (ya aprobada por el gerente) cuando su ventana de 24 h está cerrada. Solo sale a clientes con consentimiento y sin baja.',
    llamador: 'src/lib/likida/vigia/enviar.ts',
    cuerpo: 'Respuesta de {{1}} sobre tu servicio de transporte: {{2}} Si ya no quieres recibir mensajes por este medio, responde BAJA.',
    ejemplos: ['Transportes del Norte', 'Tu viaje F-1042 va en curso; la última posición del GPS es de hace 12 minutos.'],
    variables: ['razón social de la flota', 'texto de la respuesta (≤ 300 caracteres, sin saltos de línea)'],
    botones: [], textoVerificado: true, estado: 'nueva_para_aprobacion',
  },
  {
    nombre: 'vigia_aprobacion_v1', version: 1, categoria: 'UTILITY', idioma: ES_MX, agente: 'vigia_cliente',
    proposito: 'Pedir al gerente, con un toque, que apruebe la respuesta que el Vigía redactó para un cliente (respaldo fuera de su ventana de 24 h).',
    llamador: 'src/lib/likida/vigia/avisos.ts',
    cuerpo: 'Vigía de servicio: {{1}} escribió «{{2}}». Respuesta propuesta: «{{3}}». ¿La envío?',
    ejemplos: ['Compras Acme', '¿Dónde va mi viaje F-1042?', 'Tu viaje F-1042 va en curso; última posición hace 12 minutos.'],
    variables: ['cliente', 'mensaje del cliente (≤ 160 caracteres)', 'respuesta propuesta (≤ 280 caracteres)'],
    botones: [
      { tipo: 'QUICK_REPLY', texto: 'Enviar', payloadPrefijo: 'vig_ok' },
      { tipo: 'QUICK_REPLY', texto: 'No enviar', payloadPrefijo: 'vig_no' },
      { tipo: 'QUICK_REPLY', texto: 'Yo me encargo', payloadPrefijo: 'vig_tomo' },
    ],
    textoVerificado: true, estado: 'nueva_para_aprobacion',
  },
  {
    nombre: 'vigia_escalamiento_v1', version: 1, categoria: 'UTILITY', idioma: ES_MX, agente: 'vigia_cliente',
    proposito: 'Escalar al gerente responsable (nivel 1) o al dueño (nivel 2) un cliente molesto, que pide un humano o que lleva más del SLA sin respuesta.',
    llamador: 'src/lib/likida/vigia/avisos.ts',
    cuerpo: 'Vigía de servicio: el cliente {{1}} necesita atención ({{2}}). Nivel {{3}} de escalamiento. Revísalo en {{4}} o toca «Yo me encargo».',
    ejemplos: ['Compras Acme', 'lleva 45 minutos sin respuesta', '1', 'https://app.likida.ai/dashboard/agentes/vigia'],
    variables: ['cliente', 'motivo (sin respuesta, molestia, pide un humano…)', 'nivel (1 o 2)', 'liga al tablero del Vigía'],
    botones: [{ tipo: 'QUICK_REPLY', texto: 'Yo me encargo', payloadPrefijo: 'vig_tomo' }],
    textoVerificado: true, estado: 'nueva_para_aprobacion',
  },
  {
    nombre: 'liquidacion_externa_v1', version: 1, categoria: 'UTILITY', idioma: ES_MX, agente: 'liquidacion_externa',
    proposito: 'Entregar al chofer la liquidación que calculó el SAP/TMS de la flota (PDF en el encabezado) cuando su ventana de 24 h está cerrada.',
    llamador: 'src/lib/likida/liquidacion_externa/entrega.ts',
    encabezado: { tipo: 'DOCUMENT' },
    cuerpo: 'Hola {{1}}, esta es tu liquidación de {{2}}. Periodo: {{3}}. Total: {{4}}. El detalle va en el PDF. ¿Te cuadra? Responde con un botón.',
    ejemplos: ['Juan', 'SAP', '01/09/2026 al 07/09/2026', '$2,499.75 MXN'],
    variables: ['primer nombre del chofer', 'sistema de origen de la liquidación (o «tu empresa»)', 'periodo', 'total con moneda'],
    botones: [
      { tipo: 'QUICK_REPLY', texto: 'Recibida', payloadPrefijo: 'liqext_ok' },
      { tipo: 'QUICK_REPLY', texto: 'No coincide', payloadPrefijo: 'liqext_no' },
    ],
    textoVerificado: true, estado: 'nueva_para_aprobacion',
  },
  {
    nombre: 'jornada_aviso_encargado_v1', version: 1, categoria: 'UTILITY', idioma: ES_MX, agente: 'jornada',
    proposito: 'Avisar al encargado que la jornada en curso de un operador llegó al umbral de aviso, al umbral crítico o rebasó el tope que la flota configuró (LFT 132 fr. XXXIV, 68).',
    llamador: 'src/lib/likida/jornada/alerta_tope.ts',
    cuerpo: 'Aviso de jornada (LFT) de {{1}}: {{2}}. Horas registradas: {{3}} de un tope de {{4}}. Revísalo en {{5}}. Likida.',
    ejemplos: ['Juan Pérez', 'va al 80 % del tope', '9.6 h (al menos)', '12 h', 'https://app.likida.ai/dashboard/jornada'],
    variables: ['operador', 'frase del nivel (≤ 60 caracteres)', 'horas registradas (con «al menos» si el inicio es derivado)', 'tope en horas', 'liga al tablero de jornada'],
    botones: [], textoVerificado: true, estado: 'nueva_para_aprobacion',
  },
  {
    nombre: 'jornada_aviso_operador_v1', version: 1, categoria: 'UTILITY', idioma: ES_MX, agente: 'jornada',
    proposito: 'Avisar al operador que su jornada de hoy se acerca o rebasó el tope, e indicarle cómo marcar su fin o su descanso por WhatsApp.',
    llamador: 'src/lib/likida/jornada/alerta_tope.ts',
    cuerpo: 'Hola {{1}}, tu jornada de hoy registra {{2}} de un máximo de {{3}}. Si ya terminaste, escribe «fin de mi jornada»; si vas a descansar, «voy a descansar». Aviso informativo de Likida.',
    ejemplos: ['Juan', '9.6 h', '12 h'],
    variables: ['nombre del operador', 'horas registradas', 'tope en horas'],
    botones: [], textoVerificado: true, estado: 'nueva_para_aprobacion',
  },
];

/** Nombres que usa el código (evita literales sueltos). */
/** Tope de la frase de la regla dentro de `regla_aviso_v1` ({{2}}). */
export const MAX_FRASE_REGLA_PLANTILLA = 120;

/** Los tres parámetros de `regla_aviso_v1`: casos, frase confirmada (recortada) y liga. */
export function parametrosReglaAviso(casos: number, frase: string, liga: string): [string, string, string] {
  const f = frase.replace(/\s+/g, ' ').trim();
  const corta = f.length > MAX_FRASE_REGLA_PLANTILLA ? `${f.slice(0, MAX_FRASE_REGLA_PLANTILLA - 1)}…` : f;
  return [String(Math.max(0, Math.trunc(casos))), corta || 'una de tus reglas', liga];
}

export const PLANTILLA = {
  viajeAsignado: 'viaje_asignado',
  recordatorioCierre: 'recordatorio_cierre',
  cobranzaGastos: 'cobranza_gastos_v1',
  avisoOperacion: 'aviso_operacion_v1',
  plazoFactura: 'plazo_factura',
  respuestaArco: 'respuesta_arco_v2',
  reglaAviso: 'regla_aviso_v1',
  operadorInvitacion: 'operador_invitacion_v1',
  vigiaRespuestaCliente: 'vigia_respuesta_cliente_v1',
  vigiaAprobacion: 'vigia_aprobacion_v1',
  vigiaEscalamiento: 'vigia_escalamiento_v1',
  liquidacionExterna: 'liquidacion_externa_v1',
  jornadaAvisoEncargado: 'jornada_aviso_encargado_v1',
  jornadaAvisoOperador: 'jornada_aviso_operador_v1',
} as const;

export function plantillaDeCatalogo(nombre: string): PlantillaCatalogo | undefined {
  return CATALOGO_PLANTILLAS.find((p) => p.nombre === nombre);
}

/** Las variables {{n}} que aparecen en un texto, en orden de aparición. */
export function variablesDeTexto(texto: string): number[] {
  return [...texto.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
}

const MAX_CUERPO = 1024;
const MAX_TEXTO_BOTON = 25;
const MAX_PAYLOAD = 128;

/** Errores del catálogo contra las reglas de Meta que podemos comprobar sin red. */
export function validarCatalogo(catalogo: readonly PlantillaCatalogo[] = CATALOGO_PLANTILLAS): string[] {
  const errores: string[] = [];
  const vistos = new Set<string>();
  for (const p of catalogo) {
    const e = (m: string) => errores.push(`${p.nombre}: ${m}`);
    const clave = `${p.nombre}/${p.idioma}`;
    if (vistos.has(clave)) e('nombre+idioma repetido');
    vistos.add(clave);
    if (!/^[a-z0-9_]{1,512}$/.test(p.nombre)) e('el nombre debe ser minúsculas, dígitos y guion bajo');
    if (p.categoria !== 'UTILITY') e('solo se usan plantillas UTILITY');
    if (p.cuerpo.length === 0 || p.cuerpo.length > MAX_CUERPO) e(`el cuerpo mide ${p.cuerpo.length} (máx. ${MAX_CUERPO})`);
    const vars = variablesDeTexto(p.cuerpo);
    if (vars.some((v, i) => v !== i + 1)) e('las variables deben ser {{1}}…{{n}} consecutivas y sin repetir');
    if (vars.length !== p.ejemplos.length) e(`hay ${vars.length} variables y ${p.ejemplos.length} ejemplos`);
    if (vars.length !== p.variables.length) e(`hay ${vars.length} variables y ${p.variables.length} descripciones`);
    if (p.ejemplos.some((x) => !x.trim())) e('un ejemplo está vacío');
    if (/^\s*\{\{/.test(p.cuerpo) || /\}\}\s*$/.test(p.cuerpo)) e('Meta rechaza un cuerpo que empieza o termina con una variable');
    if (p.encabezado?.tipo === 'TEXT') {
      if (p.encabezado.texto.length > 60) e('encabezado de texto > 60');
    }
    if (p.botones.length > 10) e('más de 10 botones');
    const textos = new Set<string>();
    for (const b of p.botones) {
      if (!b.texto.trim() || b.texto.length > MAX_TEXTO_BOTON) e(`texto de botón inválido «${b.texto}»`);
      if (textos.has(b.texto)) e(`botón repetido «${b.texto}»`);
      textos.add(b.texto);
      if (b.tipo === 'QUICK_REPLY' && (!/^[a-z0-9_]+$/.test(b.payloadPrefijo) || b.payloadPrefijo.length > MAX_PAYLOAD - 38)) {
        e(`payloadPrefijo inválido «${b.payloadPrefijo}»`);
      }
      if (b.tipo === 'URL' && !/^https:\/\/[^\s{}]+$/.test(b.url)) e(`URL de botón inválida «${b.url}»`);
    }
    // Meta exige agrupar: respuestas rápidas juntas, luego CTA (URL).
    const tipos = p.botones.map((b) => b.tipo);
    const primeraUrl = tipos.indexOf('URL');
    if (primeraUrl !== -1 && tipos.slice(primeraUrl).includes('QUICK_REPLY')) e('los botones de respuesta rápida van antes que los de URL');
    if (p.nombre.endsWith(`_v${p.version}`) === false && p.version !== 1) e('la versión no coincide con el sufijo del nombre');
  }
  return errores;
}

export type ValoresEnvio = {
  /** Valores de {{1}}…{{n}} del cuerpo, en orden. */
  cuerpo?: string[];
  /** Ids a anexar a cada botón QUICK_REPLY (típicamente el id del viaje). */
  idsBotones?: string;
  /** Link o id del medio del encabezado, si la plantilla lo lleva. */
  medio?: { link: string; nombreArchivo?: string } | { id: string; nombreArchivo?: string };
};

/**
 * Convierte los valores de una plantilla del catálogo en las opciones de
 * `sendTemplate`, comprobando que el número de variables y el encabezado
 * coincidan con lo aprobado. Lanza (error de programación) si la plantilla no
 * existe o las variables no cuadran: es mejor fallar en la prueba del llamador
 * que gastar una llamada que Meta rechazará con 132000.
 */
export function opcionesDeEnvio(nombre: string, v: ValoresEnvio = {}): OpcionesPlantilla & { idioma: string } {
  const p = plantillaDeCatalogo(nombre);
  if (!p) throw new Error(`plantilla fuera del catálogo: ${nombre}`);
  const esperadas = variablesDeTexto(p.cuerpo).length;
  const dadas = v.cuerpo?.length ?? 0;
  if (esperadas !== dadas) throw new Error(`${nombre} lleva ${esperadas} variable(s) y se dieron ${dadas}`);
  const botones: BotonPlantilla[] = [];
  p.botones.forEach((b, indice) => {
    if (b.tipo !== 'QUICK_REPLY') return;
    if (!v.idsBotones) throw new Error(`${nombre}: falta idsBotones para los botones de respuesta rápida`);
    botones.push({ tipo: 'respuesta_rapida', indice, payload: `${b.payloadPrefijo}:${v.idsBotones}` });
  });
  const salida: OpcionesPlantilla & { idioma: string } = { idioma: p.idioma, parametros: v.cuerpo ?? [], botones };
  if (p.encabezado && p.encabezado.tipo !== 'TEXT') {
    if (!v.medio) throw new Error(`${nombre}: falta el medio del encabezado`);
    const m = v.medio;
    salida.encabezado = p.encabezado.tipo === 'DOCUMENT'
      ? ('link' in m ? { tipo: 'documento', link: m.link, nombreArchivo: m.nombreArchivo } : { tipo: 'documento', id: m.id, nombreArchivo: m.nombreArchivo })
      : ('link' in m ? { tipo: 'imagen', link: m.link } : { tipo: 'imagen', id: m.id });
  }
  return salida;
}

/** El texto tal como lo leería el chofer (sin botones), para vista previa y pruebas. */
export function textoRenderizado(nombre: string, cuerpo: string[]): string {
  const p = plantillaDeCatalogo(nombre);
  if (!p) throw new Error(`plantilla fuera del catálogo: ${nombre}`);
  return p.cuerpo.replace(/\{\{(\d+)\}\}/g, (_m, n: string) => cuerpo[Number(n) - 1] ?? '');
}

/** Cuerpo del POST /{waba}/message_templates para someter la plantilla a Meta. */
export function cuerpoCreacionMeta(p: PlantillaCatalogo): Record<string, unknown> {
  const componentes: Record<string, unknown>[] = [];
  if (p.encabezado?.tipo === 'TEXT') {
    componentes.push({ type: 'HEADER', format: 'TEXT', text: p.encabezado.texto });
  } else if (p.encabezado) {
    componentes.push({ type: 'HEADER', format: p.encabezado.tipo });
  }
  componentes.push({
    type: 'BODY', text: p.cuerpo,
    ...(p.ejemplos.length > 0 ? { example: { body_text: [p.ejemplos] } } : {}),
  });
  if (p.botones.length > 0) {
    componentes.push({
      type: 'BUTTONS',
      buttons: p.botones.map((b) => (b.tipo === 'QUICK_REPLY'
        ? { type: 'QUICK_REPLY', text: b.texto }
        : { type: 'URL', text: b.texto, url: b.url })),
    });
  }
  return { name: p.nombre, language: p.idioma, category: p.categoria, components: componentes };
}
