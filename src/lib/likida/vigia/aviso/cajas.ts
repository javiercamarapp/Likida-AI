// Importador del catálogo de cajas (T-A4-10).
//
// Función pura: recibe el texto de un CSV (número, línea, placas, estado) y devuelve las cajas listas para guardar en
// `vigia_caja` (migración 0796) más el reporte de lo que se descartó o se dejó sin dato. No lee red ni base.
//  - Número de caja es TEXTO (trim, mayúsculas, espacios internos colapsados): se conservan ceros a la izquierda y letras.
//  - Nunca se inventa un dato: placas o estado dudosos quedan en `null` con un aviso, y la caja se conserva.
//  - Una caja repetida (mismo número sin importar mayúsculas) se queda con el primer renglón; los demás se descartan.
//  - El reporte tiene tope: no crece sin límite con un archivo malo y nunca repite el contenido completo del renglón.

export const ESTADOS_CAJA = ['vacia', 'cargada', 'en_patio', 'en_transito', 'desconocido'] as const;
export type EstadoCaja = (typeof ESTADOS_CAJA)[number];

/** Misma forma que el CHECK de la 0796 (`vigia_caja_placas_forma`). */
export const FORMA_PLACAS = /^[A-Z0-9-]{3,12}$/;
export const TOPE_FILAS_CAJAS = 5000;
export const TOPE_AVISOS_CAJAS = 200;
const LARGO_MAX_NUMERO = 40;
const LARGO_MAX_LINEA = 40;
const LARGO_MAX_ORIGINAL = 60;

export interface CajaCatalogo {
  numero: string;
  linea: string | null;
  placas: string | null;
  estado: EstadoCaja | null;
  lineaCsv: number;
}

export type CodigoAvisoCaja =
  | 'numero_vacio'
  | 'numero_muy_largo'
  | 'duplicado'
  | 'placas_invalidas'
  | 'estado_fuera_de_dominio'
  | 'linea_muy_larga'
  | 'tope_de_filas';

export interface AvisoCaja {
  lineaCsv: number | null;
  codigo: CodigoAvisoCaja;
  mensaje: string;
  /** Texto original de la celda (recortado) para que la persona lo revise; vacío si no aplica. */
  original: string;
}

export interface CajaDescartada {
  lineaCsv: number;
  motivo: 'numero_vacio' | 'numero_muy_largo' | 'duplicado' | 'tope_de_filas';
}

export interface ResultadoCajas {
  cajas: CajaCatalogo[];
  descartadas: CajaDescartada[];
  avisos: AvisoCaja[];
  /** Avisos que no cupieron en `avisos` por el tope. */
  avisosOmitidos: number;
  /** Renglones de datos leídos (sin encabezado ni renglones en blanco). */
  filasLeidas: number;
}

export class ErrorCatalogoCajas extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'ErrorCatalogoCajas';
  }
}

