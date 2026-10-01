import { normalizarNombre, type Celda } from './formatos';

// ═══════════════════════════════════════════════════════════════════════════
// EL MAPEO DE COLUMNAS POR PROVEEDOR — para los formatos que el lector no
// reconoce solo.
//
// El lector detecta las columnas por NOMBRE (intake/desglose_peaje.ts). Eso
// alcanza para los encabezados vistos; el archivo REAL de PASE no está en el
// repo, así que cuando llegue con otros encabezados la salida correcta no es
// adivinar ni editar código: es declarar, una vez por proveedor, qué
// encabezado (o letra de columna) es cada cosa. Esta pieza es PURA: valida la
// declaración, la resuelve contra la fila de encabezados y, cuando no
// resuelve, dice exactamente qué encabezados leyó y cuáles se parecen a lo
// que faltó — como SUGERENCIA, nunca como lectura.
// ═══════════════════════════════════════════════════════════════════════════

export const CAMPOS_MAPEO = ['fecha', 'hora', 'caseta', 'monto', 'tag'] as const;
export type CampoMapeo = (typeof CAMPOS_MAPEO)[number];

/** Cada valor es el ENCABEZADO (sin importar mayúsculas, acentos ni signos) o la
 *  LETRA de la columna («C», «AB»). `hora` y `tag` son opcionales. */
export interface ConfigMapeo {
  fecha: string;
  caseta: string;
  monto: string;
  hora?: string;
  tag?: string;
}

export interface ColumnasMapeadas {
  fecha: number;
  caseta: number;
  monto: number;
  hora?: number;
  tag?: number;
}

const OBLIGATORIOS: ReadonlyArray<Exclude<CampoMapeo, 'hora' | 'tag'>> = ['fecha', 'caseta', 'monto'];
const LARGO_MAX = 80;

/** La declaración que llega de un formulario o de la base → un ConfigMapeo limpio, o el motivo. */
export function validarMapeo(x: unknown): { ok: true; mapeo: ConfigMapeo } | { ok: false; motivo: string } {
  if (x === null || typeof x !== 'object' || Array.isArray(x)) {
    return { ok: false, motivo: 'El mapeo debe ser un objeto con las columnas del archivo.' };
  }
  const o = x as Record<string, unknown>;
  const limpio: Partial<Record<CampoMapeo, string>> = {};
  for (const campo of CAMPOS_MAPEO) {
    const v = o[campo];
    if (v === undefined || v === null || String(v).trim() === '') continue;
    if (typeof v !== 'string') return { ok: false, motivo: `La columna de ${campo} debe ser texto (un encabezado o una letra).` };
    const t = v.trim();
    if (t.length > LARGO_MAX) return { ok: false, motivo: `La columna de ${campo} es demasiado larga (máximo ${LARGO_MAX} caracteres).` };
    limpio[campo] = t;
  }
  const faltan = OBLIGATORIOS.filter((c) => !limpio[c]);
  if (faltan.length > 0) {
    return { ok: false, motivo: `Falta declarar la columna de ${faltan.join(', ')}. Son obligatorias: sin ellas el cruce no puede afirmar nada.` };
  }
  const usados = new Map<string, CampoMapeo>();
  for (const campo of CAMPOS_MAPEO) {
    const v = limpio[campo];
    if (!v) continue;
    const llave = normalizarNombre(v);
    const previo = usados.get(llave);
    if (previo) return { ok: false, motivo: `La misma columna («${v}») no puede ser a la vez ${previo} y ${campo}.` };
    usados.set(llave, campo);
  }
  return { ok: true, mapeo: limpio as ConfigMapeo };
}

