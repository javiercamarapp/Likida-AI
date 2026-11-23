// ═══════════════════════════════════════════════════════════════════════════
// FICHA DE UNIDAD EN EL TEXTO — reconoce la plantilla de «datos de la unidad» que el equipo y los clientes pegan en los grupos.
//
// Medido en 5 grupos reales de transporte: la ficha es lo más repetido que el equipo escribe a mano (línea/caja/placas/estado,
// o unidad/placa/operador/licencia/resello/celular). Este módulo SOLO reconoce la forma (los NOMBRES de los campos); nunca lee,
// guarda ni devuelve los valores: una licencia, un celular o una placa no son asunto de este código.
//
// Dos usos, los dos de LECTURA:
//   · `detectarFicha(texto)`: ¿este mensaje es una ficha? ¿qué campos trae y qué campos faltan? (para marcar «incompleta» sin inventar).
//   · `sugerirEquipoPorFicha(mensajes)`: autores que escriben fichas con frecuencia. Es una SUGERENCIA para `equipoHashes`: el
//     cliente también pega bloques con el mismo formato (medido: hasta 1 de cada 3 fichas en un grupo), así que la decisión de quién
//     es equipo la toma una persona. Nunca se aplica sola.
// PURO: sin base, sin red.
// ═══════════════════════════════════════════════════════════════════════════
import { normalizar } from '../entrada';

export const CAMPOS_FICHA = ['linea', 'caja', 'numero', 'placas', 'estado', 'unidad', 'operador', 'licencia', 'resello', 'celular', 'folio'] as const;
export type CampoFicha = (typeof CAMPOS_FICHA)[number];

/** Campos con datos personales (de una persona o su vehículo): jamás se reenvían a un tercero sin una regla de privacidad de la flota. */
export const CAMPOS_PERSONALES: readonly CampoFicha[] = ['operador', 'licencia', 'celular', 'placas'];

const ETIQUETAS: ReadonlyArray<[CampoFicha, RegExp]> = [
  ['linea', /^(linea|cliente)$/],
  ['caja', /^(caja|remolque|trailer|termo|thermo)$/],
  ['numero', /^(numero|num|no)$/],
  ['placas', /^(placas?|placa de la caja|placas de la caja)$/],
  ['estado', /^(estado|pais)$/],
  ['unidad', /^(unidad|tracto|tractocamion|economico|eco)$/],
  ['operador', /^(operador|chofer|conductor|nombre)$/],
  ['licencia', /^(licencia|lic)$/],
  ['resello', /^(resello|fecha de resello|sello|vigencia)$/],
  ['celular', /^(celular|cel|telefono|tel)$/],
  ['folio', /^(folio|referencia|ref|servicio)$/],
];

export interface FichaDetectada {
  /** Campos distintos que la ficha trae (por su etiqueta, no por su valor). */
  campos: CampoFicha[];
  /** Campos esperados de una ficha completa que NO trae. Solo informativo: no se rellenan. */
  faltan: CampoFicha[];
  /** Líneas «Etiqueta: valor» reconocidas. */
  lineas: number;
  /** Trae al menos un campo con datos personales (operador, licencia, celular, placas). */
  conDatosPersonales: boolean;
}

/** Campos mínimos para llamarla ficha (y no «placas: x» suelto). */
export const MIN_CAMPOS_FICHA = 3;

const LINEA_ETIQUETADA = /^\s*([^\n:]{1,24}?)\s*(?::|\s[-–—]\s)\s*\S/;

/**
 * ¿El texto es una ficha de unidad? Hace falta al menos `MIN_CAMPOS_FICHA` campos distintos en líneas «Etiqueta: valor». `null` si no.
 * Las etiquetas se comparan normalizadas (sin acentos, mayúsculas ni signos).
 */
export function detectarFicha(texto: string): FichaDetectada | null {
  if (typeof texto !== 'string' || texto.length === 0 || texto.length > 2000) return null;
  const campos = new Set<CampoFicha>();
  let lineas = 0;
  for (const linea of texto.split('\n')) {
    const m = LINEA_ETIQUETADA.exec(linea);
    if (!m) continue;
    const etiqueta = normalizar(m[1]);
    const campo = ETIQUETAS.find(([, r]) => r.test(etiqueta));
    if (!campo) continue;
    lineas += 1;
    campos.add(campo[0]);
  }
  if (campos.size < MIN_CAMPOS_FICHA) return null;
  const lista = CAMPOS_FICHA.filter((c) => campos.has(c));
  const esperados: readonly CampoFicha[] = campos.has('unidad') || campos.has('operador') || campos.has('licencia')
    ? ['caja', 'placas', 'unidad', 'operador', 'licencia', 'resello', 'celular']
    : ['linea', 'numero', 'placas', 'estado'];
  return {
    campos: lista,
    faltan: esperados.filter((c) => !campos.has(c)),
    lineas,
    conDatosPersonales: lista.some((c) => CAMPOS_PERSONALES.includes(c)),
  };
}

export interface AutorSugeridoEquipo {
  autorHash: string;
  fichas: number;
  mensajes: number;
}

/**
 * Autores que escriben fichas con frecuencia: candidatos a `equipoHashes`. Exige `minFichas` fichas Y que sean al menos `minPct` % de
 * sus mensajes (así un cliente que pegó un bloque de vez en cuando no entra). SUGERENCIA, no decisión. Ordenado por fichas.
 */
export function sugerirEquipoPorFicha(
  mensajes: ReadonlyArray<{ autorHash: string; texto: string }>,
  opciones: { minFichas?: number; minPct?: number } = {},
): AutorSugeridoEquipo[] {
  const minFichas = opciones.minFichas ?? 5;
  const minPct = opciones.minPct ?? 2;
  const por = new Map<string, AutorSugeridoEquipo>();
  for (const m of mensajes) {
    const a = por.get(m.autorHash) ?? { autorHash: m.autorHash, fichas: 0, mensajes: 0 };
    a.mensajes += 1;
    if (detectarFicha(m.texto)) a.fichas += 1;
    por.set(m.autorHash, a);
  }
  return [...por.values()]
    .filter((a) => a.fichas >= minFichas && (100 * a.fichas) / a.mensajes >= minPct)
    .sort((x, y) => y.fichas - x.fichas || (x.autorHash < y.autorHash ? -1 : 1));
}
