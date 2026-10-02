// ═══════════════════════════════════════════════════════════════════════════
// LIQUIDACIÓN EXTERNA — EL FORMATO DE LA FLOTA.
//
// Hoy el chofer recibe «el formatito»: un Excel que la oficina arma a mano
// copiando y pegando lo que calculó su sistema. Este módulo describe ESE
// formato como datos (una plantilla configurable por flota) y sabe DERIVARLA
// de un Excel de muestra, para que Likida entregue la liquidación con el mismo
// aspecto sin que nadie copie y pegue.
//
// La plantilla NO calcula nada: solo decide qué columnas, con qué encabezado y
// en qué orden se imprimen las cifras que el cliente ya calculó (la regla de
// todo el módulo: se imprimen tal cual llegaron). Todo es PURO: no toca base ni
// red. El acceso a la tabla vive en `repo.ts`; el dibujo, en `render_formato.ts`.
//
// ── DERIVAR DE UNA MUESTRA, SIN ADIVINAR ────────────────────────────────────
//
// `derivarFormatoDeMatriz` busca la fila de encabezados (la que más columnas
// reconoce), mapea cada encabezado a un campo del catálogo CERRADO por su
// nombre (sin acentos ni mayúsculas) y lee lo que hay ARRIBA (título y pares
// «etiqueta: valor» como Operador, Periodo, Folio). Lo que no reconoce NO se
// inventa: queda en `sinMapear` y se le dice a la persona, que lo ajusta a
// mano antes de guardar. Una muestra sin fila de encabezados reconocible es un
// error con su motivo, no una plantilla vacía.
// ═══════════════════════════════════════════════════════════════════════════

import type { Celda } from '../peajes/formatos';

export const SALIDAS = ['pdf', 'xlsx'] as const;
export type SalidaFormato = (typeof SALIDAS)[number];
export const FECHAS = ['dmy', 'iso'] as const;
export type FechasFormato = (typeof FECHAS)[number];

/** Lo que se puede imprimir ARRIBA de la tabla (una vez por liquidación). */
export const CAMPOS_ENCABEZADO = ['operador', 'claveExterna', 'sistemaOrigen', 'periodo', 'desde', 'hasta', 'viajes', 'moneda', 'total', 'razonSocial'] as const;
export type CampoEncabezado = (typeof CAMPOS_ENCABEZADO)[number];

/** Lo que se puede imprimir en cada RENGLÓN (un concepto). */
export const CAMPOS_RENGLON = ['clave', 'descripcion', 'tipo', 'monto', 'montoFirmado', 'percepcion', 'deduccion'] as const;
export type CampoRenglon = (typeof CAMPOS_RENGLON)[number];

export const ETIQUETA_CAMPO_ENCABEZADO: Record<CampoEncabezado, string> = {
  operador: 'Operador', claveExterna: 'Folio', sistemaOrigen: 'Sistema', periodo: 'Periodo', desde: 'Del', hasta: 'Al',
  viajes: 'Viajes', moneda: 'Moneda', total: 'Total', razonSocial: 'Empresa',
};
export const ETIQUETA_CAMPO_RENGLON: Record<CampoRenglon, string> = {
  clave: 'Clave', descripcion: 'Concepto', tipo: 'Tipo', monto: 'Importe', montoFirmado: 'Importe neto', percepcion: 'Percepciones', deduccion: 'Deducciones',
};

export interface FormatoFlota {
  version: 1;
  /** Título que encabeza el documento (null = el nombre de la flota o «Liquidación»). */
  titulo: string | null;
  /** Qué documento viaja por WhatsApp. El otro queda disponible en el panel. */
  salida: SalidaFormato;
  fechas: FechasFormato;
  /** Pares etiqueta/valor sobre la tabla, en orden. */
  datos: Array<{ etiqueta: string; campo: CampoEncabezado }>;
  /** Columnas de la tabla de conceptos, en orden. */
  columnas: Array<{ encabezado: string; campo: CampoRenglon }>;
  /** La fila de cierre con el total que el cliente calculó. */
  total: { mostrar: boolean; etiqueta: string };
}

