// ═══════════════════════════════════════════════════════════════════════════
// EL PERMISO CRE: identificar la gasolinera desde el papel.
//
// POR QUÉ EXISTE. Cuatro de cada diez gasolineras del país son Pemex, y Pemex
// NO tiene portal de facturación: son 8,000+ franquicias y cada franquiciatario
// elige su sistema. Además hay ~mil marcas distintas —medido sobre 5,262
// estaciones cosechadas—, varias con portales que son una IP con puerto
// (`74.208.68.158:8060` factura los tickets de Fullgas) o un DNS dinámico
// (`octano9603.dyndns.org`). Nada de eso se reconoce por dominio ni sobrevive a
// un cambio de proveedor.
//
// Lo único estable es el PERMISO CRE, y viene impreso en el ticket:
//
//   G500 Megasur   PERMISO CRE : PL/22384/EXP/ES/2019
//   La Gas Boliche PERMISO: PL/7814/EXP/ES/2015
//
// Con la tabla, el permiso del ticket da la marca, y de la marca sale el sistema
// de facturación. Es el eslabón que ningún directorio de los cinco cosechados
// resuelve.
//
// ── LA TABLA ESTÁ INCOMPLETA A PROPÓSITO, Y ESO NO ES UN PROBLEMA ──────────
//
// Hoy cubre ~5,200 de las ~14,300 estaciones del país: la cosecha sigue
// corriendo (`scripts/cosecha/estaciones.mjs`, reanudable) y la tabla se
// regenera con `scripts/cosecha/generar-tabla-cre.mjs`. El código no cambia.
//
// Es seguro usarla incompleta porque `identificarPorPermiso` devuelve TRES
// estados y nunca dos. La distinción es la lección que este repo aprendió cinco
// veces en la auditoría 6: un valor que significa "no sé" leído como "no
// existe" es la familia de bug más caro que tenemos.
//
//   'reconocido'   está en la tabla → se sabe la marca
//   'desconocido'  hay permiso pero NO está en la tabla → no sabemos, y se dice
//   'sin_permiso'  el ticket no trae permiso → no hay nada que buscar
//
// Con 'desconocido' el producto NO puede afirmar que la estación no existe. Solo
// puede decir que no la tiene mapeada, que es la verdad.
// ═══════════════════════════════════════════════════════════════════════════

import PERMISOS from './permisos_cre.json';

/**
 * Formato del permiso de la Comisión Reguladora de Energía en un ticket de
 * combustible: `PL/22384/EXP/ES/2019`.
 *
 * - `PL` es expendio al público (`PT` aparece en transporte). Se aceptan los dos
 *   porque una flota puede recibir ambos.
 * - El número de permiso no tiene largo fijo.
 * - `ES` es estación de servicio; hay otras claves de dos letras.
 *
 * Se exige el año de cuatro dígitos al final para no confundirlo con un folio.
 */
const FORMA_PERMISO = /\bP[LT]\s*\/\s*\d{1,6}\s*\/\s*EXP\s*\/\s*[A-Z]{2}\s*\/\s*\d{4}\b/i;

/** El mismo, global, para cuando hay que encontrarlos todos. */
const FORMA_PERMISO_G = new RegExp(FORMA_PERMISO.source, 'gi');

/**
 * Normaliza el permiso para poder buscarlo.
 *
 * El OCR mete espacios alrededor de las diagonales y a veces cambia la caja.
 * `PL/ 22384 /EXP/ES/2019` y `pl/22384/exp/es/2019` son el mismo permiso, y sin
 * esto la búsqueda falla por un espacio.
 */
export function normalizarPermiso(bruto: string): string {
  return bruto.replace(/\s+/g, '').toUpperCase();
}

/** Saca el permiso CRE del texto del ticket, o `null` si no hay ninguno. */
export function permisoDelTicket(texto: string | null | undefined): string | null {
  if (!texto) return null;
  const m = FORMA_PERMISO.exec(texto);
  return m ? normalizarPermiso(m[0]) : null;
}

/** Todos los permisos del texto, sin repetir. Un ticket puede traer más de uno. */
export function permisosDelTicket(texto: string | null | undefined): string[] {
  if (!texto) return [];
  return [...new Set([...texto.matchAll(FORMA_PERMISO_G)].map((m) => normalizarPermiso(m[0])))];
}

export type ResultadoPermiso =
  /** Está en la tabla: se sabe de quién es la estación. */
  | { estado: 'reconocido'; permiso: string; marca: string }
  /**
   * Hay permiso en el ticket y NO está en la tabla.
   *
   * NO significa que la estación no exista: significa que no la tenemos. La
   * tabla cubre ~5,200 de ~14,300 estaciones, así que este estado es el normal
   * hoy, no la excepción.
   */
  | { estado: 'desconocido'; permiso: string }
  /** El ticket no trae permiso. No hay nada que buscar. */
  | { estado: 'sin_permiso' };

/**
 * Identifica la estación por su permiso CRE.
 *
 * Nunca devuelve `null` ni lanza: los tres estados cubren todo, y por eso el
 * llamador no puede confundir "no sé" con "no hay".
 */
export function identificarPorPermiso(textoTicket: string | null | undefined): ResultadoPermiso {
  const permiso = permisoDelTicket(textoTicket);
  if (!permiso) return { estado: 'sin_permiso' };
  const marca = (PERMISOS as Record<string, string>)[permiso];
  return marca ? { estado: 'reconocido', permiso, marca } : { estado: 'desconocido', permiso };
}

/** Cuántas estaciones cubre la tabla hoy. Para el diagnóstico de arranque. */
export function coberturaTablaCre(): { permisos: number; marcas: number } {
  const t = PERMISOS as Record<string, string>;
  return { permisos: Object.keys(t).length, marcas: new Set(Object.values(t)).size };
}
