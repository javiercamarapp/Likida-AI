// ═══════════════════════════════════════════════════════════════════════════
// VALIDACIÓN CFDI — el truco #1 de precisión: NO hacer OCR del UUID.
//
// El QR del CFDI (SAT) contiene en texto plano: id=UUID, re=RFC emisor,
// rr=RFC receptor, tt=total, fe=sello. Decodificarlo da esos campos con 0%
// de error, muy superior a leer un UUID de 36 chars con visión. Además se
// valida el formato de RFC/UUID por código (el JSON válido no garantiza el
// valor correcto — constrained decoding puede degradar la semántica).
// ═══════════════════════════════════════════════════════════════════════════

import sharp from 'sharp';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { readBarcodes, prepareZXingModule } from 'zxing-wasm/reader';

const RFC_RE = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface CfdiQrData {
  uuid?: string;
  rfcEmisor?: string;
  rfcReceptor?: string;
  total?: number;
  sello?: string;
}

export function esRfcValido(rfc: string | undefined): boolean {
  return !!rfc && RFC_RE.test(rfc.toUpperCase());
}
export function esUuidValido(uuid: string | undefined): boolean {
  return !!uuid && UUID_RE.test(uuid);
}

// Alfabeto del RFC con el valor de cada carácter (posición = valor).
const ALFABETO_RFC = '0123456789ABCDEFGHIJKLMN&OPQRSTUVWXYZ';
function valorRfc(c: string): number {
  if (c === ' ') return 37;
  if (c === 'Ñ') return 38;
  return ALFABETO_RFC.indexOf(c);
}

/**
 * Verifica el dígito verificador del RFC (el último carácter, calculado sobre
 * los 12 anteriores).
 *
 * Para qué: el regex de formato acepta cualquier cosa con la forma correcta. En
 * campo el OCR leyó el mismo RFC como PER / PEX / PTE en tres corridas del mismo
 * ticket —el real es PEC— y las tres pasaron. Esto no adivina el correcto, pero
 * delata que está mal en vez de darlo por bueno y salir a consultar al SAT con
 * un emisor que no existe.
 */
export function rfcChecksumOk(rfc: string | undefined): boolean {
  if (!rfc) return false;
  const r = rfc.trim().toUpperCase();
  // Genéricos del SAT: legítimos y de uso corriente, pero NO cumplen el
  // algoritmo del dígito verificador. Sin esta excepción marcaríamos como
  // sospechoso el RFC de cualquier ticket a público en general.
  if (r === 'XAXX010101000' || r === 'XEXX010101000') return true;
  if (r.length !== 12 && r.length !== 13) return false;
  // Persona moral (12): se alinea a 13 con un espacio al frente, que vale 37.
  const completo = r.length === 12 ? ` ${r}` : r;
  let suma = 0;
  for (let i = 0; i < 12; i++) {
    const v = valorRfc(completo[i]);
    if (v < 0) return false;
    suma += v * (13 - i);
  }
  // 11 − resto, con los dos casos que no caben en un dígito: si da 11 → '0',
  // si da 10 → 'A'.
  const resto = suma % 11;
  const esperado = resto === 0 ? '0' : resto === 1 ? 'A' : String(11 - resto);
  return completo[12] === esperado;
}

/** Parsea el contenido del QR del CFDI (URL de verificación del SAT). */
export function parseCfdiQr(qrText: string): CfdiQrData {
  const out: CfdiQrData = {};
  try {
    // Formato: https://verificacfdi.facturaelectronica.sat.gob.mx/...?id=UUID&re=RFC&rr=RFC&tt=000.00&fe=xxxx
    const q = qrText.includes('?') ? qrText.split('?')[1] : qrText;
    const params = new URLSearchParams(q);
    const id = params.get('id') ?? undefined;
    const re = params.get('re') ?? undefined;
    const rr = params.get('rr') ?? undefined;
    const tt = params.get('tt') ?? undefined;
    const fe = params.get('fe') ?? undefined;
    if (id && esUuidValido(id)) out.uuid = id.toLowerCase();
    if (re && esRfcValido(re)) out.rfcEmisor = re.toUpperCase();
    if (rr && esRfcValido(rr)) out.rfcReceptor = rr.toUpperCase();
    if (tt) {
      const n = parseFloat(tt);
      if (!Number.isNaN(n)) out.total = n;
    }
    if (fe) out.sello = fe;
  } catch {
    // QR no es de CFDI o formato inesperado.
  }
  return out;
}

