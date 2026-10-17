// ═══════════════════════════════════════════════════════════════════════════
// DEL ARCHIVO AL CONTENIDO — qué es, y qué se le puede leer.
//
// El formato se decide por los BYTES, nunca por la extensión ni por el `mime` que
// declara quien lo manda (un «.pdf» que en realidad es un .exe, un «.xlsx» que es
// un zip con otra cosa, una foto renombrada). Cada formato se prepara con topes
// de tamaño, páginas, hojas y filas: el documento es entrada NO autenticada.
//
// Nada aquí habla con el modelo ni con la base: es la mitad pura (y sin red) del
// pipeline, para probarla con documentos sintéticos.
// ═══════════════════════════════════════════════════════════════════════════

import * as XLSX from 'xlsx';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { llaveTexto } from './catalogos';
import { aBuffer, textoDeBase64, textoDeBytes, utf8DeLatin1 } from './bytes';

export type FormatoDoc = 'pdf_texto' | 'pdf_escaneado' | 'imagen' | 'excel' | 'csv' | 'xml' | 'correo' | 'json';

export const MAX_BYTES_DOC = 12 * 1024 * 1024;
export const MAX_PAGINAS_TEXTO = 20;
export const MAX_PAGINAS_IMAGEN = 3;
export const MAX_HOJAS = 5;
export const MAX_FILAS_HOJA = 2000;
export const MAX_COLUMNAS = 60;
/** Un JSON de embarque es chico: más de 1 MB no es un embarque, es otra cosa (o un ataque). */
export const MAX_BYTES_JSON = 1024 * 1024;
export const MAX_PROFUNDIDAD_JSON = 20;
/** Claves que nunca se leen de un JSON de un tercero (contaminación de prototipos). */
export const CLAVES_PROHIBIDAS_JSON: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype']);
/** Lo que viaja al modelo como texto: lo que cabe, no el documento entero. */
export const MAX_TEXTO_MODELO = 30_000;
/** Lo que se guarda en `texto_extracto` (para revisar al lado y para anclar). */
export const MAX_TEXTO_GUARDADO = 60_000;

export interface Hoja { nombre: string; filas: string[][] }

export interface ContenidoDoc {
  formato: FormatoDoc;
  /** Texto completo (acotado a MAX_TEXTO_GUARDADO) para anclar valores y mostrar al lado. */
  texto: string | null;
  /** Data-URLs JPEG/PNG para el modelo de visión (foto o páginas de un PDF escaneado). */
  imagenes: string[];
  tabla: Hoja[] | null;
  /** El árbol del XML ya parseado (sin prefijos de namespace), si es XML. En `json` es el árbol del JSON ya limpio (sin claves prohibidas). */
  xml: unknown | null;
  /** T-A3-14: las pestañas de un libro que son UN mismo embarque (una mercancía por pestaña); la pone el servicio, el modelo lo lee. */
  hojasMismoEmbarque?: string[];
  /** T-A3-53: tamaño en píxeles de la imagen ORIGINAL (antes de reducirla), para marcar una captura de baja resolución. */
  resolucion?: { ancho: number; alto: number };
  /** Avisos de la lectura (hojas recortadas, PDF con muchas páginas…). */
  avisos: string[];
  /** Solo para correo: lo que declara la cabecera. */
  correo?: { de: string | null; asunto: string | null; fecha: string | null };
}

export type ClaseDoc = 'pdf' | 'imagen' | 'excel' | 'csv' | 'xml' | 'correo' | 'json';

export type DeteccionFormato =
  | { ok: true; clase: ClaseDoc; mime: string }
  | { ok: false; motivo: string };

const empieza = (b: Uint8Array, ...bytes: number[]): boolean => bytes.every((v, i) => b[i] === v);

function parecenCabecerasDeCorreo(t: string): boolean {
  const cab = t.slice(0, 4000).split(/\r?\n\r?\n/)[0] ?? '';
  const lineas = cab.split(/\r?\n/);
  const conocidas = lineas.filter((l) => /^(from|to|subject|date|received|return-path|mime-version|message-id|content-type|de|para|asunto):/i.test(l)).length;
  return conocidas >= 2 && lineas.some((l) => /^(from|de):/i.test(l));
}

