import { supabaseAdmin } from '@/lib/supabase/admin';
import { acotada } from '@/lib/likida/presupuesto';
import { variantesTelefono } from '@/lib/likida/telefono_variantes';
import { logger } from '@/lib/logger';

// ═══════════════════════════════════════════════════════════════════════════
// LA PAUSA FRENA TODAS LAS SALIDAS (F20, parte a).
//
// «Pausar plan» (`asignar-plan.ts`) solo movía `suscripcion.estado`: ni el
// runner, ni el envío de WhatsApp, ni el correo lo consultaban, así que una
// flota «pausada» seguía recibiendo mensajes de los agentes.
//
// Esta es la ÚNICA lectura del estado de salidas de una flota. Todo lo que
// escribe a un tercero por cuenta de una flota la consulta ANTES de salir.
//
// ── DE DÓNDE SALE EL ESTADO (sin migración) ──────────────────────────────
//  · `pausada`  → la suscripción viva de la flota está en `pausada`.
//  · `cancelada`→ la flota NO tiene suscripción viva y sí una `cancelada`
//                 (al cancelar, la flota cae al plan demo: sin esta lectura
//                 volvería a salir como si nada).
//  · `morosa`   → NO frena. Decisión de negocio del dueño (D27): suspender a
//                 quien debe es otro acto que pausar. `POLITICA_SALIDAS` lo
//                 declara en UN solo lugar para cambiarlo con una línea.
//  · Sin filas en `suscripcion` (las flotas en plan demo y el piloto) → SALE.
//    Bloquear «sin suscripción viva» frenaría a las 4 flotas de hoy.
//
// ── FALLA CERRADO SOLO EN LAS SALIDAS ────────────────────────────────────
// Si no se puede leer el estado, NO se sale (`ilegible`). La RECEPCIÓN de
// comprobantes no pasa por aquí y nunca se bloquea.
// ═══════════════════════════════════════════════════════════════════════════

export const AVISO_PLAN_EN_PAUSA = 'Plan en pausa: los agentes no envían nada';
export const AVISO_PLAN_CANCELADO = 'Plan cancelado: los agentes no envían nada';

/** Qué estados de suscripción frenan las salidas. `morosa` queda fuera a propósito (ver arriba). */
export const POLITICA_SALIDAS = { frenaPausada: true, frenaCancelada: true, frenaMorosa: false } as const;

export type EstadoSalidas = 'libre' | 'prueba' | 'activa' | 'morosa' | 'pausada' | 'cancelada' | 'ilegible';

export type VeredictoSalidas =
  | { salen: true; estado: 'libre' | 'prueba' | 'activa' | 'morosa' }
  | { salen: false; estado: 'pausada' | 'cancelada' | 'ilegible'; mensaje: string };

const VIVAS = new Set(['prueba', 'activa', 'morosa', 'pausada']);

function vetar(estado: 'pausada' | 'cancelada' | 'ilegible'): VeredictoSalidas {
  const mensaje = estado === 'pausada' ? AVISO_PLAN_EN_PAUSA
    : estado === 'cancelada' ? AVISO_PLAN_CANCELADO
      : 'No se pudo leer el plan de la flota: por seguridad los agentes no envían nada hasta poder confirmarlo';
  return { salen: false, estado, mensaje };
}

/**
 * Pura: de las filas de `suscripcion` de UNA flota (solo sus estados) al veredicto.
 * Un estado desconocido falla cerrado: preferimos no enviar a enviar con un plan que no entendemos.
 */
export function decidirSalidas(estados: readonly string[]): VeredictoSalidas {
  if (estados.some((e) => typeof e !== 'string' || !(VIVAS.has(e) || e === 'cancelada'))) return vetar('ilegible');
  const vivas = estados.filter((e) => VIVAS.has(e));
  if (vivas.length === 0) {
    if (estados.includes('cancelada') && POLITICA_SALIDAS.frenaCancelada) return vetar('cancelada');
    return { salen: true, estado: 'libre' };
  }
  // El índice único de la 0052 garantiza una sola viva; si hubiera dos, manda la más restrictiva.
  if (vivas.includes('pausada') && POLITICA_SALIDAS.frenaPausada) return vetar('pausada');
  if (vivas.includes('morosa')) return POLITICA_SALIDAS.frenaMorosa ? vetar('pausada') : { salen: true, estado: 'morosa' };
  return { salen: true, estado: vivas.includes('activa') ? 'activa' : 'prueba' };
}

