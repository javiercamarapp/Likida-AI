// ═══════════════════════════════════════════════════════════════════════════
// PANEL DE QA (/admin/qa) — Fase A — tipos y validación compartidos.
//
// Client-safe a propósito: cero imports de node, para que el formulario
// ('use client') y el servidor hablen el mismo contrato. El contrato del
// veredicto calca `VeredictoOraculo` de scripts/qa-agentes/config.qa.ts (la
// Fase 1 del ejército de QA) — no se reescribe la semántica, solo se le da
// forma de fila de tabla para la pantalla.
//
// MODELO DE DATOS (Fase B, 24-ago-2026): las tablas `qa_corrida` /
// `qa_corrida_paso` / `qa_foto` del diseño (00-PANEL-DE-QA.md §4) YA EXISTEN
// — migración 0185. La Fase A había guardado el estado como JSON en Storage
// porque las migraciones estaban congeladas esperando el token de Supabase;
// ese motivo caducó y el ledger se importó con
// `scripts/qa/importar-ledger.ts`. En Storage solo quedan los BYTES: las
// imágenes en `qa-fotos` y los PDF del cierre en `qa-evidencia`.
// ═══════════════════════════════════════════════════════════════════════════

import type { PoliticaGasto } from '@/lib/likida/cuadre/engine';
import { normalizarFecha } from '@/lib/likida/intake/fecha';
import { COMERCIOS } from '@/lib/likida/facturacion/comercios';

export type EstadoCorrida = 'pendiente' | 'corriendo' | 'ok' | 'parcial' | 'fallo' | 'abortada';
export type EstadoPaso = 'pendiente' | 'corriendo' | 'ok' | 'warn' | 'bad';
export type Retencion = 'borrar_al_terminar' | 'conservar';
export type EscenarioId = 'feliz' | 'demo_guion' | 'foto_duplicada';

/** Los dos carriles (0185 ya los admitía en la columna; la Fase C los estrena).
 *  `rapido` = una sola invocación, hasta MAX_FOTOS_CARRIL_RAPIDO fotos.
 *  `completo` = varias PASADAS, sin tope de fotos — mandan el reloj y el dinero. */
export type Carril = 'rapido' | 'completo';

/** Por dónde va una corrida entre pasadas (columna `fase`, mig. 0240). El
 *  `estado` dice cómo TERMINÓ; la fase dice dónde RETOMAR. */
export type FaseCorrida = 'siembra' | 'fotos' | 'cierre' | 'oraculos' | 'limpieza' | 'terminada';

/** Por qué paró la última pasada. `null` = no paró — que no es lo mismo que
 *  "paró por nada". Nunca se infiere de un conteo: se dice con la palabra. */
export type CorteCorrida = 'reloj' | 'dinero';

export type EstadoFotoCorrida = 'corriendo' | 'ok' | 'bad' | 'interrumpida';

/** Los escenarios que el selector ofrece HOY. Vive aquí (client-safe) porque
 *  el validador del servidor y el formulario tienen que estar de acuerdo, y
 *  qa-escenarios.ts importa este tipo — no al revés. El catálogo del diseño
 *  tiene 11; los que faltan no se ofrecen, y el rechazo lo DICE. */
export const ESCENARIOS_VALIDOS: readonly EscenarioId[] = ['feliz', 'demo_guion', 'foto_duplicada'];

// ═══════════════════════════════════════════════════════════════════════════
// LA VERDAD-DE-TERRENO (el oráculo humano de la Fase B, pieza 2)
//
// Qué es: lo que una PERSONA leyó mirando la foto del comprobante. No es "lo
// que el sistema cree", ni "lo que el OCR sacó la vez que salió bien": es la
// etiqueta contra la que se mide el OCR, y por eso su forma importa tanto
// como su contenido.
//
// POR QUÉ EL CONTRATO ES TAN ESTRICTO CON LOS `null`. Un `null` a secas
// significa tres cosas incompatibles a la vez:
//
//   a) el papel NO imprime ese campo (un voucher bancario no trae RFC);
//   b) el papel SÍ lo imprime pero en la foto no se distingue (térmico
//      quemado, doblez, dedo encima);
//   c) a quien etiquetó se le pasó.
//
// Las tres se ven idénticas en el JSON, y sin embargo la medición del OCR
// cambia entera según cuál sea: en (a) que el OCR lea algo es una ALUCINACIÓN
// —falla—; en (b) no hay contra qué medir —el campo no cuenta ni a favor ni en
// contra—; y (c) no debería existir. Por eso el contrato EXIGE que todo `null`
// esté clasificado: cada `ClaveVerdad` con valor `null` aparece en `ilegibles`
// o en `noAplica`, en una sola de las dos, y ninguna clave con valor aparece en
// ninguna. `validarVerdadTerreno` lo comprueba y DICE cuál se rompió — y el
// mismo invariante lo repite la base en la 0239, porque un dato que corrompe
// una medición no puede depender de que alguien recuerde llamar al validador.
// ═══════════════════════════════════════════════════════════════════════════

export type ClaveVerdad =
  | 'emisor' | 'rfcEmisor' | 'folio' | 'monto' | 'fecha' | 'sucursal' | 'dominioFacturacion';

/** El orden en el que la pantalla las pinta y en el que se recorren al medir.
 *  Es la lista COMPLETA: `validarVerdadTerreno` la usa para exigir que cada una
 *  esté clasificada, así que agregar una clave aquí endurece la validación de
 *  todas las etiquetas existentes — a propósito. */