/** Cuántas veces aparece `sep` FUERA de comillas (una coma dentro de «1,200» no separa). */
function separadoresFuera(linea: string, sep: string): number {
  let n = 0; let dentro = false;
  for (const ch of linea) {
    if (ch === '"') dentro = !dentro;
    else if (!dentro && ch === sep) n++;
  }
  return n;
}

function pareceDelimitado(t: string): boolean {
  const lineas = t.split(/\r?\n/).filter((l) => l.trim() !== '').slice(0, 20);
  if (lineas.length < 2) return false;
  for (const sep of [',', ';', '\t', '|']) {
    const cuentas = lineas.map((l) => separadoresFuera(l, sep));
    if (cuentas[0] >= 1 && cuentas.filter((c) => c === cuentas[0]).length >= Math.ceil(lineas.length * 0.8)) return true;
  }
  return false;
}

/** Profundidad del JSON, sin recursión (un JSON con miles de niveles no debe reventar la pila). Se corta al pasar `max`. */
function profundidadJson(raiz: unknown, max: number): number {
  let mayor = 0;
  const pila: Array<[unknown, number]> = [[raiz, 1]];
  while (pila.length > 0) {
    const [nodo, d] = pila.pop() as [unknown, number];
    if (nodo === null || typeof nodo !== 'object') continue;
    if (d > mayor) mayor = d;
    if (mayor > max) return mayor;
    for (const hijo of Array.isArray(nodo) ? nodo : Object.values(nodo as Record<string, unknown>)) {
      if (hijo !== null && typeof hijo === 'object') pila.push([hijo, d + 1]);
    }
  }
  return mayor;
}

/**
 * ¿El texto es un JSON de objeto o arreglo (no vacío)? `null` = no lo es (sigue el camino de siempre: un texto con llaves
 * que no parsea es texto libre). Si lo es pero no se acepta (muy grande o demasiado anidado) se rechaza con un motivo llano.
 */
function detectarJson(t: string, bytes: number): DeteccionFormato | null {
  const ini = t.trimStart();
  if (ini[0] !== '{' && ini[0] !== '[') return null;
  let valor: unknown;
  try {
    valor = JSON.parse(t);
  } catch (e) {
    // Un SyntaxError es texto libre que empieza con llave. Un RangeError es anidamiento absurdo: eso sí se rechaza.
    if (e instanceof RangeError) return { ok: false, motivo: `El JSON está anidado a más de ${MAX_PROFUNDIDAD_JSON} niveles: no es un documento de embarque.` };
    return null;
  }
  if (valor === null || typeof valor !== 'object') return null;
  if (Array.isArray(valor) ? valor.length === 0 : Object.keys(valor).length === 0) return null;
  if (bytes > MAX_BYTES_JSON) return { ok: false, motivo: `El JSON pesa más de ${MAX_BYTES_JSON / 1024 / 1024} MB: no es un documento de embarque.` };
  if (profundidadJson(valor, MAX_PROFUNDIDAD_JSON) > MAX_PROFUNDIDAD_JSON) {
    return { ok: false, motivo: `El JSON está anidado a más de ${MAX_PROFUNDIDAD_JSON} niveles: no es un documento de embarque.` };
  }
  return { ok: true, clase: 'json', mime: 'application/json' };
}