/** «A»→0, «Z»→25, «AA»→26. null si no es una letra de columna. */
export function indiceDeLetra(s: string): number | null {
  const t = s.trim().toUpperCase();
  if (!/^[A-Z]{1,2}$/.test(t)) return null;
  let n = 0;
  for (const ch of t) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function indiceDeColumna(valor: string, encabezados: readonly string[], largo: number): number | null {
  const norm = normalizarNombre(valor);
  const porNombre = encabezados.findIndex((e) => e !== '' && e === norm);
  if (porNombre >= 0) return porNombre;
  // La letra solo cuenta si NINGÚN encabezado se llama así: una columna rotulada
  // «ID» o «TAG» es por nombre, no la columna 8 o 19.
  const letra = indiceDeLetra(valor);
  if (letra !== null && letra < largo) return letra;
  return null;
}

/** Resuelve el mapeo contra UNA fila de encabezados. */
export function resolverMapeo(
  encabezados: readonly Celda[],
  mapeo: ConfigMapeo,
): { ok: true; columnas: ColumnasMapeadas } | { ok: false; noEncontradas: Array<{ campo: CampoMapeo; declarada: string }> } {
  const norm = encabezados.map(normalizarNombre);
  const columnas: Partial<ColumnasMapeadas> = {};
  const noEncontradas: Array<{ campo: CampoMapeo; declarada: string }> = [];
  for (const campo of CAMPOS_MAPEO) {
    const declarada = mapeo[campo];
    if (!declarada) continue;
    const i = indiceDeColumna(declarada, norm, encabezados.length);
    if (i === null) noEncontradas.push({ campo, declarada });
    else columnas[campo] = i;
  }
  if (noEncontradas.length > 0) return { ok: false, noEncontradas };
  // Dos campos en la misma columna = el mapeo apunta mal.
  const indices = Object.values(columnas) as number[];
  if (new Set(indices).size !== indices.length) {
    return { ok: false, noEncontradas: [{ campo: 'monto', declarada: 'dos campos apuntan a la misma columna' }] };
  }
  return { ok: true, columnas: columnas as ColumnasMapeadas };
}

// ── Sugerencias para el mensaje de error ────────────────────────────────────

const SINONIMOS: Record<CampoMapeo, readonly string[]> = {
  fecha: ['fecha', 'dia', 'cruce', 'fecha cruce', 'fecha de cobro', 'fecha de paso', 'fecha y hora'],
  hora: ['hora', 'horario'],
  caseta: ['caseta', 'plaza', 'tramo', 'estacion', 'autopista', 'punto de cobro', 'plaza de cobro'],
  monto: ['importe', 'monto', 'total', 'cargo', 'costo', 'cuota', 'tarifa', 'peaje'],
  tag: ['tag', 'etiqueta', 'dispositivo', 'telepeaje', 'economico', 'unidad'],
};

function distancia(a: string, b: string): number {
  if (a === b) return 0;
  const fila = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let previo = fila[0];
    fila[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const temp = fila[j];
      fila[j] = Math.min(fila[j] + 1, fila[j - 1] + 1, previo + (a[i - 1] === b[j - 1] ? 0 : 1));
      previo = temp;
    }
  }
  return fila[b.length];
}

/**
 * Encabezados del archivo que SE PARECEN a lo que faltó (typos como «Improte»,
 * «Casetta», o una palabra del sinónimo dentro del encabezado). Solo para
 * ofrecérselo a un humano en el mensaje: el lector NO los usa solo.
 */
export function sugerirColumnas(campo: CampoMapeo, encabezados: readonly Celda[]): string[] {
  const sugeridos: string[] = [];
  for (const crudo of encabezados) {
    const e = normalizarNombre(crudo);
    if (!e) continue;
    const palabras = e.split(' ');
    const parecido = SINONIMOS[campo].some((s) => palabras.some((p) => p.length >= 4 && distancia(p, s) <= 2 && p !== s) || (distancia(e, s) <= 2 && e !== s));
    if (parecido) sugeridos.push(String(crudo).trim());
  }
  return [...new Set(sugeridos)].slice(0, 3);
}

/** Los encabezados leídos, para pegar en un mensaje: «A», «B»… con su letra. */
export function listarEncabezados(encabezados: readonly Celda[], max = 10): string {
  return encabezados
    .map((c, i) => ({ c: String(c ?? '').trim(), i }))
    .filter(({ c }) => c !== '')
    .slice(0, max)
    .map(({ c, i }) => `${letraDe(i)}=«${c}»`)
    .join(', ');
}

export function letraDe(i: number): string {
  return i < 26 ? String.fromCharCode(65 + i) : String.fromCharCode(64 + Math.floor(i / 26)) + String.fromCharCode(65 + (i % 26));
}
