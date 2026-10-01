import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { acotada } from '@/lib/likida/presupuesto';
import { estaApagado } from '@/lib/likida/interruptores';
import { rateLimit, clientIp } from '@/lib/ratelimit';
import { cuerpoAcotado } from '../../correo/_cuerpo';
import {
  MAX_CUERPO_INGESTA_BYTES, secretoMaestro, claveDeFlota, verificarFirmaIngesta, leerCuerpoIngesta,
  recibirArchivoPeaje, esUuid,
} from '@/lib/likida/peajes/ingesta';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/peajes/ingesta — el buzón firmado del desglose del proveedor.
//
// El archivo del proveedor (PASE, IAVE, TeleVía) llega cada ~10 días. En vez de
// que alguien lo suba a mano, el sistema del proveedor/cliente (o un script de
// la flota) lo manda aquí, y el cron `peajes` lo importa y lo cruza.
//
// Este endpoint es un POST SIN SESIÓN: lo que lo protege es la firma. El orden de
// las comprobaciones no es arbitrario:
//
//  1. RATE LIMIT por IP, antes de leer nada.
//  2. CUERPO acotado mientras se lee (un chunked sin content-length no llena la
//     memoria), y CRUDO: la firma cubre los bytes tal cual, no un JSON reparseado.
//  3. FIRMA antes de interpretar una sola cosa del cuerpo. La llave es POR FLOTA
//     y se deriva del secreto maestro: sin PEAJES_INGESTA_SECRETO (o con uno
//     corto) todo se rechaza — una variable olvidada no abre un buzón.
//     Una flota sin activar o desconocida contesta lo MISMO que una firma mala
//     (401): a quien no está autorizado no se le dice qué existe.
//  4. KILL SWITCH: con `agente:peajes` apagado se contesta 503 (no 200): el
//     remitente reintenta y el archivo no se pierde para siempre.
//  5. IDEMPOTENCIA: el mismo contenido (sha256) es la MISMA fila; reenviarlo
//     contesta 200 `duplicado`, no crea otro.
//
// Respuestas: 202 aceptado (en cola) · 200 duplicado · 400 cuerpo mal formado ·
// 401 firma/flota · 413 cuerpo grande · 429 límite/cola llena · 503 reintenta.
// ═══════════════════════════════════════════════════════════════════════════

const RECHAZO = 'Firma no válida.';

export async function POST(req: Request) {
  if (!(await rateLimit(`peajes-ingesta:ip:${clientIp(req)}`, 60, 60_000))) {
    return new NextResponse('Demasiadas peticiones', { status: 429 });
  }

  const secreto = secretoMaestro();
  if (!secreto) {
    logger.error('peajes.ingesta.sin_secreto', { codigo: 'peajes_sin_secreto' });
    return new NextResponse(RECHAZO, { status: 401 });
  }

  let crudo: string | null;
  try {
    crudo = await cuerpoAcotado(req, MAX_CUERPO_INGESTA_BYTES);
  } catch {
    return NextResponse.json({ error: 'No se pudo leer el cuerpo.' }, { status: 400 });
  }
  if (crudo === null) return new NextResponse('Payload too large', { status: 413 });

  const tenantId = req.headers.get('x-likida-flota')?.trim().toLowerCase() ?? null;
  if (!esUuid(tenantId)) {
    logger.warn('peajes.ingesta.flota_invalida', {});
    return new NextResponse(RECHAZO, { status: 401 });
  }

  // La rotación de la flota (y si activó el buzón). Un error de base es 503: el
  // remitente reintenta; un «no hay fila» es 401 igual que una firma mala.
  const { data: cfg, error: errCfg } = await acotada(supabaseAdmin()
    .from('peaje_ingesta_config').select('rotacion, activa').eq('tenant_id', tenantId).maybeSingle(), 'peajes.ingesta.config');
  if (errCfg) {
    logger.error('peajes.ingesta.config', { err: errCfg.message });
    return NextResponse.json({ error: 'No se pudo validar la flota.' }, { status: 503 });
  }
  if (!cfg || cfg.activa === false) {
    logger.warn('peajes.ingesta.flota_sin_buzon', { tenant: tenantId });
    return new NextResponse(RECHAZO, { status: 401 });
  }

  const firma = verificarFirmaIngesta(
    claveDeFlota(secreto, tenantId, Number(cfg.rotacion)),
    tenantId,
    { timestamp: req.headers.get('x-likida-timestamp'), firma: req.headers.get('x-likida-firma') },
    crudo,
    Date.now(),
  );
  if (!firma.ok) {
    // El motivo real solo al log: distinguirlo le enseñaría al que lo intenta a ajustar.
    logger.warn('peajes.ingesta.firma', { tenant: tenantId, motivo: firma.motivo });
    return new NextResponse(RECHAZO, { status: 401 });
  }

  // Desde aquí el remitente está demostrado: límite por flota.
  if (!(await rateLimit(`peajes-ingesta:flota:${tenantId}`, 30, 60_000))) {
    return new NextResponse('Demasiadas peticiones', { status: 429 });
  }

  const cuerpo = leerCuerpoIngesta(crudo);
  if (!cuerpo.ok) return NextResponse.json({ error: cuerpo.motivo }, { status: 400 });

  if (await estaApagado('agente:peajes')) {
    logger.warn('peajes.ingesta.apagado', { tenant: tenantId });
    return NextResponse.json({ error: 'El agente de peajes está apagado. Reintenta más tarde.' }, { status: 503 });
  }

  const r = await recibirArchivoPeaje(tenantId, cuerpo.cuerpo, 'api');
  if (!r.ok) {
    if (r.codigo === 'cola_llena') return NextResponse.json({ error: r.motivo }, { status: 429 });
    logger.error('peajes.ingesta.recepcion', { tenant: tenantId, err: r.motivo });
    return NextResponse.json({ error: 'No se pudo guardar el archivo. Reintenta.' }, { status: 503 });
  }
  logger.info('peajes.ingesta.recibido', { tenant: tenantId, archivo: r.id, duplicado: r.duplicado });
  return NextResponse.json({ ok: true, id: r.id, duplicado: r.duplicado, estado: r.estado }, { status: r.duplicado ? 200 : 202 });
}