export const MAX_COLUMNAS = 10;
export const MAX_DATOS = 12;
const MAX_TEXTO = 80;
const MAX_TITULO = 120;

export class FormatoInvalido extends Error {
  constructor(public readonly campo: string, mensaje: string) {
    super(mensaje);
    this.name = 'FormatoInvalido';
  }
}

// ── normalización de texto ──────────────────────────────────────────────────

/** minúsculas, sin acentos, sin puntuación, espacios colapsados. */
export function normalizarTexto(v: unknown): string {
  return String(v ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

const sinControl = (s: string) => s.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();

function textoCorto(v: unknown, campo: string, max: number, vacioOk = false): string {
  if (typeof v !== 'string') throw new FormatoInvalido(campo, `\`${campo}\` tiene que ser texto.`);
  const t = sinControl(v);
  if (!t && !vacioOk) throw new FormatoInvalido(campo, `\`${campo}\` no puede ir vacío.`);
  if (t.length > max) throw new FormatoInvalido(campo, `\`${campo}\` admite hasta ${max} caracteres.`);
  return t;
}

// ── validación (estricta: lo desconocido se rechaza) ────────────────────────

const esObjeto = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * Valida una plantilla que viene de la persona (o del JSON guardado). Estricta:
 * un campo que no es del catálogo, una columna repetida o un texto largo se
 * rechazan diciendo cuál, y NUNCA se recortan en silencio.
 */
export function validarFormato(crudo: unknown): FormatoFlota {
  if (!esObjeto(crudo)) throw new FormatoInvalido('formato', 'El formato tiene que ser un objeto.');
  const permitidos = ['version', 'titulo', 'salida', 'fechas', 'datos', 'columnas', 'total'];
  const sobran = Object.keys(crudo).filter((k) => !permitidos.includes(k));
  if (sobran.length > 0) throw new FormatoInvalido(sobran[0], `El formato trae campos que no existen: ${sobran.map((s) => `\`${s}\``).join(', ')}.`);
  if (crudo.version !== 1) throw new FormatoInvalido('version', '`version` tiene que ser 1.');

  const titulo = crudo.titulo === null || crudo.titulo === undefined ? null : textoCorto(crudo.titulo, 'titulo', MAX_TITULO, true) || null;
  const salida = crudo.salida ?? 'pdf';
  if (!(SALIDAS as readonly unknown[]).includes(salida)) throw new FormatoInvalido('salida', '`salida` tiene que ser `pdf` o `xlsx`.');
  const fechas = crudo.fechas ?? 'dmy';
  if (!(FECHAS as readonly unknown[]).includes(fechas)) throw new FormatoInvalido('fechas', '`fechas` tiene que ser `dmy` o `iso`.');

  const datosCrudos = crudo.datos ?? [];
  if (!Array.isArray(datosCrudos)) throw new FormatoInvalido('datos', '`datos` tiene que ser una lista.');
  if (datosCrudos.length > MAX_DATOS) throw new FormatoInvalido('datos', `\`datos\` admite hasta ${MAX_DATOS} renglones.`);
  const datos = datosCrudos.map((d, i) => {
    if (!esObjeto(d)) throw new FormatoInvalido(`datos[${i}]`, 'Cada dato tiene que ser un objeto {etiqueta, campo}.');
    if (!(CAMPOS_ENCABEZADO as readonly unknown[]).includes(d.campo)) {
      throw new FormatoInvalido(`datos[${i}].campo`, `\`datos[${i}].campo\` no es válido. Campos válidos: ${CAMPOS_ENCABEZADO.join(', ')}.`);
    }
    return { etiqueta: textoCorto(d.etiqueta, `datos[${i}].etiqueta`, MAX_TEXTO), campo: d.campo as CampoEncabezado };
  });

  const colsCrudas = crudo.columnas;
  if (!Array.isArray(colsCrudas) || colsCrudas.length === 0) throw new FormatoInvalido('columnas', 'Hace falta al menos una columna.');
  if (colsCrudas.length > MAX_COLUMNAS) throw new FormatoInvalido('columnas', `\`columnas\` admite hasta ${MAX_COLUMNAS}.`);
  const vistos = new Set<string>();
  const columnas = colsCrudas.map((c, i) => {
    if (!esObjeto(c)) throw new FormatoInvalido(`columnas[${i}]`, 'Cada columna tiene que ser un objeto {encabezado, campo}.');
    if (!(CAMPOS_RENGLON as readonly unknown[]).includes(c.campo)) {
      throw new FormatoInvalido(`columnas[${i}].campo`, `\`columnas[${i}].campo\` no es válido. Campos válidos: ${CAMPOS_RENGLON.join(', ')}.`);
    }
    if (vistos.has(c.campo as string)) throw new FormatoInvalido(`columnas[${i}].campo`, `El campo \`${c.campo}\` está en dos columnas.`);
    vistos.add(c.campo as string);
    return { encabezado: textoCorto(c.encabezado, `columnas[${i}].encabezado`, MAX_TEXTO), campo: c.campo as CampoRenglon };
  });
  // Una tabla sin NINGUNA cifra no es una liquidación.
  if (!columnas.some((c) => ['monto', 'montoFirmado', 'percepcion', 'deduccion'].includes(c.campo))) {
    throw new FormatoInvalido('columnas', 'Alguna columna tiene que llevar la cifra (importe, percepciones o deducciones).');
  }

  const t = crudo.total ?? { mostrar: true, etiqueta: 'Total' };
  if (!esObjeto(t) || typeof t.mostrar !== 'boolean') throw new FormatoInvalido('total', '`total` tiene que ser {mostrar, etiqueta}.');

  return {
    version: 1, titulo, salida: salida as SalidaFormato, fechas: fechas as FechasFormato, datos, columnas,
    total: { mostrar: t.mostrar, etiqueta: textoCorto(t.etiqueta ?? 'Total', 'total.etiqueta', MAX_TEXTO) },
  };
}

