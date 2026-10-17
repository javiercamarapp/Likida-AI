// ═══════════════════════════════════════════════════════════════════════════
// EL PUERTO REAL DE LA REFERENCIA DEL CLIENTE (T-A3-65, migración 0832).
//
// Siempre filtra por el tenant que se le pasa (quien llama lo saca de la SESIÓN). Sin la 0832 aplicada, leer devuelve
// «sin reglas / sin referencias» (el tablero queda vacío: comportamiento seguro) y escribir avisa con un mensaje llano.
// «Carga hecha» = el hito salida_carga del viaje recibido o validado (viaje_hito, 0380); su hora es recibido_en.
// ═══════════════════════════════════════════════════════════════════════════

import { supabaseAdmin } from '@/lib/supabase/admin';
import { acotada } from '@/lib/likida/presupuesto';
import { exigir } from '@/lib/likida/pg';
import { logger } from '@/lib/logger';
import { tablaAusente } from './repo';
import { leerReferencia, type ClienteRef, type ReglaReferencia, type ViajeReferencia } from './referencia_cliente';

const TOPE_VIAJES = 5000;
const TABLA_REGLA = 'cp_cliente_referencia';
const TABLA_REFERENCIA = 'cp_viaje_referencia';

export interface InsumosReferencia { viajes: ViajeReferencia[]; reglas: ReglaReferencia[]; clientes: ClienteRef[] }

/** Lo que el tablero y la comparación necesitan, de UNA flota. Sin la 0832 aplicada devuelve todo vacío y lo registra. */
export async function cargarInsumosReferencia(tenantId: string): Promise<InsumosReferencia> {
  const vacio: InsumosReferencia = { viajes: [], reglas: [], clientes: [] };
  const rReglas = await acotada(supabaseAdmin().from(TABLA_REGLA).select('cliente_id, exige_referencia').eq('tenant_id', tenantId).limit(5000), 'cpref.reglas');
  if (tablaAusente(rReglas.error)) {
    logger.warn('cartaporte_docs.referencia_sin_migracion', { tenantId });
    return vacio;
  }
  const reglas = ((exigir(rReglas, 'cpref.reglas') ?? []) as unknown as Array<{ cliente_id: string; exige_referencia: boolean }>)
    .map((f): ReglaReferencia => ({ clienteId: String(f.cliente_id), exige: f.exige_referencia === true }));

  const rCli = await acotada(supabaseAdmin().from('cliente').select('id, nombre').eq('tenant_id', tenantId).order('nombre').order('id').limit(5000), 'cpref.clientes');
  const clientes = ((exigir(rCli, 'cpref.clientes') ?? []) as unknown as Array<{ id: string; nombre: string }>).map((f) => ({ id: String(f.id), nombre: String(f.nombre) }));

  const rHito = await acotada(
    supabaseAdmin().from('viaje_hito').select('viaje_id, recibido_en').eq('tenant_id', tenantId).eq('tipo', 'salida_carga').in('estado', ['recibido', 'validado'])
      .order('recibido_en', { ascending: false }).limit(TOPE_VIAJES),
    'cpref.hitos',
  );
  const hitos = (exigir(rHito, 'cpref.hitos') ?? []) as unknown as Array<{ viaje_id: string; recibido_en: string | null }>;
  if (hitos.length === 0) return { viajes: [], reglas, clientes };
  if (hitos.length >= TOPE_VIAJES) logger.warn('cartaporte_docs.referencia_truncado', { tenantId, filas: hitos.length });
  const ids = hitos.map((h) => String(h.viaje_id));

  const rViaje = await acotada(supabaseAdmin().from('viaje').select('id, cliente_id').eq('tenant_id', tenantId).in('id', ids), 'cpref.viajes');
  const cliente = new Map(((exigir(rViaje, 'cpref.viajes') ?? []) as unknown as Array<{ id: string; cliente_id: string | null }>).map((v) => [String(v.id), v.cliente_id ? String(v.cliente_id) : null]));
  const rRef = await acotada(supabaseAdmin().from(TABLA_REFERENCIA).select('viaje_id, referencia, capturada_en').eq('tenant_id', tenantId).in('viaje_id', ids), 'cpref.referencias');
  const refs = new Map(((exigir(rRef, 'cpref.referencias') ?? []) as unknown as Array<{ viaje_id: string; referencia: string; capturada_en: string }>).map((r) => [String(r.viaje_id), r]));

  const viajes = hitos.map((h): ViajeReferencia => {
    const id = String(h.viaje_id);
    const r = refs.get(id);
    return { viajeId: id, clienteId: cliente.get(id) ?? null, cargaHechaEn: h.recibido_en, referencia: r?.referencia ?? null, referenciaCapturadaEn: r?.capturada_en ?? null };
  });
  return { viajes, reglas, clientes };
}

/** Guarda (o borra, si viene vacía) la referencia de UN viaje de la flota. La referencia no entra al CCP ni bloquea nada. */
export async function guardarReferenciaViaje(tenantId: string, viajeId: string, crudo: string | null, actorId: string | null): Promise<{ ok: true } | { ok: false; error: string }> {
  const lectura = leerReferencia(crudo);
  if (!lectura.ok) return { ok: false, error: lectura.motivo === 'larga' ? 'La referencia es muy larga (máximo 60 caracteres).' : 'La referencia trae caracteres no válidos.' };
  const db = supabaseAdmin();
  const r = lectura.referencia === null
    ? await acotada(db.from(TABLA_REFERENCIA).delete().eq('tenant_id', tenantId).eq('viaje_id', viajeId), 'cpref.borrar')
    : await acotada(db.from(TABLA_REFERENCIA).upsert({ tenant_id: tenantId, viaje_id: viajeId, referencia: lectura.referencia, capturada_en: new Date().toISOString(), capturada_por: actorId }, { onConflict: 'tenant_id,viaje_id' }), 'cpref.guardar');
  if (tablaAusente(r.error)) return { ok: false, error: 'La referencia del cliente todavía no está habilitada en la base (falta aplicar la migración 0832).' };
  exigir(r as never, 'cpref.guardar');
  return { ok: true };
}

/** Enciende o apaga «exige referencia» de UN cliente de la flota (default: no). */
export async function fijarExigeReferencia(tenantId: string, clienteId: string, exige: boolean, actorId: string | null): Promise<{ ok: true } | { ok: false; error: string }> {
  const r = await acotada(
    supabaseAdmin().from(TABLA_REGLA).upsert({ tenant_id: tenantId, cliente_id: clienteId, exige_referencia: exige, updated_by: actorId, updated_at: new Date().toISOString() }, { onConflict: 'tenant_id,cliente_id' }),
    'cpref.regla',
  );
  if (tablaAusente(r.error)) return { ok: false, error: 'La referencia del cliente todavía no está habilitada en la base (falta aplicar la migración 0832).' };
  exigir(r as never, 'cpref.regla');
  return { ok: true };
}
