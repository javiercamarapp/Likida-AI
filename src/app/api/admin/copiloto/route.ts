// ═══════════════════════════════════════════════════════════════════════════
// EL ENDPOINT DEL COPILOTO DEL FUNDADOR — /api/admin/copiloto.
//
// LA PUERTA SE RE-CHEQUEA AQUÍ (mismo criterio que api/admin/palette): las
// rutas /api no pasan por el layout de /admin — este archivo es su propia
// puerta, y detrás hay lecturas cross-tenant con service role MÁS gasto de
// modelo por llamada. Sin sesión: 401. Otro rol: 403. Ninguna dice qué hay.
//
// DOS OPERACIONES, un discriminador en el cuerpo:
//  · { mensajes }            → el chat (streaming NDJSON, como /dashboard/chat).
//    Con `conversacionId` opcional: cada intercambio se persiste (0121) y el
//    'fin' devuelve el id — la lista y la lectura viven en ./conversaciones.
//    Si la respuesta trae un bloque `accion` implementada, el SERVIDOR crea
//    un AdminActionIntent (copiloto-intents.ts) y el bloque viaja con su
//    `intentId` — esa es la única llave que después ejecuta.
//  · { intentId, accion }    → EJECUTAR presentando el intent que ESTE
//    servidor creó al proponer. Ya NO existe `confirmado: true` como
//    autoridad: el intent se valida (existe, no usado, no expirado, mismo
//    actor, mismos args) y se gasta — inválido/expirado es 409. Las acciones
//    `gateo: 'doble'` exigen motivo y DOS POSTs con el mismo intent (armar →
//    ejecutar); las 'confirma' ejecutan con uno. Determinista, sin modelo
//    (copiloto-acciones.ts).
//
// COSTO: se loguea por turno (copiloto.costo). NO va a llm_costo a propósito:
// esa tabla exige tenant_id (0003) y el copiloto es gasto de LIKIDA, no de
// una flota — cargárselo a un tenant mentiría en su pantalla de costos.
// Decisión anotada en el reporte de fase; si el gasto crece, la salida es
// una columna nullable o un tenant interno, no un tenant real de relleno.
// ═══════════════════════════════════════════════════════════════════════════
import { NextResponse } from 'next/server';
import { rateLimit } from '@/lib/ratelimit';
import { ejecutarCopiloto, type BloqueCopiloto, type BloqueAccion } from '@/lib/agents/copiloto';
import { ejecutarAccionCopiloto } from '@/lib/agents/copiloto-acciones';
import { crearIntent, reclamarIntent, hashArgsAccion } from '@/lib/agents/copiloto-intents';
import { guardarIntercambioCopiloto } from '@/lib/agents/copiloto-historial';
import { validarConversacionId } from '@/app/api/dashboard/chat/validacion';
import { DatoInvalido } from '@/lib/likida/errores';
import { logger } from '@/lib/logger';
import { sesionSuperadmin } from './puerta';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

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

/** Techo diario de TURNOS del copiloto. El mapeo del 16-ago encontró que
 *  este era el ÚNICO camino de LLM sin freno de gasto: el chat del cliente
 *  tiene topeDiaUsd, y aquí una sesión secuestrada o un bucle de la UI
 *  gastaba sin techo. No se mide en USD porque el costo del copiloto no va
 *  a llm_costo (decisión de arriba: es gasto de Likida, no de un tenant),
 *  así que el freno cuenta TURNOS con el rate limiter persistente: 300/día
 *  ≈ un día PESADO de dirección × margen; a ~$0.01/turno son ~$3/día de
 *  techo. Override: LIKIDA_COPILOTO_TOPE_TURNOS_DIA. */
function topeTurnosDia(): number {
  const v = Number(process.env.LIKIDA_COPILOTO_TOPE_TURNOS_DIA);
  return Number.isFinite(v) && v > 0 ? v : 300;
}
const DIA_MS = 24 * 60 * 60 * 1000;

