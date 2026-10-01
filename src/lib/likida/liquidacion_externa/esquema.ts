// ═══════════════════════════════════════════════════════════════════════════
// LIQUIDACIÓN EXTERNA — el contrato del cuerpo de POST /v1/liquidaciones-externas
// y su validación estricta.
//
// Innovativos calcula la liquidación en su SAP/TMS; Likida solo la ENTREGA.
// Por eso la regla que manda aquí es la opuesta a la del cuadre: Likida NO
// recalcula nada. Pero tampoco entrega a ciegas una cifra incoherente a un
// chofer: lo único que se verifica es que el `total` sea la suma de SUS
// renglones (percepciones − deducciones), en centavos enteros. Si no cuadra, el
// error está del lado del cliente y se le dice cuál es la diferencia — un total
// que el chofer lee en su teléfono y que no es la suma de lo que ve debajo es
// exactamente el documento que genera una queja de nómina.
//
// ── ESTRICTA = NADA SE ACEPTA EN SILENCIO ────────────────────────────────────
//
//   · un campo que no existe en el contrato es 400, no se ignora: `totl` no
//     puede convertirse en una liquidación sin total, ni `tenant_id` colarse;
//   · más de dos decimales se rechaza, no se redondea;
//   · un texto largo se rechaza, no se recorta (un folio recortado dedupea
//     contra otro folio);
//   · el PDF adjunto se comprueba por sus bytes, no por lo que diga el nombre.
//
// Todo esto es PURO: no toca base ni red. La resolución del operador (que sí
// necesita la base) vive en `repo.ts`.
// ═══════════════════════════════════════════════════════════════════════════

import { createHash } from 'node:crypto';
import { CampoInvalido, texto, uuid, fecha, monto } from '@/lib/http/campos_cuerpo';
import { normalizarTelefonoOperador } from '../administracion';
import { DatoInvalido } from '../errores';

/** Los estados de entrega. Viven aquí (puro) y no en `repo.ts` para que el
 *  OpenAPI —que no toca la base— pueda leerlos sin importar el acceso a datos. */
export const ESTADOS = ['pendiente', 'en_cola', 'enviada', 'acusada', 'fallida'] as const;
export type EstadoLiquidacionExterna = (typeof ESTADOS)[number];

export const MONEDAS = ['MXN', 'USD'] as const;
export type MonedaExterna = (typeof MONEDAS)[number];
export const TIPOS_CONCEPTO = ['percepcion', 'deduccion'] as const;
export type TipoConcepto = (typeof TIPOS_CONCEPTO)[number];

/** Tope de renglones. Una liquidación semanal real trae decenas; 100 sobra y
 *  mantiene el mensaje de WhatsApp y el PDF legibles. */
export const MAX_CONCEPTOS = 100;
export const MAX_VIAJES = 50;
/** Más de un año no es una liquidación, es un error de captura. */
export const MAX_DIAS_PERIODO = 366;
/** El PDF que adjunta el cliente. WhatsApp admite hasta 100 MB, pero una
 *  liquidación son unas hojas: 1 MB corta lo absurdo sin estorbar a nadie. */
export const MAX_PDF_BYTES = 1_000_000;
/** Cuerpo máximo de la ruta: el PDF en base64 (×4/3) más el resto del JSON. */
export const MAX_CUERPO_LIQUIDACION_BYTES = Math.ceil(MAX_PDF_BYTES * 4 / 3) + 64_000;

