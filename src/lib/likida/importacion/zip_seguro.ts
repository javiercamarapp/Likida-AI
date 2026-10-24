// ═══════════════════════════════════════════════════════════════════════════
// PRE-VALIDACIÓN DE UN .xlsx ANTES DE DESCOMPRIMIRLO (A37-S45-09).
//
// `sheetRows` corta el recorrido de FILAS, pero SheetJS descomprime la hoja y
// las cadenas compartidas COMPLETAS antes de parsear: un .xlsx de 4 MB que se
// expande ~1000:1 agota la memoria de la función. El tope de 4 MB es sobre el
// archivo comprimido, así que no ayuda.
//
// Un .xlsx es un zip. Su directorio central declara el tamaño descomprimido de
// cada parte SIN descomprimir nada; se suma y se rechaza lo que pase de un tope
// razonable. Es una barrera barata, no una garantía total (un zip mentiroso
// puede declarar menos): por eso el tope de filas sigue en su sitio.
//
// Un archivo que NO es zip (CSV, .xls binario) pasa sin tocarse.
// ═══════════════════════════════════════════════════════════════════════════

/** Suma de tamaños descomprimidos declarados, como máximo. Una plantilla real de
 *  2,000 filas pesa unos cientos de KB descomprimida. */
export const MAX_DESCOMPRIMIDO_BYTES = 64 * 1024 * 1024;
/** Una sola parte (la hoja o las cadenas compartidas), como máximo. */
export const MAX_PARTE_BYTES = 48 * 1024 * 1024;
/** Cuántas partes puede declarar el zip. Un libro normal trae decenas. */
export const MAX_PARTES = 2_000;
/** Máxima razón descomprimido/comprimido aceptada en una parte grande. */
const RAZON_MAX = 200;
const PARTE_CHICA = 1024 * 1024;

export class ArchivoPeligroso extends Error {}

/** Lanza `ArchivoPeligroso` si el zip declara una expansión desmedida. */
export function validarZipDeLibro(buffer: ArrayBuffer): void {
  const v = new DataView(buffer);
  const n = buffer.byteLength;
  // Firma local de zip «PK\x03\x04». Si no es zip, no hay nada que validar aquí.
  if (n < 22 || v.getUint32(0, true) !== 0x04034b50) return;

  // Fin del directorio central: se busca hacia atrás (comentario ≤ 65,535 bytes).
  let eocd = -1;
  for (let i = n - 22; i >= Math.max(0, n - 22 - 65_535); i--) {
    if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new ArchivoPeligroso('El archivo parece un zip dañado: no se pudo leer su directorio.');

  const partes = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  if (partes > MAX_PARTES) throw new ArchivoPeligroso('El archivo trae demasiadas partes internas para ser un Excel normal.');

  let total = 0;
  for (let k = 0; k < partes; k++) {
    if (p + 46 > n || v.getUint32(p, true) !== 0x02014b50) {
      throw new ArchivoPeligroso('El archivo parece un zip dañado: su directorio está incompleto.');
    }
    const comprimido = v.getUint32(p + 20, true);
    const real = v.getUint32(p + 24, true);
    // 0xFFFFFFFF = zip64: el tamaño verdadero no está aquí, y un libro de 4 MB no lo necesita.
    if (real === 0xffffffff || comprimido === 0xffffffff) {
      throw new ArchivoPeligroso('El archivo usa un formato zip demasiado grande para un Excel normal.');
    }
    if (real > MAX_PARTE_BYTES) throw new ArchivoPeligroso('Una parte del Excel se descomprimiría a un tamaño desmedido.');
    if (real > PARTE_CHICA && real / Math.max(1, comprimido) > RAZON_MAX) {
      throw new ArchivoPeligroso('El Excel se descomprimiría a un tamaño desmedido para lo que pesa.');
    }
    total += real;
    if (total > MAX_DESCOMPRIMIDO_BYTES) throw new ArchivoPeligroso('El Excel se descomprimiría a un tamaño desmedido.');
    p += 46 + v.getUint16(p + 28, true) + v.getUint16(p + 30, true) + v.getUint16(p + 32, true);
  }
}
