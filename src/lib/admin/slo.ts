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

function p95(valores: number[]): number | null {
  if (valores.length === 0) return null;
  const orden = [...valores].sort((a, b) => a - b);
  return orden[Math.min(orden.length - 1, Math.ceil(orden.length * 0.95) - 1)];
}

export async function getSLOs(): Promise<Slo[]> {
  const admin = supabaseAdmin();
  const hace30d = new Date(ahoraMs() - 30 * 86_400_000).toISOString();
  const hace1h = new Date(ahoraMs() - 3_600_000).toISOString();
  const hace24h = new Date(ahoraMs() - 86_400_000).toISOString();
  const out: Slo[] = [];

  // ── 1. Corridas de agentes: tasa de éxito ≥95% (30d) ────────────────────
  try {
    const { data, error } = await admin.from('agente_corrida')
      .select('estado, inicio, fin').gte('inicio', hace30d).limit(5000);
    if (error) throw new Error(error.message);
    const total = (data ?? []).length;
    const ok = (data ?? []).filter((f) => f.estado === 'ok').length;
    if (total < MUESTRA_MINIMA) {
      out.push({ clave: 'agentes_exito', nombre: 'Corridas de agentes exitosas', objetivo: '≥ 95%', medido: `${total} corridas — muestra insuficiente (mínimo ${MUESTRA_MINIMA})`, cumple: null, ventana: '30 días' });
    } else {
      const pct = Math.round((ok / total) * 1000) / 10;
      out.push({ clave: 'agentes_exito', nombre: 'Corridas de agentes exitosas', objetivo: '≥ 95%', medido: `${pct}% (${ok}/${total})`, cumple: pct >= 95, ventana: '30 días' });
    }
    // ── 2. p95 de duración de corridas OK ≤ 120 s ─────────────────────────
    const duraciones = (data ?? [])
      .filter((f) => f.estado === 'ok' && f.fin)
      .map((f) => (Date.parse(f.fin as string) - Date.parse(f.inicio as string)) / 1000)
      .filter((s) => Number.isFinite(s) && s >= 0);
    const p = p95(duraciones);
    if (p === null || duraciones.length < MUESTRA_MINIMA) {
      out.push({ clave: 'agentes_p95', nombre: 'p95 de duración de corrida', objetivo: '≤ 120 s', medido: `${duraciones.length} corridas medibles — muestra insuficiente`, cumple: null, ventana: '30 días' });
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
