import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { acotada } from '@/lib/likida/presupuesto';
import { anotarBitacora } from '@/lib/likida/bitacora_escritura';
import { hoyMx } from '@/lib/formato';
import { MANDATO_AUTOFACTURACION } from '@/lib/legal/documentos';
import { guionDe } from '../facturacion/adaptadores/portales';
import { estadoVerificacion } from './verificacion';
import { REGISTRO_VERIFICACIONES } from './registro_verificaciones';
import type { ControlEmision, DepsControl, FasePortal, RepoControl, SalidasControl } from './control_emision';

// La implementación real (Supabase, 0542) de los puertos de `control_emision.ts` y las operaciones del panel.
// Toda regla de rol/mandato/aislamiento vive en las RPC de la base; aquí solo se llama y se traduce.

const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v));

export const repoControl: RepoControl = {
  async control(tenantId) {
    const { data, error } = await acotada(supabaseAdmin().from('autofactura_control')
      .select('emision_real, max_monto_ticket, max_tickets_lote, max_tickets_dia, max_monto_dia')
      .eq('tenant_id', tenantId).maybeSingle(), 'autofactura.control');
    if (error) { logger.error('autofactura.control_ilegible', { err: error.message }); return null; }
    if (!data) return 'sin_fila';
    const f = data as Record<string, unknown>;
    return { emisionReal: f.emision_real === true, maxMontoTicket: num(f.max_monto_ticket), maxTicketsLote: num(f.max_tickets_lote), maxTicketsDia: num(f.max_tickets_dia), maxMontoDia: num(f.max_monto_dia) };
  },
  async fase(tenantId, comercio) {
    const { data, error } = await acotada(supabaseAdmin().from('autofactura_portal_fase')
      .select('fase, emisiones_confirmadas').eq('tenant_id', tenantId).eq('comercio', comercio).maybeSingle(), 'autofactura.fase');
    if (error) { logger.error('autofactura.fase_ilegible', { err: error.message }); return null; }
    if (!data) return 'sin_fila';
    const f = data as { fase: string; emisiones_confirmadas: unknown };
    return { fase: f.fase === 'autonoma' ? 'autonoma' : 'supervisada', emisionesConfirmadas: num(f.emisiones_confirmadas) };
  },
  async cupoDelDia(tenantId, dia) {
    const { data, error } = await acotada(supabaseAdmin().from('autofactura_cupo_dia')
      .select('tickets, monto').eq('tenant_id', tenantId).eq('dia', dia).maybeSingle(), 'autofactura.cupo');
    if (error) { logger.error('autofactura.cupo_ilegible', { err: error.message }); return null; }
    const f = (data ?? { tickets: 0, monto: 0 }) as { tickets: unknown; monto: unknown };
    return { tickets: num(f.tickets), monto: num(f.monto) };
  },
  async reservarCupo(tenantId, dia, tickets, monto, maxTickets, maxMonto) {
    const { data, error } = await acotada(supabaseAdmin().rpc('reservar_cupo_dia', {
      p_tenant: tenantId, p_dia: dia, p_tickets: tickets, p_monto: monto, p_max_tickets: maxTickets, p_max_monto: maxMonto,
    }), 'autofactura.reservar_cupo');
    if (error) { logger.error('autofactura.reservar_cupo_fallo', { err: error.message }); return false; }
    return data === true;
  },
  async liberarCupo(tenantId, dia, tickets, monto) {
    const { error } = await acotada(supabaseAdmin().rpc('liberar_cupo_dia', { p_tenant: tenantId, p_dia: dia, p_tickets: tickets, p_monto: monto }), 'autofactura.liberar_cupo');
    if (error) logger.warn('autofactura.liberar_cupo_fallo', { err: error.message });
  },
  async consumirLoteConfirmado(tenantId, comercio, gastoIds) {
    const { data, error } = await acotada(supabaseAdmin().rpc('consumir_lote_confirmado', { p_tenant: tenantId, p_comercio: comercio, p_gastos: gastoIds }), 'autofactura.consumir_lote');
    if (error) { logger.error('autofactura.consumir_lote_fallo', { err: error.message }); return null; }
    return Array.isArray(data) ? (data as unknown[]).map(String) : [];
  },
  async proponerLote(tenantId, comercio, gastoIds, monto) {
    const { data, error } = await acotada(supabaseAdmin().rpc('proponer_lote_emision', { p_tenant: tenantId, p_comercio: comercio, p_gastos: gastoIds, p_monto: monto }), 'autofactura.proponer_lote');
    if (error) { logger.error('autofactura.proponer_lote_fallo', { err: error.message }); return { ok: false, motivo: error.message }; }
    const r = (data ?? {}) as { ok?: boolean; estado?: string; motivo?: string };
    return { ok: r.ok === true, estado: r.estado, motivo: r.motivo };
  },
  async registrarEmision(tenantId, comercio, n) {
    const { error } = await acotada(supabaseAdmin().rpc('registrar_emision_portal', { p_tenant: tenantId, p_comercio: comercio, p_n: n }), 'autofactura.registrar_emision');
    if (error) logger.error('autofactura.registrar_emision_fallo', { err: error.message });
  },
};

