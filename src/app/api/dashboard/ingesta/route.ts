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
//
// ANTI-QUEMADURA (AUDITORÍA 18, A6/A25): la ruta se copió del hermano por su
// autorización y no por su contabilidad — no tenía rateLimit, ni tope, ni
// escribía en `llm_costo`. Tres capas, como /api/dashboard/chat:
//  1. rateLimit por usuario (SONDAS_POR_MINUTO).
//  2. Tope diario por tenant contra `llm_costo` (fase ocr, sin viaje) —
//     fallando CERRADO si no se pudo leer.
//  3. Cada llamada deja su fila de costo: el tablero de /admin y el costo
//     por flota la cuentan.
import { NextResponse, type NextRequest } from 'next/server';
import { MAX_DATAURL } from './limites';
import { getSessionTenant } from '@/lib/auth/session';
import { puedeVerArea } from '@/lib/auth/visibilidad';
import { extraerComprobante } from '@/lib/likida/intake/ocr';
import { createLlmBudget } from '@/lib/llm/budget';
import { randomUUID } from 'node:crypto';
import { registrarCosto } from '@/lib/likida/costos';
import { rateLimit } from '@/lib/ratelimit';
import { logger } from '@/lib/logger';
import { gastoSondaHoyUsd, topeSondaDiaUsd, SONDAS_POR_MINUTO } from './tope';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;


export async function POST(req: NextRequest) {
  const sesion = await getSessionTenant();
  if (!sesion) return NextResponse.json({ error: 'sin sesion' }, { status: 401 });
  if (!puedeVerArea(sesion.rol, 'dinero')) {
    return NextResponse.json({ error: 'sin acceso' }, { status: 403 });
  }
  if (!(await rateLimit(`ingesta:${sesion.userId}`, SONDAS_POR_MINUTO, 60_000))) {
    return NextResponse.json({ error: 'demasiadas lecturas seguidas; espera un minuto' }, { status: 429 });
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
    return NextResponse.json({
      error: 'La imagen pesa demasiado (máx ~3 MB de foto). Vuelve a tomarla en calidad normal o recórtala al ticket.',
    }, { status: 413 });
  }

  // ── Tope diario ── se lee ANTES de gastar; fallar cerrado si no se pudo.
  const tenantId = sesion.tenantId;
  if (!tenantId) return NextResponse.json({ error: 'sin acceso' }, { status: 403 });
  let gastadoHoy: number;
  try {
    gastadoHoy = await gastoSondaHoyUsd(tenantId);
  } catch (e) {
    logger.error('ingesta.tope_dia.error', { tenantId, err: e instanceof Error ? e.message : String(e) });
    return NextResponse.json({ error: 'no pude verificar el presupuesto del día; inténtalo en un momento' }, { status: 503 });
  }
  if (gastadoHoy >= topeSondaDiaUsd()) {
    return NextResponse.json({ error: 'la lectura de prueba llegó a su tope diario (existe para cuidar tu costo); mañana se renueva', agotado: true }, { status: 429 });
  }

  try {
    // 45s de tope: por debajo del maxDuration para alcanzar a responder.
    const r = await extraerComprobante(imagen, AbortSignal.timeout(45_000), createLlmBudget(tenantId, randomUUID(), 'interactivo'));
    // La fila de costo: sin viaje (es una sonda) y con la fase del OCR — es
    // lo que el tope de arriba lee y lo que el tablero de costo de IA suma.
    await registrarCosto({
      tenantId, viajeId: null, fase: 'ocr', modelo: r.costo.modelo,
      tokensIn: r.costo.tokensIn, tokensOut: r.costo.tokensOut, costoUsd: r.costo.costoUsd,
    });
    logger.info('ingesta.sonda', {
      tenantId, rol: sesion.rol, legible: r.legible,
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