/**
 * Qué traía el QR. NO todo QR de un comprobante es del SAT: en un ticket de
 * gasolinera o tienda el QR suele ser la LIGA DE AUTOFACTURACIÓN del emisor.
 * Antes se tiraba en silencio por no parsear como CFDI — y es justo el dato que
 * la oficina necesita para timbrar el ticket.
 */
export interface QrLeido {
  texto: string;            // contenido crudo del QR
  cfdi?: CfdiQrData;        // QR de verificación del SAT
  urlFacturacion?: string;  // cualquier otra URL: portal de autofacturación
  folioPortal?: string;     // folio que venía DENTRO de la liga (no del OCR)
  totalPortal?: number;     // total que venía DENTRO de la liga (no del OCR)
}

/**
 * Varios portales de autofacturación meten el folio y el total codificados en
 * base64 en la propia liga del QR (medido en un ticket de Office Depot:
 * `.../generaF/<folio en b64>/<total en b64>`). Sacarlos de ahí da los dos
 * campos EXACTOS —los mismos que el OCR leyó distinto en cada corrida— sin
 * pasar por visión.
 *
 * El filtro es deliberadamente estricto —largo múltiplo de 4, alfabeto base64 y
 * round-trip idéntico— porque un falso positivo aquí no es un hueco: es un
 * folio inventado que la oficina va a teclear en un portal.
 */
