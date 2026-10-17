// ═══════════════════════════════════════════════════════════════════════════
// POST /v1/ccp-timbrado — el aviso del TMS: «este CCP ya quedó timbrado» (T-A3-33, vía (a) de la ficha).
//
// El TMS del cliente invoca esto al timbrar (con una llave de API de la flota) y entrega el PDF y el XML TAL CUAL. Likida
// registra el UUID fiscal y, solo si la flota activó «responder al cliente», contesta por correo al remitente original del
// documento. ESTA RUTA NO TIMBRA NI CREA UN CCP: guarda lo que el TMS ya timbró.
//
// ── LA PUERTA ───────────────────────────────────────────────────────────────
//   · `abrir(req, 'operacion')`: tasa, llave (o sesión del panel desde nuestro sitio), flota, perfil y área ANTES de leer
//     el cuerpo. El tenant sale de la CREDENCIAL; un `tenant_id` en el cuerpo es 400.
//   · La `referencia` debe ser de un envío de ESA flota; una ajena es 404 sin guardar y sin correo.
//
// ── IDEMPOTENCIA ────────────────────────────────────────────────────────────
// Por UUID fiscal (unique tenant_id + uuid en la base): el mismo aviso dos veces es 200 `duplicado: true`, sin un segundo
// correo. Un aviso nuevo es 201. El 201/200 acusa que se GUARDÓ; el correo es un efecto aparte (`respondido`).
//
// Cuerpo: { referencia, xmlBase64, pdfBase64 }. Base64 y no texto: el XML timbrado se entrega byte a byte (cualquier
// cambio invalida su sello). Cada archivo ≤ 8 MB (`MAX_ADJUNTO_BYTES`).
// ═══════════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { abrir, errorApi, fallo } from '../_comun';
import { leerCuerpo, texto, CampoInvalido, validar } from '../_escritura';
import { MAX_ADJUNTO_BYTES, procesarCcpTimbrado, type CodigoErrorCcp } from '@/lib/likida/carta_porte_docs/ccp_respuesta';
import { depsCcp } from '@/lib/likida/carta_porte_docs/ccp_respuesta_repo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/** Dos archivos de 8 MB en base64 (×4/3) más el sobre del JSON. */
const MAX_CUERPO_CCP_BYTES = Math.ceil((MAX_ADJUNTO_BYTES * 4) / 3) * 2 + 4096;

const CAMPOS_PERMITIDOS = new Set(['referencia', 'xmlBase64', 'pdfBase64']);
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

function archivo(cuerpo: Record<string, unknown>, campo: string): Uint8Array {
  const v = cuerpo[campo];
  if (typeof v !== 'string' || v.length === 0) throw new CampoInvalido(campo, `\`${campo}\` es obligatorio (archivo en base64).`);
  if (v.length % 4 !== 0 || !BASE64.test(v)) throw new CampoInvalido(campo, `\`${campo}\` no es base64 válido.`);
  const bytes = Buffer.from(v, 'base64');
  if (bytes.length > MAX_ADJUNTO_BYTES) throw new CampoInvalido(campo, `\`${campo}\` no puede pasar de ${MAX_ADJUNTO_BYTES / 1024 / 1024} MB.`);
  return new Uint8Array(bytes);
}

const ERROR_POR_CODIGO: Record<CodigoErrorCcp, Parameters<typeof errorApi>[0]> = {
  adjunto_grande: 'parametro_invalido',
  xml_invalido: 'parametro_invalido',
  pdf_invalido: 'parametro_invalido',
  no_encontrado: 'no_encontrado',
  sin_migracion: 'dependencia_no_disponible',
};

export async function POST(req: Request) {
  const acceso = await abrir(req, 'operacion');
  if (!acceso.ok) return acceso.respuesta;

  const cuerpo = await leerCuerpo(req, MAX_CUERPO_CCP_BYTES);
  if (!cuerpo.ok) return cuerpo.respuesta;

  const v = validar('v1.ccp_timbrado.post', () => {
    const raros = Object.keys(cuerpo.cuerpo).filter((k) => !CAMPOS_PERMITIDOS.has(k));
    if (raros.length > 0) throw new CampoInvalido(raros[0], `\`${raros[0]}\` no es un campo de este recurso (la flota sale de tu llave).`);
    return {
      referencia: texto(cuerpo.cuerpo, 'referencia', { obligatorio: true, max: 200 })!,
      xml: archivo(cuerpo.cuerpo, 'xmlBase64'),
      pdf: archivo(cuerpo.cuerpo, 'pdfBase64'),
    };
  });
  if (!v.ok) return v.respuesta;

  try {
    const r = await procesarCcpTimbrado(depsCcp(), { tenantId: acceso.tenantId, ...v.valor });
    if (!r.ok) return errorApi(ERROR_POR_CODIGO[r.codigo], r.mensaje);
    return NextResponse.json(
      { estado: r.estado, duplicado: r.duplicado, respondido: r.respondido },
      { status: r.duplicado ? 200 : 201 },
    );
  } catch (e) {
    return fallo('v1.ccp_timbrado.post', e, { tenant: acceso.tenantId });
  }
}
