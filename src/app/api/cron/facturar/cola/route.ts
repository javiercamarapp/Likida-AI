import { NextResponse, type NextRequest } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { procesarLoteEnCola, type FilaCola } from '../route';

export const runtime = 'nodejs';
// QStash permite hasta 10 min de timeout para el worker; el lote de 8 tickets
// con varias flotas lo necesita (el techo de 300s de una invocación directa es
// justo lo que esta cola existe para romper).
export const maxDuration = 600;

// ═══════════════════════════════════════════════════════════════════════════
// EL CALLBACK DE QSTASH — el cron encola aquí el lote (ronda 16) y este
// endpoint lo procesa con su propio presupuesto.
//
// PÚBLICO por diseño pero protegido por la FIRMA de QStash: sin el token de
// verificación, cualquiera podría encolar un lote a procesar. `verify()` de
// @upstash/qstash valida la firma y el cuerpo exactos.
// ═══════════════════════════════════════════════════════════════════════════
export async function POST(req: NextRequest) {
  const token = process.env.UPSTASH_QSTASH_TOKEN;
  const currentKey = process.env.QSTASH_CURRENT_SIGNING_KEY;
  const nextKey = process.env.QSTASH_NEXT_SIGNING_KEY;
  if (!token || !currentKey || !nextKey) {
    logger.error('qstash.cola.sin_config', { token: !!token, current: !!currentKey, next: !!nextKey });
    return NextResponse.json({ error: 'QStash no configurado' }, { status: 503 });
  }

  // Verificar la firma de QStash ANTES de tocar nada.
  const raw = await req.text();
  try {
    const { Receiver } = await import('@upstash/qstash');
    // Las SIGNING KEYS reales de QStash (Settings → Signing Keys) — no el
    // token: QStash firma con ellas, y verificarlas con el token fallaría.
    const receiver = new Receiver({ currentSigningKey: currentKey, nextSigningKey: nextKey });
    const valido = await receiver.verify({
      signature: req.headers.get('upstash-signature') ?? '',
      body: raw,
    });
    if (!valido) {
      logger.warn('qstash.cola.firma_invalida', {});
      return NextResponse.json({ error: 'Firma inválida' }, { status: 401 });
    }
  } catch (e) {
    logger.warn('qstash.cola.verificacion_error', { err: e instanceof Error ? e.message : String(e) });
    return NextResponse.json({ error: 'No se pudo verificar la firma' }, { status: 401 });
  }

  let body: { lote?: FilaCola[]; quedaron?: number };
  try {
    body = JSON.parse(raw) as typeof body;
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const lote = body.lote ?? [];
  if (lote.length === 0) return NextResponse.json({ corrio: true, vacio: true });

  // Re-validar que los gastos siguen en la cola (un intento previo pudo
  // facturarlos): no se procesa un ticket que ya tiene CFDI.
  const ids = lote.map((g) => g.id);
  const { data: vigentes, error } = await supabaseAdmin()
    .from('gasto')
    .select('id')
    .in('id', ids)
    .is('cfdi_uuid', null);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const vigentesIds = new Set((vigentes ?? []).map((v) => v.id));
  const loteVigente = lote.filter((g) => vigentesIds.has(g.id));

  const hoy = new Date().toISOString().slice(0, 10);
  const inicio = Date.now();
  // QStash espera un 2xx para dar por procesado; un 5xx dispara el reintento
  // (retries: 2). El resultado del procesamiento es el de la función compartida.
  return procesarLoteEnCola(loteVigente, req as unknown as Request, hoy, inicio, body.quedaron ?? 0);
}