/** Un formato listo para usar cuando la flota aún no sube su muestra: lo más
 *  parecido a «el formatito» típico (clave, concepto, percepciones, deducciones). */
export const FORMATO_BASE: FormatoFlota = {
  version: 1, titulo: null, salida: 'pdf', fechas: 'dmy',
  datos: [
    { etiqueta: 'Operador', campo: 'operador' }, { etiqueta: 'Folio', campo: 'claveExterna' },
    { etiqueta: 'Periodo', campo: 'periodo' }, { etiqueta: 'Viajes', campo: 'viajes' },
  ],
  columnas: [
    { encabezado: 'Clave', campo: 'clave' }, { encabezado: 'Concepto', campo: 'descripcion' },
    { encabezado: 'Percepciones', campo: 'percepcion' }, { encabezado: 'Deducciones', campo: 'deduccion' },
  ],
  total: { mostrar: true, etiqueta: 'Total a pagar' },
};

// ── derivar de un Excel de muestra ──────────────────────────────────────────

// Sinónimos por campo, ya normalizados. El orden importa: «clave concepto» tiene
// que ganarle a «concepto» (por eso se prueba primero la coincidencia EXACTA de
// todo el encabezado y solo después la que lo contiene).
const SIN_RENGLON: Record<CampoRenglon, string[]> = {
  clave: ['clave', 'cve', 'codigo', 'clave concepto', 'cve concepto', 'codigo concepto', 'no concepto', 'num concepto', 'numero de concepto'],
  descripcion: ['concepto', 'descripcion', 'detalle', 'nombre concepto', 'nombre del concepto', 'descripcion concepto', 'rubro'],
  tipo: ['tipo', 'naturaleza', 'clase', 'tipo concepto', 'tipo de concepto'],
  monto: ['importe', 'monto', 'valor', 'cantidad', 'importe mxn', 'monto mxn', 'total concepto'],
  montoFirmado: ['importe neto', 'monto neto', 'neto', 'monto firmado'],
  percepcion: ['percepcion', 'percepciones', 'ingresos', 'ingreso', 'abonos', 'abono', 'haber', 'a favor'],
  deduccion: ['deduccion', 'deducciones', 'descuentos', 'descuento', 'cargos', 'cargo', 'debe', 'en contra'],
};