const MONTO_MAX = 9_999_999.99;
const CLAVE_VALIDA = /^[A-Za-z0-9][A-Za-z0-9._:/#-]*$/;

export interface ConceptoExterno {
  /** El código del concepto en el sistema del cliente (p. ej. «P010»). */
  clave: string | null;
  descripcion: string;
  tipo: TipoConcepto;
  monto: number;
}

export interface PdfAdjunto {
  bytes: Uint8Array;
  nombre: string;
  sha256: string;
}

export interface LiquidacionExternaNormalizada {
  claveExterna: string;
  sistemaOrigen: string | null;
  operador: { id: string | null; telefono: string | null; numeroEmpleado: string | null };
  viajes: string[];
  periodo: { desde: string; hasta: string };
  conceptos: ConceptoExterno[];
  total: number;
  moneda: MonedaExterna;
  pdf: PdfAdjunto | null;
}

// ── utilidades ─────────────────────────────────────────────────────────────

function esObjeto(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Rechaza cualquier llave que el contrato no declare. Dice CUÁLES, y dónde. */
function soloCampos(obj: Record<string, unknown>, permitidos: readonly string[], donde: string): void {
  const sobran = Object.keys(obj).filter((k) => !permitidos.includes(k));
  if (sobran.length > 0) {
    throw new CampoInvalido(
      sobran[0],
      `${donde} trae ${sobran.length === 1 ? 'un campo' : 'campos'} que el contrato no tiene: ${sobran.map((s) => `\`${s}\``).join(', ')}. Campos válidos: ${permitidos.map((p) => `\`${p}\``).join(', ')}.`,
    );
  }
}

/** Texto sin caracteres de control: un folio o un concepto con un salto de
 *  línea rompe el CSV, el mensaje de WhatsApp y el PDF. */
function sinControl(valor: string, campo: string): string {
  if (/[\u0000-\u001f\u007f]/.test(valor)) {
    throw new CampoInvalido(campo, `\`${campo}\` no puede traer saltos de línea ni caracteres de control.`);
  }
  return valor;
}

/** Pesos con dos decimales → centavos enteros, sin errores de coma flotante. */
export function aCentavos(pesos: number): number {
  return Math.round(pesos * 100);
}

function aPesos(centavos: number): number {
  return Math.round(centavos) / 100;
}

// ── el PDF adjunto ─────────────────────────────────────────────────────────

/**
 * Marcas de PDF activo. Un PDF que el cliente adjunta llega al teléfono del
 * chofer: si la llave de API del cliente se filtra, este campo sería la forma
 * más barata de mandar un archivo malicioso a cientos de choferes con la
 * firma de su patrón. La lista es una heurística, NO un sandbox: un PDF
 * ofuscado con escapes de nombre (`/#4AavaScript`) podría pasarla. Por eso el
 * PDF que Likida GENERA con las cifras es la opción por omisión y el adjunto es
 * opt-in del cliente.
 */
const MARCAS_PDF_ACTIVO = ['/JavaScript', '/JS', '/Launch', '/EmbeddedFile', '/OpenAction', '/RichMedia', '/SubmitForm', '/GoToR'];

export function validarPdfAdjunto(crudo: unknown): PdfAdjunto {
  if (!esObjeto(crudo)) throw new CampoInvalido('pdf', '`pdf` tiene que ser un objeto `{ base64, nombre? }`.');
  soloCampos(crudo, ['base64', 'nombre'], '`pdf`');
  const b64 = crudo.base64;
  if (typeof b64 !== 'string' || b64.trim() === '') throw new CampoInvalido('pdf.base64', '`pdf.base64` es obligatorio y tiene que ser texto.');
  const limpio = b64.replace(/\s/g, '');
  // Buffer.from acepta basura en silencio; el regex cierra eso. Se admite el
  // alfabeto estándar con relleno `=` (lo que produce cualquier SDK).
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(limpio) || limpio.length % 4 !== 0) {
    throw new CampoInvalido('pdf.base64', '`pdf.base64` no es base64 válido (alfabeto estándar, con `=` de relleno).');
  }
  // Tope ANTES de decodificar: el largo en base64 ya dice el tamaño real.
  const relleno = limpio.endsWith('==') ? 2 : limpio.endsWith('=') ? 1 : 0;
  const bytesEstimados = (limpio.length / 4) * 3 - relleno;
  if (bytesEstimados > MAX_PDF_BYTES) {
    throw new CampoInvalido('pdf.base64', `El PDF no puede pesar más de ${MAX_PDF_BYTES} bytes.`);
  }
  // `atob` y no el constructor de `Buffer`: el alfabeto ya se validó arriba, y
  // así este archivo puro no depende de Node (ni lo confunde con acceso a datos
  // el guardia de la frontera, que cuenta toda llamada de ese nombre).
  const binario = atob(limpio);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  if (bytes.length === 0) throw new CampoInvalido('pdf.base64', '`pdf.base64` quedó vacío.');
  const cabecera = String.fromCharCode(...bytes.slice(0, 5));
  if (cabecera !== '%PDF-') throw new CampoInvalido('pdf.base64', 'Lo adjunto no es un PDF (no empieza con `%PDF-`).');
  // El marcador de fin debe estar en el último kilobyte: un PDF truncado se ve
  // como página en blanco en el teléfono del chofer, sin ningún error.
  const cola = new TextDecoder('latin1').decode(bytes.slice(-1024));
  if (!cola.includes('%%EOF')) throw new CampoInvalido('pdf.base64', 'El PDF está truncado (le falta `%%EOF` al final).');
  const cuerpoLatin1 = new TextDecoder('latin1').decode(bytes);
  const activa = MARCAS_PDF_ACTIVO.find((m) => cuerpoLatin1.includes(m));
  if (activa) {
    throw new CampoInvalido('pdf.base64', `El PDF trae contenido activo (${activa}); no se entrega a un teléfono. Mándalo sin scripts ni archivos incrustados, o quita el campo \`pdf\` y Likida genera uno con tus cifras.`);
  }

  const nombreCrudo = texto(crudo, 'nombre', { max: 80 });
  let nombre = nombreCrudo ?? 'liquidacion.pdf';
  sinControl(nombre, 'pdf.nombre');
  // El nombre viaja a WhatsApp y a Storage: sin rutas, sin caracteres raros.
  nombre = nombre.replace(/[^A-Za-z0-9._ -]/g, '_').replace(/^\.+/, '_');
  if (!/\.pdf$/i.test(nombre)) nombre = `${nombre}.pdf`;
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  return { bytes, nombre, sha256 };
}