export const salidasControl: SalidasControl = {
  async bitacora(tenantId, accion, entidadId, detalle) {
    await anotarBitacora({ tenantId, actor: 'sistema', accion, entidad: 'autofactura', entidadId, detalle }, { evento: 'autofactura.bitacora_no_escribio' });
  },
};

/** Los comercios con adaptador propio no pasan por el registro de guiones (CAPUFE): su primera emisión también es supervisada. */
const EXENTOS_DEL_REGISTRO = new Set(['capufe']);

export function verificacionDeComercio(comercio: string): ReturnType<DepsControl['verificacionDe']> {
  if (EXENTOS_DEL_REGISTRO.has(comercio)) return 'exento';
  const g = guionDe(comercio);
  if (!g) return 'no_verificado';
  const e = estadoVerificacion(g, REGISTRO_VERIFICACIONES).estado;
  return e;
}

export function crearDepsControl(): DepsControl {
  return { repo: repoControl, salidas: salidasControl, verificacionDe: verificacionDeComercio, hoyMx };
}

// ═══════════════════════════════════════════════════════════════════════════
// LAS OPERACIONES DEL PANEL (dueño / contador): encender, apagar, límites, lotes, fase.
// ═══════════════════════════════════════════════════════════════════════════

export type ResultadoOp = { ok: true; mensaje: string } | { ok: false; motivo: string };

interface RespuestaRpc { ok?: boolean; motivo?: string }
async function rpc(nombre: string, args: Record<string, unknown>): Promise<RespuestaRpc | null> {
  const { data, error } = await acotada(supabaseAdmin().rpc(nombre, args), `autofactura.${nombre}`);
  if (error) { logger.error('autofactura.rpc_fallo', { rpc: nombre, err: error.message }); return null; }
  return (data ?? {}) as RespuestaRpc;
}
const traducir = (r: RespuestaRpc | null, ok: string): ResultadoOp =>
  r === null ? { ok: false, motivo: 'No se pudo completar: la base no contestó. Intenta de nuevo.' } : r.ok === true ? { ok: true, mensaje: ok } : { ok: false, motivo: r.motivo ?? 'La base no explicó el rechazo.' };

const firma = (userId: string) => ({ id: userId });

