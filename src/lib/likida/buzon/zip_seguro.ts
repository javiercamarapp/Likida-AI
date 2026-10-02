import { inflateRawSync, crc32 } from 'node:zlib';
import { aBuffer, copiar } from './bytes';

// ═══════════════════════════════════════════════════════════════════════════
// LECTOR DE ZIP A PRUEBA DE BOMBAS (buzón de facturas, Agente 9).
//
// Un proveedor puede mandar sus CFDI en un .zip, y un atacante puede mandar un
// .zip que no sea lo que dice. El buzón es entrada NO autenticada (cualquiera que
// conozca la dirección escribe), así que el lector asume mala fe:
//
//   · NADA SE EXTRAE A DISCO. Todo vive en memoria y las rutas del archivo solo se
//     usan para mostrar y para decidir (un `../../etc/x.xml` se OMITE, no se sanea
//     para escribirlo).
//   · LÍMITES DUROS declarados abajo: número de entradas, tamaño por entrada, tamaño
//     total descomprimido, razón de compresión y profundidad de zips anidados. Se
//     comprueban ANTES de descomprimir (con lo declarado) Y mientras se descomprime
//     (con `maxOutputLength`, porque el tamaño declarado puede mentir).
//   · SOLO SE DESCOMPRIME LO QUE SE VA A LEER (.xml, .pdf y .zip anidado): el resto
//     de entradas ni se tocan.
//   · SOLAPES: dos entradas que apuntan a los mismos bytes (la «bomba de solape»
//     multiplica el contenido sin crecer el archivo) rechazan el zip ENTERO.
//   · FALLA CERRADO: ante cualquier estructura que no cuadre (EOCD ausente, zip64,
//     directorio central roto, más entradas de las permitidas) el resultado es
//     `rechazado` y NO se entrega ninguna entrada, ni las que parecían sanas.
//   · Sin dependencias: `node:zlib` y nada más (el ahorro de superficie de ataque
//     es parte del diseño; el formato soportado es el mínimo: método 0 y 8).
//
// Especificación de formato: PKWARE APPNOTE.TXT 6.3.10, §4.3 (estructura), §4.4
// (campos) — https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT
// ═══════════════════════════════════════════════════════════════════════════

export interface LimitesZip {
  /** Entradas del directorio central (todas, no solo las leídas). */
  maxEntradas: number;
  /** Bytes descomprimidos de UNA entrada. */
  maxBytesEntrada: number;
  /** Bytes descomprimidos entre TODAS las entradas leídas (incluye los zips anidados). */
  maxBytesTotal: number;
  /** Descomprimido / comprimido máximo por entrada (solo aplica a entradas > `pisoRazon`). */
  maxRazon: number;
  /** Debajo de este tamaño la razón no se juzga (un XML de 3 KB comprime 30× sin ser bomba). */
  pisoRazon: number;
  /** 0 = el zip de afuera; 1 = un zip dentro de un zip. */
  maxProfundidad: number;
  /** Bytes del archivo zip mismo. */
  maxBytesZip: number;
}

export const LIMITES_ZIP: LimitesZip = {
  maxEntradas: 100,
  maxBytesEntrada: 8 * 1024 * 1024,
  maxBytesTotal: 24 * 1024 * 1024,
  maxRazon: 100,
  pisoRazon: 256 * 1024,
  maxProfundidad: 1,
  maxBytesZip: 12 * 1024 * 1024,
};

export type MotivoZipRechazado =
  | 'no_es_zip' | 'zip64' | 'multidisco' | 'corrupto' | 'demasiado_grande' | 'demasiadas_entradas'
  | 'solapado' | 'bomba';

export type MotivoEntradaOmitida =
  | 'ruta_peligrosa' | 'cifrado' | 'metodo_no_soportado' | 'entrada_grande' | 'crc_no_coincide'
  | 'corrupta' | 'profundidad' | 'tipo_ignorado';