export const CLAVES_VERDAD: readonly ClaveVerdad[] = [
  'emisor', 'rfcEmisor', 'folio', 'monto', 'fecha', 'sucursal', 'dominioFacturacion',
];

/** Cómo se llama cada campo en la pantalla. Español, porque quien mira la ficha
 *  es la persona que etiquetó la foto, no quien escribió el tipo. */
export const NOMBRE_CLAVE_VERDAD: Record<ClaveVerdad, string> = {
  emisor: 'Emisor',
  rfcEmisor: 'RFC del emisor',
  folio: 'Folio',
  monto: 'Monto',
  fecha: 'Fecha',
  sucursal: 'Sucursal',
  dominioFacturacion: 'Dominio de facturación',
};

/**
 * QUÉ CLASE DE PAPEL ES. Calca la distinción que `intake/ocr.ts` ya hace en
 * producción (`documento`: voucher_pago / nota_no_fiscal / …) porque es la que
 * decide si el papel puede entrar como gasto:
 *
 *  · `ticket`            — el ticket de compra normal, se factura en el portal.
 *  · `voucher_bancario`  — el papel de la terminal. NO es dinero aparte: su
 *                          ticket fiscal ya representa el mismo gasto. Medir el
 *                          OCR contra un voucher sirve justo para verificar que
 *                          el sistema lo RECONOCE como voucher.
 *  · `cfdi_impreso`      — la representación impresa de un CFDI ya timbrado.
 *  · `no_comprobante`    — la foto no es un comprobante (una borrosa, un
 *                          paisaje, un papel cualquiera). Está en el banco a
 *                          propósito: el pipeline tiene que rechazarla.
 */
export type ClaseComprobante =
  | 'ticket' | 'voucher_bancario' | 'cfdi_impreso' | 'no_comprobante';

export const CLASES_COMPROBANTE: readonly ClaseComprobante[] = [
  'ticket', 'voucher_bancario', 'cfdi_impreso', 'no_comprobante',
];

export interface VerdadTerreno {
  /** clave del comercio en COMERCIOS (facturacion/comercios.ts), o null si el
   *  emisor NO está en el catálogo — ese null es un hallazgo, no un hueco. */
  comercioClave: string | null;
  emisor: string | null;
  rfcEmisor: string | null;
  folio: string | null;
  monto: number | null;
  /** 'yyyy-mm-dd' tal como se lee impreso. */
  fecha: string | null;
  sucursal: string | null;
  /** El dominio del portal de facturación IMPRESO en el comprobante. */
  dominioFacturacion: string | null;
  /** Campos que NO se pudieron leer con claridad en la foto. */
  ilegibles: ClaveVerdad[];
  /** Campos que el comprobante genuinamente NO imprime. */
  noAplica: ClaveVerdad[];
  clase: ClaseComprobante;
  notas: string | null;
}

/** Una foto del banco (tabla `qa_foto`, mig. 0185; los bytes en el bucket
 *  qa-fotos).
 *
 *  `ocrEsperado` DEJÓ de ser `null` en el tipo: la pantalla del oráculo humano
 *  existe (banco-verdad.tsx) y `fotoDeFila` ya lo lee de verdad. `null` sigue
 *  significando "nadie la ha confirmado", que NO es lo mismo que "está bien":
 *  una foto sin verdad-de-terreno no se puede medir, y la medición lo dice en
 *  vez de contarla como acierto. */
export interface FotoBanco {
  id: string;
  /** sha256 de los BYTES del archivo — el mismo criterio que `img_hash` de
   *  producción (`hashImagen`), para que el dedup del banco y el de la base
   *  hablen del mismo hash. */
  hash: string;
  path: string;          // ruta dentro del bucket qa-fotos
  mime: string;
  etiqueta: string;      // hoy: el nombre original del archivo (nadie etiquetó aún)
  bytes: number;
  subidoEn: string;
  ocrEsperado: VerdadTerreno | null;
  /** Cuándo se firmó la verdad-de-terreno. El CHECK
   *  `qa_foto_confirmacion_completa` (0185) hace imposible que uno esté puesto
   *  sin el otro, así que aquí los dos van juntos o no va ninguno. */
  confirmadoEn: string | null;
}

export interface PasoQA {
  n: number;
  nombre: string;
  estado: EstadoPaso;
  /** Costo REAL de este paso, leído de llm_costo (fases ≠ whatsapp) — nunca
   *  una estimación. */
  costoUsd: number;
  detalle?: string;
  inicio?: string;
  fin?: string;
}

export interface FilaVeredicto {
  invariante: string;    // "#1  anticipo − gastos = diferencia"
  oraculo: string;       // "cuadre_balancea (#1)"
  estado: 'ok' | 'fallo' | 'no_verificado';
  severidad: string;     // CRÍTICO | ALTO | MEDIO — la del invariante, aplica si falla
  esperado: unknown;
  real: unknown;
  detalle?: string;
}

export interface TurnoConversacion { rol: 'user' | 'assistant'; texto: string }

export interface ParametrosCorrida {
  anticipo: number;
  rfcEmpresa: string | null;
  ruta: { origen: string; destino: string };
  politica: PoliticaGasto[];
  fotoIds: string[];
  retencion: Retencion;
}

/** Lo que una corrida larga tiene que recordar ENTRE pasadas. Se guarda en
 *  `qa_corrida.memoria` (jsonb, mig. 0240).
 *
 *  Sin las identidades, la pasada 2 sembraría OTRO tenant y las fotos de la
 *  pasada 1 quedarían en un viaje que ya nadie mira. Sin `dedup` y `eventos`,
 *  los oráculos #3 y #8 juzgarían con lo que vio la ÚLTIMA pasada y llamarían
 *  a eso el veredicto de la corrida — que es inventar. */