/** Decide qué ES el archivo por sus bytes. */
export function detectarFormato(bytes: Uint8Array): DeteccionFormato {
  if (bytes.length === 0) return { ok: false, motivo: 'El archivo está vacío.' };
  if (bytes.length > MAX_BYTES_DOC) return { ok: false, motivo: `El archivo pesa más de ${MAX_BYTES_DOC / 1024 / 1024} MB.` };
  if (empieza(bytes, 0x25, 0x50, 0x44, 0x46, 0x2d)) return { ok: true, clase: 'pdf', mime: 'application/pdf' };
  if (empieza(bytes, 0x89, 0x50, 0x4e, 0x47)) return { ok: true, clase: 'imagen', mime: 'image/png' };
  if (empieza(bytes, 0xff, 0xd8, 0xff)) return { ok: true, clase: 'imagen', mime: 'image/jpeg' };
  if (empieza(bytes, 0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
    return { ok: true, clase: 'imagen', mime: 'image/webp' };
  }
  if (bytes.length > 12 && bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) {
    return { ok: false, motivo: 'Las fotos HEIC/HEIF no se leen. Mándala como JPG o PNG (en el iPhone: Ajustes → Cámara → Formatos → «Más compatible»).' };
  }
  if (empieza(bytes, 0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1)) return { ok: true, clase: 'excel', mime: 'application/vnd.ms-excel' };
  if (empieza(bytes, 0x50, 0x4b, 0x03, 0x04)) {
    // Un zip: solo es Excel si trae el libro adentro. Los nombres de las entradas
    // viajan en claro en las cabeceras locales.
    const muestra = textoDeBytes(bytes, 'latin1', 65_536);
    if (muestra.includes('xl/workbook.xml') || muestra.includes('xl/_rels') || (muestra.includes('[Content_Types].xml') && muestra.includes('xl/'))) {
      return { ok: true, clase: 'excel', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
    }
    return { ok: false, motivo: 'Es un archivo comprimido o un documento de Office que no es Excel. Manda el Excel, PDF, foto, XML, JSON o CSV directamente.' };
  }
  // Ejecutables y otros binarios conocidos: se nombran, no se intentan leer.
  if (empieza(bytes, 0x4d, 0x5a) || empieza(bytes, 0x7f, 0x45, 0x4c, 0x46) || empieza(bytes, 0x1f, 0x8b) || empieza(bytes, 0x52, 0x61, 0x72, 0x21)) {
    return { ok: false, motivo: 'Ese tipo de archivo no es un documento de embarque.' };
  }
  // Binario desconocido: demasiados bytes nulos para ser texto.
  const muestra = bytes.subarray(0, Math.min(bytes.length, 4096));
  let nulos = 0;
  for (const b of muestra) if (b === 0) nulos++;
  if (nulos > 2) return { ok: false, motivo: 'No reconocí el formato del archivo (ni PDF, ni foto, ni Excel, ni texto).' };

  const t = textoDeBytes(bytes).replace(/^\ufeff/, '');
  const ini = t.trimStart();
  if (ini.startsWith('<?xml') || /^<[A-Za-z_][\w:.-]*[\s>/]/.test(ini)) {
    if (/^<!doctype\s+html|^<html[\s>]/i.test(ini)) return { ok: true, clase: 'correo', mime: 'text/html' };
    return { ok: true, clase: 'xml', mime: 'application/xml' };
  }
  // JSON estructurado (el «API propio» de algún cliente): antes del texto plano, que es donde caía.
  const json = detectarJson(t, bytes.length);
  if (json) return json;
  if (parecenCabecerasDeCorreo(t)) return { ok: true, clase: 'correo', mime: 'message/rfc822' };
  if (pareceDelimitado(t)) return { ok: true, clase: 'csv', mime: 'text/csv' };
  if (t.trim().length >= 10) return { ok: true, clase: 'correo', mime: 'text/plain' };
  return { ok: false, motivo: 'El archivo no trae contenido legible.' };
}

/**
 * T-A3-58 · ¿Un adjunto SIN extensión se acepta? Solo si sus BYTES son JSON, PDF o Excel (y una foto cuando el correo la
 * declara `image/*`: las imágenes pegadas llegan sin nombre). Cualquier otra cosa —texto, XML, CSV, zip, ejecutable,
 * binario desconocido— se descarta sin leerla ni interpretarla: sin extensión no hay ninguna pista de que sea un documento.
 */
export function aceptableSinExtension(bytes: Uint8Array, contentType?: string | null): boolean {
  const d = detectarFormato(bytes);
  if (!d.ok) return false;
  if (d.clase === 'json' || d.clase === 'pdf' || d.clase === 'excel') return true;
  return d.clase === 'imagen' && /^image\//i.test((contentType ?? '').trim());
}

const recortar = (s: string, max: number): string => (s.length > max ? s.slice(0, max) : s);

/** Quita el ruido que pdf-parse agrega entre páginas. */
function limpiarTextoPdf(t: string): string {
  return t.replace(/^-- \d+ of \d+ --$/gm, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

async function prepararPdf(bytes: Uint8Array, avisos: string[]): Promise<ContenidoDoc> {
  const { PDFParse } = await import('pdf-parse');
  const parser = new PDFParse({ data: aBuffer(bytes) });
  try {
    const r = await parser.getText({ first: MAX_PAGINAS_TEXTO });
    const texto = limpiarTextoPdf(r.text ?? '');
    const paginas = r.pages?.length ?? 0;
    if (r.total && r.total > MAX_PAGINAS_TEXTO) avisos.push(`El PDF tiene ${r.total} páginas; se leyeron las primeras ${MAX_PAGINAS_TEXTO}.`);
    if (texto.replace(/\s+/g, '').length >= 80) {
      return { formato: 'pdf_texto', texto: recortar(texto, MAX_TEXTO_GUARDADO), imagenes: [], tabla: null, xml: null, avisos };
    }
    // Sin capa de texto: es un escaneo. Se rinde a imagen para el modelo de visión.
    const s = await parser.getScreenshot({ first: MAX_PAGINAS_IMAGEN, desiredWidth: 1400, imageDataUrl: true, imageBuffer: false });
    const imagenes = (s.pages ?? []).map((p: { dataUrl?: string }) => p.dataUrl).filter((u: string | undefined): u is string => !!u);
    if (imagenes.length === 0) throw new Error('El PDF no tiene texto ni se pudo convertir a imagen.');
    if ((r.total ?? paginas) > MAX_PAGINAS_IMAGEN) avisos.push(`PDF escaneado de ${r.total} páginas: se leyeron las primeras ${MAX_PAGINAS_IMAGEN}.`);
    return { formato: 'pdf_escaneado', texto: null, imagenes, tabla: null, xml: null, avisos };
  } finally {
    await parser.destroy().catch(() => {});
  }
}

async function prepararImagen(bytes: Uint8Array, avisos: string[]): Promise<ContenidoDoc> {
  const sharp = (await import('sharp')).default;
  // limitInputPixels: una imagen de 40 000 × 40 000 px cabe en pocos KB y reventaría la memoria.
  const original = sharp(aBuffer(bytes), { limitInputPixels: 40_000_000, failOn: 'error' });
  const meta = await original.metadata();
  // Con la orientación EXIF 5-8 la foto se gira 90°: el ancho de verdad es el alto declarado.
  const girada = (meta.orientation ?? 1) >= 5;
  const resolucion = meta.width && meta.height ? { ancho: girada ? meta.height : meta.width, alto: girada ? meta.width : meta.height } : undefined;
  const buf = await original
    .rotate()
    .resize({ width: 1800, height: 1800, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toBuffer();
  avisos.push('La foto se orientó y se redujo a un máximo de 1800 px antes de leerla.');
  return { formato: 'imagen', texto: null, imagenes: [`data:image/jpeg;base64,${buf.toString('base64')}`], tabla: null, xml: null, ...(resolucion ? { resolucion } : {}), avisos };
}

function celdaATexto(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : v.toISOString().slice(0, 19).replace('T', ' ').replace(/ 00:00:00$/, '');
  return String(v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ').trim().slice(0, 300);
}

/** Una hoja a filas de texto, sin fórmulas evaluadas y con topes. */
function hojaAFilas(ws: XLSX.WorkSheet, avisos: string[], nombre: string): string[][] {
  const filas = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: '', blankrows: false });
  if (filas.length > MAX_FILAS_HOJA) avisos.push(`La hoja «${nombre}» tiene ${filas.length} filas; se leyeron ${MAX_FILAS_HOJA}.`);
  return filas.slice(0, MAX_FILAS_HOJA).map((f) => {
    if (f.length > MAX_COLUMNAS) avisos.push(`La hoja «${nombre}» tiene más de ${MAX_COLUMNAS} columnas; se recortó.`);
    return f.slice(0, MAX_COLUMNAS).map(celdaATexto);
  });
}

export function tablaATexto(hojas: Hoja[], maxChars = MAX_TEXTO_GUARDADO): string {
  const partes = hojas.map((h) => `### Hoja: ${h.nombre}\n${h.filas.map((f) => f.join(' | ')).join('\n')}`);
  return recortar(partes.join('\n\n'), maxChars);
}

// ── Libro con la plantilla del TMS (T-A3-47): sus hojas que no son datos no cuentan contra MAX_HOJAS ──

/** Nombre de hoja a llave comparable: minúsculas, sin acentos, espacios ni signos. */
export const llaveHoja = (t: unknown): string => llaveTexto(String(t ?? '')).replace(/[^a-z0-9]+/g, '');

/** Hojas que nunca son datos: errores del TMS, catálogo de regímenes del agente aduanal y la Guía de llenado. */
export function esHojaIgnorada(nombre: string): boolean {
  const k = llaveHoja(nombre);
  return k === 'error' || k.startsWith('informacionagenteaduanal') || k === 'guia' || k.startsWith('guiade');
}

/** ¿Los nombres de hoja son los de la plantilla «normal» del TMS? (firma por nombres; los rótulos se verifican al leer). */
export function esLibroPlantillaTms(nombres: readonly string[]): boolean {
  const k = new Set(nombres.map(llaveHoja));
  return k.has('remintentedestinatario') && k.has('mercancias');
}

/** Las hojas que se leen como datos: en un libro-plantilla se descartan las ignoradas ANTES del tope `MAX_HOJAS`. */
export function hojasDeDatos(nombres: readonly string[]): string[] {
  return esLibroPlantillaTms(nombres) ? nombres.filter((n) => !esHojaIgnorada(n)) : [...nombres];
}

function prepararHoja(bytes: Uint8Array, esCsv: boolean, avisos: string[]): ContenidoDoc {
  let libro: XLSX.WorkBook;
  if (esCsv) {
    // raw: el CSV se lee como TEXTO — «01000» no se vuelve 1000 y «1/2/2026» no se reinterpreta.
    libro = XLSX.read(textoDeBytes(bytes).replace(/^\ufeff/, ''), { type: 'string', raw: true, cellDates: false });
  } else {
    libro = XLSX.read(aBuffer(bytes), { type: 'buffer', cellDates: true, cellFormula: false, cellHTML: false, cellStyles: false, sheetRows: MAX_FILAS_HOJA + 1 });
  }
  const nombresDatos = esCsv ? libro.SheetNames : hojasDeDatos(libro.SheetNames);
  if (nombresDatos.length < libro.SheetNames.length) avisos.push(`Plantilla del TMS: se ignoraron las hojas que no son datos (${libro.SheetNames.filter(esHojaIgnorada).join(', ')}).`);
  if (nombresDatos.length > MAX_HOJAS) avisos.push(`El libro tiene ${nombresDatos.length} hojas; se leyeron ${MAX_HOJAS}.`);
  const hojas: Hoja[] = nombresDatos.slice(0, MAX_HOJAS)
    .map((n) => ({ nombre: n.slice(0, 60), filas: hojaAFilas(libro.Sheets[n], avisos, n) }))
    .filter((h) => h.filas.length > 0);
  if (hojas.length === 0) throw new Error('El archivo no trae filas con datos.');
  return { formato: esCsv ? 'csv' : 'excel', texto: tablaATexto(hojas), imagenes: [], tabla: hojas, xml: null, avisos };
}

/** Parser XML sin prefijos de namespace; entidades limitadas por fast-xml-parser. */
export function parsearXml(texto: string): unknown {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    removeNSPrefix: true,
    parseAttributeValue: false,
    parseTagValue: false,
    trimValues: true,
    processEntities: true,
    allowBooleanAttributes: false,
  });
  return parser.parse(texto);
}

function prepararXml(bytes: Uint8Array, avisos: string[]): ContenidoDoc {
  const texto = textoDeBytes(bytes).replace(/^\ufeff/, '');
  if (/<!ENTITY/i.test(texto)) throw new Error('El XML declara entidades (<!ENTITY): no se lee.');
  // fast-xml-parser perdona casi todo (etiquetas sin cerrar, texto suelto): el validador estricto va primero.
  if (XMLValidator.validate(texto) !== true) throw new Error('El XML está mal formado.');
  let arbol: unknown;
  try { arbol = parsearXml(texto); } catch { throw new Error('El XML está mal formado.'); }
  if (!arbol || typeof arbol !== 'object') throw new Error('El XML está vacío.');
  return { formato: 'xml', texto: recortar(texto, MAX_TEXTO_GUARDADO), imagenes: [], tabla: null, xml: arbol, avisos };
}

// ── JSON ────────────────────────────────────────────────────────────────────

/** Copia el árbol sin las claves prohibidas (cuenta cuántas quitó) y con tope de profundidad. */
function limpiarJson(v: unknown, profundidad: number, quitadas: { n: number }): unknown {
  if (v === null || typeof v !== 'object') return v;
  if (profundidad > MAX_PROFUNDIDAD_JSON) throw new Error(`El JSON está anidado a más de ${MAX_PROFUNDIDAD_JSON} niveles: no es un documento de embarque.`);
  if (Array.isArray(v)) return v.map((x) => limpiarJson(x, profundidad + 1, quitadas));
  const salida: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if (CLAVES_PROHIBIDAS_JSON.has(k)) { quitadas.n++; continue; }
    salida[k] = limpiarJson(x, profundidad + 1, quitadas);
  }
  return salida;
}

/** Un JSON de embarque: el árbol (sin claves peligrosas) para los perfiles y su texto re-serializado para el modelo y la pantalla. */
function prepararJson(bytes: Uint8Array, avisos: string[]): ContenidoDoc {
  if (bytes.length > MAX_BYTES_JSON) throw new Error(`El JSON pesa más de ${MAX_BYTES_JSON / 1024 / 1024} MB: no es un documento de embarque.`);
  const crudo = textoDeBytes(bytes).replace(/^\ufeff/, '');
  let valor: unknown;
  try { valor = JSON.parse(crudo); } catch { throw new Error('El JSON está mal formado.'); }
  if (valor === null || typeof valor !== 'object') throw new Error('El JSON no es un objeto ni un arreglo.');
  if (profundidadJson(valor, MAX_PROFUNDIDAD_JSON) > MAX_PROFUNDIDAD_JSON) throw new Error(`El JSON está anidado a más de ${MAX_PROFUNDIDAD_JSON} niveles: no es un documento de embarque.`);
  const quitadas = { n: 0 };
  const arbol = limpiarJson(valor, 1, quitadas);
  if (quitadas.n > 0) avisos.push(`Se ignoraron ${quitadas.n} clave(s) no permitidas del JSON (__proto__, constructor, prototype).`);
  const completo = JSON.stringify(arbol, null, 2);
  if (completo.length > MAX_TEXTO_GUARDADO) avisos.push(`El JSON es largo: solo se guardan y se leen los primeros ${MAX_TEXTO_GUARDADO} caracteres del texto; el mapeo del perfil sí recorre todo.`);
  return { formato: 'json', texto: recortar(completo, MAX_TEXTO_GUARDADO), imagenes: [], tabla: null, xml: arbol, avisos };
}

// ── Correo ──────────────────────────────────────────────────────────────────

function decodificarQp(s: string): string {
  return s.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/gi, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
}

function htmlATexto(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, '\n')
    .replace(/<\/t[dh]>/gi, ' | ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
}

function cabecera(cab: string, nombre: string): string | null {
  const m = new RegExp(`^${nombre}:[ \\t]*(.*(?:\\r?\\n[ \\t].*)*)`, 'im').exec(cab);
  return m ? m[1].replace(/\r?\n[ \t]+/g, ' ').trim().slice(0, 300) : null;
}

function cuerpoMime(crudo: string, profundidad = 0): string {
  const corte = crudo.search(/\r?\n\r?\n/);
  const cab = corte === -1 ? crudo : crudo.slice(0, corte);
  const cuerpo = corte === -1 ? '' : crudo.slice(corte).replace(/^\r?\n\r?\n/, '');
  const tipo = (cabecera(cab, 'Content-Type') ?? 'text/plain').toLowerCase();
  const cte = (cabecera(cab, 'Content-Transfer-Encoding') ?? '').toLowerCase();
  const dec = (s: string): string => {
    if (cte === 'base64') return textoDeBase64(s.replace(/\s+/g, ''));
    if (cte === 'quoted-printable') return utf8DeLatin1(decodificarQp(s));
    return s;
  };
  const frontera = /boundary="?([^";\s]+)"?/i.exec(cabecera(cab, 'Content-Type') ?? '')?.[1];
  if (tipo.startsWith('multipart/') && frontera && profundidad < 3) {
    const partes = cuerpo.split(`--${frontera}`).slice(1).filter((p) => !p.startsWith('--'));
    const textos: string[] = [];
    let html: string | null = null;
    for (const p of partes) {
      const pcorte = p.search(/\r?\n\r?\n/);
      const pcab = (pcorte === -1 ? p : p.slice(0, pcorte)).replace(/^\r?\n/, '');
      if (/content-disposition:\s*attachment/i.test(pcab)) continue;
      const ptipo = (cabecera(pcab, 'Content-Type') ?? 'text/plain').toLowerCase();
      const sub = cuerpoMime(p.replace(/^\r?\n/, ''), profundidad + 1);
      if (ptipo.startsWith('text/html')) html = sub; else if (ptipo.startsWith('text/plain') || ptipo.startsWith('multipart/')) textos.push(sub);
    }
    return textos.length > 0 ? textos.join('\n') : (html ?? '');
  }
  if (tipo.startsWith('text/html')) return htmlATexto(dec(cuerpo));
  if (tipo.startsWith('text/')) return dec(cuerpo);
  return '';
}