// ── los renglones ──────────────────────────────────────────────────────────

function validarConcepto(crudo: unknown, i: number): ConceptoExterno {
  const donde = `\`conceptos[${i}]\``;
  if (!esObjeto(crudo)) throw new CampoInvalido(`conceptos[${i}]`, `${donde} tiene que ser un objeto.`);
  soloCampos(crudo, ['clave', 'descripcion', 'tipo', 'monto'], donde);
  const descripcion = texto(crudo, 'descripcion', { obligatorio: true, max: 120 });
  if (!descripcion) throw new CampoInvalido(`conceptos[${i}].descripcion`, `${donde}: \`descripcion\` es obligatoria.`);
  sinControl(descripcion, `conceptos[${i}].descripcion`);
  const tipo = crudo.tipo;
  if (typeof tipo !== 'string' || !(TIPOS_CONCEPTO as readonly string[]).includes(tipo)) {
    throw new CampoInvalido(`conceptos[${i}].tipo`, `${donde}: \`tipo\` tiene que ser \`percepcion\` o \`deduccion\`. El signo lo da el tipo; el monto va siempre positivo.`);
  }
  if (crudo.monto === undefined || crudo.monto === null || (typeof crudo.monto === 'string' && crudo.monto.trim() === '')) {
    // VACÍO ≠ CERO: un renglón sin monto no es un renglón de $0.
    throw new CampoInvalido(`conceptos[${i}].monto`, `${donde}: \`monto\` es obligatorio (si de verdad es cero, manda 0).`);
  }
  let m: number | null;
  try {
    m = monto(crudo, 'monto', { min: 0, max: MONTO_MAX });
  } catch (e) {
    if (e instanceof CampoInvalido) throw new CampoInvalido(`conceptos[${i}].monto`, `${donde}: ${e.message}`);
    throw e;
  }
  if (m === null) throw new CampoInvalido(`conceptos[${i}].monto`, `${donde}: \`monto\` es obligatorio.`);
  const clave = texto(crudo, 'clave', { max: 40 });
  if (clave !== null) sinControl(clave, `conceptos[${i}].clave`);
  return { clave, descripcion, tipo: tipo as TipoConcepto, monto: aPesos(aCentavos(m)) };
}

// ── el cuerpo entero ───────────────────────────────────────────────────────

const CAMPOS_RAIZ = ['claveExterna', 'sistemaOrigen', 'operador', 'viajes', 'periodo', 'conceptos', 'total', 'moneda', 'pdf'] as const;

