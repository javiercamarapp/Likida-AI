import { normalizarNombre, normalizarTag, type Celda } from './formatos';

// ═══════════════════════════════════════════════════════════════════════════
// TAG ↔ UNIDAD — alta masiva por CSV.
//
//   tag;unidad;proveedor
//   IMDM 12345678;C2-08;PASE
//
// «unidad» es el número económico o las placas (como la flota llama a su
// camión). Todo el módulo es PURO: valida el CSV y lo resuelve contra la lista
// de unidades que el llamador trae. El I/O vive en `datos.ts`.
//
// Hostil a propósito: un TAG que aparece con DOS unidades distintas en el mismo
// archivo se rechaza (las dos filas) — no se elige una; un TAG que no se puede
// normalizar, o una unidad que no existe (o que casa con más de una), se
// rechaza con su motivo y su fila.
// ═══════════════════════════════════════════════════════════════════════════

export const TOPE_TAGS_IMPORTACION = 5_000;

export interface TagImportado {
  fila: number;
  tag: string;
  tagOriginal: string;
  unidadRef: string;
  proveedor: string | null;
}

export interface LecturaTags {
  tags: TagImportado[];
  rechazadas: Array<{ fila: number; motivo: string }>;
  error?: string;
}

const COLS: Record<'tag' | 'unidad' | 'proveedor', string[]> = {
  tag: ['tag', 'no tag', 'no. tag', 'numero de tag', 'id tag', 'dispositivo', 'telepeaje', 'etiqueta'],
  unidad: ['unidad', 'economico', 'numero economico', 'no economico', 'no. economico', 'numero_economico', 'placas', 'placa', 'camion'],
  proveedor: ['proveedor', 'emisor', 'operador de telepeaje'],
};

export function parsearTagsMatriz(matriz: Celda[][]): LecturaTags {
  const vacio: LecturaTags = { tags: [], rechazadas: [] };
  if (matriz.length === 0) return { ...vacio, error: 'El archivo está vacío.' };
  const enc = matriz[0].map(normalizarNombre);
  const idx: Partial<Record<keyof typeof COLS, number>> = {};
  for (const k of Object.keys(COLS) as Array<keyof typeof COLS>) {
    const i = enc.findIndex((e) => COLS[k].includes(e));
    if (i >= 0) idx[k] = i;
  }
  const faltan = (['tag', 'unidad'] as const).filter((k) => idx[k] === undefined);
  if (faltan.length > 0) {
    return {
      ...vacio,
      error: `Faltan columnas: ${faltan.join(', ')}. Encabezados leídos: ${matriz[0].map((c) => `«${String(c ?? '').trim()}»`).join(', ')}. `
        + 'El CSV necesita: tag y unidad (número económico o placas); proveedor es opcional.',
    };
  }
  if (matriz.length - 1 > TOPE_TAGS_IMPORTACION) {
    return { ...vacio, error: `El archivo trae más de ${TOPE_TAGS_IMPORTACION} TAGs. Pártelo y súbelo en partes.` };
  }

  const tags: TagImportado[] = [];
  const rechazadas: Array<{ fila: number; motivo: string }> = [];
  for (let f = 1; f < matriz.length; f++) {
    const fila = matriz[f];
    if (!fila || fila.every((c) => String(c ?? '').trim() === '')) continue;
    const n = f + 1;
    const tagOriginal = String(fila[idx.tag as number] ?? '').trim();
    const tag = normalizarTag(tagOriginal);
    if (!tag) { rechazadas.push({ fila: n, motivo: 'el TAG está vacío o no es un identificador válido (4 a 40 letras/dígitos)' }); continue; }
    const unidadRef = String(fila[idx.unidad as number] ?? '').trim();
    if (!unidadRef) { rechazadas.push({ fila: n, motivo: 'sin unidad' }); continue; }
    const proveedor = idx.proveedor === undefined ? null : (String(fila[idx.proveedor] ?? '').trim().slice(0, 60) || null);
    tags.push({ fila: n, tag, tagOriginal: tagOriginal.slice(0, 60), unidadRef, proveedor });
  }

  // Un mismo TAG con dos unidades distintas dentro del archivo: se rechazan las
  // dos filas (y todas las que repitan ese TAG con otra unidad).
  const porTag = new Map<string, Set<string>>();
  for (const t of tags) {
    const s = porTag.get(t.tag) ?? new Set<string>();
    s.add(normalizarNombre(t.unidadRef));
    porTag.set(t.tag, s);
  }
  const conflictivos = new Set([...porTag.entries()].filter(([, s]) => s.size > 1).map(([t]) => t));
  const limpios: TagImportado[] = [];
  const vistos = new Set<string>();
  for (const t of tags) {
    if (conflictivos.has(t.tag)) {
      rechazadas.push({ fila: t.fila, motivo: 'el mismo TAG aparece con unidades distintas en el archivo — no se elige una' });
    } else if (vistos.has(t.tag)) {
      // Repetido con la MISMA unidad: inocuo, se ignora la repetición.
      continue;
    } else {
      vistos.add(t.tag);
      limpios.push(t);
    }
  }
  rechazadas.sort((a, b) => a.fila - b.fila);
  return { tags: limpios, rechazadas };
}

export interface UnidadRef { id: string; numeroEconomico: string; placas: string | null }

/** Casa cada fila con UNA unidad (por número económico y, si no, por placas). */
export function resolverUnidadesDeTags(
  tags: readonly TagImportado[],
  unidades: readonly UnidadRef[],
): { altas: Array<TagImportado & { unidadId: string }>; rechazadas: Array<{ fila: number; motivo: string }> } {
  const porEco = new Map<string, UnidadRef[]>();
  const porPlaca = new Map<string, UnidadRef[]>();
  const meter = (m: Map<string, UnidadRef[]>, k: string, u: UnidadRef) => {
    if (!k) return;
    const l = m.get(k) ?? [];
    l.push(u);
    m.set(k, l);
  };
  for (const u of unidades) {
    meter(porEco, normalizarNombre(u.numeroEconomico), u);
    meter(porPlaca, normalizarNombre(u.placas), u);
  }
  const altas: Array<TagImportado & { unidadId: string }> = [];
  const rechazadas: Array<{ fila: number; motivo: string }> = [];
  for (const t of tags) {
    const ref = normalizarNombre(t.unidadRef);
    const e = porEco.get(ref) ?? [];
    const candidatas = e.length > 0 ? e : (porPlaca.get(ref) ?? []);
    if (candidatas.length === 0) rechazadas.push({ fila: t.fila, motivo: `la unidad «${t.unidadRef}» no existe en la flota (revisa el número económico o las placas)` });
    else if (candidatas.length > 1) rechazadas.push({ fila: t.fila, motivo: `«${t.unidadRef}» corresponde a más de una unidad — usa el número económico` });
    else altas.push({ ...t, unidadId: candidatas[0].id });
  }
  return { altas, rechazadas };
}
