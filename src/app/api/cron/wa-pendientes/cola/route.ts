import { NextResponse, type NextRequest } from 'next/server';
import { Receiver } from '@upstash/qstash';
import { logger } from '@/lib/logger';
import { leerInterruptor } from '@/lib/likida/interruptores';
import { drenarBandeja } from '../drenado';

export const runtime = 'nodejs';
// Su propio presupuesto, como el callback de facturar: la vuelta encolada no
// hereda lo que ya gastó el cron que la encoló.
export const maxDuration = 120;

// ═══════════════════════════════════════════════════════════════════════════
// EL CALLBACK DE QSTASH DEL DRENADO (ESC-1).
//
// El cron corre cada minuto y drena 40 mensajes; si el lote sale LLENO hay más
// esperando, y encola aquí la vuelta siguiente en vez de dejarla para dentro
// de un minuto. Cada vuelta puede encolar la siguiente hasta el techo de
// `MAX_VUELTAS_QSTASH`, así que un pico de 800 mensajes se drena en el mismo
// minuto en el que entró.
//
// PÚBLICO por diseño pero protegido por la FIRMA de QStash, igual que
// `facturar/cola`: sin verificarla, cualquiera podría disparar el drenado —que
// manda WhatsApp a personas reales— con solo conocer la URL.
// ═══════════════════════════════════════════════════════════════════════════
export async function POST(req: NextRequest) {
  const inicioInvocacion = Date.now();
  const currentKey = process.env.QSTASH_CURRENT_SIGNING_KEY;
  const nextKey = process.env.QSTASH_NEXT_SIGNING_KEY;
  if (!currentKey || !nextKey) {
    logger.error('qstash.wa_pendientes.sin_config', { current: !!currentKey, next: !!nextKey });
    return NextResponse.json({ error: 'QStash no configurado' }, { status: 503 });
  }

  const raw = await req.text();
  try {
    const receiver = new Receiver({ currentSigningKey: currentKey, nextSigningKey: nextKey });
    const valido = await receiver.verify({ signature: req.headers.get('upstash-signature') ?? '', body: raw });
    if (!valido) {
      logger.warn('qstash.wa_pendientes.firma_invalida', {});
      return NextResponse.json({ error: 'Firma inválida' }, { status: 401 });
    }
  } catch (e) {
    logger.warn('qstash.wa_pendientes.verificacion_error', { err: e instanceof Error ? e.message : String(e) });
    return NextResponse.json({ error: 'No se pudo verificar la firma' }, { status: 401 });
  }

  let vuelta = 0;
  try {
    vuelta = Number((JSON.parse(raw) as { vuelta?: number }).vuelta ?? 0);
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  // EL KILL SWITCH TAMBIÉN AQUÍ (0110): una vuelta encolada segundos antes del
  // apagón llegaría por esta puerta y procesaría lo que se acaba de apagar.
  // 200 y no 5xx: un 5xx haría que QStash reintentara, o sea insistir en
  // correr lo apagado. La bandeja es durable; nada se pierde por esperar.
  const global = await leerInterruptor('global');
  if (global === 'ilegible') {
    return NextResponse.json({
      corrio: false,
      error: 'No se pudo leer el interruptor global: la bandeja no se drena sin saber si está apagado.',
      codigo: 'interruptor_ilegible',
    }, { status: 500 });
  }
  if (global === 'apagado') {
    logger.warn('qstash.wa_pendientes.saltado', { interruptor: 'global', vuelta });
    return NextResponse.json({ corrio: false, saltado: 'interruptor global' });
  }

  const r = await drenarBandeja(inicioInvocacion, req, vuelta);
  if (r.error !== undefined) {
    return NextResponse.json({ error: r.error, vuelta }, { status: 500 });
  }
  return NextResponse.json({
    corrio: true,
    vuelta,
    procesados: r.procesados,
    fallidos: r.fallidos,
    pospuestos: r.pospuestos,
    ...(r.encolado ? { encolado: r.encolado } : {}),
  }, { status: r.fallidos > 0 ? 500 : 200 });
}
