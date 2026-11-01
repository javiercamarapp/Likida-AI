// CSV SEGURO — la guarda anti-inyección de fórmulas (CWE-1236, OWASP «CSV injection») en UN solo lugar.
//
// Una celda de TEXTO que empieza con `=`, `+`, `-`, `@`, tabulador o retorno de carro la evalúa Excel/Sheets/LibreOffice como
// FÓRMULA al abrir el archivo (`=HYPERLINK("http://…")`, `=cmd|'/c calc'!A1`). Quien controla ese texto (un CFDI ajeno, el
// nombre de un operador, un renglón de un archivo subido) controlaría una fórmula en la máquina de quien descarga el CSV.
// Se neutraliza anteponiendo `'`, el patrón estándar. Un NÚMERO (`typeof v === 'number'`) nunca se toca: un total negativo
// legítimo sigue siendo número y no un texto «protegido».
//
// El repo ya traía esta guarda en varios exportadores, cada uno con su copia. Este módulo es la copia única para los nuevos;
// `csv_guarda_global.test.ts` falla si algún serializador de CSV del repo no aplica ninguna guarda.

/** Primer carácter que vuelve fórmula a una celda de texto. */
export const INICIO_FORMULA = /^[=+\-@\t\r]/;

/** Un texto que ya es un número plano («-12.50», «340»): Excel lo lee como número, no como fórmula. */
const ENTERO_PLANO = /^-?\d+$/;
const DECIMAL_PLANO = /^-?\d+\.\d+$/;
const esNumeroPlano = (s: string): boolean => ENTERO_PLANO.test(s) || DECIMAL_PLANO.test(s);

export interface OpcionesNeutralizar {
  /** Deja intacto un texto que es solo un número plano (importes ya formateados como texto, p. ej. `toFixed(2)`). */
  numerosEnTexto?: boolean;
}

/** El texto de una celda con la fórmula neutralizada. `null`/`undefined` → ''. Los números no se tocan. */
export function neutralizarFormula(v: unknown, opciones: OpcionesNeutralizar = {}): string {
  const s = v === null || v === undefined ? '' : String(v);
  if (typeof v === 'number') return s;
  if (!INICIO_FORMULA.test(s)) return s;
  if (opciones.numerosEnTexto && esNumeroPlano(s)) return s;
  return `'${s}`;
}

export interface OpcionesCeldaCsv extends OpcionesNeutralizar {
  /** Separador del archivo (la celda se entrecomilla si lo contiene). Por omisión «,». */
  separador?: string;
  /** Entrecomilla SIEMPRE (RFC 4180 estricto). Por omisión, solo cuando hace falta. */
  siempreComillas?: boolean;
}

/** Una celda lista para el archivo: fórmula neutralizada y comillas RFC 4180 cuando hay separador, comillas o saltos de línea. */
export function celdaCsvSegura(v: unknown, opciones: OpcionesCeldaCsv = {}): string {
  const { separador = ',', siempreComillas = false, ...neutralizar } = opciones;
  const s = neutralizarFormula(v, neutralizar);
  const necesita = siempreComillas || s.includes(separador) || s.includes('"') || s.includes('\n') || s.includes('\r');
  return necesita ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Una fila: celdas seguras unidas por el separador. */
export function filaCsvSegura(valores: readonly unknown[], opciones: OpcionesCeldaCsv = {}): string {
  return valores.map((v) => celdaCsvSegura(v, opciones)).join(opciones.separador ?? ',');
}