export async function encenderEmisionReal(tenantId: string, userId: string): Promise<ResultadoOp> {
  const r = await rpc('activar_emision_real', { p_tenant: tenantId, p_user: userId, p_version_mandato: MANDATO_AUTOFACTURACION.version });
  await anotarBitacora({ tenantId, actor: firma(userId), accion: 'autofactura.emision_real_encendida', entidad: 'autofactura', entidadId: 'control', detalle: { ok: r?.ok === true, motivo: r?.motivo ?? null } }, { evento: 'autofactura.bitacora_no_escribio' });
  return traducir(r, 'Emisión real ENCENDIDA para tu flota. Los portales siguen en fase supervisada: cada lote lo confirmas tú.');
}
export async function apagarEmisionReal(tenantId: string, userId: string): Promise<ResultadoOp> {
  const r = await rpc('apagar_emision_real', { p_tenant: tenantId, p_user: userId });
  await anotarBitacora({ tenantId, actor: firma(userId), accion: 'autofactura.emision_real_apagada', entidad: 'autofactura', entidadId: 'control', detalle: { ok: r?.ok === true } }, { evento: 'autofactura.bitacora_no_escribio' });
  return traducir(r, 'Emisión real APAGADA: el agente vuelve a ensayo y los lotes pendientes se rechazaron.');
}
export async function cambiarLimites(tenantId: string, userId: string, l: { maxMontoTicket: number; maxTicketsLote: number; maxTicketsDia: number; maxMontoDia: number }): Promise<ResultadoOp> {
  if (![l.maxMontoTicket, l.maxTicketsLote, l.maxTicketsDia, l.maxMontoDia].every((n) => Number.isFinite(n) && n > 0)) return { ok: false, motivo: 'Todos los límites deben ser números mayores que cero.' };
  const r = await rpc('cambiar_limites_emision', { p_tenant: tenantId, p_user: userId, p_max_monto_ticket: l.maxMontoTicket, p_max_tickets_lote: Math.trunc(l.maxTicketsLote), p_max_tickets_dia: Math.trunc(l.maxTicketsDia), p_max_monto_dia: l.maxMontoDia });
  await anotarBitacora({ tenantId, actor: firma(userId), accion: 'autofactura.limites_cambiados', entidad: 'autofactura', entidadId: 'control', detalle: { ok: r?.ok === true, ...l } }, { evento: 'autofactura.bitacora_no_escribio' });
  return traducir(r, 'Límites de emisión guardados.');
}
export async function decidirLote(tenantId: string, userId: string, loteId: string, confirmar: boolean, motivo?: string): Promise<ResultadoOp> {
  const r = await rpc('decidir_lote_emision', { p_id: loteId, p_tenant: tenantId, p_user: userId, p_confirmar: confirmar, p_version_mandato: MANDATO_AUTOFACTURACION.version, p_motivo: motivo ?? null });
  await anotarBitacora({ tenantId, actor: firma(userId), accion: confirmar ? 'autofactura.lote_confirmado' : 'autofactura.lote_rechazado', entidad: 'autofactura', entidadId: loteId, detalle: { ok: r?.ok === true, motivo: motivo?.slice(0, 200) ?? null } }, { evento: 'autofactura.bitacora_no_escribio' });
  return traducir(r, confirmar ? 'Lote confirmado: se emite en la siguiente corrida del agente (cada 15 minutos).' : 'Lote rechazado: esos tickets vuelven a la cola.');
}
export async function promoverPortal(tenantId: string, userId: string, comercio: string, minimo = 3): Promise<ResultadoOp> {
  const r = await rpc('promover_portal_autonomo', { p_tenant: tenantId, p_comercio: comercio, p_user: userId, p_min: minimo });
  await anotarBitacora({ tenantId, actor: firma(userId), accion: 'autofactura.portal_promovido', entidad: 'autofactura', entidadId: comercio, detalle: { ok: r?.ok === true } }, { evento: 'autofactura.bitacora_no_escribio' });
  return traducir(r, 'Portal en emisión autónoma: ya no pide confirmar cada lote (los límites siguen).');
}
export async function devolverASupervisada(tenantId: string, userId: string, comercio: string): Promise<ResultadoOp> {
  const r = await rpc('devolver_portal_a_supervisada', { p_tenant: tenantId, p_comercio: comercio, p_user: userId });
  await anotarBitacora({ tenantId, actor: firma(userId), accion: 'autofactura.portal_devuelto_a_supervisada', entidad: 'autofactura', entidadId: comercio, detalle: { ok: r?.ok === true } }, { evento: 'autofactura.bitacora_no_escribio' });
  return traducir(r, 'Portal devuelto a fase supervisada.');
}

// ── Lecturas para el tablero ────────────────────────────────────────────────

export interface LoteTablero { id: string; comercio: string; gastoIds: string[]; montoTotal: number; estado: string; propuestoEn: string; expiraEn: string }
export interface FaseTablero { comercio: string; fase: FasePortal; emisionesConfirmadas: number; ultimaEmisionEn: string | null }

/** Devuelve `null` si la base no contestó (el tablero lo dice; nunca pinta «sin lotes» a ciegas). */
export async function lotesVivos(tenantId: string): Promise<LoteTablero[] | null> {
  const { data, error } = await acotada(supabaseAdmin().from('autofactura_lote')
    .select('id, comercio, gasto_ids, monto_total, estado, propuesto_en, expira_en')
    .eq('tenant_id', tenantId).in('estado', ['propuesto', 'confirmado']).order('propuesto_en', { ascending: false }).order('id').limit(100), 'autofactura.lotes');
  if (error) { logger.warn('autofactura.lotes_sin_leer', { err: error.message }); return null; }
  return ((data ?? []) as Array<Record<string, unknown>>).map((f) => ({
    id: String(f.id), comercio: String(f.comercio), gastoIds: ((f.gasto_ids as unknown[]) ?? []).map(String), montoTotal: num(f.monto_total),
    estado: String(f.estado), propuestoEn: String(f.propuesto_en), expiraEn: String(f.expira_en),
  }));
}
export async function fasesDePortales(tenantId: string): Promise<FaseTablero[] | null> {
  // orden-no-importa: la llave primaria es (tenant_id, comercio) y se filtra por tenant, así que ordenar por comercio ya es un orden total
  const { data, error } = await acotada(supabaseAdmin().from('autofactura_portal_fase')
    .select('comercio, fase, emisiones_confirmadas, ultima_emision_en').eq('tenant_id', tenantId).order('comercio').limit(200), 'autofactura.fases');
  if (error) { logger.warn('autofactura.fases_sin_leer', { err: error.message }); return null; }
  return ((data ?? []) as Array<Record<string, unknown>>).map((f) => ({
    comercio: String(f.comercio), fase: f.fase === 'autonoma' ? 'autonoma' : 'supervisada', emisionesConfirmadas: num(f.emisiones_confirmadas),
    ultimaEmisionEn: f.ultima_emision_en == null ? null : String(f.ultima_emision_en),
  }));
}
export type { ControlEmision };
