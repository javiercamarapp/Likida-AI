import { contieneDatoDeSeguridad } from './guardia_seguridad';
import { estaResuelto, TIPOS_HITO, type HitoFila, type TipoEvidencia, type TipoHito } from './tipos';

// ═══════════════════════════════════════════════════════════════════════════
// LA FOTO DE EVIDENCIA DE UN HITO — qué papel es y a qué hito pertenece. Puro.
//
// Mismo criterio que el POD (pod_wa.ts): el CAPTION es la única señal
// determinística de qué papel es la foto. Sin caption que lo diga, la foto sigue
// su camino de comprobante como siempre: un ticket de diésel tratado como
// evidencia de un hito desaparecería de la liquidación. La carta porte sellada
// («POD») ya tiene su propio camino y NO se toca aquí.
//
//   «sello»  / «sello de carga»       → el sello de la unidad al salir de la carga
//   «anden»  / «mi anden»              → el andén o la rampa donde está
//   «recibido» / «sello de recibido»   → el sello de recibido del cliente
// ═══════════════════════════════════════════════════════════════════════════

const MAX_LARGO_CAPTION = 60;

/** Normaliza para comparar por forma: sin acentos, en minúsculas, solo letras/números/espacios. La reusa `documentos_cierre.ts` (T-A5-53). */
export function limpiar(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}

const FORMAS: ReadonlyArray<[TipoEvidencia, ReadonlySet<string>]> = [
  ['sello', new Set(['sello', 'el sello', 'sello de carga', 'sello de la unidad', 'sello de salida', 'sello puesto', 'foto del sello', 'sello del remolque', 'sello de caja'])],
  ['anden', new Set(['anden', 'mi anden', 'el anden', 'anden de carga', 'anden de descarga', 'foto del anden', 'rampa', 'estoy en el anden'])],
  ['recibido', new Set(['recibido', 'sello de recibido', 'sello recibido', 'acuse de recibido', 'el recibido', 'foto del recibido', 'recibido por el cliente', 'sellado de recibido'])],
];

/** ¿El caption dice que la foto es evidencia de un hito? Formas EXACTAS (lista cerrada): «mi sello de diésel» no cuenta. */
export function tipoEvidenciaDeCaption(texto: string | undefined): TipoEvidencia | null {
  if (typeof texto !== 'string' || !texto.trim() || texto.length > MAX_LARGO_CAPTION) return null;
  if (contieneDatoDeSeguridad(texto)) return null; // T-A5-58: un pie de foto con la clave no es evidencia ni se guarda como tal
  const t = limpiar(texto);
  for (const [tipo, formas] of FORMAS) if (formas.has(t)) return tipo;
  return null;
}

/** Los hitos a los que cada papel pertenece, en orden de preferencia. */
const HITOS_DE: Record<TipoEvidencia, readonly TipoHito[]> = {
  sello: ['salida_carga', 'llegada_carga'],
  anden: ['llegada_descarga', 'llegada_carga'],
  recibido: ['salida_descarga', 'llegada_descarga'],
  otra: [],
  // T-A5-53: el documento de cierre se pide DESPUÉS de terminar la descarga; cuelga del mismo hito que «recibido».
  documento_cierre: ['salida_descarga'],
};

/** Hasta cuándo, tras registrarse un hito, se le puede colgar una foto (horas). */
export const HORAS_EVIDENCIA = 12;

const hora = (h: HitoFila): number => new Date(h.recibidoEn ?? h.mensajeEn ?? 0).getTime();

/**
 * El hito al que va la foto. Entre los candidatos del papel, el MÁS RECIENTE ya registrado (≤ 12 h). El «andén»
 * es el del lugar donde el chofer está: si ya salió de la carga y llegó a descargar, es de la descarga.
 * `null` = no hay hito al cual colgarla (se le dice al chofer; no se adivina).
 */
export function hitoParaEvidencia(tipo: TipoEvidencia, hitos: readonly HitoFila[], ahora: Date): HitoFila | null {
  const limite = ahora.getTime() - HORAS_EVIDENCIA * 3_600_000;
  const candidatos = HITOS_DE[tipo]
    .map((t) => hitos.find((h) => h.tipo === t))
    .filter((h): h is HitoFila => Boolean(h) && estaResuelto(h as HitoFila) && hora(h as HitoFila) >= limite);
  if (candidatos.length === 0) return null;
  candidatos.sort((a, b) => hora(b) - hora(a) || TIPOS_HITO.indexOf(b.tipo) - TIPOS_HITO.indexOf(a.tipo));
  return candidatos[0];
}

export const ETIQUETA_EVIDENCIA: Record<TipoEvidencia, string> = {
  sello: 'el sello', anden: 'el andén', recibido: 'el sello de recibido', otra: 'la evidencia',
  documento_cierre: 'el documento',
};