export interface MemoriaCorrida {
  tenantId: string;
  viajeId: string;
  telefono: string;
  /** Sólo los guiones que cruzan de viaje (foto_duplicada). `null` si el
   *  escenario no lo pidió — nunca se siembra un chofer que nadie usa. */
  viaje2Id: string | null;
  telefono2: string | null;
  /** El ataque de dedup, montado en una pasada y juzgado en otra. Ausente = el
   *  guion no repitió ninguna foto, y entonces #3 NO se corre. */
  dedup?: { imgHash: string; viajeIntentoId: string };
  /** Los MENSAJES distintos que la bitácora emitió a lo largo de TODAS las
   *  pasadas. Es exactamente lo que `oraculoBitacoraRegistro` mira (`msg`), así
   *  que guardar el conjunto no pierde nada de lo que ese oráculo juzga. */
  eventos?: string[];
}

/** Tope de mensajes distintos que `MemoriaCorrida.eventos` acumula. Existe
 *  para que una corrida de 91 fotos no crezca un jsonb sin fondo; que se
 *  quedara corto se DICE en el detalle del paso, no se calla. */
export const MAX_EVENTOS_MEMORIA = 500;

/** Una foto de la corrida, tal como quedó en `qa_corrida_foto` (mig. 0240). */
export interface FotoDeCorrida {
  fotoId: string;
  n: number;
  estado: EstadoFotoCorrida;
  pasada: number;
  detalle: string | null;
  /** null = NO SE MIDIÓ. Jamás 0 por omisión: un 0 afirmaría que esta foto no
   *  costó nada, y "no se sabe" no es "salió gratis". */
  costoUsd: number | null;
  inicio: string;
  fin: string | null;
}

/** El parte del avance de una corrida larga. Todo lo que la pantalla necesita
 *  para decir la verdad mientras corre: cuántas van, cuántas faltan y —cuando
 *  se cortó— CUÁLES se quedaron sin turno. */
export interface AvanceFotos {
  total: number;
  ok: number;
  bad: number;
  /** Una pasada murió con la foto en vuelo: no se sabe cómo acabó. Ni acierto
   *  ni fallo — se cuenta aparte y se dice. */
  interrumpidas: number;
  /** Tomadas por la pasada que corre AHORA (o por una que aún no se declara
   *  muerta). */
  enVuelo: number;
  /** Ni siquiera se empezaron. */
  sinTurno: number;
  /** Los ids de las que no se empezaron, EN ORDEN de la corrida. */
  sinTurnoIds: string[];
}

export interface CorridaQA {
  id: string;
  escenario: EscenarioId;
  /** `completo` (Fase C, 27-ago-2026) avanza en varias PASADAS y no tiene tope
   *  de fotos; `rapido` sigue siendo una sola invocación con su tope de diez. */
  carril: Carril;
  parametros: ParametrosCorrida;
  estado: EstadoCorrida;
  /** Por qué se abortó / qué motivo tiene el estado — dicho, nunca en silencio. */
  motivo: string | null;
  tenantId: string | null;
  tenantNombre: string;
  creadaEn: string;
  inicio: string | null;
  fin: string | null;
  /** Última señal de vida del motor: cada escritura de paso lo actualiza. La
   *  pantalla lo usa para decir "sin señales desde hace Ns" si el proceso
   *  murió sin poder escribir su aborto (fallar cerrado en la LECTURA). */
  latidoEn: string;
  pasos: PasoQA[];
  costoUsdTotal: number;
  veredicto: FilaVeredicto[] | null;
  /** La conversación completa (turnos de wa_conversacion): la evidencia de
   *  qué dijo el chofer sintético y qué contestó el sistema. */
  turnos: TurnoConversacion[];
  /** Rutas de PDF que el cierre dejó en el bucket `liquidaciones`. */
  pdfs: string[];
  limpieza: string | null;

  // ── Carril completo (Fase C, mig. 0240) ──────────────────────────────────
  /** Dónde retomar. El carril rápido nace y muere en 'siembra'→'terminada'
   *  dentro de una sola invocación; el completo la usa de verdad. */
  fase: FaseCorrida;
  /** Por qué paró la última pasada: 'reloj' | 'dinero' | null (no paró). */
  corte: CorteCorrida | null;
  pasadas: number;
  /** Id de la pasada que tiene la corrida tomada, o null si está libre. Con
   *  `latidoEn` es lo que distingue «pausada entre pasadas» de «se murió a
   *  media pasada», que en pantalla no se ven igual. */
  pasadaEnVuelo: string | null;
  memoria: MemoriaCorrida | null;
  /** El avance foto por foto. `null` en el carril rápido: ahí no hay filas de
   *  `qa_corrida_foto` que resumir, y un avance de 0/N sobre una corrida que
   *  sí procesó sus fotos sería una cifra inventada. */
  avance: AvanceFotos | null;
}

/** Tope del carril rápido (00-PANEL-DE-QA.md §3). NO se sube: el carril rápido
 *  corre dentro de UNA función serverless con `maxDuration`, y subirlo a 91 no
 *  daría 91 fotos procesadas — daría una corrida muerta a la mitad, que además
 *  mentiría. Más fotos que esto es el carril COMPLETO, que sí existe desde la
 *  Fase C (mig. 0240) y avanza en varias pasadas. */
