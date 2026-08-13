// El endpoint del agente analista — "Pregunta a tus datos" (12-ago-2026).
//
// Autorización calcada de /api/dashboard/asistente e ingesta (el matcher del
// proxy excluye /api: esta línea es la única puerta, y el mismo IDOR que se
// cerró allá aplica aquí — esto lee dinero de TODA la flota con service role
// y además GASTA en el modelo por llamada).
//
// ANTI-QUEMADURA (pedido explícito: "que no implique que si se quedan ahí
// todo el día quemar un exceso de tokens"), tres capas:
//  1. Por turno: 5 rondas de tools + 900 tokens de salida (analista.ts).
//  2. Por petición: historial recortado a 12 turnos / 2,000 chars cada uno.
//  3. POR DÍA Y POR TENANT: tope en USD contra `llm_costo` (fase chat, hoy
//     en America/Mexico_City). Agotado, el endpoint responde `agotado:true`
//     y el cliente degrada al respondedor gratis — el chat nunca queda mudo.
import { NextResponse, type NextRequest } from 'next/server';
import { getSessionTenant } from '@/lib/auth/session';
import { tenantDemo } from '@/lib/auth/tenant-demo';
import { puedeVerArea } from '@/lib/auth/visibilidad';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { acotada } from '@/lib/likida/presupuesto';
import { registrarCosto, faseDeModelo } from '@/lib/likida/costos';
import { ejecutarAnalista } from '@/lib/agents/analista';
import { ahoraMs } from '@/lib/saludo';
import { logger } from '@/lib/logger';
import { inicioDiaMxIso, validarMensajes } from './validacion';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Tope diario de gasto de chat POR TENANT, en USD. Subió de 0.25 a 1.00 el
 *  12-ago-2026 cuando Javier confirmó su pricing ("a una flota le cobro
 *  mucho más"): a ~$0.005 el análisis medido, $1 son ~200 análisis/día —
 *  un contralor premium en cierre de semana no debe toparse con un muro
 *  por centavos. El techo absoluto queda en ~$30 USD/mes por tenant, ruido
 *  contra el ticket; el candado sigue atrapando bucles y curiosos. */
function topeDiaUsd(): number {
  const v = Number(process.env.LIKIDA_CHAT_TOPE_DIA_USD);
  return Number.isFinite(v) && v > 0 ? v : 1.0;
}

export async function POST(req: NextRequest) {
  const sesion = await getSessionTenant();
  if (!sesion) return NextResponse.json({ error: 'sin sesion' }, { status: 401 });
  if (!puedeVerArea(sesion.rol, 'dinero')) {
    return NextResponse.json({ error: 'sin acceso' }, { status: 403 });
  }

  let tenantId = sesion.tenantId;
  if (!tenantId) {
    if (sesion.rol !== 'superadmin') return NextResponse.json({ error: 'sin acceso' }, { status: 403 });
    tenantId = tenantDemo();
  }

  // Un `?tenant=` solo lo honra un superadmin, y solo si existe de verdad.
  let nombreFlota = 'tu flota';
  const pedido = req.nextUrl.searchParams.get('tenant');
  if (pedido && sesion.rol === 'superadmin') {
    const { data: t } = await acotada(
      supabaseAdmin().from('tenant').select('id, nombre').eq('id', pedido).maybeSingle(), 'chat.tenant');
    if (t) { tenantId = t.id as string; nombreFlota = (t.nombre as string) ?? nombreFlota; }
  } else {
    const { data: t } = await acotada(
      supabaseAdmin().from('tenant').select('nombre').eq('id', tenantId).maybeSingle(), 'chat.tenant');
    if (t?.nombre) nombreFlota = t.nombre as string;
  }

  let cuerpo: unknown;
  try { cuerpo = await req.json(); } catch { return NextResponse.json({ error: 'cuerpo inválido' }, { status: 400 }); }
  const mensajes = validarMensajes((cuerpo as { mensajes?: unknown })?.mensajes);
  if (!mensajes) return NextResponse.json({ error: 'mensajes inválidos' }, { status: 400 });

  // ── Tope diario ──
  const { data: filas, error: errTope } = await acotada(
    supabaseAdmin().from('llm_costo').select('costo_usd')
      .eq('tenant_id', tenantId).eq('fase', 'chat')
      .gte('created_at', inicioDiaMxIso(ahoraMs())),
    'chat.tope_dia');
  // Fallar CERRADO: si no se pudo leer el gasto del día, no se gasta más.
  if (errTope) {
    logger.error('chat.tope_dia.error', { err: errTope.message });
    return NextResponse.json({ agotado: true, bloques: [{ tipo: 'texto', texto: 'No pude verificar el presupuesto del día — el análisis con IA descansa un momento. Las respuestas rápidas siguen funcionando.' }] });
  }
  const gastadoHoy = (filas ?? []).reduce((s, f) => s + Number((f as { costo_usd: unknown }).costo_usd ?? 0), 0);
  if (gastadoHoy >= topeDiaUsd()) {
    return NextResponse.json({
      agotado: true,
      bloques: [{ tipo: 'texto', texto: 'El análisis con IA de hoy llegó a su tope diario (existe para cuidar tu costo). Mañana se renueva solo; mientras, las respuestas rápidas del catálogo siguen funcionando.' }],
    });
  }

  try {
    const r = await ejecutarAnalista({ tenantId, nombreFlota, usuario: { nombre: sesion.nombre, rol: sesion.rol }, mensajes });
    // El costo se registra POR MODELO real (mismo criterio que processor.ts):
    // una fila con la etiqueta del último modelo miente cuando hubo fallback.
    for (const [modelo, c] of Object.entries(r.costoPorModelo)) {
      await registrarCosto({
        tenantId, viajeId: null, fase: faseDeModelo(modelo, 'chat'), modelo,
        tokensIn: c.tokensIn, tokensOut: c.tokensOut, costoUsd: c.cost,
      });
    }
    return NextResponse.json({ bloques: r.bloques });
  } catch (err) {
    logger.error('chat.analista.fallo', { err: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({ error: 'el analista no pudo responder en este momento' }, { status: 502 });
  }
}
