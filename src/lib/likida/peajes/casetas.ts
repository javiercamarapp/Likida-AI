import { normalizarNombre, type Celda } from './formatos';

// ═══════════════════════════════════════════════════════════════════════════
// EL CATÁLOGO DE CASETAS — importador por CSV y resolución de nombres.
//
// NO se siembra con coordenadas: no hay catálogo oficial verificado en el repo
// y una coordenada inventada acusaría a un chofer con un dato de mentira. La
// flota (o Likida, con el shapefile del IMT cuando se cargue) sube su CSV:
//
//   nombre;lat;lng;radio_m;alias;fuente;por_pasada
//   Caseta Ejemplo Norte;19.4326;-99.1332;300;Ejemplo N|Ej. Norte;captura propia;no
//
// LAS COORDENADAS SON OPCIONALES (T-A2-05). Una caseta vive por NOMBRE (+ alias):
// sin coordenadas se resuelve igual contra el desglose del proveedor y solo la
// evidencia GPS queda en «sin datos» para ella. Una fila trae las dos coordenadas
// o ninguna; con una sola se rechaza.
//
// Este módulo es PURO: valida el CSV fila por fila y resuelve el nombre que
// trae el proveedor contra el catálogo. El I/O vive en `datos.ts`.
// ═══════════════════════════════════════════════════════════════════════════

/** Caja de México (con margen): fuera de ella una coordenada es casi seguro un error de captura. */
export const CAJA_MEXICO = { latMin: 14, latMax: 33.5, lngMin: -119, lngMax: -86 } as const;
export const RADIO_DEFAULT_M = 300;
export const TOPE_CASETAS_IMPORTACION = 5_000;

export interface CasetaImportada {
  fila: number;
  nombre: string;
  nombreNorm: string;
  alias: string[];
  /** null = la fila no trae coordenadas (caseta conocida solo por nombre). Siempre las dos o ninguna. */
  lat: number | null;
  lng: number | null;
  radioM: number;
  fuente: string | null;
  /** true/false si el archivo trae la columna; undefined = no la trae (no se pisa lo ya guardado). */
  porPasada?: boolean;
}

export interface LecturaCasetas {
  casetas: CasetaImportada[];
  rechazadas: Array<{ fila: number; motivo: string }>;
  error?: string;
}

const COLS: Record<'nombre' | 'lat' | 'lng' | 'radio' | 'alias' | 'fuente' | 'porPasada', string[]> = {
  nombre: ['nombre', 'caseta', 'plaza', 'nombre de la caseta', 'nombre de la plaza'],
  lat: ['lat', 'latitud', 'latitude', 'y'],
  lng: ['lng', 'lon', 'long', 'longitud', 'longitude', 'x'],
  radio: ['radio', 'radio m', 'radio_m', 'radio metros', 'radio en metros'],
  alias: ['alias', 'otros nombres', 'sinonimos'],
  fuente: ['fuente', 'origen', 'referencia'],
  porPasada: ['por pasada', 'por_pasada', 'tarifa por pasada', 'tarifa_por_pasada'],
};

/** «si», «sí», «true», «1», «x» → true; «no», «false», «0» → false; vacío o raro → null. */
function booleanoDeCelda(v: Celda): boolean | null {
  const s = normalizarNombre(String(v ?? ''));
  if (['si', 'true', '1', 'x', 'verdadero'].includes(s)) return true;
  if (['no', 'false', '0', 'falso'].includes(s)) return false;
  return null;
}

/** «19.43», «19,43» (coma decimal), « -99.13 » → número, o null. */
export function coordenadaDeCelda(v: Celda): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v ?? '').trim().replace(',', '.');
  if (s.length > 30) return null;
  // eslint-disable-next-line security/detect-unsafe-regex -- entrada acotada a una celda; un solo cuantificador opcional
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function validarCoordenadasMexico(lat: number, lng: number): string | null {
  const { latMin, latMax, lngMin, lngMax } = CAJA_MEXICO;
  const dentro = (la: number, ln: number) => la >= latMin && la <= latMax && ln >= lngMin && ln <= lngMax;
  if (dentro(lat, lng)) return null;
  if (dentro(lng, lat)) return 'latitud y longitud parecen invertidas';
  return 'las coordenadas caen fuera de México — revisa que sean grados decimales (ej. 19.4326 y -99.1332)';
}