export const MAX_FOTOS_CARRIL_RAPIDO = 10;

// ═══════════════════════════════════════════════════════════════════════════
// EL RELOJ DEL CARRIL COMPLETO — el patrón del PR #152 («El reloj entra a los
// motores»), aplicado a la corrida larga.
//
// Vive aquí (client-safe) porque el formulario tiene que poder decirle a
// Javier lo que de verdad pasa cuando elige 91 fotos, y para eso necesita el
// número. El candado real lo aplica el motor, no la interfaz.
//
// El precedente exacto: `PASOS_LATIDO` / `MARGEN_RELOJ_MS` en
// agentes/runner.ts. Un margen justificado sólo en prosa no se puede
// verificar, y allá ya se quedó corto una vez (auditoría ciclo 7, c7-31). Así
// que la cola del cierre de una pasada se escribe PASO POR PASO, con el tope
// REAL de cada uno, y el margen se compara contra la suma en una prueba.
// ═══════════════════════════════════════════════════════════════════════════

/** Lo que cuesta CERRAR una pasada, paso por paso. Los topes no son
 *  estimaciones: cada consulta de supabase-js está acotada a
 *  `TOPE_CONSULTA_MS` (8 000, presupuesto.ts) más 1 500 de gracia. */
export const PASOS_CIERRE_PASADA: ReadonlyArray<{ paso: string; donde: string; ms: number }> = [
  { paso: 'cerrar la fila de la foto en vuelo (update qa_corrida_foto)', donde: 'qa-storage.ts', ms: 9_500 },
  { paso: 'leer el costo MEDIDO del tenant (select llm_costo)', donde: 'qa-motor.ts', ms: 9_500 },
  { paso: 'guardarCorrida — el estado y los pasos, lo que NO se puede perder', donde: 'qa-storage.ts', ms: 9_500 },
  { paso: 'soltar la pasada (update pasada_en_vuelo → null)', donde: 'qa-storage.ts', ms: 9_500 },
];

/** Suma de la tabla de arriba: 38 s. */
export const COSTO_CIERRE_PASADA_MS = PASOS_CIERRE_PASADA.reduce((s, p) => s + p.ms, 0);

/** Lo que se le deja a la pasada para cerrar y SOLTAR LA LLAVE después del
 *  corte. 45 s contra los 38 s de la cola: 7 s de holgura, la misma proporción
 *  que `MARGEN_RELOJ_MS` se da en runner.ts. */
export const MARGEN_PASADA_MS = 45_000;

/** `maxDuration` de la ruta que corre una pasada (300 s, el mismo techo del
 *  cron del runner). */
export const MAX_DURATION_PASADA_S = 300;

/** El presupuesto de trabajo de UNA pasada. */
export const TECHO_PASADA_MS = MAX_DURATION_PASADA_S * 1_000 - MARGEN_PASADA_MS;

/** Cuánto puede llevar sin dar señales una pasada antes de darla por muerta y
 *  dejar que otra tome la corrida. Es el techo entero de la pasada más su
 *  margen —o sea, el `maxDuration` completo—: reclamar antes sería adelantarse
 *  a una pasada que todavía puede estar viva, y eso es exactamente la carrera
 *  que la PK de `qa_corrida_foto` existe para que no cueste dinero. */
export const PASADA_MUERTA_MS = MAX_DURATION_PASADA_S * 1_000;

/** COPIA declarada de `PRESUPUESTO_WEBHOOK_MS` (lib/likida/presupuesto.ts).
 *  No se importa porque este módulo es client-safe a propósito (el formulario
 *  lo carga) y aquel arrastra `logger` y `node:`; qa-tipos.test.ts compara los
 *  dos números contra el archivo fuente para que no deriven. */
export const PRESUPUESTO_MENSAJE_MS = 120_000;

/** Lo que se RESERVA antes de arrancar otra foto. No es una estimación:
 *  es el peor caso MEDIDO de esta misma corrida por dos, y mientras no haya
 *  ninguna medición, el presupuesto que el propio camino de producción declara
 *  para un mensaje entrante (`PRESUPUESTO_WEBHOOK_MS` = 120 000,
 *  presupuesto.ts) — el único techo que ese camino promete.
 *
 *  Por qué se reserva algo en vez de arrancar hasta el último milisegundo: el
 *  reloj se consulta ANTES de cada foto y NUNCA a la mitad de una (regla del
 *  PR #152), así que una foto que arranca a un milisegundo del vencimiento se
 *  come el margen del cierre entero. La red de abajo (el reloj duro de la
 *  ruta) sigue existiendo para cuando ni esto alcanza; lo que esta reserva
 *  compra es que el caso normal cierre limpio en vez de dejar una foto
 *  'interrumpida' en cada pasada.
 *
 *  Pura, y con prueba: entra la lista de duraciones medidas, sale el margen. */
export function reservaPorFotoMs(duracionesMs: readonly number[]): number {
  const utiles = duracionesMs.filter((d) => Number.isFinite(d) && d > 0);
  if (utiles.length === 0) return PRESUPUESTO_MENSAJE_MS;
  return Math.min(PRESUPUESTO_MENSAJE_MS, Math.max(...utiles) * 2);
}

/** Tope diario del panel (00-PANEL-DE-QA.md §6, default $5). Vive aquí
 *  (client-safe) porque el botón lo enseña; el CANDADO real lo aplica el
 *  servidor (lanzar/route.ts) con el gasto leído, nunca solo la interfaz. */
export const TOPE_DIA_USD = 5;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RFC_RE = /^[A-ZÑ&0-9]{12,13}$/;

