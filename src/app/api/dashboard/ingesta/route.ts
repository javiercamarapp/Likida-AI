// Lectura de PRUEBA de un comprobante desde el panel — la pata "Ingest" de
// la página Preguntar a la IA (12-ago-2026).
//
// Corre el MISMO OCR del motor (`extraerComprobante`, el de WhatsApp) sobre
// la imagen que el usuario adjunta y devuelve lo leído. NO ESCRIBE NADA:
// ni gasto, ni foto, ni costo por liquidación — es una sonda para que el
// contralor vea qué leería el motor. La ingesta que sí registra sigue
// siendo el flujo de WhatsApp, que trae viaje, operador y dedup.
//
// Autorización: calcada de /api/dashboard/asistente (el IDOR que se cerró
// ahí aplica igual aquí — el matcher del proxy excluye /api, esta línea es
// la única puerta). Además esto GASTA dinero por llamada de visión: sin rol
// correcto no se toca el modelo.
import { NextResponse, type NextRequest } from 'next/server';
import { getSessionTenant } from '@/lib/auth/session';
import { puedeVerArea } from '@/lib/auth/visibilidad';
import { extraerComprobante } from '@/lib/likida/intake/ocr';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** ~6 MB de imagen ya como data-URL (base64 infla ~1.37×). El límite es de
 *  cortesía para el modelo de visión, no de seguridad: Vercel ya corta el
 *  cuerpo mucho más arriba. */
const MAX_DATAURL = 9_000_000;

export async function POST(req: NextRequest) {
  const sesion = await getSessionTenant();
  if (!sesion) return NextResponse.json({ error: 'sin sesion' }, { status: 401 });
  if (!puedeVerArea(sesion.rol, 'dinero')) {
    return NextResponse.json({ error: 'sin acceso' }, { status: 403 });
  }

  let imagen: unknown;
  try {
    ({ imagen } = await req.json());
  } catch {
    return NextResponse.json({ error: 'cuerpo inválido' }, { status: 400 });
  }
  if (typeof imagen !== 'string' || !imagen.startsWith('data:image/')) {
    return NextResponse.json({ error: 'se espera una imagen (data URL)' }, { status: 400 });
  }
  if (imagen.length > MAX_DATAURL) {
    return NextResponse.json({ error: 'imagen demasiado grande (máx ~6 MB)' }, { status: 413 });
  }

  try {
    // 45s de tope: por debajo del maxDuration para alcanzar a responder.
    const r = await extraerComprobante(imagen, AbortSignal.timeout(45_000));
    logger.info('ingesta.sonda', {
      tenantId: sesion.tenantId, rol: sesion.rol, legible: r.legible,
      motivo: r.motivo ?? null, costoUsd: r.costo.costoUsd,
    });
    // Solo lo que el panel va a ENSEÑAR — nunca el objeto Gasto entero
    // (trae campos internos que no son para la pantalla).
    return NextResponse.json({
      legible: r.legible,
      motivo: r.motivo ?? null,
      campos: {
        concepto: r.gasto.concepto ?? null,
        monto: r.gasto.monto ?? null,
        fecha: r.gasto.fecha ?? null,
        folio: r.gasto.folio ?? null,
        rfcEmisor: r.gasto.rfcEmisor ?? null,
        litros: typeof r.gasto.ocrExtra?.litros === 'number' ? r.gasto.ocrExtra.litros : null,
        confianza: r.gasto.ocrConfianza ?? null,
      },
    });
  } catch (err) {
    logger.error('ingesta.sonda.fallo', { err: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({ error: 'no se pudo leer la imagen en este momento' }, { status: 502 });
  }
}