function sinAcentos(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function clave(s: string): string {
  return sinAcentos(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Clave de unicidad de una caja: la misma que el índice `vigia_caja_numero_uq` (lower(btrim(numero))). */
export function claveCaja(numero: string): string {
  return numero.trim().toLowerCase();
}

/** Número de caja normalizado: trim, espacios internos colapsados y mayúsculas. Vacío → ''. */
export function normalizarNumeroCaja(crudo: string): string {
  return crudo.replace(/\s+/g, ' ').trim().toUpperCase();
}

/** Placas normalizadas (mayúsculas, sin espacios). Devuelve null si no tienen la forma válida. */
export function normalizarPlacas(crudo: string): string | null {
  const p = crudo.replace(/\s+/g, '').toUpperCase();
  return FORMA_PLACAS.test(p) ? p : null;
}

const SINONIMOS_ESTADO: Record<string, EstadoCaja> = {
  vacia: 'vacia',
  vacio: 'vacia',
  cargada: 'cargada',
  cargado: 'cargada',
  llena: 'cargada',
  lleno: 'cargada',
  'en patio': 'en_patio',
  patio: 'en_patio',
  'en transito': 'en_transito',
  transito: 'en_transito',
  'en ruta': 'en_transito',
  desconocido: 'desconocido',
  'no se sabe': 'desconocido',
};

/** Estado de caja normalizado, o null si el texto no es de ningún estado conocido. */
export function normalizarEstadoCaja(crudo: string): EstadoCaja | null {
  return SINONIMOS_ESTADO[clave(crudo)] ?? null;
}

type Columna = 'numero' | 'linea' | 'placas' | 'estado';
const ENCABEZADOS: Record<string, Columna> = {
  numero: 'numero',
  'numero de caja': 'numero',
  'no de caja': 'numero',
  'no caja': 'numero',
  caja: 'numero',
  linea: 'linea',
  'linea transportista': 'linea',
  placas: 'placas',
  placa: 'placas',
  'placas de la caja': 'placas',
  'placas caja': 'placas',
  estado: 'estado',
  estatus: 'estado',
  'estado de la caja': 'estado',
  'estado caja': 'estado',
};

/** Divide un CSV en renglones de celdas respetando comillas (con saltos de línea y "" escapadas). */
function partirCsv(texto: string, delim: string): { celdas: string[]; linea: number }[] {
  const filas: { celdas: string[]; linea: number }[] = [];
  let celdas: string[] = [];
  let celda = '';
  let enComillas = false;
  let linea = 1;
  let lineaInicio = 1;
  const cerrarCelda = () => {
    celdas.push(celda);
    celda = '';
  };
  const cerrarFila = () => {
    cerrarCelda();
    filas.push({ celdas, linea: lineaInicio });
    celdas = [];
  };
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (enComillas) {
      if (c === '"') {
        if (texto[i + 1] === '"') {
          celda += '"';
          i++;
        } else enComillas = false;
      } else {
        if (c === '\n') linea++;
        celda += c;
      }
      continue;
    }
    if (c === '"' && celda === '') enComillas = true;
    else if (c === delim) cerrarCelda();
    else if (c === '\r') continue;
    else if (c === '\n') {
      cerrarFila();
      linea++;
      lineaInicio = linea;
    } else celda += c;
  }
  if (celda !== '' || celdas.length > 0) cerrarFila();
  return filas;
}

function recortar(s: string): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > LARGO_MAX_ORIGINAL ? `${t.slice(0, LARGO_MAX_ORIGINAL)}…` : t;
}

export interface OpcionesCajas {
  topeFilas?: number;
}

export function importarCatalogoCajas(textoCrudo: string, opciones: OpcionesCajas = {}): ResultadoCajas {
  const topeFilas = opciones.topeFilas ?? TOPE_FILAS_CAJAS;
  const texto = textoCrudo.charCodeAt(0) === 0xfeff ? textoCrudo.slice(1) : textoCrudo;
  if (texto.replace(/[;,\s"]/g, '') === '') {
    throw new ErrorCatalogoCajas('El archivo está vacío: no trae ninguna caja.');
  }
  const primera = texto.split('\n', 1)[0] ?? '';
  const delim = (primera.match(/;/g)?.length ?? 0) > (primera.match(/,/g)?.length ?? 0) ? ';' : ',';
  const renglones = partirCsv(texto, delim);

  // Encabezado: el primer renglón no vacío debe nombrar la columna del número de caja.
  const idxEnc = renglones.findIndex((r) => r.celdas.some((c) => c.trim() !== ''));
  const enc = renglones[idxEnc];
  const columnas: (Columna | null)[] = enc.celdas.map((c) => ENCABEZADOS[clave(c)] ?? null);
  if (!columnas.includes('numero')) {
    throw new ErrorCatalogoCajas(
      'No encontré la columna del número de caja. La primera fila debe llamarla «Número», «Número de caja» o «Caja».',
    );
  }
  const col = (nombre: Columna) => columnas.indexOf(nombre);
  const iNumero = col('numero');
  const iLinea = col('linea');
  const iPlacas = col('placas');
  const iEstado = col('estado');

  const cajas: CajaCatalogo[] = [];
  const descartadas: CajaDescartada[] = [];
  const avisos: AvisoCaja[] = [];
  let avisosOmitidos = 0;
  let filasLeidas = 0;
  let avisoTope = false;
  const vistas = new Set<string>();

  const avisar = (a: AvisoCaja) => {
    if (avisos.length < TOPE_AVISOS_CAJAS) avisos.push(a);
    else avisosOmitidos++;
  };
  const celda = (r: string[], i: number) => (i >= 0 ? (r[i] ?? '') : '');

  for (const { celdas, linea } of renglones.slice(idxEnc + 1)) {
    if (celdas.every((c) => c.trim() === '')) continue;
    if (filasLeidas >= topeFilas) {
      descartadas.push({ lineaCsv: linea, motivo: 'tope_de_filas' });
      if (!avisoTope) {
        avisoTope = true;
        avisar({
          lineaCsv: linea,
          codigo: 'tope_de_filas',
          mensaje: `El archivo pasa de ${topeFilas} cajas; las siguientes no se leyeron. Divídelo en partes.`,
          original: '',
        });
      }
      continue;
    }
    filasLeidas++;

    const numero = normalizarNumeroCaja(celda(celdas, iNumero));
    if (numero === '') {
      descartadas.push({ lineaCsv: linea, motivo: 'numero_vacio' });
      avisar({ lineaCsv: linea, codigo: 'numero_vacio', mensaje: 'El renglón no trae número de caja; se descartó.', original: '' });
      continue;
    }
    if (numero.length > LARGO_MAX_NUMERO) {
      descartadas.push({ lineaCsv: linea, motivo: 'numero_muy_largo' });
      avisar({
        lineaCsv: linea,
        codigo: 'numero_muy_largo',
        mensaje: `El número de caja pasa de ${LARGO_MAX_NUMERO} caracteres; se descartó el renglón.`,
        original: recortar(numero),
      });
      continue;
    }
    const k = claveCaja(numero);
    if (vistas.has(k)) {
      descartadas.push({ lineaCsv: linea, motivo: 'duplicado' });
      avisar({
        lineaCsv: linea,
        codigo: 'duplicado',
        mensaje: `La caja ${numero} ya venía antes en el archivo; se conservó el primer renglón.`,
        original: recortar(numero),
      });
      continue;
    }
    vistas.add(k);

    let lineaTransp: string | null = celda(celdas, iLinea).replace(/\s+/g, ' ').trim().toUpperCase() || null;
    if (lineaTransp !== null && lineaTransp.length > LARGO_MAX_LINEA) {
      avisar({
        lineaCsv: linea,
        codigo: 'linea_muy_larga',
        mensaje: `La línea de la caja ${numero} pasa de ${LARGO_MAX_LINEA} caracteres; se dejó sin línea.`,
        original: recortar(lineaTransp),
      });
      lineaTransp = null;
    }

    const placasCrudas = celda(celdas, iPlacas);
    let placas: string | null = null;
    if (placasCrudas.trim() !== '') {
      placas = normalizarPlacas(placasCrudas);
      if (placas === null) {
        avisar({
          lineaCsv: linea,
          codigo: 'placas_invalidas',
          mensaje: `Las placas de la caja ${numero} no tienen forma de placas (3 a 12 letras, números o guiones); se dejó sin placas.`,
          original: recortar(placasCrudas),
        });
      }
    }

    const estadoCrudo = celda(celdas, iEstado);
    let estado: EstadoCaja | null = null;
    if (estadoCrudo.trim() !== '') {
      estado = normalizarEstadoCaja(estadoCrudo);
      if (estado === null) {
        avisar({
          lineaCsv: linea,
          codigo: 'estado_fuera_de_dominio',
          mensaje: `El estado de la caja ${numero} no es uno conocido (${ESTADOS_CAJA.join(', ')}); se dejó sin estado.`,
          original: recortar(estadoCrudo),
        });
      }
    }

    cajas.push({ numero, linea: lineaTransp, placas, estado, lineaCsv: linea });
  }

  return { cajas, descartadas, avisos, avisosOmitidos, filasLeidas };
}
