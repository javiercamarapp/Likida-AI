// ═══════════════════════════════════════════════════════════════════════════
// Lee el .txt de un .zip de «Exportar chat» sin dependencias (el repo no trae un lector de zip).
//
// Solo lo necesario: directorio central, métodos 0 (almacenado) y 8 (deflate), y el primer `.txt`. Es entrada de un usuario
// externo, así que cada tamaño está acotado: un zip que declara millones de entradas o que descomprime a cientos de MB
// (zip bomb) se rechaza; `maxOutputLength` corta la descompresión en el propio zlib, sin confiar en el tamaño declarado.
// ═══════════════════════════════════════════════════════════════════════════
import { inflateRawSync } from 'node:zlib';

export const MAX_ZIP_BYTES = 25 * 1024 * 1024;
export const MAX_TXT_BYTES = 20 * 1024 * 1024;
const MAX_ENTRADAS = 2_000;

export type ResultadoZip = { ok: true; texto: string; nombre: string } | { ok: false; error: string };

/** ¿Los primeros bytes son los de un zip («PK\x03\x04», o el EOCD de un zip vacío)? */
export function esZip(b: Uint8Array): boolean {
  return b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && (b[2] === 3 || b[2] === 5) && (b[3] === 4 || b[3] === 6);
}

export function textoDeZip(bytes: Uint8Array): ResultadoZip {
  if (bytes.length > MAX_ZIP_BYTES) return { ok: false, error: 'El archivo .zip es demasiado grande.' };
  const buf = Buffer.concat([bytes]);
  // EOCD: firma 0x06054b50, a lo más 65,557 bytes antes del final.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65_535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return { ok: false, error: 'El .zip está dañado (sin directorio central).' };
  const total = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  if (total > MAX_ENTRADAS) return { ok: false, error: 'El .zip trae demasiados archivos.' };

  for (let n = 0; n < total; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) return { ok: false, error: 'El .zip está dañado (directorio central).' };
    const metodo = buf.readUInt16LE(p + 10);
    const tamComprimido = buf.readUInt32LE(p + 20);
    const lNombre = buf.readUInt16LE(p + 28); const lExtra = buf.readUInt16LE(p + 30); const lComentario = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const nombre = buf.subarray(p + 46, p + 46 + lNombre).toString('utf8');
    p += 46 + lNombre + lExtra + lComentario;
    // El .txt de la conversación; se ignoran carpetas, medios y archivos de macOS.
    if (!/\.txt$/i.test(nombre) || /(^|\/)(__MACOSX|\.)/.test(nombre)) continue;

    if (local + 30 > buf.length || buf.readUInt32LE(local) !== 0x04034b50) return { ok: false, error: 'El .zip está dañado (entrada local).' };
    const ini = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    if (ini + tamComprimido > buf.length) return { ok: false, error: 'El .zip está dañado (entrada truncada).' };
    const datos = buf.subarray(ini, ini + tamComprimido);
    try {
      let crudo: Buffer;
      if (metodo === 0) crudo = datos;
      else if (metodo === 8) crudo = inflateRawSync(datos, { maxOutputLength: MAX_TXT_BYTES });
      else return { ok: false, error: 'El .zip usa una compresión que no se puede leer.' };
      if (crudo.length > MAX_TXT_BYTES) return { ok: false, error: 'El chat exportado es demasiado grande.' };
      return { ok: true, texto: crudo.toString('utf8'), nombre };
    } catch {
      return { ok: false, error: 'El chat exportado es demasiado grande o está dañado.' };
    }
  }
  return { ok: false, error: 'El .zip no trae el archivo .txt del chat.' };
}