// ── caché corta, por invocación caliente: la pausa se obedece en ≤ 20 s ────
const TTL_MS = 20_000;
const cacheTenant = new Map<string, { t: number; v: VeredictoSalidas }>();
const cacheTelefono = new Map<string, { t: number; v: VeredictoSalidas }>();
const TOPE_CACHE = 500;

export function olvidarCacheSalidas(): void {
  cacheTenant.clear();
  cacheTelefono.clear();
}

function recordar(cache: Map<string, { t: number; v: VeredictoSalidas }>, k: string, v: VeredictoSalidas): void {
  if (cache.size >= TOPE_CACHE) cache.clear();
  cache.set(k, { t: Date.now(), v });
}

/** El veredicto de salidas de una flota. NUNCA lanza: ante cualquier duda, `ilegible` (no sale). */
export async function veredictoSalidasDeFlota(tenantId: string | null | undefined): Promise<VeredictoSalidas> {
  if (!tenantId) return vetar('ilegible');
  const hit = cacheTenant.get(tenantId);
  if (hit && Date.now() - hit.t < TTL_MS) return hit.v;
  try {
    const { data, error } = await acotada(supabaseAdmin()
      .from('suscripcion')
      .select('estado')
      .eq('tenant_id', tenantId)
      .limit(200), 'salidas_flota.suscripcion');
    if (error) throw new Error(error.message);
    const v = decidirSalidas(((data ?? []) as Array<{ estado?: unknown }>).map((f) => String(f.estado)));
    // `ilegible` no se recuerda: que la siguiente salida vuelva a intentar leer.
    if (v.estado !== 'ilegible') recordar(cacheTenant, tenantId, v);
    return v;
  } catch (e) {
    logger.error('salidas_flota.ilegible', { error: e instanceof Error ? e.message : String(e) });
    return vetar('ilegible');
  }
}

/** `true` solo si la flota está en condiciones de que sus agentes envíen. */
export async function salidasPermitidas(tenantId: string | null | undefined): Promise<boolean> {
  return (await veredictoSalidasDeFlota(tenantId)).salen;
}

/**
 * El veredicto para un mensaje a un TELÉFONO: se resuelve a qué flota(s) pertenece (operador o usuario de oficina).
 *  · Teléfono que no es de ninguna flota (equipo de Likida, prospecto): SALE; no pertenece a un plan que frenar.
 *  · Si pertenece a varias flotas, basta que UNA esté frenada para frenar (conservador: es un dato ambiguo).
 *  · Si no se puede resolver el dueño, NO sale.
 */
export async function veredictoSalidasHaciaTelefono(telefono: string): Promise<VeredictoSalidas> {
  const llave = telefono.replace(/[^\d]/g, '');
  const hit = cacheTelefono.get(llave);
  if (hit && Date.now() - hit.t < TTL_MS) return hit.v;
  try {
    const variantes = variantesTelefono(telefono);
    const [op, us] = await Promise.all([
      acotada(supabaseAdmin().from('operador').select('tenant_id').in('telefono', variantes).limit(20), 'salidas_flota.operador'),
      acotada(supabaseAdmin().from('app_user').select('tenant_id').in('telefono', variantes).limit(20), 'salidas_flota.app_user'),
    ]);
    if (op.error) throw new Error(op.error.message);
    if (us.error) throw new Error(us.error.message);
    const tenants = new Set<string>();
    for (const f of [...(op.data ?? []), ...(us.data ?? [])] as Array<{ tenant_id?: string | null }>) {
      if (f.tenant_id) tenants.add(f.tenant_id);
    }
    let v: VeredictoSalidas = { salen: true, estado: 'libre' };
    for (const t of tenants) {
      const vt = await veredictoSalidasDeFlota(t);
      if (!vt.salen) { v = vt; break; }
    }
    if (v.estado !== 'ilegible') recordar(cacheTelefono, llave, v);
    return v;
  } catch (e) {
    logger.error('salidas_flota.telefono_ilegible', { error: e instanceof Error ? e.message : String(e) });
    return vetar('ilegible');
  }
}
