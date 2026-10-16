// Guía de texto llano y linter de jerga (T-INS-04).
// Se usa en pruebas sobre lo que produce `componer()`; NO corre en el runtime del usuario.
// Deterministas, sin dependencias. Todo texto de ejemplo aquí es sintético.

import type { Insight } from './tipos';

export const MAX_CARACTERES_LINEA = 140;

export type CampoTexto = 'quePaso' | 'queSignifica' | 'queHacer' | 'texto';

export type CodigoHallazgo =
  | 'termino-vetado'
  | 'acusacion-sin-tarifario'
  | 'error-a-secas'
  | 'sigla-sin-explicar'
  | 'linea-larga'
  | 'varias-ideas'
  | 'sin-verbo-de-accion';

export interface Hallazgo {
  campo: CampoTexto;
  codigo: CodigoHallazgo;
  /** Fragmento o término que disparó el hallazgo. */
  termino: string;
  /** Qué decir en su lugar. */
  sustituto: string;
  /** Línea (1-based) dentro del campo. */
  linea: number;
}

export interface TerminoVetado {
  /** Expresión sobre texto SIN acentos y en minúsculas. */
  patron: RegExp;
  etiqueta: string;
  sustituto: string;
}

/** Términos técnicos que el usuario de la flota no tiene por qué conocer. */
export const TERMINOS_VETADOS: readonly TerminoVetado[] = [
  { patron: /\bocr\b/, etiqueta: 'OCR', sustituto: 'leer el documento' },
  { patron: /\bendpoints?\b/, etiqueta: 'endpoint', sustituto: 'conexión' },
  { patron: /\bpayloads?\b/, etiqueta: 'payload', sustituto: 'datos enviados' },
  { patron: /\bidempotentes?\b/, etiqueta: 'idempotente', sustituto: 'que no se repite aunque se envíe dos veces' },
  { patron: /\bconcili\w*/, etiqueta: 'conciliar', sustituto: 'comparar' },
  { patron: /\befos\b/, etiqueta: 'EFOS', sustituto: 'proveedor en la lista del SAT de operaciones dudosas' },
  { patron: /\bwebhooks?\b/, etiqueta: 'webhook', sustituto: 'aviso automático' },
  { patron: /\bjson\b/, etiqueta: 'JSON', sustituto: 'archivo de datos' },
  { patron: /\bparse\w*/, etiqueta: 'parsear', sustituto: 'leer' },
  { patron: /\btimeouts?\b/, etiqueta: 'timeout', sustituto: 'se acabó el tiempo de espera' },
  { patron: /\bdashboards?\b/, etiqueta: 'dashboard', sustituto: 'panel' },
];

/** «Cobro indebido/ilegal»: solo se puede decir con un tarifario que lo demuestre. */
const ACUSACION = /\bcobros?\s+(indebid\w+|ilegal\w*|fraudulent\w+)/;
const MENCIONA_TARIFARIO = /\btarifario\b/;

/** Siglas que cualquier persona de la operación entiende sin explicación. */
export const SIGLAS_PERMITIDAS: ReadonlySet<string> = new Set([
  'PDF',
  'XML',
  'GPS',
  'IVA',
  'RFC',
  'MXN',
  'USD',
  'SAT',
  'CFDI',
]);

const SIGLA = /(?<![\p{L}\d])[A-ZÁÉÍÓÚÑ]{2,6}(?![\p{L}\d])/gu;
/** «error» sin decir de qué: se acepta «error de/en/al/del ...». */
const ERROR_SECO = /\berror(?:es)?\b(?!\s+(?:de|del|en|al|por|que)\b)/;

const sinAcentos = (s: string): string =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const lineasDe = (s: string): string[] => s.split('\n');

/** Una sigla queda explicada si aparece «SIGLA (…)» o «(…SIGLA…)» cerca de un paréntesis. */
function siglaExplicada(sigla: string, texto: string): boolean {
  const e = sigla.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`${e}\\s*\\(|\\([^)]*\\b${e}\\b[^)]*\\)`).test(texto);
}