export interface EntradaZip {
  /** Solo el nombre del archivo (sin carpetas). */
  nombre: string;
  /** La ruta tal como venía, saneada para mostrar. */
  ruta: string;
  bytes: Buffer;
  /** 0 = zip de afuera; 1 = venía dentro de otro zip. */
  profundidad: number;
}

export interface ResultadoZip {
  entradas: EntradaZip[];
  omitidas: Array<{ ruta: string; motivo: MotivoEntradaOmitida }>;
  /** No null = el zip ENTERO se rechazó y `entradas` está vacío. */
  rechazado: MotivoZipRechazado | null;
}

const SIG_EOCD = 0x06054b50;
const SIG_CD = 0x02014b50;
const SIG_LOCAL = 0x04034b50;
const TAM_EOCD = 22;
const TAM_CD = 46;
const TAM_LOCAL = 30;

/** ¿Los primeros bytes son los de un zip? (local header o EOCD de un zip vacío). */
export function pareceZip(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;
  const b = aBuffer(bytes.subarray(0, 4));
  const sig = b.readUInt32LE(0);
  return sig === SIG_LOCAL || sig === SIG_EOCD;
}

const EXTENSIONES_LEIDAS = /\.(xml|pdf|zip)$/i;

/** Una ruta con `..`, absoluta, con NUL o con letra de unidad no es un archivo: es un ataque o un descuido. */
function rutaPeligrosa(ruta: string): boolean {
  if (ruta.includes('\0')) return true;
  if (/^([a-zA-Z]:|[\\/])/.test(ruta)) return true;
  return ruta.split(/[\\/]/).some((p) => p === '..');
}

function sanear(ruta: string): string {
  return ruta.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 200);
}

function nombreBase(ruta: string): string {
  const partes = ruta.split(/[\\/]/).filter(Boolean);
  return sanear(partes[partes.length - 1] ?? ruta).slice(0, 120);
}

interface CtxZip {
  lim: LimitesZip;
  bytesTotales: number;
  entradasVistas: number;
}

interface EntradaCd {
  nombre: string;
  flags: number;
  metodo: number;
  crc: number;
  comprimido: number;
  tamano: number;
  offsetLocal: number;
}

type ParseCd = { ok: true; entradas: EntradaCd[] } | { ok: false; motivo: MotivoZipRechazado };

function leerDirectorio(buf: Buffer, lim: LimitesZip): ParseCd {
  // EOCD: los últimos 22 bytes + un comentario de hasta 65,535. Se busca hacia atrás.
  const desde = Math.max(0, buf.length - (TAM_EOCD + 0xffff));
  let eocd = -1;
  for (let i = buf.length - TAM_EOCD; i >= desde; i--) {
    if (buf.readUInt32LE(i) === SIG_EOCD) {
      const comentario = buf.readUInt16LE(i + 20);
      if (i + TAM_EOCD + comentario === buf.length) { eocd = i; break; }
    }
  }
  if (eocd < 0) return { ok: false, motivo: 'no_es_zip' };

  const disco = buf.readUInt16LE(eocd + 4);
  const discoCd = buf.readUInt16LE(eocd + 6);
  const entradasDisco = buf.readUInt16LE(eocd + 8);
  const total = buf.readUInt16LE(eocd + 10);
  const tamCd = buf.readUInt32LE(eocd + 12);
  const offsetCd = buf.readUInt32LE(eocd + 16);

  if (total === 0xffff || tamCd === 0xffffffff || offsetCd === 0xffffffff) return { ok: false, motivo: 'zip64' };
  if (disco !== 0 || discoCd !== 0 || entradasDisco !== total) return { ok: false, motivo: 'multidisco' };
  if (total > lim.maxEntradas) return { ok: false, motivo: 'demasiadas_entradas' };
  if (offsetCd + tamCd > eocd) return { ok: false, motivo: 'corrupto' };

  const entradas: EntradaCd[] = [];
  let p = offsetCd;
  for (let i = 0; i < total; i++) {
    if (p + TAM_CD > eocd || buf.readUInt32LE(p) !== SIG_CD) return { ok: false, motivo: 'corrupto' };
    const flags = buf.readUInt16LE(p + 8);
    const metodo = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const comprimido = buf.readUInt32LE(p + 20);
    const tamano = buf.readUInt32LE(p + 24);
    const lenNombre = buf.readUInt16LE(p + 28);
    const lenExtra = buf.readUInt16LE(p + 30);
    const lenComentario = buf.readUInt16LE(p + 32);
    const offsetLocal = buf.readUInt32LE(p + 42);
    const fin = p + TAM_CD + lenNombre + lenExtra + lenComentario;
    if (fin > eocd) return { ok: false, motivo: 'corrupto' };
    if (comprimido === 0xffffffff || tamano === 0xffffffff || offsetLocal === 0xffffffff) return { ok: false, motivo: 'zip64' };
    const crudo = buf.subarray(p + TAM_CD, p + TAM_CD + lenNombre);
    // Bit 11 = UTF-8; si no, el estándar manda CP437, que para un nombre solo se muestra: latin1 basta.
    const nombre = (flags & 0x800) !== 0 ? crudo.toString('utf8') : crudo.toString('latin1');
    entradas.push({ nombre, flags, metodo, crc, comprimido, tamano, offsetLocal });
    p = fin;
  }
  return { ok: true, entradas };
}

