import { createHash } from 'node:crypto';

// ═══════════════════════════════════════════════════════════════════════════
// PAQUETE DE EXPORTACIÓN DE UNA FLOTA — F9, CT-DAT-16. PURO (sin red ni base): recibe las filas ya leídas y arma archivos JSON Lines
// con su huella SHA-256 y un manifiesto que lista cada archivo. La huella del manifiesto es lo que se guarda en `tenant_exportacion`
// (0998); quien recibe el paquete la recalcula y comprueba que nada cambió.
//
// SECRETOS: toda columna cuyo nombre parezca secreto (token, llave, hash, cifrado, credencial…) se OMITE y el manifiesto lo dice.
// ═══════════════════════════════════════════════════════════════════════════

const NOMBRE_SECRETO = /(token|secret|llave|password|passwd|hash|cifrad|credencial|apikey|api_key|clave)/i;

export function columnaSecreta(nombre: string): boolean {
  return NOMBRE_SECRETO.test(nombre);
}

export type LecturaTabla =
  | { tabla: string; filas: Array<Record<string, unknown>>; truncada?: boolean }
  | { tabla: string; error: string };

export interface ArchivoPaquete {
  nombre: string;
  contenido: string;
  sha256: string;
  filas: number;
}

export interface EntradaManifiesto {
  tabla: string;
  archivo: string | null;
  estado: 'ok' | 'error' | 'truncada';
  filas: number;
  sha256: string | null;
  columnas_omitidas: string[];
  error?: string;
}

export interface Manifiesto {
  version: 1;
  tenant_id: string;
  generado_en: string;
  completo: boolean;
  filas_total: number;
  archivos: EntradaManifiesto[];
}

export interface Paquete {
  archivos: ArchivoPaquete[];
  manifiesto: Manifiesto;
  /** El manifiesto serializado tal cual se hashea (estable). */
  manifiestoJson: string;
  huellaManifiesto: string;
}

export function sha256(texto: string): string {
  return createHash('sha256').update(texto, 'utf8').digest('hex');
}

export function armarPaquete(tenantId: string, lecturas: LecturaTabla[], ahora: Date = new Date()): Paquete {
  const archivos: ArchivoPaquete[] = [];
  const entradas: EntradaManifiesto[] = [];
  let filasTotal = 0;
  for (const l of [...lecturas].sort((a, b) => a.tabla.localeCompare(b.tabla))) {
    if ('error' in l) {
      entradas.push({ tabla: l.tabla, archivo: null, estado: 'error', filas: 0, sha256: null, columnas_omitidas: [], error: l.error });
      continue;
    }
    const omitidas = new Set<string>();
    const lineas = l.filas.map((f) => {
      const limpia: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(f)) {
        if (columnaSecreta(k)) { omitidas.add(k); continue; }
        limpia[k] = v;
      }
      return JSON.stringify(limpia);
    });
    const contenido = lineas.length ? lineas.join('\n') + '\n' : '';
    const nombre = `${l.tabla}.jsonl`;
    const huella = sha256(contenido);
    archivos.push({ nombre, contenido, sha256: huella, filas: lineas.length });
    filasTotal += lineas.length;
    entradas.push({
      tabla: l.tabla, archivo: nombre, estado: l.truncada ? 'truncada' : 'ok', filas: lineas.length, sha256: huella,
      columnas_omitidas: [...omitidas].sort(),
    });
  }
  const manifiesto: Manifiesto = {
    version: 1, tenant_id: tenantId, generado_en: ahora.toISOString(),
    completo: entradas.every((e) => e.estado === 'ok'), filas_total: filasTotal, archivos: entradas,
  };
  const manifiestoJson = JSON.stringify(manifiesto);
  return { archivos, manifiesto, manifiestoJson, huellaManifiesto: sha256(manifiestoJson) };
}

/** Lo que hace quien recibe el paquete: recalcula todo y devuelve las discrepancias (vacío = íntegro). */
export function verificarPaquete(
  archivos: Array<{ nombre: string; contenido: string }>,
  manifiestoJson: string,
  huellaEsperada: string,
): string[] {
  const problemas: string[] = [];
  if (sha256(manifiestoJson) !== huellaEsperada) problemas.push('la huella del manifiesto no coincide');
  let m: Manifiesto;
  try { m = JSON.parse(manifiestoJson) as Manifiesto; } catch { return [...problemas, 'el manifiesto no es JSON']; }
  const porNombre = new Map(archivos.map((a) => [a.nombre, a.contenido]));
  for (const e of m.archivos) {
    if (!e.archivo) continue;
    const c = porNombre.get(e.archivo);
    if (c === undefined) { problemas.push(`falta el archivo ${e.archivo}`); continue; }
    if (sha256(c) !== e.sha256) problemas.push(`el archivo ${e.archivo} cambió`);
    const filas = c === '' ? 0 : c.split('\n').filter(Boolean).length;
    if (filas !== e.filas) problemas.push(`el archivo ${e.archivo} tiene ${filas} filas y el manifiesto dice ${e.filas}`);
  }
  for (const a of archivos) if (!m.archivos.some((e) => e.archivo === a.nombre)) problemas.push(`archivo ajeno al manifiesto: ${a.nombre}`);
  return problemas;
}
