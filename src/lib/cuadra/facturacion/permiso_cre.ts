// ═══════════════════════════════════════════════════════════════════════════
// EL PERMISO CRE: identificar la gasolinera desde el papel.
//
// POR QUÉ EXISTE. **El 46.6% de las gasolineras del país son Pemex** —6,171 de
// 12,625, medido sobre el padrón completo— y Pemex NO tiene portal de
// facturación: son franquicias y cada franquiciatario elige su sistema. Además
// hay **3,226 marcas distintas, y 2,935 de ellas tienen UNA sola estación**, varias con portales que son una IP con puerto
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
// Cubre 12,625 de las ~14,300 estaciones del padrón (88%). Lo que falta son 676
// páginas que fallaron por timeout y las fichas cuya "compañía" venía corrida,
// que se descartan a propósito. Se regenera con
// `scripts/cosecha/generar-tabla-cre.mjs` sin tocar el código.
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
//
// ── LA MARCA ES UNA PISTA, NO UN VEREDICTO. MEDIDO CONTRA LOS DOS TICKETS ──
//
// Al cerrar la cosecha (12,625 permisos, 88% del padrón) se probó contra los dos
// tickets que sí facturamos, y los dos fallaron de formas distintas:
//
//   G500 Megasur  PL/22384/EXP/ES/2019 → la ficha de origen traía la "compañía"
//                 vacía y el extractor tomó el campo siguiente: salía
//                 `Ciudad/Municipio Tixkokob`. Se descarta en el generador, así
//                 que hoy responde 'desconocido'. Correcto: no la sabemos.
//
//   La Gas        PL/7814/EXP/ES/2015 → responde `PEMEX`, Y ESO ESTÁ MAL. La
//                 fuente (`gasolinerasmx.mx`) la tiene como Pemex; el ticket
//                 impreso dice "LA GAS BOLICHE", RFC AES0706049E2. La dirección
//                 de la ficha —"20 x 1'C' y 1'B' No. 20, Mérida"— coincide con
//                 la del ticket, así que es la misma estación con la marca
//                 equivocada EN EL ORIGEN.
//
// De dos comprobaciones, una no sabe y la otra miente. Por eso esta tabla NO
// puede decidir a qué portal se manda al operador: para eso está
// `identificarComercio`, que usa el dominio del QR, el RFC del emisor y el texto
// impreso —tres señales del propio papel—.
//
// El permiso sirve para lo que ninguna de esas tres resuelve: la ESTACIÓN
// concreta cuando el portal es una IP con puerto o un DNS dinámico. Es una capa
// de contexto, no de decisión.
//
// ── AUDITORÍA 10, BAJO (fiscal), tercera ronda sin consumidor — por qué se ──
// ── CONSERVA y no se borra ──────────────────────────────────────────────────
//
// Sigue sin una sola llamada fuera de su propia prueba. Se decidió CONSERVAR,
// no borrar, porque hay un consumidor concreto escrito en el roadmap, no uno
// hipotético inventado para justificar no borrar: `docs/investigacion/
// ROADMAP-INTEGRACIONES.md` Fase 3 es "los tres sistemas de Pemex" —GORM/
// Brentec, FacturacionEstacion, FacturaGAS—, y Pemex es el 46.6% del padrón
// (6,171 de 12,625, medido aquí mismo, arriba) sin un solo portal ni dominio
// central: ninguna de las tres señales que usa `identificarComercio` (dominio
// del QR, RFC del emisor, texto impreso) puede decir "esto es Pemex" antes de
// intentar alguno de los tres sistemas. El permiso impreso en el ticket sí
// puede, con el mismo límite que ya documenta este archivo arriba: es
// contexto, no decisión, porque la marca de la tabla se probó mal una de dos
// veces (La Gas → PEMEX, con la fuente equivocada en el origen).
//
// No se conectó esta ronda porque Fase 3 todavía no arranca: la ingeniería de
// esta semana fue a Fase 1 (CAPUFE) y al consolidado de monedero/TAG — ver el
// hallazgo [CRÍTICO] de `docs/auditoria-10/fiscal.md`. Cuando arranque Fase 3,
// el punto de entrada es `identificarPorPermiso` sobre el texto OCR del
// ticket, ANTES de intentar los tres sistemas — nunca dentro de
// `identificarComercio` como señal dura de routing, por la razón de arriba.
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
   * tabla cubre 12,625 de ~14,300, así que hoy es la excepción — pero sigue
   * siendo un estado de primera clase, no un caso de borde.
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