/** Rango [inicio, fin) de los datos comprimidos de una entrada, leyendo SU cabecera local (la que manda). */
function rangoDatos(buf: Buffer, e: EntradaCd): { inicio: number; fin: number } | null {
  if (e.offsetLocal + TAM_LOCAL > buf.length) return null;
  if (buf.readUInt32LE(e.offsetLocal) !== SIG_LOCAL) return null;
  const lenNombre = buf.readUInt16LE(e.offsetLocal + 26);
  const lenExtra = buf.readUInt16LE(e.offsetLocal + 28);
  const inicio = e.offsetLocal + TAM_LOCAL + lenNombre + lenExtra;
  const fin = inicio + e.comprimido;
  if (fin > buf.length || fin < inicio) return null;
  return { inicio, fin };
}

function leerNivel(buf: Buffer, profundidad: number, ctx: CtxZip, salida: ResultadoZip): MotivoZipRechazado | null {
  const { lim } = ctx;
  if (buf.length > lim.maxBytesZip) return 'demasiado_grande';
  const cd = leerDirectorio(buf, lim);
  if (!cd.ok) return cd.motivo;

  ctx.entradasVistas += cd.entradas.length;
  if (ctx.entradasVistas > lim.maxEntradas) return 'demasiadas_entradas';

  // SOLAPES: ningún par de entradas puede compartir bytes de datos (bomba de solape).
  const rangos: Array<{ inicio: number; fin: number }> = [];
  for (const e of cd.entradas) {
    const r = rangoDatos(buf, e);
    if (!r) return 'corrupto';
    rangos.push(r);
  }
  const ordenados = [...rangos].filter((r) => r.fin > r.inicio).sort((a, b) => a.inicio - b.inicio);
  for (let i = 1; i < ordenados.length; i++) {
    if (ordenados[i].inicio < ordenados[i - 1].fin) return 'solapado';
  }

  const hijos: EntradaZip[] = [];
  for (let i = 0; i < cd.entradas.length; i++) {
    const e = cd.entradas[i];
    const ruta = sanear(e.nombre);
    // Directorios.
    if (/[\\/]$/.test(e.nombre)) continue;
    if (rutaPeligrosa(e.nombre)) { salida.omitidas.push({ ruta, motivo: 'ruta_peligrosa' }); continue; }
    if (!EXTENSIONES_LEIDAS.test(e.nombre)) { salida.omitidas.push({ ruta, motivo: 'tipo_ignorado' }); continue; }
    if ((e.flags & 0x1) !== 0) { salida.omitidas.push({ ruta, motivo: 'cifrado' }); continue; }
    if (e.metodo !== 0 && e.metodo !== 8) { salida.omitidas.push({ ruta, motivo: 'metodo_no_soportado' }); continue; }

    // Lo DECLARADO, antes de descomprimir.
    if (e.tamano > lim.maxBytesEntrada) { salida.omitidas.push({ ruta, motivo: 'entrada_grande' }); continue; }
    if (e.tamano > lim.pisoRazon && e.tamano / Math.max(1, e.comprimido) > lim.maxRazon) return 'bomba';
    if (ctx.bytesTotales + e.tamano > lim.maxBytesTotal) return 'bomba';
    if (e.metodo === 0 && e.comprimido !== e.tamano) { salida.omitidas.push({ ruta, motivo: 'corrupta' }); continue; }

    const { inicio, fin } = rangos[i];
    const comprimido = buf.subarray(inicio, fin);
    let datos: Buffer;
    try {
      // El tamaño declarado PUEDE MENTIR: el tope real lo pone `maxOutputLength` (declarado + 1 para
      // detectar que se pasó, nunca más que el límite por entrada ni que lo que queda del total).
      const tope = Math.min(e.tamano + 1, lim.maxBytesEntrada + 1, lim.maxBytesTotal - ctx.bytesTotales + 1);
      datos = e.metodo === 0 ? copiar(comprimido) : inflateRawSync(comprimido, { maxOutputLength: Math.max(1, tope) });
    } catch (err) {
      // `ERR_BUFFER_TOO_LARGE` = se pasó del tope mientras descomprimía: es la bomba que mintió.
      if ((err as { code?: string }).code === 'ERR_BUFFER_TOO_LARGE') return 'bomba';
      salida.omitidas.push({ ruta, motivo: 'corrupta' });
      continue;
    }
    if (datos.length !== e.tamano) {
      // Descomprimió a más (o a menos) de lo declarado: el archivo miente.
      if (datos.length > e.tamano) return 'bomba';
      salida.omitidas.push({ ruta, motivo: 'corrupta' });
      continue;
    }
    if ((crc32(datos) >>> 0) !== e.crc) { salida.omitidas.push({ ruta, motivo: 'crc_no_coincide' }); continue; }
    ctx.bytesTotales += datos.length;
    if (ctx.bytesTotales > lim.maxBytesTotal) return 'bomba';

    if (/\.zip$/i.test(e.nombre)) {
      if (profundidad + 1 > lim.maxProfundidad) { salida.omitidas.push({ ruta, motivo: 'profundidad' }); continue; }
      const interno: ResultadoZip = { entradas: [], omitidas: [], rechazado: null };
      const motivo = leerNivel(datos, profundidad + 1, ctx, interno);
      // Un zip anidado malicioso rechaza TODO: quien esconde una bomba adentro no merece que se lea lo demás.
      if (motivo) return motivo;
      hijos.push(...interno.entradas);
      salida.omitidas.push(...interno.omitidas);
      continue;
    }
    hijos.push({ nombre: nombreBase(e.nombre), ruta, bytes: datos, profundidad });
  }
  salida.entradas.push(...hijos);
  return null;
}

/**
 * Lee un zip con todos los límites. NUNCA lanza: cualquier problema es un `rechazado` (zip entero) o una
 * entrada en `omitidas`. Si `rechazado` no es null, `entradas` viene VACÍO.
 */
export function leerZipSeguro(bytes: Uint8Array, limites: Partial<LimitesZip> = {}): ResultadoZip {
  const lim = { ...LIMITES_ZIP, ...limites };
  const salida: ResultadoZip = { entradas: [], omitidas: [], rechazado: null };
  try {
    const buf = aBuffer(bytes);
    if (!pareceZip(buf)) { salida.rechazado = 'no_es_zip'; return salida; }
    const motivo = leerNivel(buf, 0, { lim, bytesTotales: 0, entradasVistas: 0 }, salida);
    if (motivo) return { entradas: [], omitidas: salida.omitidas, rechazado: motivo };
    return salida;
  } catch {
    return { entradas: [], omitidas: salida.omitidas, rechazado: 'corrupto' };
  }
}
