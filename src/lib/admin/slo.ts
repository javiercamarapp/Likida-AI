import { supabaseAdmin } from '@/lib/supabase/admin';
import { ahoraMs } from '@/lib/saludo';

// ═══════════════════════════════════════════════════════════════════════════
// SLOs MEDIDOS (fase 7, auditoría 5 §34/§38) — objetivos declarados contra
// datos REALES de las tablas del producto. Un SLO sin medición no se pinta
// como verde: `cumple: null` = no se pudo medir o no hay muestra suficiente,
// y la página lo dice con esas palabras (cero ≠ ciego, regla de la casa).
// ═══════════════════════════════════════════════════════════════════════════

export interface Slo {
  clave: string;
  nombre: string;
  /** El objetivo, en palabras — declarado, no implícito. */
  objetivo: string;
  /** Lo medido, en palabras (con su cifra adentro). */
  medido: string;
  /** true = cumple · false = NO cumple · null = sin muestra o sin lectura. */
  cumple: boolean | null;
  ventana: string;
}

const MUESTRA_MINIMA = 5;

export async function getSLOs(): Promise<Slo[]> {
  const admin = supabaseAdmin();
  const hace30d = new Date(ahoraMs() - 30 * 86_400_000).toISOString();
  const hace1h = new Date(ahoraMs() - 3_600_000).toISOString();
  const hace24h = new Date(ahoraMs() - 86_400_000).toISOString();
  const out: Slo[] = [];

  // ── 1 y 2. Corridas de agentes: tasa de éxito ≥95% y p95 ≤ 120 s (30d) ──
  //
  // FE-8: esto leía `agente_corrida` con `.limit(5000)` y SIN `order`, y
  // calculaba los dos SLO en JS. PostgREST recorta a 1,000 filas EN SILENCIO,
  // así que el límite real nunca fue 5,000; y sin `order`, esas 1,000 son las
  // que la base devolvió primero — un conjunto ARBITRARIO. Un SLO medido
  // sobre una muestra que nadie eligió no es una medición, y este panel se
  // pinta verde o rojo con ella.
  //
  // `slo_agente_corrida()` (mig. 0162) cuenta y calcula el p95 en la base con
  // `percentile_disc`, que es el MISMO estadístico que hacía el JS (rango más
  // cercano: un valor que de verdad ocurrió, no una interpolación).
  try {
    const { data, error } = await admin.rpc('slo_agente_corrida', { p_desde: hace30d });
    if (error) throw new Error(error.message);
    const r = data as Record<string, unknown> | null;
    const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    const total = num(r?.total);
    const ok = num(r?.ok);
    const medibles = num(r?.medibles);
    // `p95Segundos` viene NULL cuando no hay ni una corrida medible — eso NO
    // es un error de forma, es la ausencia de muestra, y se dice abajo.
    const p = r?.p95Segundos === null || r?.p95Segundos === undefined ? null : Number(r.p95Segundos);
    if (total === null || ok === null || medibles === null) {
      throw new Error('slo_agente_corrida devolvió otra forma (¿migración 0162 sin aplicar?)');
    }
    if (total < MUESTRA_MINIMA) {
      out.push({ clave: 'agentes_exito', nombre: 'Corridas de agentes exitosas', objetivo: '≥ 95%', medido: `${total} corridas — muestra insuficiente (mínimo ${MUESTRA_MINIMA})`, cumple: null, ventana: '30 días' });
    } else {
      const pct = Math.round((ok / total) * 1000) / 10;
      out.push({ clave: 'agentes_exito', nombre: 'Corridas de agentes exitosas', objetivo: '≥ 95%', medido: `${pct}% (${ok}/${total})`, cumple: pct >= 95, ventana: '30 días' });
    }
    if (p === null || !Number.isFinite(p) || medibles < MUESTRA_MINIMA) {
      out.push({ clave: 'agentes_p95', nombre: 'p95 de duración de corrida', objetivo: '≤ 120 s', medido: `${medibles} corridas medibles — muestra insuficiente`, cumple: null, ventana: '30 días' });
    } else {
      out.push({ clave: 'agentes_p95', nombre: 'p95 de duración de corrida', objetivo: '≤ 120 s', medido: `${Math.round(p)} s`, cumple: p <= 120, ventana: '30 días' });
    }
  } catch {
    out.push({ clave: 'agentes_exito', nombre: 'Corridas de agentes exitosas', objetivo: '≥ 95%', medido: 'no se pudo leer', cumple: null, ventana: '30 días' });
    out.push({ clave: 'agentes_p95', nombre: 'p95 de duración de corrida', objetivo: '≤ 120 s', medido: 'no se pudo leer', cumple: null, ventana: '30 días' });
  }

  // ── 3. Inbox durable de WhatsApp: nada atorado > 1 h ────────────────────
  try {
    const { count, error } = await admin.from('wa_evento_pendiente')
      .select('id', { count: 'exact', head: true })
      .is('procesado_en', null).lt('recibido_en', hace1h);
    if (error) throw new Error(error.message);
    if (typeof count !== 'number') throw new Error('sin conteo');
    out.push({ clave: 'wa_inbox', nombre: 'Mensajes de WhatsApp atorados', objetivo: '0 sin procesar tras 1 h', medido: `${count}`, cumple: count === 0, ventana: 'ahora' });
  } catch {
    out.push({ clave: 'wa_inbox', nombre: 'Mensajes de WhatsApp atorados', objetivo: '0 sin procesar tras 1 h', medido: 'no se pudo leer', cumple: null, ventana: 'ahora' });
  }

  // ── 4. Stripe: cero eventos sin sellar (0132) ───────────────────────────
  try {
    const { count, error } = await admin.from('evento_stripe')
      .select('id', { count: 'exact', head: true }).is('aplicado_en', null);
    if (error) throw new Error(error.message);
    if (typeof count !== 'number') throw new Error('sin conteo');
    out.push({ clave: 'stripe_sellado', nombre: 'Eventos de Stripe sin aplicar', objetivo: '0 (el reintento los re-aplica)', medido: `${count}`, cumple: count === 0, ventana: 'ahora' });
  } catch {
    out.push({ clave: 'stripe_sellado', nombre: 'Eventos de Stripe sin aplicar', objetivo: '0 (el reintento los re-aplica)', medido: 'no se pudo leer', cumple: null, ventana: 'ahora' });
  }

  // ── 5. Bus de mando: ninguna orden pendiente > 24 h ─────────────────────
  try {
    const { count, error } = await admin.from('bus_orden')
      .select('id', { count: 'exact', head: true })
      .eq('estado', 'pendiente').lt('creado_en', hace24h);
    if (error) throw new Error(error.message);
    if (typeof count !== 'number') throw new Error('sin conteo');
    out.push({ clave: 'bus_ordenes', nombre: 'Órdenes del bus sin atender', objetivo: '0 pendientes tras 24 h', medido: `${count}`, cumple: count === 0, ventana: 'ahora' });
  } catch {
    out.push({ clave: 'bus_ordenes', nombre: 'Órdenes del bus sin atender', objetivo: '0 pendientes tras 24 h', medido: 'no se pudo leer', cumple: null, ventana: 'ahora' });
  }

  return out;
}