function datosDeLigaPortal(url: string): { folioPortal?: string; totalPortal?: number } {
  const out: { folioPortal?: string; totalPortal?: number } = {};
  // OJO: NO se parte en '=', que es el relleno de base64 ('NDAyNy4xMA==' se
  // haría trizas). Para `?clave=valor` se prueba también lo que va tras el
  // primer '=', que es donde vive el dato cuando viaja como parámetro.
  const piezas = url.split(/[/?#&]/);
  const candidatos = piezas.flatMap((p) => {
    const i = p.indexOf('=');
    return i > 0 && i < p.length - 1 ? [p, p.slice(i + 1)] : [p];
  });
  for (const seg of candidatos) {
    if (seg.length < 8 || seg.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(seg)) continue;
    let claro: string;
    try {
      claro = Buffer.from(seg, 'base64').toString('utf8');
      if (Buffer.from(claro, 'utf8').toString('base64') !== seg) continue; // no era base64
    } catch {
      continue;
    }
    if (!/^[\x20-\x7E]+$/.test(claro)) continue; // basura binaria
    if (out.totalPortal === undefined && /^\d+(\.\d{1,2})?$/.test(claro)) {
      const n = parseFloat(claro);
      if (n > 0) out.totalPortal = n;
    } else if (out.folioPortal === undefined && /^[A-Z0-9-]{6,40}$/i.test(claro)) {
      out.folioPortal = claro;
    }
  }
  return out;
}

/** Separa un QR del SAT de una liga de portal. */
export function clasificarQr(texto: string): QrLeido {
  const t = texto.trim();
  const cfdi = parseCfdiQr(t);
  if (Object.keys(cfdi).length) return { texto: t, cfdi };
  if (/^https?:\/\//i.test(t)) return { texto: t, urlFacturacion: t, ...datosDeLigaPortal(t) };
  if (/^www\./i.test(t)) return { texto: t, urlFacturacion: `https://${t}`, ...datosDeLigaPortal(t) };
  return { texto: t };
}

/** Un código leído de la foto, con el formato que resultó ser. */
export interface CodigoLeido extends QrLeido {
  formato: string; // 'QRCode', 'Code93', 'Code128', 'EAN-13'…
}

/**
 * zxing es WebAssembly y su cargador por defecto hace `fetch` del `.wasm`, que
 * en Node no existe. Se le pasa el binario ya leído de disco: funciona igual en
 * vitest, en `next dev` y en una función de Vercel, y evita la sorpresa clásica
 * de descubrir el wasm roto el día del deploy. `zxing-wasm` va en
 * `serverExternalPackages` (next.config.ts) para que el paquete —y su `.wasm`—
 * queden en node_modules del deploy en vez de pasar por el bundler.
 *
 * Se prepara UNA sola vez por proceso: en Vercel el contenedor se reutiliza
 * entre invocaciones, así que el costo de arranque se paga una vez, no por foto.
 */
/**
 * Dónde está el `.wasm` en disco.
 *
 * El especificador se ARMA en tiempo de ejecución a propósito. Escrito como
 * literal, Turbopack lo ve, intenta empaquetar el `.wasm` como si fuera un
 * módulo y el build revienta con "Module not found: Can't resolve 'a'" — pasó,
 * está medido. Partido en pedazos el bundler no puede analizarlo y lo deja
 * pasar como lo que es: una lectura de archivo en runtime.
 *
 * Que el archivo LLEGUE al deploy es cosa aparte, y por eso next.config.ts lo
 * mete a la fuerza con `outputFileTracingIncludes`: el tracer sigue imports, y
 * aquí justamente no hay ninguno que seguir.
 */
function rutaDelWasm(): string {
  const partes = ['zxing-wasm', 'reader', 'zxing_reader.wasm'];
  try {
    return createRequire(import.meta.url).resolve(partes.join('/'));
  } catch {
    // Si el `exports` del paquete no deja resolver el subpath, se cae a la ruta
    // física dentro de node_modules del proyecto.
    return join(process.cwd(), 'node_modules', partes[0], 'dist', partes[1], partes[2]);
  }
}

let zxingPreparado: Promise<void> | null = null;
function prepararZxing(): Promise<void> {
  zxingPreparado ??= (async () => {
    const wasm = await readFile(rutaDelWasm());
    await prepareZXingModule({
      overrides: { wasmBinary: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) },
      fireImmediately: true,
    });
  })();
  return zxingPreparado;
}

/**
 * Lee TODOS los códigos de una foto: QR y códigos de barras 1D.
 *
 * Por qué zxing y no jsQR: sobre la foto de campo de `__fixtures__` —un
 * acercamiento deliberado al ticket— jsQR falla en 1600, 1200 y 900 px, y aun
 * si leyera el QR no puede ver el Code93, porque jsQR solo lee 2D. El folio de
 * facturación del ticket viaja justo en ese código de barras.
 */
export async function decodeCodigosFromImage(image: Buffer): Promise<CodigoLeido[]> {
  try {
    await prepararZxing();
    // `.rotate()` aplica la orientación EXIF: sharp trabaja sobre píxeles crudos
    // y las fotos de iPhone vienen con orientación 3 (180°). Sin esto el código
    // le llega de cabeza al lector.
    //
    // Dos escalas, no más: sobre una foto de 24 Mpx la pasada a resolución
    // nativa cuesta segundos y no encuentra nada que no encuentre la de 1600 px
    // (medido el 27-jul-2026 con tickets de campo). El presupuesto del request
    // —60 s para TODA la liquidación— vale más que esa cola.
    for (const ancho of [1600, 1000]) {
      const buf = await sharp(image).rotate().resize({ width: ancho, withoutEnlargement: true }).jpeg().toBuffer();
      const leidos = await readBarcodes(new Blob([new Uint8Array(buf)]), { tryHarder: true });
      const codigos = leidos.filter((r) => r.text).map((r) => ({ ...clasificarQr(r.text), formato: r.format }));
      if (codigos.length) return codigos;
    }
    return [];
  } catch {
    return [];
  }
}

/**
 * Un solo código de la foto, el más útil de los que haya.
 *
 * Los que fallan en campo fallan por daño FÍSICO —doblez del papel cruzando el
 * código, impresión térmica moteada, código fuera de encuadre— y contra eso
 * ningún preprocesado sirve: se probaron 10 variantes (escalas, normalise,
 * threshold, blur) sobre un recorte limpio y las 10 fallaron; un mosaico de 13
 * recortes costaba 2–4 s por foto y no rescató ni uno. Lo que sí funciona es
 * otra FOTO: el mismo ticket de cerca entra en ~100 ms. Por eso el intake
 * acepta varias imágenes por comprobante en vez de insistir sobre una sola.
 */
export async function decodeQrFromImage(image: Buffer): Promise<QrLeido | null> {
  const codigos = await decodeCodigosFromImage(image);
  if (!codigos.length) return null;
  // Prioridad: datos fiscales del SAT > liga de portal > lo que haya. Un ticket
  // puede traer QR y código de barras a la vez (Office Depot trae los dos).
  return codigos.find((c) => c.cfdi) ?? codigos.find((c) => c.urlFacturacion) ?? codigos[0];
}

/**
 * Compatibilidad: devuelve SOLO los datos fiscales del SAT.
 * Para la liga de autofacturación usar `decodeQrFromImage`.
 */
export async function decodeCfdiFromImage(image: Buffer): Promise<CfdiQrData | null> {
  const qr = await decodeQrFromImage(image);
  return qr?.cfdi && Object.keys(qr.cfdi).length ? qr.cfdi : null;
}

export function bufferFromDataUrl(dataUrl: string): Buffer {
  const comma = dataUrl.indexOf(',');
  const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  return Buffer.from(b64, 'base64');
}