function variasIdeas(linea: string): boolean {
  if (linea.includes(';')) return true;
  // Más de una oración: «.», «!» o «?» seguido de espacio y mayúscula (no decimales ni abreviaturas de número).
  return /[.!?]\s+[A-ZÁÉÍÓÚÑ¿¡]/.test(linea.trim().replace(/\.$/, ''));
}

/** Revisa un texto (varias líneas) y devuelve los hallazgos; `[]` si es llano. */
export function revisarTexto(texto: string, campo: CampoTexto = 'texto'): Hallazgo[] {
  const hallazgos: Hallazgo[] = [];
  const completo = texto;
  lineasDe(texto).forEach((linea, i) => {
    const n = i + 1;
    const plano = sinAcentos(linea);
    const agregar = (h: Omit<Hallazgo, 'campo' | 'linea'>): void => {
      hallazgos.push({ campo, linea: n, ...h });
    };

    for (const t of TERMINOS_VETADOS) {
      if (t.patron.test(plano)) {
        agregar({ codigo: 'termino-vetado', termino: t.etiqueta, sustituto: t.sustituto });
      }
    }
    if (ACUSACION.test(plano) && !MENCIONA_TARIFARIO.test(sinAcentos(completo))) {
      agregar({
        codigo: 'acusacion-sin-tarifario',
        termino: plano.match(ACUSACION)![0],
        sustituto: 'candidato a revisar contra el tarifario',
      });
    }
    if (ERROR_SECO.test(plano)) {
      agregar({ codigo: 'error-a-secas', termino: 'error', sustituto: 'decir qué falló, por ejemplo «falta un dato» o «no coincide»' });
    }
    for (const m of linea.matchAll(SIGLA)) {
      const sigla = m[0];
      if (SIGLAS_PERMITIDAS.has(sigla) || siglaExplicada(sigla, completo)) continue;
      agregar({ codigo: 'sigla-sin-explicar', termino: sigla, sustituto: `explicar «${sigla}» entre paréntesis o usar el nombre completo` });
    }
    if (linea.length > MAX_CARACTERES_LINEA) {
      agregar({ codigo: 'linea-larga', termino: `${linea.length} caracteres`, sustituto: `partir en líneas de máximo ${MAX_CARACTERES_LINEA} caracteres` });
    }
    if (variasIdeas(linea)) {
      agregar({ codigo: 'varias-ideas', termino: linea.trim().slice(0, 40), sustituto: 'una idea por línea' });
    }
  });
  return hallazgos;
}

/** Verbo en infinitivo (revisar, enviar, pedir) al inicio de «qué hacer». */
const INFINITIVO = /^[a-záéíóúñü]{2,}(ar|er|ir)$/;
const SIN_ACCION_VALIDO = /^(nada|no hace falta|no hay nada)\b/;

export function revisarQueHacer(texto: string): Hallazgo[] {
  const hallazgos = revisarTexto(texto, 'queHacer');
  lineasDe(texto).forEach((linea, i) => {
    const t = linea.trim();
    if (t === '') return;
    const primera = sinAcentos(t).replace(/^[«"'¿¡(\s]+/, '').split(/\s+/)[0] ?? '';
    const inicio = sinAcentos(t);
    if (INFINITIVO.test(primera) || SIN_ACCION_VALIDO.test(inicio)) return;
    hallazgos.push({
      campo: 'queHacer',
      codigo: 'sin-verbo-de-accion',
      termino: primera,
      sustituto: 'empezar con un verbo en infinitivo: Revisar, Enviar, Pedir…',
      linea: i + 1,
    });
  });
  return hallazgos;
}

/** Revisa las tres líneas de un insight; pensado para pruebas sobre `componer()`. */
export function revisarInsight(insight: Pick<Insight, 'quePaso' | 'queSignifica' | 'queHacer'>): Hallazgo[] {
  return [
    ...revisarTexto(insight.quePaso, 'quePaso'),
    ...revisarTexto(insight.queSignifica, 'queSignifica'),
    ...revisarQueHacer(insight.queHacer),
  ];
}