const SIN_ENCABEZADO: Record<CampoEncabezado, string[]> = {
  operador: ['operador', 'chofer', 'conductor', 'nombre', 'empleado', 'nombre del operador', 'nombre operador', 'nombre del chofer'],
  claveExterna: ['liquidacion', 'folio', 'no liquidacion', 'numero de liquidacion', 'folio liquidacion', 'folio de liquidacion', 'num liquidacion', 'clave'],
  sistemaOrigen: ['sistema', 'origen', 'sistema origen'],
  periodo: ['periodo', 'semana', 'del periodo', 'periodo de pago', 'periodo liquidado'],
  desde: ['desde', 'del', 'fecha inicio', 'inicio', 'periodo desde'],
  hasta: ['hasta', 'al', 'fecha fin', 'fin', 'periodo hasta'],
  viajes: ['viajes', 'viaje', 'folios', 'folios de viaje', 'folio viaje', 'folios viaje'],
  moneda: ['moneda', 'divisa'],
  total: ['total', 'total a pagar', 'neto a pagar', 'neto'],
  razonSocial: ['empresa', 'razon social', 'compania', 'transportista'],
};

const SIN_TOTAL = ['total', 'total a pagar', 'neto a pagar', 'neto', 'total liquidacion', 'saldo', 'total neto', 'importe total', 'gran total'];

function buscarCampo<C extends string>(texto: string, tabla: Record<C, string[]>): C | null {
  if (!texto) return null;
  for (const [campo, sinonimos] of Object.entries(tabla) as Array<[C, string[]]>) if (sinonimos.includes(texto)) return campo;
  return null;
}

export interface DerivacionFormato {
  ok: true;
  formato: FormatoFlota;
  /** Encabezados de la muestra que no se pudieron mapear (para que la persona los ajuste). */
  sinMapear: string[];
  advertencias: string[];
}
export type ResultadoDerivacion = DerivacionFormato | { ok: false; motivo: string };

const FILAS_MAX = 200;
const COLS_MAX = 40;

const textoDeCelda = (c: Celda | undefined): string => (c === null || c === undefined ? '' : sinControl(String(c)));

/**
 * Deriva la plantilla de la matriz de la primera hoja de un Excel de muestra.
 * Nunca lanza: devuelve el motivo en palabras.
 */