export function parsearCasetasMatriz(matriz: Celda[][]): LecturaCasetas {
  const vacio: LecturaCasetas = { casetas: [], rechazadas: [] };
  if (matriz.length === 0) return { ...vacio, error: 'El archivo está vacío.' };

  const enc = matriz[0].map(normalizarNombre);
  const idx: Partial<Record<keyof typeof COLS, number>> = {};
  for (const k of Object.keys(COLS) as Array<keyof typeof COLS>) {
    const i = enc.findIndex((e) => COLS[k].includes(e));
    if (i >= 0) idx[k] = i;
  }
  // Solo el nombre es obligatorio. Las coordenadas son opcionales, pero un archivo con UNA sola de las
  // dos columnas es un error de captura (se pediría una mitad de la coordenada): se avisa cuál falta.
  const faltan = (['nombre'] as const).filter((k) => idx[k] === undefined);
  if ((idx.lat === undefined) !== (idx.lng === undefined)) faltan.push(...((idx.lat === undefined ? ['lat'] : ['lng']) as never[]));
  if (faltan.length > 0) {
    return {
      ...vacio,
      error: `Faltan columnas: ${faltan.join(', ')}. Encabezados leídos: ${matriz[0].map((c) => `«${String(c ?? '').trim()}»`).join(', ')}. `
        + 'El CSV necesita: nombre (y opcionales lat y lng —las dos juntas—, radio_m, alias, fuente, por_pasada).',
    };
  }
  if (matriz.length - 1 > TOPE_CASETAS_IMPORTACION) {
    return { ...vacio, error: `El archivo trae más de ${TOPE_CASETAS_IMPORTACION} casetas. Pártelo y súbelo en partes.` };
  }

  const casetas: CasetaImportada[] = [];
  const rechazadas: Array<{ fila: number; motivo: string }> = [];
  const vistos = new Map<string, number>();
  for (let f = 1; f < matriz.length; f++) {
    const fila = matriz[f];
    if (!fila || fila.every((c) => String(c ?? '').trim() === '')) continue;
    const n = f + 1; // fila 1-based como la ve el usuario en su Excel
    const celda = (k: keyof typeof COLS) => (idx[k] === undefined ? undefined : fila[idx[k] as number]);

    const nombre = String(celda('nombre') ?? '').trim().replace(/\s+/g, ' ');
    if (!nombre) { rechazadas.push({ fila: n, motivo: 'sin nombre' }); continue; }
    if (nombre.length > 120) { rechazadas.push({ fila: n, motivo: 'nombre de más de 120 caracteres' }); continue; }
    const nombreNorm = normalizarNombre(nombre);
    if (!nombreNorm) { rechazadas.push({ fila: n, motivo: 'el nombre no tiene letras ni dígitos' }); continue; }

    const vacia = (k: 'lat' | 'lng') => String(celda(k) ?? '').trim() === '';
    let lat: number | null = null;
    let lng: number | null = null;
    if (idx.lat !== undefined && !(vacia('lat') && vacia('lng'))) {
      if (vacia('lat') !== vacia('lng')) {
        rechazadas.push({ fila: n, motivo: `trae solo ${vacia('lat') ? 'la longitud' : 'la latitud'}: captura las dos coordenadas o deja ambas vacías` });
        continue;
      }
      lat = coordenadaDeCelda(celda('lat'));
      lng = coordenadaDeCelda(celda('lng'));
      if (lat === null || lng === null) { rechazadas.push({ fila: n, motivo: 'latitud o longitud ilegible' }); continue; }
      const fuera = validarCoordenadasMexico(lat, lng);
      if (fuera) { rechazadas.push({ fila: n, motivo: fuera }); continue; }
    }

    let radioM = RADIO_DEFAULT_M;
    const radioCrudo = celda('radio');
    if (radioCrudo !== undefined && String(radioCrudo).trim() !== '') {
      const r = coordenadaDeCelda(radioCrudo);
      if (r === null || !Number.isInteger(Math.round(r)) || r < 50 || r > 5000) {
        rechazadas.push({ fila: n, motivo: 'radio fuera de rango (50 a 5,000 metros)' });
        continue;
      }
      radioM = Math.round(r);
    }

    const previa = vistos.get(nombreNorm);
    if (previa !== undefined) {
      rechazadas.push({ fila: n, motivo: `nombre repetido en el archivo (ya estaba en la fila ${previa})` });
      continue;
    }
    vistos.set(nombreNorm, n);

    const alias = String(celda('alias') ?? '')
      .split(/[|;]/)
      .map((a) => a.trim())
      .filter((a) => a !== '' && normalizarNombre(a) !== nombreNorm)
      .slice(0, 10);
    const fuente = String(celda('fuente') ?? '').trim().slice(0, 200) || null;
    const porPasada = idx.porPasada === undefined ? undefined : (booleanoDeCelda(celda('porPasada')) ?? false);
    casetas.push({ fila: n, nombre, nombreNorm, alias, lat, lng, radioM, fuente, ...(porPasada === undefined ? {} : { porPasada }) });
  }
  return { casetas, rechazadas };
}