export function validarLiquidacionExterna(cuerpo: Record<string, unknown>): LiquidacionExternaNormalizada {
  soloCampos(cuerpo, CAMPOS_RAIZ, 'El cuerpo');

  // — clave: la identidad del documento en el sistema del cliente —
  const claveExterna = texto(cuerpo, 'claveExterna', { obligatorio: true, max: 120 });
  if (!claveExterna) throw new CampoInvalido('claveExterna', '`claveExterna` es obligatoria.');
  if (!CLAVE_VALIDA.test(claveExterna)) {
    throw new CampoInvalido('claveExterna', '`claveExterna` solo admite letras, números y `. _ : / # -` (sin espacios), empezando por letra o número. Es el folio de la liquidación en tu sistema.');
  }
  const sistemaOrigen = texto(cuerpo, 'sistemaOrigen', { max: 40 });
  if (sistemaOrigen !== null) sinControl(sistemaOrigen, 'sistemaOrigen');

  // — operador: al menos UNA forma de identificarlo —
  if (!esObjeto(cuerpo.operador)) {
    throw new CampoInvalido('operador', '`operador` es obligatorio: `{ id }`, `{ telefono }` o `{ numeroEmpleado }` de un chofer dado de alta en Likida.');
  }
  soloCampos(cuerpo.operador, ['id', 'telefono', 'numeroEmpleado'], '`operador`');
  const opId = uuid(cuerpo.operador, 'id');
  const opTelCrudo = texto(cuerpo.operador, 'telefono', { max: 25 });
  const opEmpleado = texto(cuerpo.operador, 'numeroEmpleado', { max: 40 });
  if (opId === null && opTelCrudo === null && opEmpleado === null) {
    throw new CampoInvalido('operador', '`operador` necesita `id`, `telefono` o `numeroEmpleado`.');
  }
  let opTelefono: string | null = null;
  if (opTelCrudo !== null) {
    try {
      opTelefono = normalizarTelefonoOperador(opTelCrudo);
    } catch (e) {
      if (e instanceof DatoInvalido) throw new CampoInvalido('operador.telefono', e.message);
      throw e;
    }
  }
  if (opEmpleado !== null) sinControl(opEmpleado, 'operador.numeroEmpleado');

  // — viajes: los folios que cubre —
  if (!Array.isArray(cuerpo.viajes) || cuerpo.viajes.length === 0) {
    throw new CampoInvalido('viajes', '`viajes` es obligatorio: la lista de folios de viaje que cubre la liquidación (al menos uno).');
  }
  if (cuerpo.viajes.length > MAX_VIAJES) {
    throw new CampoInvalido('viajes', `\`viajes\` no puede traer más de ${MAX_VIAJES} folios.`);
  }
  const vistos = new Set<string>();
  const viajes: string[] = [];
  cuerpo.viajes.forEach((v, i) => {
    if (typeof v !== 'string' && typeof v !== 'number') {
      throw new CampoInvalido(`viajes[${i}]`, `\`viajes[${i}]\` tiene que ser un folio (texto).`);
    }
    const folio = String(v).trim();
    if (folio === '') throw new CampoInvalido(`viajes[${i}]`, `\`viajes[${i}]\` está vacío.`);
    if (folio.length > 40) throw new CampoInvalido(`viajes[${i}]`, `\`viajes[${i}]\` no puede pasar de 40 caracteres.`);
    sinControl(folio, `viajes[${i}]`);
    if (vistos.has(folio)) throw new CampoInvalido(`viajes[${i}]`, `El folio \`${folio}\` viene repetido en \`viajes\`.`);
    vistos.add(folio);
    viajes.push(folio);
  });

  // — periodo —
  if (!esObjeto(cuerpo.periodo)) {
    throw new CampoInvalido('periodo', '`periodo` es obligatorio: `{ desde: "AAAA-MM-DD", hasta: "AAAA-MM-DD" }`.');
  }
  soloCampos(cuerpo.periodo, ['desde', 'hasta'], '`periodo`');
  const desde = fecha(cuerpo.periodo, 'desde');
  const hasta = fecha(cuerpo.periodo, 'hasta');
  if (!desde || !hasta) throw new CampoInvalido('periodo', '`periodo.desde` y `periodo.hasta` son obligatorios (`AAAA-MM-DD`).');
  if (desde > hasta) throw new CampoInvalido('periodo', '`periodo.desde` no puede ser posterior a `periodo.hasta`.');
  const dias = (Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86_400_000 + 1;
  if (dias > MAX_DIAS_PERIODO) {
    throw new CampoInvalido('periodo', `El periodo no puede pasar de ${MAX_DIAS_PERIODO} días (trae ${dias}). Revisa las fechas.`);
  }

  // — conceptos y total —
  if (!Array.isArray(cuerpo.conceptos) || cuerpo.conceptos.length === 0) {
    throw new CampoInvalido('conceptos', '`conceptos` es obligatorio: los renglones de la liquidación (al menos uno). Likida no recalcula tu liquidación, pero necesita los renglones para que el chofer vea de dónde sale el total.');
  }
  if (cuerpo.conceptos.length > MAX_CONCEPTOS) {
    throw new CampoInvalido('conceptos', `\`conceptos\` no puede traer más de ${MAX_CONCEPTOS} renglones.`);
  }
  const conceptos = cuerpo.conceptos.map((c, i) => validarConcepto(c, i));

  if (cuerpo.total === undefined || cuerpo.total === null || (typeof cuerpo.total === 'string' && cuerpo.total.trim() === '')) {
    throw new CampoInvalido('total', '`total` es obligatorio (si de verdad es cero, manda 0).');
  }
  const total = monto(cuerpo, 'total', { min: -MONTO_MAX, max: MONTO_MAX });
  if (total === null) throw new CampoInvalido('total', '`total` es obligatorio.');

  const sumaCentavos = conceptos.reduce((a, c) => a + (c.tipo === 'percepcion' ? 1 : -1) * aCentavos(c.monto), 0);
  if (aCentavos(total) !== sumaCentavos) {
    throw new CampoInvalido(
      'total',
      `El \`total\` (${aPesos(aCentavos(total)).toFixed(2)}) no es la suma de tus conceptos (percepciones − deducciones = ${aPesos(sumaCentavos).toFixed(2)}). Likida no recalcula tu liquidación, pero tampoco la entrega a un chofer con un total que no cuadra con los renglones que ve.`,
    );
  }

  // — moneda —
  const moneda = cuerpo.moneda;
  if (typeof moneda !== 'string' || !(MONEDAS as readonly string[]).includes(moneda)) {
    throw new CampoInvalido('moneda', `\`moneda\` es obligatoria y tiene que ser ${MONEDAS.map((m) => `\`${m}\``).join(' o ')}.`);
  }

  // — PDF opcional —
  const pdf = cuerpo.pdf === undefined || cuerpo.pdf === null ? null : validarPdfAdjunto(cuerpo.pdf);

  return {
    claveExterna,
    sistemaOrigen,
    operador: { id: opId?.toLowerCase() ?? null, telefono: opTelefono, numeroEmpleado: opEmpleado },
    viajes,
    periodo: { desde, hasta },
    conceptos,
    total: aPesos(aCentavos(total)),
    moneda: moneda as MonedaExterna,
    pdf,
  };
}

/**
 * La huella del CONTENIDO normalizado: lo que decide si dos peticiones con la
 * misma `claveExterna` son la misma operación (200) o dos contenidos distintos
 * (409). El orden de `viajes` no importa (es un conjunto); el de `conceptos`
 * sí (es lo que el chofer lee). El PDF entra por su sha256.
 */
export function huellaContenido(n: LiquidacionExternaNormalizada): string {
  const canonico = JSON.stringify({
    c: n.claveExterna,
    s: n.sistemaOrigen,
    o: [n.operador.id, n.operador.telefono, n.operador.numeroEmpleado],
    v: [...n.viajes].sort(),
    p: [n.periodo.desde, n.periodo.hasta],
    k: n.conceptos.map((c) => [c.clave, c.descripcion, c.tipo, aCentavos(c.monto)]),
    t: aCentavos(n.total),
    m: n.moneda,
    f: n.pdf?.sha256 ?? null,
  });
  return createHash('sha256').update(canonico, 'utf8').digest('hex');
}