/** Un .eml o el cuerpo de un correo (texto o HTML) a texto leíble. Los adjuntos de un .eml NO se abren. */
function prepararCorreo(bytes: Uint8Array, avisos: string[]): ContenidoDoc {
  const crudo = textoDeBytes(bytes).replace(/^\ufeff/, '');
  let de: string | null = null; let asunto: string | null = null; let fecha: string | null = null;
  let cuerpo: string;
  if (parecenCabecerasDeCorreo(crudo)) {
    const corte = crudo.search(/\r?\n\r?\n/);
    const cab = corte === -1 ? crudo : crudo.slice(0, corte);
    de = cabecera(cab, 'From') ?? cabecera(cab, 'De');
    asunto = cabecera(cab, 'Subject') ?? cabecera(cab, 'Asunto');
    fecha = cabecera(cab, 'Date');
    cuerpo = cuerpoMime(crudo);
    if (/content-disposition:\s*attachment/i.test(crudo)) avisos.push('El correo trae adjuntos: no se abren desde un .eml; súbelos por separado.');
  } else if (/^\s*<(!doctype\s+html|html)/i.test(crudo)) {
    cuerpo = htmlATexto(crudo);
  } else {
    cuerpo = crudo;
  }
  cuerpo = cuerpo.replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (cuerpo.length < 10) throw new Error('El correo no trae texto legible.');
  const encabezado = [de ? `De: ${de}` : null, asunto ? `Asunto: ${asunto}` : null, fecha ? `Fecha: ${fecha}` : null].filter(Boolean).join('\n');
  const texto = recortar(encabezado ? `${encabezado}\n\n${cuerpo}` : cuerpo, MAX_TEXTO_GUARDADO);
  return { formato: 'correo', texto, imagenes: [], tabla: null, xml: null, avisos, correo: { de, asunto, fecha } };
}

/** Prepara el contenido de un archivo YA detectado. Lanza con un motivo en español si no se puede leer. */
export async function prepararContenido(bytes: Uint8Array, clase: ClaseDoc): Promise<ContenidoDoc> {
  const avisos: string[] = [];
  try {
    switch (clase) {
      case 'pdf': return await prepararPdf(bytes, avisos);
      case 'imagen': return await prepararImagen(bytes, avisos);
      case 'excel': return prepararHoja(bytes, false, avisos);
      case 'csv': return prepararHoja(bytes, true, avisos);
      case 'xml': return prepararXml(bytes, avisos);
      case 'correo': return prepararCorreo(bytes, avisos);
      case 'json': return prepararJson(bytes, avisos);
    }
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    // Los errores propios ya son frases; los de las librerías (pdf.js, sharp, xlsx) no.
    if (/^(El|Las|Los|PDF|No )/.test(m) && m.length < 200) throw new Error(m);
    if (clase === 'pdf') throw new Error('El PDF está dañado, protegido con contraseña o no se pudo leer.');
    if (clase === 'imagen') throw new Error('La imagen está dañada o es demasiado grande para leerla.');
    throw new Error('El archivo está dañado o no se pudo leer.');
  }
}
