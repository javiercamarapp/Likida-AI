// ═══════════════════════════════════════════════════════════════════════════
// EL LECTOR DE ZIP DEL PAQUETE DEL SAT (0231).
//
// El SAT entrega la descarga masiva como un ZIP con un XML por CFDI. No hay
// librería de ZIP en el árbol y no se agrega una: leer un ZIP es recorrer su
// DIRECTORIO CENTRAL y desinflar cada entrada con `node:zlib`, que ya está en
// Node. Son ~120 líneas contra una dependencia nueva en el camino por donde
// entra un archivo de un tercero — el cálculo de superficie es obvio.
//
// SE LEE EL DIRECTORIO CENTRAL, NO LOS ENCABEZADOS LOCALES. Es la diferencia
// entre leer un ZIP y adivinarlo: el encabezado local puede traer los tamaños
// en cero (el bit 3 de `flags`, streaming) y el directorio central SIEMPRE los
// tiene. Un lector que confía en el local se queda con archivos vacíos ante un
// ZIP perfectamente válido.
//
// LOS TOPES SON PARTE DEL LECTOR, no una comprobación opcional. Esto abre un
// archivo que viene de fuera: sin límite de entradas ni de tamaño desinflado,
// un ZIP de 1 MB puede pedir gigabytes de RAM (zip bomb) y tirar la función
// entera. Se corta y SE DICE que se cortó — un paquete truncado en silencio
// sería exactamente el recorte que este producto no se permite.
// ═══════════════════════════════════════════════════════════════════════════

import { inflateRawSync } from 'node:zlib';

/** Cuántas entradas se leen de un paquete. El tope del SAT por petición es de
 *  200,000 CFDI, pero un paquete individual viene MUY por debajo; 50,000 deja
 *  margen de sobra y sigue siendo un techo. */
export const MAX_ENTRADAS = 50_000;

/** Cuánto XML desinflado se acepta por paquete (bytes). Un CFDI ronda los 4 KB;
 *  256 MB son ~60,000 comprobantes. Pasado esto se corta y se declara. */
export const MAX_DESINFLADO = 256 * 1024 * 1024;

export interface EntradaZip {
  nombre: string;
  contenido: string;
}

export interface LecturaZip {
  entradas: EntradaZip[];
  /** true si se alcanzó alguno de los topes y quedaron entradas sin leer. La
   *  lee el llamador para DECIRLO, no para ignorarlo. */
  truncado: boolean;
  /** Entradas que existían y no se pudieron desinflar (método desconocido,
   *  datos corruptos). Se cuentan y se reportan: un CFDI que no se pudo leer
   *  no es un CFDI que no existe. */
  ilegibles: number;
}

const FIRMA_EOCD = 0x06054b50;
const FIRMA_CENTRAL = 0x02014b50;
const FIRMA_LOCAL = 0x04034b50;

/** Encuentra el End Of Central Directory, que vive al final del archivo pero
 *  puede traer hasta 64 KB de comentario detrás. Se busca hacia atrás. */
function buscarEocd(buf: Buffer): number | null {
  const minimo = Math.max(0, buf.length - 0xffff - 22);
  for (let i = buf.length - 22; i >= minimo; i--) {
    if (buf.readUInt32LE(i) === FIRMA_EOCD) return i;
  }
  return null;
}

/**
 * Extrae las entradas de un ZIP. Nunca lanza por un ZIP malformado: devuelve
 * lo que sí pudo leer y cuenta lo que no — el mismo criterio que el parser de
 * CFDI (perder un comprobante es malo; perder el paquete entero por un
 * comprobante malo es peor).
 *
 * @param filtro Qué nombres interesan. Por omisión, solo `.xml`.
 */
export function leerZip(
  datos: Buffer | Uint8Array,
  filtro: (nombre: string) => boolean = (n) => n.toLowerCase().endsWith('.xml'),
): LecturaZip {
  const buf = Buffer.isBuffer(datos) ? datos : Buffer.from(datos);
  const entradas: EntradaZip[] = [];
  let ilegibles = 0;
  let truncado = false;
  let desinflado = 0;

  const eocd = buscarEocd(buf);
  if (eocd === null) return { entradas, truncado: false, ilegibles: 0 };

  const total = buf.readUInt16LE(eocd + 10);
  let puntero = buf.readUInt32LE(eocd + 16);

  for (let i = 0; i < total; i++) {
    // Un directorio central que se sale del archivo es un ZIP roto: se corta
    // aquí con lo que ya se leyó, no se lanza.
    if (puntero + 46 > buf.length || buf.readUInt32LE(puntero) !== FIRMA_CENTRAL) break;

    const metodo = buf.readUInt16LE(puntero + 10);
    const tamComprimido = buf.readUInt32LE(puntero + 20);
    const tamCrudo = buf.readUInt32LE(puntero + 24);
    const largoNombre = buf.readUInt16LE(puntero + 28);
    const largoExtra = buf.readUInt16LE(puntero + 30);
    const largoComentario = buf.readUInt16LE(puntero + 32);
    const offsetLocal = buf.readUInt32LE(puntero + 42);
    const nombre = buf.subarray(puntero + 46, puntero + 46 + largoNombre).toString('utf8');
    puntero += 46 + largoNombre + largoExtra + largoComentario;

    if (!filtro(nombre)) continue;

    if (entradas.length >= MAX_ENTRADAS || desinflado + tamCrudo > MAX_DESINFLADO) {
      truncado = true;
      break;
    }

    // El encabezado LOCAL solo se usa para saber dónde empiezan los datos: sus
    // longitudes de nombre/extra pueden diferir de las del central, y ésas sí
    // hay que leerlas de aquí.
    if (offsetLocal + 30 > buf.length || buf.readUInt32LE(offsetLocal) !== FIRMA_LOCAL) {
      ilegibles++;
      continue;
    }
    const inicio = offsetLocal + 30
      + buf.readUInt16LE(offsetLocal + 26)
      + buf.readUInt16LE(offsetLocal + 28);
    if (inicio + tamComprimido > buf.length) { ilegibles++; continue; }

    const crudo = buf.subarray(inicio, inicio + tamComprimido);
    try {
      // 0 = almacenado sin comprimir, 8 = deflate. Son los dos que produce
      // cualquier generador de ZIP; otro método se cuenta como ilegible en
      // vez de devolver basura que parecería un CFDI.
      let contenido: Buffer;
      if (metodo === 0) contenido = Buffer.from(crudo);
      else if (metodo === 8) contenido = inflateRawSync(crudo, { maxOutputLength: MAX_DESINFLADO });
      else { ilegibles++; continue; }
      desinflado += contenido.length;
      entradas.push({ nombre, contenido: contenido.toString('utf8') });
    } catch {
      ilegibles++;
    }
  }

  return { entradas, truncado, ilegibles };
}