export interface LanzarValidado {
  escenario: EscenarioId;
  carril: Carril;
  params: ParametrosCorrida;
}

/** El carril que le toca a N fotos cuando nadie lo eligió a mano. Puro, para
 *  que el formulario y el servidor no puedan contar historias distintas. */
export function carrilPara(fotos: number): Carril {
  return fotos > MAX_FOTOS_CARRIL_RAPIDO ? 'completo' : 'rapido';
}

/** Valida el body del POST /api/admin/qa/lanzar. El cliente no es frontera de
 *  confianza (mismo criterio que valida /api/admin/copiloto): todo se
 *  re-chequea aquí y el motivo del rechazo se dice. */
export function validarLanzar(crudo: unknown): { ok: true; datos: LanzarValidado } | { ok: false; error: string } {
  const b = crudo as Record<string, unknown> | null;
  if (!b || typeof b !== 'object') return { ok: false, error: 'body inválido' };

  const escenario = b.escenario as EscenarioId;
  if (!ESCENARIOS_VALIDOS.includes(escenario)) {
    return { ok: false, error: `escenario desconocido — los del selector son ${ESCENARIOS_VALIDOS.map((e) => `"${e}"`).join(', ')}; los ${11 - ESCENARIOS_VALIDOS.length} restantes del catálogo siguen pendientes` };
  }

  const fotoIds = b.fotoIds;
  if (!Array.isArray(fotoIds) || fotoIds.length === 0) return { ok: false, error: 'elige al menos una foto del banco' };
  if (!fotoIds.every((f) => typeof f === 'string' && UUID_RE.test(f))) return { ok: false, error: 'fotoIds inválidos' };

  // ── EL CARRIL ────────────────────────────────────────────────────────────
  // Ausente = el que le toca al número de fotos (`carrilPara`). Se acepta la
  // omisión a propósito: el tope de fotos dejó de ser un rechazo y pasó a ser
  // una ELECCIÓN DE CARRIL, y hacer que 91 fotos fallaran por no traer un
  // campo nuevo sería el mismo "no cabe" de antes con otro disfraz.
  //
  // Elegir 'rapido' con más de diez SÍ se rechaza, y con el motivo entero: ahí
  // no hay ambigüedad —alguien pidió una cosa que no cabe— y arrancarla de
  // todos modos daría una corrida muerta a la mitad.
  let carril: Carril;
  if (b.carril === undefined || b.carril === null || b.carril === '') {
    carril = carrilPara(fotoIds.length);
  } else if (b.carril === 'rapido' || b.carril === 'completo') {
    carril = b.carril;
  } else {
    return { ok: false, error: 'carril desconocido — "rapido" o "completo"' };
  }
  if (carril === 'rapido' && fotoIds.length > MAX_FOTOS_CARRIL_RAPIDO) {
    return {
      ok: false,
      error: `${fotoIds.length} fotos no caben en el carril rápido (máx. ${MAX_FOTOS_CARRIL_RAPIDO}: corre entero dentro de UNA función serverless). Elige el carril completo — avanza en varias pasadas y no tiene tope de fotos.`,
    };
  }

  const anticipo = Number(b.anticipo);
  if (!Number.isFinite(anticipo) || anticipo <= 0 || anticipo > 10_000_000) {
    return { ok: false, error: 'anticipo inválido — debe ser un monto mayor a 0' };
  }

  let rfcEmpresa: string | null = null;
  if (b.rfcEmpresa !== null && b.rfcEmpresa !== undefined && b.rfcEmpresa !== '') {
    if (typeof b.rfcEmpresa !== 'string') return { ok: false, error: 'rfcEmpresa inválido' };
    const rfc = b.rfcEmpresa.toUpperCase().replace(/[^A-ZÑ&0-9]/g, '');
    if (!RFC_RE.test(rfc)) return { ok: false, error: 'rfcEmpresa inválido — 12 o 13 caracteres de RFC' };
    rfcEmpresa = rfc;
  }

  const ruta = b.ruta as Record<string, unknown> | null;
  const origen = typeof ruta?.origen === 'string' ? ruta.origen.trim().slice(0, 80) : '';
  const destino = typeof ruta?.destino === 'string' ? ruta.destino.trim().slice(0, 80) : '';
  if (!origen || !destino) return { ok: false, error: 'ruta incompleta — origen y destino' };

  const politicaCruda = b.politica;
  if (!Array.isArray(politicaCruda) || politicaCruda.length === 0 || politicaCruda.length > 20) {
    return { ok: false, error: 'política inválida — de 1 a 20 conceptos' };
  }
  const politica: PoliticaGasto[] = [];
  for (const p of politicaCruda) {
    const fila = p as Record<string, unknown>;
    const concepto = typeof fila?.concepto === 'string' ? fila.concepto.trim().toLowerCase().slice(0, 40) : '';
    if (!concepto) return { ok: false, error: 'política inválida — un concepto está vacío' };
    const entrada: PoliticaGasto = { concepto };
    if (fila.topeMonto !== undefined && fila.topeMonto !== null && fila.topeMonto !== '') {
      const tope = Number(fila.topeMonto);
      if (!Number.isFinite(tope) || tope < 0 || tope > 10_000_000) return { ok: false, error: `política inválida — tope de "${concepto}"` };
      entrada.topeMonto = tope;
    }
    if (fila.requiereCfdi === true) entrada.requiereCfdi = true;
    politica.push(entrada);
  }

  const retencion: Retencion = b.retencion === 'conservar' ? 'conservar' : 'borrar_al_terminar';

  return {
    ok: true,
    datos: {
      escenario,
      carril,
      params: { anticipo, rfcEmpresa, ruta: { origen, destino }, politica, fotoIds: fotoIds as string[], retencion },
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// LAS DOS FRASES DEL CORTE.
//
// Se escriben aquí, una sola vez y con prueba, por la misma razón que
// `relojAgotado` es una función y no un `Date.now() >= venceEn` suelto: es lo
// que Javier va a leer en la pantalla a las 11 de la noche, y la diferencia
// entre "la corrida se paró" y "la corrida se paró POR ESTO, con ESTA cifra
// medida, y le faltan ESTAS fotos" es la diferencia entre un panel y un
// spinner. Un aborto por tope es EVIDENCIA: dice la cifra, no la redondea, y
// deja claro que el estado se conserva para inspección.
// ═══════════════════════════════════════════════════════════════════════════

/** El motivo que se escribe cuando la corrida topa por DINERO. Para de verdad:
 *  esta corrida no vuelve a gastar. `cual` distingue el tope POR CORRIDA
 *  (TOPE_CORRIDA_USD, config.qa.ts) del tope DEL DÍA (TOPE_DIA_USD) — son dos
 *  candados distintos y confundirlos mandaría a Javier a subir el equivocado. */
export function motivoTopeDinero(
  cual: 'corrida' | 'dia', gastadoUsd: number, topeUsd: number, av: AvanceFotos,
): string {
  const faltan = av.sinTurno + av.enVuelo + av.interrumpidas;
  const quien = cual === 'corrida' ? 'TOPE DE CORRIDA' : 'TOPE DIARIO DEL PANEL';
  return `${quien} alcanzado: $${gastadoUsd.toFixed(4)} USD medidos contra un tope de $${topeUsd.toFixed(2)}. `
    + `La corrida PARA aquí con ${av.ok} de ${av.total} fotos procesadas y ${faltan} sin procesar; `
    + `el gasto es el que reportó el proveedor del modelo, no una estimación. `
    + `El tenant sintético se CONSERVA para inspección — un aborto por tope es evidencia, no basura.`;
}

/** El motivo que se escribe cuando la pasada topa por RELOJ. No es un aborto:
 *  la corrida sigue viva y la siguiente pasada continúa. */
export function motivoCorteReloj(pasada: number, enEstaPasada: number, av: AvanceFotos): string {
  return `RELOJ DE LA PASADA ${pasada} agotado (${Math.round(TECHO_PASADA_MS / 1000)} s de trabajo por pasada). `
    + `Procesó ${enEstaPasada} foto(s); van ${av.ok} de ${av.total} y ${av.sinTurno} se quedaron SIN TURNO. `
    + `No se pierde ninguna: la siguiente pasada continúa desde ahí y no repite las que ya se midieron.`;
}

/** Resume las filas de `qa_corrida_foto` contra los ids que la corrida pidió.
 *  Puro: lo que no aparece en las filas es lo que no tuvo turno, y eso se
 *  cuenta y se nombra en vez de deducirse de una resta a ojo. */
export function resumirAvance(fotoIds: readonly string[], filas: readonly FotoDeCorrida[]): AvanceFotos {
  const porId = new Map(filas.map((f) => [f.fotoId, f]));
  const sinTurnoIds: string[] = [];
  let ok = 0, bad = 0, interrumpidas = 0, enVuelo = 0;
  for (const id of fotoIds) {
    const f = porId.get(id);
    if (!f) { sinTurnoIds.push(id); continue; }
    if (f.estado === 'ok') ok += 1;
    else if (f.estado === 'bad') bad += 1;
    else if (f.estado === 'interrumpida') interrumpidas += 1;
    else enVuelo += 1;
  }
  return { total: fotoIds.length, ok, bad, interrumpidas, enVuelo, sinTurno: sinTurnoIds.length, sinTurnoIds };
}

// ── El validador de la verdad-de-terreno ───────────────────────────────────

/** Texto de una etiqueta humana: se recorta, se topa y se rechaza el vacío.
 *  Un `""` NO es lo mismo que `null` — el vacío se cuela como "se leyó una
 *  cadena vacía" y luego mide contra el OCR como si fuera un dato. */
function textoVerdad(v: unknown, campo: string, maxLargo: number): { ok: true; valor: string | null } | { ok: false; error: string } {
  if (v === null || v === undefined) return { ok: true, valor: null };
  if (typeof v !== 'string') return { ok: false, error: `${campo}: se esperaba texto o null, llegó ${typeof v}` };
  const t = v.trim();
  if (t === '') return { ok: false, error: `${campo}: cadena vacía — si no se leyó, va null y clasificado en "ilegibles" o "noAplica"` };
  if (t.length > maxLargo) return { ok: false, error: `${campo}: pasa de ${maxLargo} caracteres (${t.length})` };
  return { ok: true, valor: t };
}

/** Una lista de `ClaveVerdad`: claves conocidas, sin repetidos. Un repetido
 *  no es inocente — delata que la etiqueta se editó a mano dos veces y que
 *  quizá la otra lista quedó a medias. */
function listaClaves(v: unknown, campo: string): { ok: true; valor: ClaveVerdad[] } | { ok: false; error: string } {
  if (v === undefined || v === null) return { ok: false, error: `${campo}: falta — si no hay ninguno, va []` };
  if (!Array.isArray(v)) return { ok: false, error: `${campo}: se esperaba un arreglo` };
  const salida: ClaveVerdad[] = [];
  for (const x of v) {
    if (typeof x !== 'string' || !CLAVES_VERDAD.includes(x as ClaveVerdad)) {
      return { ok: false, error: `${campo}: "${String(x)}" no es un campo medible — los que hay: ${CLAVES_VERDAD.join(', ')}` };
    }
    if (salida.includes(x as ClaveVerdad)) return { ok: false, error: `${campo}: "${x}" aparece dos veces` };
    salida.push(x as ClaveVerdad);
  }
  return { ok: true, valor: salida };
}

/**
 * Valida la verdad-de-terreno de UNA foto y dice qué está mal cuando lo está.
 *
 * El invariante que da sentido a toda la medición, y el único motivo por el que
 * esta función existe en vez de un `as VerdadTerreno`:
 *
 *   para cada ClaveVerdad, valor `null` ⟺ está en `ilegibles` XOR en `noAplica`.
 *
 * Los tres modos de romperlo, y por qué cada uno envenena la medición:
 *
 *   · `null` sin clasificar → "no se sabe por qué falta". Al medir habría que
 *     decidir a ciegas si un OCR que leyó algo alucinó o acertó.
 *   · `null` en las DOS listas → dos afirmaciones que se contradicen ("el papel
 *     no lo trae" y "el papel lo trae pero no se ve").
 *   · valor NO nulo listado como ilegible/noAplica → la etiqueta dice a la vez
 *     que sí se leyó y que no se pudo leer. El campo se descontaría de la
 *     medición teniendo un esperado perfectamente bueno, y el porcentaje del
 *     panel saldría inflado sobre menos campos de los que de verdad se midieron.
 */
export function validarVerdadTerreno(crudo: unknown): { ok: true; datos: VerdadTerreno } | { ok: false; error: string } {
  const b = crudo as Record<string, unknown> | null;
  if (!b || typeof b !== 'object' || Array.isArray(b)) return { ok: false, error: 'verdad-de-terreno inválida: se esperaba un objeto' };

  // comercioClave se comprueba CONTRA EL CATÁLOGO REAL. Una clave inventada
  // ("oxxogas2") pasaría cualquier chequeo de forma y luego no casaría con
  // nada: el hallazgo "este emisor no está en COMERCIOS" se escribe con `null`,
  // que es un dato, no con una clave que no existe, que es basura.
  let comercioClave: string | null = null;
  if (b.comercioClave !== null && b.comercioClave !== undefined) {
    if (typeof b.comercioClave !== 'string') return { ok: false, error: 'comercioClave: se esperaba texto o null' };
    const clave = b.comercioClave.trim();
    if (!COMERCIOS.some((c) => c.clave === clave)) {
      return { ok: false, error: `comercioClave: "${clave}" no está en COMERCIOS (facturacion/comercios.ts). Si el emisor no está en el catálogo, va null — ese null es un hallazgo, no un hueco` };
    }
    comercioClave = clave;
  }

  const emisor = textoVerdad(b.emisor, 'emisor', 160);
  if (!emisor.ok) return emisor;
  const folio = textoVerdad(b.folio, 'folio', 80);
  if (!folio.ok) return folio;
  const sucursal = textoVerdad(b.sucursal, 'sucursal', 120);
  if (!sucursal.ok) return sucursal;
  const dominio = textoVerdad(b.dominioFacturacion, 'dominioFacturacion', 200);
  if (!dominio.ok) return dominio;
  const notas = textoVerdad(b.notas, 'notas', 600);
  if (!notas.ok) return notas;

  const rfcTexto = textoVerdad(b.rfcEmisor, 'rfcEmisor', 20);
  if (!rfcTexto.ok) return rfcTexto;
  let rfcEmisor: string | null = null;
  if (rfcTexto.valor !== null) {
    const rfc = rfcTexto.valor.toUpperCase().replace(/[^A-ZÑ&0-9]/g, '');
    if (!RFC_RE.test(rfc)) return { ok: false, error: `rfcEmisor: "${rfcTexto.valor}" no tiene forma de RFC (12 o 13 caracteres). Si en la foto no se distingue, va null y en "ilegibles"` };
    rfcEmisor = rfc;
  }

  let monto: number | null = null;
  if (b.monto !== null && b.monto !== undefined) {
    if (typeof b.monto !== 'number' || !Number.isFinite(b.monto)) {
      return { ok: false, error: 'monto: se esperaba un número finito o null' };
    }
    // Negativo no existe en un comprobante y 0 tampoco se etiqueta: un ticket
    // de $0.00 no se fotografía. Dejar pasar el 0 lo volvería indistinguible
    // del `null` que esta función existe para no confundir.
    if (b.monto <= 0) return { ok: false, error: `monto: ${b.monto} — un comprobante no ampara cero ni negativo; si no se lee, va null y clasificado` };
    if (b.monto > 10_000_000) return { ok: false, error: `monto: ${b.monto} pasa del tope razonable de un comprobante de viaje` };
    monto = Math.round(b.monto * 100) / 100;
  }

  const fechaTexto = textoVerdad(b.fecha, 'fecha', 10);
  if (!fechaTexto.ok) return fechaTexto;
  let fecha: string | null = null;
  if (fechaTexto.valor !== null) {
    // `normalizarFecha` es la MISMA función que el intake de producción usa, y
    // rechaza el 31 de abril en vez de rodarlo al 1 de mayo en silencio. Se
    // exige que la entrada YA venga en ISO: la verdad-de-terreno la teclea una
    // persona contra un formato fijo, no la adivina un modelo.
    const iso = normalizarFecha(fechaTexto.valor);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaTexto.valor) || iso !== fechaTexto.valor) {
      return { ok: false, error: `fecha: "${fechaTexto.valor}" no es una fecha real en formato yyyy-mm-dd` };
    }
    fecha = iso;
  }

  const clase = b.clase;
  if (typeof clase !== 'string' || !CLASES_COMPROBANTE.includes(clase as ClaseComprobante)) {
    return { ok: false, error: `clase: "${String(clase)}" desconocida — las que hay: ${CLASES_COMPROBANTE.join(', ')}` };
  }

  const ilegibles = listaClaves(b.ilegibles, 'ilegibles');
  if (!ilegibles.ok) return ilegibles;
  const noAplica = listaClaves(b.noAplica, 'noAplica');
  if (!noAplica.ok) return noAplica;

  const datos: VerdadTerreno = {
    comercioClave,
    emisor: emisor.valor,
    rfcEmisor,
    folio: folio.valor,
    monto,
    fecha,
    sucursal: sucursal.valor,
    dominioFacturacion: dominio.valor,
    ilegibles: ilegibles.valor,
    noAplica: noAplica.valor,
    clase: clase as ClaseComprobante,
    notas: notas.valor,
  };

  // ── EL INVARIANTE, campo por campo y con el motivo a la vista ────────────
  for (const clave of CLAVES_VERDAD) {
    const vacio = datos[clave] === null;
    const esIlegible = datos.ilegibles.includes(clave);
    const esNoAplica = datos.noAplica.includes(clave);
    if (esIlegible && esNoAplica) {
      return { ok: false, error: `${clave}: está en "ilegibles" Y en "noAplica" a la vez — o el papel no lo imprime, o lo imprime y no se distingue; las dos cosas no` };
    }
    if (vacio && !esIlegible && !esNoAplica) {
      return { ok: false, error: `${clave}: es null y no está clasificado — ponlo en "ilegibles" (el papel lo trae pero no se lee) o en "noAplica" (el papel no lo imprime). Un null sin motivo corrompe la medición` };
    }
    if (!vacio && (esIlegible || esNoAplica)) {
      return { ok: false, error: `${clave}: tiene valor (${JSON.stringify(datos[clave])}) pero está listado en "${esIlegible ? 'ilegibles' : 'noAplica'}" — o se leyó, o no se leyó` };
    }
  }

  return { ok: true, datos };
}

// ── El lote del botón «correr el OCR» ──────────────────────────────────────

/** Tope de fotos por invocación de `/api/admin/qa/fotos/ocr`. No es una
 *  preferencia: cada foto es una llamada de visión EN SERIE de varios
 *  segundos, y 25 ya rozan el `maxDuration` de 120 s. Pedir las 91 de golpe
 *  sería pedir un corte a media iteración. Vive aquí (client-safe) porque el
 *  botón lo enseña; el candado real lo aplica el servidor. */
export const MAX_FOTOS_OCR = 25;

/** Valida el body del POST /api/admin/qa/fotos/ocr. Igual que `validarLanzar`,
 *  la corre TAMBIÉN el formulario para que el motivo del botón deshabilitado
 *  sea literalmente el mismo texto que el rechazo del servidor. */
export function validarLoteOcr(crudo: unknown): { ok: true; fotoIds: string[] } | { ok: false; error: string } {
  const b = crudo as Record<string, unknown> | null;
  if (!b || typeof b !== 'object') return { ok: false, error: 'body inválido — se esperaba { fotoIds: string[] }' };
  const ids = b.fotoIds;
  if (!Array.isArray(ids) || ids.length === 0) return { ok: false, error: 'elige al menos una foto del banco' };
  if (!ids.every((x) => typeof x === 'string' && UUID_RE.test(x))) {
    return { ok: false, error: 'fotoIds inválidos — se esperaban uuids' };
  }
  // Deduplicar ANTES del tope: la misma foto dos veces se leería dos veces y
  // se cobraría dos veces, y el segundo resultado no aporta nada.
  const unicos = [...new Set(ids as string[])];
  if (unicos.length > MAX_FOTOS_OCR) {
    return { ok: false, error: `${unicos.length} fotos no caben en una invocación — el tope es ${MAX_FOTOS_OCR} (cada foto es una llamada de visión en serie). Mándalas en tandas de ${MAX_FOTOS_OCR}` };
  }
  return { ok: true, fotoIds: unicos };
}

/** El estado final de una corrida a partir de su veredicto: cualquier fallo
 *  manda (fallo), lo no verificado NO cuenta como pasó (parcial — regla
 *  "fallar cerrado y decirlo"), y solo ok limpio es ok. */
export function estadoFinalDe(veredicto: FilaVeredicto[]): Extract<EstadoCorrida, 'ok' | 'parcial' | 'fallo'> {
  if (veredicto.some((v) => v.estado === 'fallo')) return 'fallo';
  if (veredicto.some((v) => v.estado === 'no_verificado')) return 'parcial';
  return 'ok';
}

/** Conteo ✅/⚠️/❌ para el historial. */
export function resumenVeredicto(veredicto: FilaVeredicto[] | null): { ok: number; noVerificado: number; fallo: number } | null {
  if (!veredicto) return null;
  return {
    ok: veredicto.filter((v) => v.estado === 'ok').length,
    noVerificado: veredicto.filter((v) => v.estado === 'no_verificado').length,
    fallo: veredicto.filter((v) => v.estado === 'fallo').length,
  };
}
