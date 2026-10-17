import * as XLSX from 'xlsx';
import type { CostoViaje } from './costo_viaje';

// ═══════════════════════════════════════════════════════════════════════════
// T-A2-22 — EL ARCHIVO «CASETAS LIGADAS A VIAJE» Y SUS EXCEPCIONES.
//
// Entrega para el dueño (requisito: «un archivo con casetas ligadas a viaje
// válidas… y casetas no encontradas… que serían mis excepciones»). Tres hojas:
//   · Ligadas   — el cruce tiene su viaje (folio).
//   · Sin viaje — no se encontró viaje (sin_viaje, sin_unidad) o la línea aún no
//                 tiene vínculo calculado («sin calcular»): son las EXCEPCIONES.
//   · Ambiguas  — dos o más viajes posibles (ambiguo) o datos que se contradicen
//                 (conflicto): una persona decide, el sistema no adivina.
// Sin TAG en el archivo (el perfil solo necesita la unidad).
//
// PURO: sin base, sin red, sin fechas de creación (mismo insumo = mismo archivo).
// Los textos que vienen del proveedor se escriben como TEXTO, jamás como fórmula.
// ═══════════════════════════════════════════════════════════════════════════

export const HOJAS_VINCULOS = ['Ligadas', 'Sin viaje', 'Ambiguas'] as const;

export const LEYENDA_DIA_DE_VIAJE = 'ligado por día de viaje, no por hora';

export const ENCABEZADOS_VINCULOS = [
  'Fecha', 'Hora', 'Unidad', 'Caseta', 'Clase', 'Importe', 'Folio de viaje', 'Vía', 'Estado',
  // T-A2-23: lo que cuesta el viaje al que está ligado el cruce (solo filas ligadas).
  'Costo del viaje', 'Cruces ligados del viaje', 'Costo del viaje: detalle y fuente', 'Nota',
] as const;

/** Una línea del desglose, con lo que el archivo muestra. */
export interface LineaParaVinculos {
  id: string;
  fecha: string | null;
  hora: string | null;
  unidad: string | null;
  caseta: string | null;
  clase: number | null;
  importe: number;
}

/** El vínculo guardado de una línea (forma de `peaje_cruce_viaje`). */
export interface VinculoParaArchivo {
  lineaId: string;
  estado: 'ligado' | 'ambiguo' | 'sin_viaje' | 'sin_unidad' | 'conflicto';
  viajeId: string | null;
  via: 'icident' | 'unidad_ventana';
  candidatos: readonly string[];
  motivo?: string | null;
}

export interface FilaVinculo {
  lineaId: string;
  fecha: string | null;
  hora: string | null;
  unidad: string | null;
  caseta: string | null;
  clase: number | null;
  importe: number;
  /** Ligada: el folio del viaje. Ambigua: los folios candidatos. Sin viaje: vacío. */
  folioViaje: string;
  via: string;
  estado: string;
  nota: string;
  /** T-A2-23, solo filas ligadas: suma de los cruces ligados del viaje (null = sin costo calculado). */
  costoViaje: number | null;
  crucesViaje: number | null;
  detalleCosto: string;
}

export interface ArchivoVinculos {
  ligadas: FilaVinculo[];
  sinViaje: FilaVinculo[];
  ambiguas: FilaVinculo[];
}

const ESTADO_SIN_CALCULAR = 'sin calcular';

/**
 * Reparte las líneas del desglose en las tres hojas. Solo cuentan los vínculos de líneas de ESTE
 * desglose (uno ajeno se ignora); toda línea sin vínculo cae en «Sin viaje» como «sin calcular»,
 * para que ninguna se pierda. Conserva el orden de las líneas.
 */
