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

function limpiar(texto: string): string {
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
