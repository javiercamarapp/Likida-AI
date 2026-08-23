// ═══════════════════════════════════════════════════════════════════════════
// LA FICHA 360 DEL CLIENTE — la vista unificada por tenant que el plan hacia
// el 90% marcó como hueco de /admin: "ciclo de vida (lead→cliente), consumo
// de IA, tickets, facturación SaaS, salud — tres pantallas separadas, cero
// vista unificada". La consume /admin/flotas/[id] Y la tool `ficha_cliente`
// del copiloto ("¿cómo va el cliente X?" en una consulta, no cinco).
//
// CROSS-TENANT A PROPÓSITO, como todo lib/admin — pero cada consulta va
// FILTRADA al tenant de la ficha. Resiliencia POR SECCIÓN (patrón
// inicio-contenido): una sección caída llega `null` y la pantalla lo dice —
// jamás un cero con cara de medición.
// ═══════════════════════════════════════════════════════════════════════════
import { supabaseAdmin } from '@/lib/supabase/admin';
import { getKpis, type DashboardKpis } from '@/lib/likida/analytics';
import { getSenalesPmf, type SenalesPmf } from '@/lib/likida/pmf';
import { getSuscripcion, getFacturasSaas, type Suscripcion, type FacturaSaas } from '@/lib/saas/suscripcion';
import { getTicketsCruzados, type TicketCruzado } from './soporte';
import { costoIaDeTenant } from './negocio';

async function safe<T>(fn: () => Promise<T>): Promise<T | null> {
  try { return await fn(); } catch { return null; }
}

export interface FichaCliente {
  tenant: { id: string; nombre: string; plan: string; creadoEn: string | null };
  /** El prospecto del que NACIÓ este cliente (prospecto.tenant_id se llena
   *  solo al cerrar) — `null` real cuando no vino del pipeline, y la ficha
   *  lo distingue de "no se pudo leer" con `origenLegible`. */
  origen: { empresa: string; fuente: string; capturadoEn: string; cerradoEn: string | null } | null;
  origenLegible: boolean;
  operacion: DashboardKpis | null;
  pmf: SenalesPmf | null;
  consumoIa: { historicoUsd: number; d30Usd: number } | null;
  suscripcion: Suscripcion | null;
  suscripcionLegible: boolean;
  facturasSaas: FacturaSaas[] | null;
  /** Tickets del tenant, los abiertos primero (ya vienen ordenados por SLA). */
  tickets: TicketCruzado[] | null;
  /** Últimas corridas de agentes DE ESTA flota — su pulso operativo. */
  corridas: Array<{ agente: string; estado: string; disparo: string; fin: string }> | null;
}

export async function getFichaCliente(tenantId: string): Promise<FichaCliente | null> {
  // El tenant primero y SIN safe: si esta lectura falla o no hay fila, no
  // hay ficha que armar — la página decide 404 vs error con el throw.
  const { data: t, error } = await supabaseAdmin()
    .from('tenant').select('id, nombre, plan, created_at').eq('id', tenantId).maybeSingle();
  if (error) throw new Error(`getFichaCliente: ${error.message}`);
  if (!t) return null;
  const fila = t as { id: string; nombre: string; plan: string | null; created_at: string | null };

  // `origen` y `suscripcion` legítimamente pueden NO existir (null adentro)
  // — se envuelven en { v } para que el null del safe (lectura caída) no se
  // confunda con el null real: "no vino del pipeline" y "no se pudo leer"
  // son afirmaciones distintas.
  const [origenR, operacion, pmf, consumoIa, suscripcionR, facturasSaas, ticketsTodos, corridasR] = await Promise.all([
    safe(async () => {
      const { data, error: e } = await supabaseAdmin()
        .from('prospecto').select('empresa, fuente, created_at, cerrado_en')
        .eq('tenant_id', tenantId).maybeSingle();
      if (e) throw new Error(e.message);
      return { v: data as { empresa: string; fuente: string; created_at: string; cerrado_en: string | null } | null };
    }),
    safe(() => getKpis(tenantId)),
    safe(() => getSenalesPmf(tenantId)),
    safe(() => costoIaDeTenant(tenantId)),
    safe(async () => ({ v: await getSuscripcion(tenantId) })),
    safe(() => getFacturasSaas(tenantId, 6)),
    // FE-11: pedía TODOS los tickets de TODAS las flotas y se quedaba con
    // los de ésta con un `.filter()` — la flota con 12 tickets pagaba la
    // lectura de los 40,000 de todas. El filtro vive en la consulta.
    safe(() => getTicketsCruzados(Date.now(), { tenantId })),
    safe(async () => {
      const { data, error: e } = await supabaseAdmin()
        .from('agente_corrida').select('agente, estado, disparo, fin')
        .eq('tenant_id', tenantId).order('fin', { ascending: false }).limit(5);
      if (e) throw new Error(e.message);
      return (data ?? []) as Array<{ agente: string; estado: string; disparo: string; fin: string }>;
    }),
  ]);

  return {
    tenant: { id: fila.id, nombre: fila.nombre, plan: fila.plan ?? '—', creadoEn: fila.created_at },
    origen: origenR?.v
      ? { empresa: origenR.v.empresa, fuente: origenR.v.fuente, capturadoEn: origenR.v.created_at, cerradoEn: origenR.v.cerrado_en }
      : null,
    origenLegible: origenR !== null,
    operacion,
    pmf,
    consumoIa,
    suscripcion: suscripcionR?.v ?? null,
    suscripcionLegible: suscripcionR !== null,
    facturasSaas,
    tickets: ticketsTodos,
    corridas: corridasR,
  };
}
