// ═══════════════════════════════════════════════════════════════════════════
// VALIDACIÓN CFDI — el truco #1 de precisión: NO hacer OCR del UUID.
//
// El QR del CFDI (SAT) contiene en texto plano: id=UUID, re=RFC emisor,
// rr=RFC receptor, tt=total, fe=sello. Decodificarlo da esos campos con 0%
// de error, muy superior a leer un UUID de 36 chars con visión. Además se
// valida el formato de RFC/UUID por código (el JSON válido no garantiza el
// valor correcto — constrained decoding puede degradar la semántica).
// ═══════════════════════════════════════════════════════════════════════════

import jsQR from 'jsqr';
import sharp from 'sharp';

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

/** Decodifica el QR de una imagen (data-URL o buffer) y devuelve los datos del CFDI. */
export async function decodeCfdiFromImage(image: Buffer): Promise<CfdiQrData | null> {
  try {
    const { data, info } = await sharp(image)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const code = jsQR(new Uint8ClampedArray(data), info.width, info.height);
    if (!code?.data) return null;
    const parsed = parseCfdiQr(code.data);
    return Object.keys(parsed).length ? parsed : null;
  } catch {
    return null;
  }
}

export function bufferFromDataUrl(dataUrl: string): Buffer {
  const comma = dataUrl.indexOf(',');
  const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  return Buffer.from(b64, 'base64');
}