export function armarVinculos(
  lineas: readonly LineaParaVinculos[], vinculos: readonly VinculoParaArchivo[], foliosPorViaje: ReadonlyMap<string, string>,
  costos?: ReadonlyMap<string, CostoViaje>,
): ArchivoVinculos {
  const porLinea = new Map(vinculos.map((v) => [v.lineaId, v]));
  const folio = (id: string | null) => (id ? foliosPorViaje.get(id) ?? '' : '');
  const r: ArchivoVinculos = { ligadas: [], sinViaje: [], ambiguas: [] };

  for (const l of lineas) {
    const v = porLinea.get(l.id);
    const base = {
      lineaId: l.id, fecha: l.fecha, hora: l.hora, unidad: l.unidad, caseta: l.caseta, clase: l.clase, importe: l.importe,
      costoViaje: null, crucesViaje: null, detalleCosto: '',
    };
    if (!v) {
      r.sinViaje.push({ ...base, folioViaje: '', via: '', estado: ESTADO_SIN_CALCULAR, nota: 'Aún no se calcula el vínculo de esta línea con un viaje.' });
      continue;
    }
    const fila = (folioViaje: string, nota: string): FilaVinculo => ({ ...base, folioViaje, via: v.via, estado: v.estado, nota });
    if (v.estado === 'ligado') {
      const f = fila(folio(v.viajeId), v.via === 'unidad_ventana' ? LEYENDA_DIA_DE_VIAJE : '');
      const c = v.viajeId ? costos?.get(v.viajeId) : undefined;
      if (c) { f.costoViaje = c.costo; f.crucesViaje = c.cruces; f.detalleCosto = detalleDeCosto(c); }
      r.ligadas.push(f);
    } else if (v.estado === 'ambiguo' || v.estado === 'conflicto') {
      r.ambiguas.push(fila(v.candidatos.map((c) => folio(c)).filter((f) => f !== '').join(', '), v.motivo ?? ''));
    } else {
      r.sinViaje.push(fila('', v.motivo ?? ''));
    }
  }
  return r;
}

const pesos = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** El detalle en lenguaje llano de un viaje: casetas, candidatos, ambiguos y la referencia (rotulada, nunca tarifa). */
export function detalleDeCosto(c: CostoViaje): string {
  const partes = [`${c.casetasDistintas} caseta(s) distinta(s)`];
  if (c.candidatos !== null) partes.push(`${c.candidatos} candidato(s) a reclamación`);
  if (c.ambiguos > 0) partes.push(`${c.ambiguos} cruce(s) ambiguo(s) que NO suman`);
  const ref = c.referencia;
  if (ref?.aplica && ref.mediana !== null && ref.desviacion !== null) {
    const pct = ref.desviacionPct === null ? '' : ` (${ref.desviacionPct > 0 ? '+' : ''}${ref.desviacionPct}%)`;
    partes.push(`${ref.rotulo}: ${pesos(ref.mediana)} con ${ref.nViajes} viajes; este viaje ${ref.desviacion >= 0 ? '+' : '−'}${pesos(Math.abs(ref.desviacion))}${pct}`);
  } else if (ref) {
    partes.push(`sin ${ref.rotulo}: ${ref.motivo}`);
  }
  return `${partes.join(' · ')}. Fuente: ${c.fuente}.`;
}

type Celda = string | number | null;

/** Excel evalúa como fórmula el texto que empieza con = + - @: se neutraliza con un apóstrofo visible. */
const texto = (v: string | null | undefined): string => {
  const s = v ?? '';
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
};

const filaDe = (f: FilaVinculo): Celda[] => [
  f.fecha, f.hora, texto(f.unidad), texto(f.caseta), f.clase, f.importe, texto(f.folioViaje), f.via, f.estado,
  f.costoViaje, f.crucesViaje, texto(f.detalleCosto), texto(f.nota),
];

function hoja(filas: readonly FilaVinculo[]): XLSX.WorkSheet {
  const h = XLSX.utils.aoa_to_sheet([[...ENCABEZADOS_VINCULOS], ...filas.map(filaDe)]);
  for (let i = 0; i < filas.length; i++) {
    for (const c of [5, 9]) {
      const celda = h[XLSX.utils.encode_cell({ r: 1 + i, c })];
      if (celda && celda.t === 'n') celda.z = '#,##0.00';
    }
  }
  h['!cols'] = [12, 9, 14, 30, 8, 12, 22, 16, 14, 14, 12, 60, 44].map((wch) => ({ wch }));
  h['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(filas.length, 1), c: ENCABEZADOS_VINCULOS.length - 1 } }) };
  return h;
}

/** El libro de tres hojas con filtro automático. Las tres existen siempre, aunque estén vacías. */
export function vinculosAExcel(a: ArchivoVinculos): Uint8Array {
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, hoja(a.ligadas), HOJAS_VINCULOS[0]);
  XLSX.utils.book_append_sheet(libro, hoja(a.sinViaje), HOJAS_VINCULOS[1]);
  XLSX.utils.book_append_sheet(libro, hoja(a.ambiguas), HOJAS_VINCULOS[2]);
  return new Uint8Array(XLSX.write(libro, { type: 'array', bookType: 'xlsx', compression: true }) as ArrayBuffer);
}
