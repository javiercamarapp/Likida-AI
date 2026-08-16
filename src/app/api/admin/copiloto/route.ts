// ═══════════════════════════════════════════════════════════════════════════
// EL ENDPOINT DEL COPILOTO DEL FUNDADOR — /api/admin/copiloto.
//
// LA PUERTA SE RE-CHEQUEA AQUÍ (mismo criterio que api/admin/palette): las
// rutas /api no pasan por el layout de /admin — este archivo es su propia
// puerta, y detrás hay lecturas cross-tenant con service role MÁS gasto de
// modelo por llamada. Sin sesión: 401. Otro rol: 403. Ninguna dice qué hay.
//
// DOS OPERACIONES, un discriminador en el cuerpo:
//  · { mensajes }            → el chat (streaming NDJSON, como /dashboard/chat)
//  · { accion, confirmado }  → EJECUTAR una acción ya confirmada por Javier —
//    determinista, sin modelo (copiloto-acciones.ts). El servidor RECHAZA
//    sin `confirmado: true`: la confirmación del cliente no es decorativa.
//
// COSTO: se loguea por turno (copiloto.costo). NO va a llm_costo a propósito:
// esa tabla exige tenant_id (0003) y el copiloto es gasto de LIKIDA, no de
// una flota — cargárselo a un tenant mentiría en su pantalla de costos.
// Decisión anotada en el reporte de fase; si el gasto crece, la salida es
// una columna nullable o un tenant interno, no un tenant real de relleno.
// ═══════════════════════════════════════════════════════════════════════════
import { NextResponse } from 'next/server';
import { getSessionTenant } from '@/lib/auth/session';
import { ejecutarCopiloto } from '@/lib/agents/copiloto';
import { ejecutarAccionCopiloto } from '@/lib/agents/copiloto-acciones';
import { DatoInvalido } from '@/lib/likida/errores';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

async function sesionSuperadmin() {
  const s = await getSessionTenant();
  if (!s) return { error: new NextResponse(null, { status: 401 }), sesion: null };
  if (s.rol !== 'superadmin') return { error: new NextResponse(null, { status: 403 }), sesion: null };
  return { error: null, sesion: s };
}

/** Historial acotado (mismos topes que valida /dashboard/chat): 12 turnos,
 *  2,000 chars cada uno — el cliente no es frontera de confianza. */
function validarMensajes(crudo: unknown): Array<{ rol: 'usuario' | 'asistente'; texto: string }> | null {
  if (!Array.isArray(crudo) || crudo.length === 0 || crudo.length > 24) return null;
  const out: Array<{ rol: 'usuario' | 'asistente'; texto: string }> = [];
  for (const m of crudo.slice(-24)) {
    const rol = (m as { rol?: unknown })?.rol;
    const texto = (m as { texto?: unknown })?.texto;
    if ((rol !== 'usuario' && rol !== 'asistente') || typeof texto !== 'string' || !texto.trim()) return null;
    out.push({ rol, texto: texto.trim().slice(0, 2000) });
  }
  if (out[out.length - 1].rol !== 'usuario') return null;
  return out;
}

export async function POST(req: Request) {
  const { error: puerta, sesion } = await sesionSuperadmin();
  if (!sesion) return puerta;

  let cuerpo: Record<string, unknown>;
  try { cuerpo = await req.json() as Record<string, unknown>; } catch {
    return NextResponse.json({ error: 'cuerpo inválido' }, { status: 400 });
  }

  // ── Camino 2: ejecutar una acción confirmada (sin modelo, sin stream) ────
  if (cuerpo.accion !== undefined) {
    const a = cuerpo.accion as { id?: unknown; objetivo?: unknown; motivo?: unknown } | null;
    if (cuerpo.confirmado !== true) {
      // La regla del diseño §5.3: ninguna acción con consecuencia sin
      // confirmación explícita — y la valida el SERVIDOR, no el botón.
      return NextResponse.json({ error: 'La acción llegó sin confirmación explícita — no se ejecuta.' }, { status: 400 });
    }
    const accionId = typeof a?.id === 'string' ? a.id : '';
    try {
      const r = await ejecutarAccionCopiloto(accionId, {
        id: typeof a?.objetivo === 'string' ? a.objetivo : undefined,
        motivo: typeof a?.motivo === 'string' ? a.motivo : undefined,
      }, sesion.userId);
      return NextResponse.json(r);
    } catch (e) {
      if (e instanceof DatoInvalido) return NextResponse.json({ error: e.message }, { status: 400 });
      logger.error('copiloto.accion_fallo', { accion: accionId, err: e instanceof Error ? e.message : String(e) });
      return NextResponse.json({ error: 'No se pudo ejecutar la acción. El detalle quedó en los registros.' }, { status: 500 });
    }
  }

  // ── Camino 1: el chat (streaming NDJSON, patrón de /dashboard/chat) ──────
  const mensajes = validarMensajes(cuerpo.mensajes);
  if (!mensajes) return NextResponse.json({ error: 'mensajes inválidos' }, { status: 400 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controlador) {
      const manda = (ev: unknown) => {
        try { controlador.enqueue(encoder.encode(`${JSON.stringify(ev)}\n`)); } catch { /* cliente cerró */ }
      };
      try {
        const r = await ejecutarCopiloto({
          userId: sesion.userId,
          mensajes,
          onPaso: (p) => manda({ t: 'paso', fase: p.fase, tool: p.tool }),
        });
        logger.info('copiloto.costo', {
          costoUsd: r.costoUsd, tokensIn: r.tokensIn, tokensOut: r.tokensOut,
          modelo: r.modelo, tools: r.toolsUsadas.length,
        });
        manda({ t: 'fin', bloques: r.bloques, toolsUsadas: r.toolsUsadas });
      } catch (err) {
        logger.error('copiloto.fallo', { err: err instanceof Error ? err.message : String(err) });
        manda({ t: 'error', error: 'el copiloto no pudo responder en este momento' });
      } finally {
        try { controlador.close(); } catch { /* ya cerrado */ }
      }
    },
  });
  return new Response(stream, {
    headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
