// ═══════════════════════════════════════════════════════════════════════════
// CARTA PORTE — lo que dice el NOMBRE del archivo (T-A3-56).
//
// Los clientes nombran sus documentos `CCP <transportista>-<cliente final> <IMPO|EXPO> <caja> <dd-mm-aa>`, a veces con una
// versión `(1)`, `(3)` y con un carácter dañado (mojibake «Â» o U+FFFD) donde iba el espacio. El nombre es una PISTA con
// evidencia, nunca un dato: no decide nada por sí solo, solo permite (a) avisar cuando contradice al contenido y (b) saber
// si dos archivos son versiones del mismo embarque.
//
// Todo puro y sin I/O. Sin lectura de bytes: la huella del contenido se calcula con `huellaContenido`.
// ═══════════════════════════════════════════════════════════════════════════

import { createHash } from 'node:crypto';

export type TipoOperacionNombre = 'IMPO' | 'EXPO';

export interface PistaNombre<T> { valor: T; evidencia: string }

export interface MetadatosNombre {
  /** Nombre ya sin carácter dañado ni extensión ni versión, con espacios simples. */
  limpio: string;
  extension: string | null;
  tipo: PistaNombre<TipoOperacionNombre> | null;
  caja: PistaNombre<string> | null;
  /** Fecha ISO `AAAA-MM-DD`; el nombre trae dd-mm-aa (día primero, como el resto de los nombres del cliente). */
  fecha: PistaNombre<string> | null;
  /** Número entre paréntesis; sin él es la versión 1. */
  version: number;
  versionExplicita: boolean;
  /** Qué se arregló o no se pudo leer (lenguaje de quien revisa). */
  avisos: string[];
}

const EXTENSIONES = /\.(xlsx|xlsm|xls|csv|pdf|json|xml|txt|png|jpe?g|webp|heic)$/i;
const FECHA = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/;
const VERSION = /\s*\((\d{1,3})\)/g;

/**
 * Quita el carácter dañado: «Â» (y «Â» + espacio duro) que deja un UTF-8 de espacio duro leído como Latin-1, el U+FFFD de
 * un decodificador estricto, espacios duros y de ancho cero. Si hay secuencias «Ã¡»-estilo, intenta el viaje Latin-1→UTF-8
 * solo cuando el resultado no contiene U+FFFD. Devuelve el texto y si cambió algo.
 */
export function limpiarMojibake(texto: string): { texto: string; cambio: boolean } {
  let t = texto;
  if (/[Ã][\u0080-¿]/.test(t)) {
    try {
      const bytes = Uint8Array.from(Array.from(t, (c) => c.charCodeAt(0)));
      if (bytes.every((b, i) => b === t.charCodeAt(i))) {
        const dec = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        t = dec;
      }
    } catch { /* no era UTF-8 mal leído: se deja como estaba */ }
  }
  t = t.replace(/Â[  ]?/g, ' ').replace(/[ ​  �]+/g, ' ').replace(/\s+/g, ' ').trim();
  return { texto: t, cambio: t !== texto };
}

function aIso(d: number, m: number, a: number): string | null {
  const anio = a < 100 ? 2000 + a : a;
  const f = new Date(Date.UTC(anio, m - 1, d));
  if (f.getUTCFullYear() !== anio || f.getUTCMonth() !== m - 1 || f.getUTCDate() !== d) return null;
  return `${anio}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Interpreta el nombre de un archivo de carta porte. Un nombre que no sigue la forma devuelve pistas en `null`. */
export function metadatosNombre(nombre: string | null | undefined): MetadatosNombre {
  const avisos: string[] = [];
  const { texto: sinDanio, cambio } = limpiarMojibake(nombre ?? '');
  if (cambio) avisos.push('El nombre traía un carácter dañado donde va el espacio; se limpió.');
  const ext = EXTENSIONES.exec(sinDanio);
  let base = ext ? sinDanio.slice(0, ext.index) : sinDanio;
  const versiones = Array.from(base.matchAll(VERSION));
  const ultima = versiones.length > 0 ? versiones[versiones.length - 1] : undefined;
  const version = ultima ? Math.max(1, Number(ultima[1])) : 1;
  base = base.replace(VERSION, '').replace(/\s+/g, ' ').trim();

  const tokens = base.split(' ').filter((x) => x !== '');
  const iTipo = tokens.findIndex((x) => /^(impo|expo)$/i.test(x));
  let tipo: MetadatosNombre['tipo'] = null;
  let caja: MetadatosNombre['caja'] = null;
  let fecha: MetadatosNombre['fecha'] = null;
  if (iTipo >= 0) {
    tipo = { valor: tokens[iTipo].toUpperCase() as TipoOperacionNombre, evidencia: tokens[iTipo] };
    const posible = tokens[iTipo + 1];
    if (posible && !FECHA.test(posible)) caja = { valor: posible.toUpperCase(), evidencia: posible };
    const iFecha = tokens.findIndex((x, i) => i > iTipo && FECHA.test(x));
    if (iFecha >= 0) {
      const m = FECHA.exec(tokens[iFecha]) as RegExpExecArray;
      const iso = aIso(Number(m[1]), Number(m[2]), Number(m[3]));
      if (iso) fecha = { valor: iso, evidencia: tokens[iFecha] };
      else avisos.push(`La fecha «${tokens[iFecha]}» del nombre no es una fecha real.`);
    }
  }
  return { limpio: base, extension: ext ? ext[1].toLowerCase() : null, tipo, caja, fecha, version, versionExplicita: Boolean(ultima), avisos };
}

/** `IMPO|CAJA|AAAA-MM-DD`: lo que comparten las versiones de un mismo embarque. `null` si falta alguna pista. */
export function claveEmbarque(m: MetadatosNombre): string | null {
  return m.tipo && m.caja && m.fecha ? `${m.tipo.valor}|${m.caja.valor}|${m.fecha.valor}` : null;
}

/** Huella (sha256 hex) del contenido: dos archivos con la misma huella son el mismo documento aunque se llamen distinto. */
export function huellaContenido(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export type RelacionArchivos = 'duplicado' | 'nueva_version' | 'mismo_embarque_otro_contenido' | 'distinto' | 'indeterminado';

/**
 * Cómo se relacionan dos archivos recibidos:
 *   · misma huella → `duplicado` (idempotente: no se procesa otra vez, sea cual sea el nombre);
 *   · misma clave de embarque y versión distinta con contenido distinto → `nueva_version`;
 *   · misma clave y misma versión pero contenido distinto → `mismo_embarque_otro_contenido` (la persona decide);
 *   · claves distintas → `distinto`; sin clave en alguno y sin huella igual → `indeterminado` (no se adivina).
 */
export function relacionArchivos(a: { meta: MetadatosNombre; huella: string }, b: { meta: MetadatosNombre; huella: string }): RelacionArchivos {
  if (a.huella === b.huella) return 'duplicado';
  const ka = claveEmbarque(a.meta);
  const kb = claveEmbarque(b.meta);
  if (ka === null || kb === null) return 'indeterminado';
  if (ka !== kb) return 'distinto';
  return a.meta.version !== b.meta.version ? 'nueva_version' : 'mismo_embarque_otro_contenido';
}
