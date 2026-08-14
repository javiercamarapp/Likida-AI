import { leerCifraImportada, leerFechaImportada } from '../importar_viajes';

// ═══════════════════════════════════════════════════════════════════════════
// LECTOR GENÉRICO DE DESGLOSES DE PEAJE (kit del PoC, 14-ago-2026).
//
// El "martirio" de Transportes Innovativos llega como archivo del proveedor
// de peaje cada ~10 días: filas de cruces con fecha, caseta, importe y tag.
// Este módulo es el ANDAMIAJE puro: detecta las columnas por nombre y
// normaliza cada fila. Se calibra el día 1 del PoC contra el archivo REAL
// del proveedor (una lista de encabezados nueva = una línea aquí) — lo que
// NO se hace es adivinar un formato que no hemos visto.
//
// La integración a la conciliación (cruce contra viajes/casetas) es la fase
// siguiente y depende del archivo real; este módulo deja listo el 80% de
// los días 1–2 prometidos en la propuesta.
// ═══════════════════════════════════════════════════════════════════════════

export interface LineaDesglose {
  /** ISO AAAA-MM-DD del cruce, o null si el archivo no la trae. */
  fecha: string | null;
  caseta: string;
  monto: number;
  /** El identificador del TAG/unidad tal como venga, o null. */
  tag: string | null;
  /** 1-based en el archivo — para poder señalar la fila exacta al cliente. */
  fila: number;
}

export interface LecturaDesglose {
  lineas: LineaDesglose[];
  descartadas: Array<{ fila: number; motivo: string }>;
  error?: string;
}

/** Encabezados vistos en desgloses reales (IAVE/PASE/TeleVía/convenios).
 *  Minúsculas y sin acentos; agregar el del proveedor del PoC = una línea. */
const COLUMNAS: Record<'fecha' | 'caseta' | 'monto' | 'tag', string[]> = {
  fecha: ['fecha', 'fecha de cruce', 'fecha cruce', 'fecha y hora', 'fecha hora', 'fecha de paso'],
  caseta: ['caseta', 'plaza', 'plaza de cobro', 'caseta de cobro', 'tramo', 'descripcion', 'concepto', 'punto de cobro'],
  monto: ['importe', 'monto', 'total', 'tarifa', 'costo', 'importe mxn', 'importe total'],
  tag: ['tag', 'no tag', 'no. tag', 'numero de tag', 'id tag', 'dispositivo', 'economico', 'unidad'],
};

function normalizar(v: unknown): string {
  return String(v ?? '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * La matriz cruda (fila 0 = encabezados) → líneas de cruce normalizadas.
 * PURA. Sin columna de importe no hay lectura: un desglose sin montos no
 * concilia nada, y adivinar cuál columna era el dinero es el error caro.
 */
export function interpretarDesglose(matriz: unknown[][]): LecturaDesglose {
  if (!matriz.length) return { lineas: [], descartadas: [], error: 'El archivo está vacío.' };

  const encabezados = matriz[0].map(normalizar);
  const indice: Partial<Record<keyof typeof COLUMNAS, number>> = {};
  for (const clave of Object.keys(COLUMNAS) as Array<keyof typeof COLUMNAS>) {
    const i = encabezados.findIndex((e) => COLUMNAS[clave].includes(e));
    if (i >= 0) indice[clave] = i;
  }
  if (indice.monto === undefined) {
    return {
      lineas: [], descartadas: [],
      error: `No encontré la columna del importe. Encabezados leídos: ${matriz[0].map((c) => `«${String(c ?? '')}»`).join(', ')}. Manda el archivo tal cual y agregamos su encabezado al lector.`,
    };
  }
  if (indice.caseta === undefined) {
    return {
      lineas: [], descartadas: [],
      error: 'No encontré la columna de la caseta/plaza. Manda el archivo tal cual y agregamos su encabezado al lector.',
    };
  }

  const lineas: LineaDesglose[] = [];
  const descartadas: Array<{ fila: number; motivo: string }> = [];

  for (let f = 1; f < matriz.length && f <= 5000; f++) {
    const fila = matriz[f];
    if (!fila || fila.every((c) => c === null || c === undefined || String(c).trim() === '')) continue;

    const celda = (clave: keyof typeof COLUMNAS): unknown =>
      indice[clave] === undefined ? null : fila[indice[clave] as number];

    const monto = leerCifraImportada(celda('monto'));
    if (monto === null || monto === 'ilegible') {
      descartadas.push({ fila: f + 1, motivo: monto === null ? 'sin importe' : 'importe ilegible' });
      continue;
    }
    const fecha = leerFechaImportada(celda('fecha'));
    if (fecha === 'ilegible') {
      descartadas.push({ fila: f + 1, motivo: 'fecha ilegible' });
      continue;
    }
    const caseta = String(celda('caseta') ?? '').trim().slice(0, 120);
    if (!caseta) {
      descartadas.push({ fila: f + 1, motivo: 'sin caseta' });
      continue;
    }

    lineas.push({
      fecha,
      caseta,
      monto,
      tag: String(celda('tag') ?? '').trim().slice(0, 60) || null,
      fila: f + 1,
    });
  }

  if (matriz.length - 1 > 5000) {
    return { lineas, descartadas, error: 'El archivo trae más de 5,000 filas — se leyeron las primeras 5,000. Pártelo y sube el resto aparte.' };
  }
  return { lineas, descartadas };
}