export function derivarFormatoDeMatriz(matriz: readonly (readonly Celda[])[]): ResultadoDerivacion {
  const filas = matriz.slice(0, FILAS_MAX).map((f) => f.slice(0, COLS_MAX));

  // 1) La fila de encabezados: la que más columnas reconoce (mínimo 2, y una con cifra o concepto).
  let mejor = -1;
  let mejorPuntos = 0;
  filas.forEach((fila, i) => {
    const campos = fila.map((c) => buscarCampo(normalizarTexto(c), SIN_RENGLON));
    const reconocidas = new Set(campos.filter((c): c is CampoRenglon => c !== null));
    const tieneCifra = ['monto', 'percepcion', 'deduccion', 'montoFirmado'].some((c) => reconocidas.has(c as CampoRenglon));
    if (reconocidas.size >= 2 && tieneCifra && reconocidas.size > mejorPuntos) { mejor = i; mejorPuntos = reconocidas.size; }
  });
  if (mejor < 0) {
    return { ok: false, motivo: 'No encontré la fila de encabezados de la tabla de conceptos. Debe tener al menos dos columnas conocidas (por ejemplo «Concepto» y «Importe», o «Percepciones» y «Deducciones»).' };
  }

  const advertencias: string[] = [];
  const sinMapear: string[] = [];
  const columnas: FormatoFlota['columnas'] = [];
  const usados = new Set<CampoRenglon>();
  for (const celda of filas[mejor]) {
    const original = textoDeCelda(celda);
    if (!original) continue;
    const campo = buscarCampo(normalizarTexto(original), SIN_RENGLON);
    if (!campo) { sinMapear.push(original); continue; }
    if (usados.has(campo)) { advertencias.push(`El encabezado «${original}» repite el campo «${ETIQUETA_CAMPO_RENGLON[campo]}»; se dejó la primera columna.`); continue; }
    usados.add(campo);
    columnas.push({ encabezado: original.slice(0, MAX_TEXTO), campo });
  }
  if (columnas.length > MAX_COLUMNAS) {
    advertencias.push(`La muestra trae más de ${MAX_COLUMNAS} columnas reconocidas; se tomaron las primeras ${MAX_COLUMNAS}.`);
    columnas.length = MAX_COLUMNAS;
  }

  // 2) Lo de ARRIBA: título y pares etiqueta/valor.
  let titulo: string | null = null;
  const datos: FormatoFlota['datos'] = [];
  const camposVistos = new Set<CampoEncabezado>();
  for (let i = 0; i < mejor; i++) {
    const celdas = filas[i].map(textoDeCelda);
    const llenas = celdas.filter(Boolean);
    if (llenas.length === 0) continue;
    // «Operador: Juan» en una celda, o «Operador» + «Juan» en celdas contiguas.
    const pares: Array<{ etiqueta: string; resto: string }> = [];
    celdas.forEach((c, j) => {
      if (!c) return;
      const dosPuntos = /^([^:]{1,60}):\s*(.*)$/.exec(c);
      if (dosPuntos) pares.push({ etiqueta: dosPuntos[1].trim(), resto: dosPuntos[2] });
      else if (buscarCampo(normalizarTexto(c), SIN_ENCABEZADO) && celdas.slice(j + 1).some(Boolean)) pares.push({ etiqueta: c, resto: '' });
    });
    let usoFila = false;
    for (const p of pares) {
      const campo = buscarCampo(normalizarTexto(p.etiqueta), SIN_ENCABEZADO);
      if (!campo || camposVistos.has(campo) || datos.length >= MAX_DATOS) continue;
      camposVistos.add(campo);
      datos.push({ etiqueta: p.etiqueta.slice(0, MAX_TEXTO), campo });
      usoFila = true;
    }
    if (!usoFila && !titulo && llenas.length === 1 && llenas[0].length <= MAX_TITULO && !/:\s*$/.test(llenas[0])) titulo = llenas[0];
  }

  // 3) La fila de total, debajo de la tabla.
  let total: FormatoFlota['total'] = { mostrar: true, etiqueta: 'Total' };
  let hallado = false;
  for (let i = mejor + 1; i < filas.length && !hallado; i++) {
    for (const c of filas[i]) {
      const t = textoDeCelda(c);
      if (t && SIN_TOTAL.includes(normalizarTexto(t))) { total = { mostrar: true, etiqueta: t.slice(0, MAX_TEXTO) }; hallado = true; break; }
    }
  }
  if (!hallado) advertencias.push('No vi una fila de total en la muestra; se imprimirá una con la etiqueta «Total». Puedes ocultarla o renombrarla.');
  if (datos.length === 0) advertencias.push('No reconocí datos sobre la tabla (operador, periodo, folio…); el documento llevará solo la tabla. Puedes agregarlos a mano.');

  try {
    const formato = validarFormato({ version: 1, titulo, salida: 'pdf', fechas: 'dmy', datos, columnas, total });
    return { ok: true, formato, sinMapear, advertencias };
  } catch (e) {
    return { ok: false, motivo: e instanceof FormatoInvalido ? e.message : 'La muestra no produjo un formato válido.' };
  }
}