export async function POST(req: Request) {
  const { error: puerta, sesion } = await sesionSuperadmin();
  if (!sesion) return puerta;

  // Anti-bucle (20/min) + techo diario de turnos. Por userId: el freno es
  // contra el bucle y el secuestro, no contra Javier — y se le DICE cuál
  // tope pegó, porque un freno silencioso se depura como si fuera un bug.
  if (!(await rateLimit(`copiloto:min:${sesion.userId}`, 20, 60_000))) {
    return NextResponse.json({ error: 'tope por minuto del copiloto (20/min) — espera un momento' }, { status: 429 });
  }
  if (!(await rateLimit(`copiloto:dia:${sesion.userId}`, topeTurnosDia(), DIA_MS))) {
    return NextResponse.json({ error: `tope diario del copiloto (${topeTurnosDia()} turnos) — sube LIKIDA_COPILOTO_TOPE_TURNOS_DIA si es a propósito` }, { status: 429 });
  }

  let cuerpo: Record<string, unknown>;
  try { cuerpo = await req.json() as Record<string, unknown>; } catch {
    return NextResponse.json({ error: 'cuerpo inválido' }, { status: 400 });
  }

  // ── Camino 2: ejecutar una acción con su INTENT (sin modelo, sin stream) ─
  if (cuerpo.accion !== undefined || cuerpo.intentId !== undefined) {
    const a = cuerpo.accion as { id?: unknown; objetivo?: unknown; motivo?: unknown } | null;
    const accionId = typeof a?.id === 'string' ? a.id : '';
    const objetivo = typeof a?.objetivo === 'string' ? a.objetivo : '';
    const motivo = typeof a?.motivo === 'string' ? a.motivo : undefined;
    // La regla del diseño §5.3, versión intent: ninguna acción sin la llave
    // que ESTE servidor emitió al proponer. Un `confirmado: true` del
    // cliente ya no pinta nada — el booleano dejó de ser la autoridad.
    const intentId = typeof cuerpo.intentId === 'string' ? cuerpo.intentId : '';
    if (!intentId) {
      return NextResponse.json({
        error: 'La acción llegó sin un intent del servidor — pide la acción al copiloto y confirma desde su previsualización.',
      }, { status: 409 });
    }
    const reclamo = reclamarIntent({
      intentId,
      actorId: sesion.userId,
      argsHash: hashArgsAccion(accionId, objetivo),
      motivo,
    });
    if (!reclamo.ok) {
      // 'motivo' es validación de entrada (400); lo demás es un intent que
      // ya no autoriza nada (409) — y en ambos se dice qué hacer.
      return NextResponse.json({ error: reclamo.error }, { status: reclamo.codigo === 'motivo' ? 400 : 409 });
    }
    if (reclamo.fase === 'armado') {
      // 'doble': primer POST válido. NO ejecutó — falta repetir el POST con
      // el mismo intentId para gastar el intent.
      return NextResponse.json({
        ok: true,
        armado: true,
        mensaje: 'Primera confirmación registrada. Confirma de nuevo para ejecutar — esta acción exige doble confirmación.',
      });
    }
    try {
      const r = await ejecutarAccionCopiloto(accionId, {
        id: objetivo || undefined,
        motivo: reclamo.motivo ?? undefined,
      }, sesion.userId);
      return NextResponse.json(r);
    } catch (e) {
      // El intent ya se gastó: un fallo aquí NO deja una llave viva para
      // reintentar a ciegas — se re-propone (fallar cerrado, sin replay).
      if (e instanceof DatoInvalido) return NextResponse.json({ error: e.message }, { status: 400 });
      logger.error('copiloto.accion_fallo', { accion: accionId, err: e instanceof Error ? e.message : String(e) });
      return NextResponse.json({ error: 'No se pudo ejecutar la acción. El detalle quedó en los registros.' }, { status: 500 });
    }
  }

  // ── Camino 1: el chat (streaming NDJSON, patrón de /dashboard/chat) ──────
  const mensajes = validarMensajes(cuerpo.mensajes);
  if (!mensajes) return NextResponse.json({ error: 'mensajes inválidos' }, { status: 400 });
  // El id de conversación al que anexar (historial 0121). Inválido o ajeno →
  // conversación nueva, jamás la de otro (el anclaje vive en el módulo).
  const conversacionPedida = validarConversacionId(cuerpo.conversacionId);

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
        // EL INTENT NACE AL PROPONER (copiloto-intents.ts): cada bloque
        // `accion` implementada sale con el `intentId` que el servidor acaba
        // de crear para ESTA sesión — la única llave que después ejecuta. Las
        // no implementadas no llevan intent: no hay nada que autorizar.
        type BloqueConIntent = BloqueCopiloto | (BloqueAccion & { intentId: string });
        const bloques: BloqueConIntent[] = r.bloques.map((b) => (
          b.tipo === 'accion' && b.implementada
            ? { ...b, intentId: crearIntent({ actorId: sesion.userId, accion: b.accion, objetivo: b.objetivo, gateo: b.gateo }).id }
            : b
        ));
        logger.info('copiloto.costo', {
          costoUsd: r.costoUsd, tokensIn: r.tokensIn, tokensOut: r.tokensOut,
          modelo: r.modelo, tools: r.toolsUsadas.length,
        });
        // Persistir el intercambio (0121). Si falla, la respuesta IGUAL sale —
        // el historial es una comodidad; la respuesta ya costó dinero.
        let conversacionId: string | null = null;
        try {
          conversacionId = await guardarIntercambioCopiloto({
            userId: sesion.userId,
            conversacionId: conversacionPedida,
            pregunta: mensajes[mensajes.length - 1].texto,
            textoRespuesta: bloques
              .filter((b): b is { tipo: 'texto'; texto: string } => b.tipo === 'texto' && typeof (b as { texto?: unknown }).texto === 'string')
              .map((b) => b.texto).join(' ') || 'Listo.',
            // Con intentId incluido — inofensivo en el historial: las
            // reaperturas se pintan ARCHIVADAS y el intent expira en 2 min.
            bloques: bloques as unknown as Array<Record<string, unknown>>,
          });
        } catch (err) {
          logger.error('copiloto.guardar_fallo', { err: err instanceof Error ? err.message : String(err) });
        }
        manda({ t: 'fin', bloques, toolsUsadas: r.toolsUsadas, conversacionId });
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