// ── Resolución del nombre del proveedor contra el catálogo ──────────────────

export interface CasetaCatalogo {
  id: string;
  nombre: string;
  nombreNorm: string;
  alias: string[];
  /** null = caseta conocida solo por nombre (sin coordenadas): no entra al cruce GPS. */
  lat: number | null;
  lng: number | null;
  radioM: number;
}

export type ResolucionCaseta =
  | { tipo: 'unica'; caseta: CasetaCatalogo; por: 'nombre' | 'alias' | 'contiene' }
  | { tipo: 'ambigua'; candidatas: string[] }
  | { tipo: 'ninguna' };

function contienePalabras(texto: string, buscada: string): boolean {
  if (buscada.length < 4) return false;
  return (` ${texto} `).includes(` ${buscada} `);
}

/**
 * Casa el nombre que trae el desglose con UNA caseta del catálogo.
 * Orden: nombre exacto → alias exacto → el texto de la línea CONTIENE el nombre
 * (o un alias) como palabras completas. Dos casetas distintas en el mismo nivel
 * = ambigua: no se adivina (la línea queda sin evidencia espacial).
 */
export function resolverCaseta(nombreLinea: string | null, catalogo: readonly CasetaCatalogo[]): ResolucionCaseta {
  const norm = normalizarNombre(nombreLinea);
  if (!norm) return { tipo: 'ninguna' };

  const exactas = catalogo.filter((c) => c.nombreNorm === norm);
  if (exactas.length === 1) return { tipo: 'unica', caseta: exactas[0], por: 'nombre' };
  if (exactas.length > 1) return { tipo: 'ambigua', candidatas: exactas.map((c) => c.nombre) };

  const porAlias = catalogo.filter((c) => c.alias.some((a) => normalizarNombre(a) === norm));
  if (porAlias.length === 1) return { tipo: 'unica', caseta: porAlias[0], por: 'alias' };
  if (porAlias.length > 1) return { tipo: 'ambigua', candidatas: porAlias.map((c) => c.nombre) };

  const contiene = catalogo.filter((c) =>
    contienePalabras(norm, c.nombreNorm) || c.alias.some((a) => contienePalabras(norm, normalizarNombre(a))));
  if (contiene.length === 1) return { tipo: 'unica', caseta: contiene[0], por: 'contiene' };
  if (contiene.length > 1) {
    // Si una contiene a las otras («tlalpan» ⊂ «tlalpan norte») gana la más específica
    // SOLO si el nombre de la línea la contiene completa; si no, es ambigua.
    const maxLargo = Math.max(...contiene.map((c) => c.nombreNorm.length));
    const largas = contiene.filter((c) => c.nombreNorm.length === maxLargo);
    if (largas.length === 1 && contiene.every((c) => largas[0].nombreNorm.includes(c.nombreNorm))) {
      return { tipo: 'unica', caseta: largas[0], por: 'contiene' };
    }
    return { tipo: 'ambigua', candidatas: contiene.map((c) => c.nombre) };
  }
  return { tipo: 'ninguna' };
}