/** El acuse al chofer, con la verdad de cada desenlace. */
export function mensajeEvidencia(r: 'ok' | 'duplicada' | 'sin_hito' | 'fallo', tipo: TipoEvidencia): string {
  switch (r) {
    case 'ok': return `Recibí la foto de ${ETIQUETA_EVIDENCIA[tipo]} ✅ — quedó guardada junto a tu aviso.`;
    case 'duplicada': return `Esa foto de ${ETIQUETA_EVIDENCIA[tipo]} ya la tenía. 👍`;
    case 'sin_hito': return 'Todavía no tengo el aviso al que va esa foto. Primero dime «ya llegué» o «ya salí» y mándala de nuevo. 🙏';
    case 'fallo': return 'No pude guardar esa foto ahorita 😕 — consérvala y reenvíamela en un momento, por favor.';
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// T-A5-40 — LA FOTO DEL SELLO ANTES DE «INICIO DE VIAJE» (R08). Puro.
//
// El cliente: antes de que la unidad salga, la foto del sello; luego ya manda su inicio de viaje. La clave de amago, el bloqueo, la
// cámara y el botón de pánico NO viajan por WhatsApp (quedan con monitoreo): nada de esto las pide ni las nombra. El sello previo es de
// IMPORTACIÓN; en exportación «aquí no se ocupa». Que la foto por WhatsApp baste, o monitoreo la necesite además por su canal, es
// pregunta abierta al cliente: por eso la opción nace APAGADA (solo recomienda y registra) y nunca exige en exportación.
//
// El «inicio de viaje» del ciclo actual es la salida de la carga (`salida_carga`); el ciclo por servicio (T-A5-41/42) lo separará.
// ═══════════════════════════════════════════════════════════════════════════

export type ServicioViaje = 'importacion' | 'exportacion' | 'nacional';

/** Lo mínimo de una evidencia ya guardada (`viaje_hito_evidencia`) para decidir. */
export interface EvidenciaSelloFila { tipo: TipoEvidencia; creadaEn: string }

export type DecisionSelloInicio =
  /** Hay sello reciente, o no aplica: se registra el inicio sin más. */
  | { accion: 'registrar'; recomendar: false }
  /** Sin sello y la opción apagada: se registra el inicio y se recomienda la foto. */
  | { accion: 'registrar'; recomendar: true }
  /** Sin sello y la opción encendida (importación): NO se registra; se pide la foto primero. */
  | { accion: 'pedir_foto' };

/** ¿Hay una foto de sello del viaje lo bastante reciente (≤ `HORAS_EVIDENCIA`)? Las purgadas no llegan (ruta nula); las `otra`/`anden` no cuentan. */
export function hayFotoDeSello(evidencias: readonly EvidenciaSelloFila[], ahora: Date): boolean {
  const limite = ahora.getTime() - HORAS_EVIDENCIA * 3_600_000;
  return evidencias.some((e) => {
    const t = new Date(e.creadaEn).getTime();
    return e.tipo === 'sello' && Number.isFinite(t) && t >= limite && t <= ahora.getTime() + 60_000;
  });
}

/**
 * Qué hacer con un aviso que registraría `objetivo`. Solo `salida_carga` (el inicio de viaje) pasa por aquí; cualquier otro hito
 * se registra como siempre. `servicio` null = aún no se sabe (el modelo por servicio llega con T-A5-41): nunca se EXIGE, solo se recomienda.
 */
export function decidirSelloInicio(a: {
  objetivo: TipoHito;
  servicio: ServicioViaje | null;
  exigir: boolean | undefined;
  evidencias: readonly EvidenciaSelloFila[];
  ahora: Date;
}): DecisionSelloInicio {
  if (a.objetivo !== 'salida_carga') return { accion: 'registrar', recomendar: false };
  if (a.servicio === 'exportacion' || a.servicio === 'nacional') return { accion: 'registrar', recomendar: false };
  if (hayFotoDeSello(a.evidencias, a.ahora)) return { accion: 'registrar', recomendar: false };
  if (a.exigir === true && a.servicio === 'importacion') return { accion: 'pedir_foto' };
  return { accion: 'registrar', recomendar: true };
}

/** El texto al chofer. Sin claves, evidencias de seguridad ni nada de monitoreo. */
export function mensajeSelloInicio(que: 'pedir' | 'recomendar'): string {
  return que === 'pedir'
    ? '📷 Antes de iniciar el viaje, manda la foto del sello y escribe «sello» en el pie de la foto. Cuando la reciba, dime «ya salí».'
    : '📷 Si puedes, manda la foto del sello y escribe «sello» en el pie de la foto.';
}
