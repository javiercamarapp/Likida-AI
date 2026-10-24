// ═══════════════════════════════════════════════════════════════════════════
// EL AVISO DE CRUCES ATÍPICOS AL SUPERVISOR (T-A2-14).
//
// Cuando el detector (T-A2-11/13) deja hallazgos «nuevos» de un desglose, el cron manda
// UN resumen por desglose (no un mensaje por hallazgo): «N casos inusuales en M
// unidades: …», con la liga a la pantalla. Es una señal para revisar, nunca una
// acusación: sin montos por cobro y sin afirmar que algo sea indebido (patrón de
// `textoAvisoDesglose`).
//
// DESTINATARIO CONFIGURABLE, NO ADIVINADO. A quién le llega, cada cuánto y por qué canal
// es una pregunta abierta del cliente (BLOQUEO EXTERNO). Mientras la flota no capture un
// teléfono (`umbrales.aviso.telefono` de `peaje_atipico_config`) NO se envía a nadie: ni
// al dueño ni al contador «por lo menos». Los hallazgos quedan marcados «sin_destinatario»
// en su detalle (visible en pantalla) y siguen pendientes; en cuanto se configure, el
// siguiente barrido los avisa.
//
// IDEMPOTENTE. El aviso se RESERVA antes de enviarse (compare-and-set sobre
// `avisado_en`): dos procesos simultáneos no mandan dos avisos. Si el envío falla, la
// reserva se devuelve y se cuenta un intento (`detalle.aviso.intentos`); al llegar a
// MAX_INTENTOS_AVISO_ATIPICOS el hallazgo deja de reintentarse. Un desglose ANULADO jamás
// avisa. Si el proceso muere entre reservar y enviar, ese aviso se pierde (a lo sumo una
// vez, nunca doble); la pantalla sigue mostrando el hallazgo.
//
// Sale por el selector central (`avisarOficina`: texto en ventana, plantilla
// `aviso_operacion_v1` fuera). No gestiona plantillas con Meta.
// ═══════════════════════════════════════════════════════════════════════════

import { logger } from '@/lib/logger';
import { quedoEnCola } from './aviso_en_cola';
import { appUrl } from '@/lib/env';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { avisarOficina, parametrosAvisoOficina } from '@/lib/meta/aviso_oficina';
import { acotada } from '../presupuesto';
import type { ReglaAtipica } from './atipicos';

export const MAX_INTENTOS_AVISO_ATIPICOS = 5;
const MAX_UNIDADES_EN_TEXTO = 5;
const LOTE_BARRIDO = 200;
/** Tope de páginas del barrido (200 hallazgos cada una): acota el costo de una corrida del cron. */
const MAX_PAGINAS_BARRIDO = 10;

export type ResultadoAvisoAtipicos =
  | 'enviado' | 'no_requerido' | 'anulado' | 'no_existe' | 'agotado' | 'ocupado' | 'sin_destinatario' | 'rechazado';

/** Lo mínimo de un hallazgo pendiente que necesita el aviso. */
export interface HallazgoPendiente {
  id: string;
  regla: ReglaAtipica;
  unidad: string;
  intentos: number;
}

export interface AlmacenAvisoAtipicos {
  /** `null` si el desglose no existe en esa flota. */
  estadoDesglose: (tenantId: string, desgloseId: string) => Promise<{ anulado: boolean } | null>;
  /** Hallazgos «nuevos» (no avisados) del desglose. */
  pendientes: (tenantId: string, desgloseId: string) => Promise<HallazgoPendiente[]>;
  destinatario: (tenantId: string) => Promise<string | null>;
  /** Anota «sin_destinatario» en el detalle para que la pantalla lo muestre. */
  marcarSinDestinatario: (tenantId: string, ids: string[]) => Promise<void>;
  /** Compare-and-set: devuelve los ids que ESTE proceso logró reservar. */
  reservar: (tenantId: string, ids: string[]) => Promise<string[]>;
  /** Devuelve la reserva tras un envío fallido y suma un intento. */
  liberar: (tenantId: string, ids: string[], motivo: string) => Promise<void>;
  /** Desglose con avisos por enviar, de todas las flotas (barrido del cron). */
  desglosesPendientes: (limite: number) => Promise<Array<{ tenantId: string; desgloseId: string }>>;
}

export interface DepsAvisoAtipicos {
  almacen: AlmacenAvisoAtipicos;
  avisar: typeof avisarOficina;
}

const liga = () => `${appUrl()}/dashboard/agentes/peajes`;

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

const MOTIVO_REGLA: Record<ReglaAtipica, [string, string]> = {
  repeticion_caseta: ['con muchas pasadas por la misma caseta', 'con muchas pasadas por la misma caseta'],
  ida_y_vuelta_madrugada: ['con idas y vueltas de madrugada', 'con idas y vueltas de madrugada'],
  secuencia_imposible: ['con cruces seguidos que el tiempo no permite', 'con cruces seguidos que el tiempo no permite'],
};

/** El texto del resumen (puro, para probarlo). `null` si no hay casos. Sin montos ni acusaciones. */
export function textoAvisoAtipicos(hallazgos: ReadonlyArray<Pick<HallazgoPendiente, 'regla' | 'unidad'>>): string | null {
  if (hallazgos.length === 0) return null;
  const unidades = [...new Set(hallazgos.map((h) => h.unidad))].sort();
  const porRegla = new Map<ReglaAtipica, number>();
  for (const h of hallazgos) porRegla.set(h.regla, (porRegla.get(h.regla) ?? 0) + 1);
  const partes = (Object.keys(MOTIVO_REGLA) as ReglaAtipica[])
    .filter((r) => porRegla.has(r))
    .map((r) => `${plural(porRegla.get(r)!, 'caso', 'casos')} ${MOTIVO_REGLA[r][0]}`);
  const lista = unidades.length <= MAX_UNIDADES_EN_TEXTO
    ? ` (${unidades.join(', ')})`
    : ` (${unidades.slice(0, MAX_UNIDADES_EN_TEXTO).join(', ')} y ${unidades.length - MAX_UNIDADES_EN_TEXTO} más)`;
  return `⚠️ Peajes: ${plural(hallazgos.length, 'caso inusual', 'casos inusuales')} en ${plural(unidades.length, 'unidad', 'unidades')}${lista}: ${partes.join('; ')}. `
    + `Es una señal para revisar, no afirma que algo sea indebido. Revísalos: ${liga()}`;
}

/** Normaliza un teléfono capturado a solo dígitos; `null` si no parece un teléfono. */
export function normalizarTelefonoAviso(entrada: unknown): string | null {
  if (typeof entrada !== 'string') return null;
  const d = entrada.replace(/\D/g, '');
  return d.length >= 10 && d.length <= 15 ? d : null;
}

// ── Almacén real (Supabase) ─────────────────────────────────────────────────

type Detalle = Record<string, unknown>;
const comoDetalle = (x: unknown): Detalle => (x && typeof x === 'object' && !Array.isArray(x) ? (x as Detalle) : {});
const avisoDe = (d: Detalle): Detalle => comoDetalle(d.aviso);
const intentosDe = (d: Detalle): number => Math.max(0, Math.floor(Number(avisoDe(d).intentos ?? 0)) || 0);

export const almacenAvisoAtipicos: AlmacenAvisoAtipicos = {
  async estadoDesglose(tenantId, desgloseId) {
    const { data, error } = await acotada(supabaseAdmin().from('desglose_peaje')
      .select('anulado_en').eq('tenant_id', tenantId).eq('id', desgloseId).maybeSingle(), 'peajes.atipicos_aviso_desglose');
    if (error) throw new Error(`avisoAtipicos.estadoDesglose: ${error.message}`);
    return data ? { anulado: data.anulado_en != null } : null;
  },

  async pendientes(tenantId, desgloseId) {
    const { data, error } = await acotada(supabaseAdmin().from('peaje_atipico')
      .select('id, regla, unidad_archivo, detalle')
      .eq('tenant_id', tenantId).eq('desglose_id', desgloseId).eq('estado', 'nuevo').is('avisado_en', null)
      .order('creado_en').order('id'), 'peajes.atipicos_aviso_pendientes');
    if (error) throw new Error(`avisoAtipicos.pendientes: ${error.message}`);
    return ((data ?? []) as Array<Record<string, unknown>>).map((f) => ({
      id: String(f.id), regla: String(f.regla) as ReglaAtipica, unidad: String(f.unidad_archivo), intentos: intentosDe(comoDetalle(f.detalle)),
    }));
  },

  async destinatario(tenantId) {
    const { data, error } = await acotada(supabaseAdmin().from('peaje_atipico_config')
      .select('umbrales').eq('tenant_id', tenantId).maybeSingle(), 'peajes.atipicos_aviso_destinatario');
    if (error) throw new Error(`avisoAtipicos.destinatario: ${error.message}`);
    return normalizarTelefonoAviso(avisoDe(comoDetalle(data?.umbrales)).telefono);
  },

  async marcarSinDestinatario(tenantId, ids) {
    await anotarAviso(tenantId, ids, (a) => (a.estado === 'sin_destinatario' ? null : { ...a, estado: 'sin_destinatario' }));
  },

  async reservar(tenantId, ids) {
    if (ids.length === 0) return [];
    const { data, error } = await acotada(supabaseAdmin().from('peaje_atipico')
      .update({ estado: 'avisado', avisado_en: new Date().toISOString(), actualizado_en: new Date().toISOString() })
      .eq('tenant_id', tenantId).in('id', ids).eq('estado', 'nuevo').is('avisado_en', null).select('id'), 'peajes.atipicos_aviso_reservar');
    if (error) throw new Error(`avisoAtipicos.reservar: ${error.message}`);
    return ((data ?? []) as Array<{ id: unknown }>).map((f) => String(f.id));
  },

  async liberar(tenantId, ids, motivo) {
    // Quien reservó es el único dueño de estas filas hasta que las libera.
    await anotarAviso(tenantId, ids, (a) => ({ ...a, estado: 'fallo_envio', motivo: motivo.slice(0, 200), intentos: Math.max(0, Number(a.intentos ?? 0) || 0) + 1 }), true);
  },

  async desglosesPendientes(limite) {
    // A37-S51-01: antes se tomaban los 200 hallazgos más viejos y se cortaba a `limite` desgloses: una flota sin teléfono (o con los
    // intentos agotados) acumulaba los mismos primeros desgloses en cada corrida y las demás flotas nunca llegaban. Ahora se PAGINA y
    // se saltan las flotas sin destinatario (su caso se ve en pantalla; si luego configuran uno, vuelven a entrar solas) y los hallazgos
    // agotados, hasta juntar `limite` desgloses que SÍ se pueden avisar o agotar las páginas.
    const vistos = new Map<string, { tenantId: string; desgloseId: string }>();
    const conDestinatario = new Map<string, boolean>();
    for (let pagina = 0; pagina < MAX_PAGINAS_BARRIDO && vistos.size < limite; pagina++) {
      const { data, error } = await acotada(supabaseAdmin().from('peaje_atipico')
        .select('id, tenant_id, desglose_id, detalle')
        .eq('estado', 'nuevo').is('avisado_en', null).not('desglose_id', 'is', null)
        .order('creado_en').order('id').range(pagina * LOTE_BARRIDO, (pagina + 1) * LOTE_BARRIDO - 1), 'peajes.atipicos_aviso_barrido');
      if (error) throw new Error(`avisoAtipicos.desglosesPendientes: ${error.message}`);
      const filas = (data ?? []) as Array<Record<string, unknown>>;
      for (const f of filas) {
        if (intentosDe(comoDetalle(f.detalle)) >= MAX_INTENTOS_AVISO_ATIPICOS) continue;
        const tenantId = String(f.tenant_id);
        if (!conDestinatario.has(tenantId)) conDestinatario.set(tenantId, (await almacenAvisoAtipicos.destinatario(tenantId)) !== null);
        if (!conDestinatario.get(tenantId)) continue;
        const k = `${tenantId}|${f.desglose_id}`;
        if (!vistos.has(k)) vistos.set(k, { tenantId, desgloseId: String(f.desglose_id) });
        if (vistos.size >= limite) break;
      }
      if (filas.length < LOTE_BARRIDO) break;
    }
    return [...vistos.values()];
  },
};

/** Reescribe `detalle.aviso` de cada hallazgo con `cambia`; `null` = sin cambio. `liberando` además devuelve la reserva. */
async function anotarAviso(
  tenantId: string, ids: string[], cambia: (actual: Detalle) => Detalle | null, liberando = false,
): Promise<void> {
  if (ids.length === 0) return;
  const { data, error } = await acotada(supabaseAdmin().from('peaje_atipico')
    .select('id, detalle').eq('tenant_id', tenantId).in('id', ids), 'peajes.atipicos_aviso_anotar_leer');
  if (error) throw new Error(`avisoAtipicos.anotar: ${error.message}`);
  for (const f of (data ?? []) as Array<Record<string, unknown>>) {
    const detalle = comoDetalle(f.detalle);
    const nuevo = cambia(avisoDe(detalle));
    if (nuevo === null) continue;
    const parche: Record<string, unknown> = { detalle: { ...detalle, aviso: nuevo }, actualizado_en: new Date().toISOString() };
    if (liberando) { parche.estado = 'nuevo'; parche.avisado_en = null; }
    let q = supabaseAdmin().from('peaje_atipico').update(parche).eq('tenant_id', tenantId).eq('id', String(f.id));
    // Al liberar solo se toca una fila que sigue reservada; al anotar, una que sigue sin avisar.
    q = liberando ? q.eq('estado', 'avisado') : q.is('avisado_en', null);
    const r = await acotada(q, 'peajes.atipicos_aviso_anotar');
    if (r.error) logger.error('peajes.atipicos_aviso_anotar', { tenant: tenantId, err: r.error.message });
  }
}

const depsPorOmision: DepsAvisoAtipicos = { almacen: almacenAvisoAtipicos, avisar: avisarOficina };

/** Evalúa y, si hay casos nuevos, manda UN resumen del desglose. Nunca lanza. */
export async function avisarAtipicosDesglose(
  tenantId: string, desgloseId: string, deps: DepsAvisoAtipicos = depsPorOmision,
): Promise<ResultadoAvisoAtipicos> {
  const { almacen } = deps;
  try {
    const desglose = await almacen.estadoDesglose(tenantId, desgloseId);
    if (!desglose) return 'no_existe';
    if (desglose.anulado) return 'anulado';

    const todos = await almacen.pendientes(tenantId, desgloseId);
    if (todos.length === 0) return 'no_requerido';
    const vivos = todos.filter((h) => h.intentos < MAX_INTENTOS_AVISO_ATIPICOS);
    if (vivos.length === 0) return 'agotado';

    const tel = await almacen.destinatario(tenantId);
    if (!tel) {
      await almacen.marcarSinDestinatario(tenantId, vivos.map((h) => h.id));
      logger.warn('peajes.atipicos_aviso_sin_destinatario', { tenant: tenantId, desglose: desgloseId, casos: vivos.length });
      return 'sin_destinatario';
    }

    const reservados = new Set(await almacen.reservar(tenantId, vivos.map((h) => h.id)));
    if (reservados.size === 0) return 'ocupado';
    const mios = vivos.filter((h) => reservados.has(h.id));

    const texto = textoAvisoAtipicos(mios)!;
    const unidades = new Set(mios.map((h) => h.unidad)).size;
    const r = await deps.avisar(tel, texto, {
      parametros: parametrosAvisoOficina('Peajes: cruces inusuales', `${plural(mios.length, 'caso inusual', 'casos inusuales')} en ${plural(unidades, 'unidad', 'unidades')}`, liga()),
      contexto: { tenantId, agente: 'peajes', desglose: desgloseId },
    });
    // A37-S51-04: en cola del outbox = enviado (la reserva NO se libera: saldrá solo y otro barrido lo duplicaría).
    if (quedoEnCola(r)) {
      logger.warn('peajes.atipicos_aviso_en_cola', { tenant: tenantId, desglose: desgloseId, motivo: r.ok ? null : r.motivo, codigo: r.ok ? null : r.codigo });
      return 'enviado';
    }
    if (!r.ok) {
      logger.error('peajes.atipicos_aviso_fallo', { tenant: tenantId, desglose: desgloseId, motivo: r.motivo, codigo: r.codigo });
      await almacen.liberar(tenantId, mios.map((h) => h.id), String(r.motivo ?? 'envío rechazado'));
      return 'rechazado';
    }
    return 'enviado';
  } catch (e) {
    logger.error('peajes.atipicos_aviso_error', { tenant: tenantId, desglose: desgloseId, err: e instanceof Error ? e.message : String(e) });
    return 'rechazado';
  }
}

export interface ResumenAvisosAtipicos { revisados: number; enviados: number; pendientes: number }

/** El barrido del cron: avisa (o reintenta) los desgloses con casos nuevos. Nunca lanza. */
export async function reintentarAvisosAtipicos(limite = 5, deps: DepsAvisoAtipicos = depsPorOmision): Promise<ResumenAvisosAtipicos> {
  const r: ResumenAvisosAtipicos = { revisados: 0, enviados: 0, pendientes: 0 };
  let lista: Array<{ tenantId: string; desgloseId: string }> = [];
  try { lista = await deps.almacen.desglosesPendientes(limite); } catch (e) {
    logger.error('peajes.atipicos_avisos_barrido', { err: e instanceof Error ? e.message : String(e) });
    return r;
  }
  for (const p of lista) {
    r.revisados++;
    const res = await avisarAtipicosDesglose(p.tenantId, p.desgloseId, deps);
    if (res === 'enviado') r.enviados++;
    // `sin_destinatario` es configuración pendiente, no un fallo del sistema: no vuelve «parcial» el latido.
    else if (res === 'rechazado') r.pendientes++;
  }
  return r;
}

/**
 * Guarda (o borra, con `null`) el teléfono que recibe el aviso. Se conserva el resto de los
 * umbrales. Un valor que no parece teléfono se rechaza con mensaje llano.
 */
export async function guardarDestinatarioAtipicos(
  tenantId: string, telefono: string | null,
): Promise<{ ok: true; telefono: string | null } | { ok: false; motivo: string }> {
  const tel = telefono === null || telefono.trim() === '' ? null : normalizarTelefonoAviso(telefono);
  if (telefono !== null && telefono.trim() !== '' && !tel) return { ok: false, motivo: 'El teléfono debe tener entre 10 y 15 dígitos.' };
  const { data, error } = await acotada(supabaseAdmin().from('peaje_atipico_config')
    .select('activo, umbrales').eq('tenant_id', tenantId).maybeSingle(), 'peajes.atipicos_destinatario_leer');
  if (error) throw new Error(`guardarDestinatarioAtipicos: ${error.message}`);
  const umbrales = comoDetalle(data?.umbrales);
  const { aviso: _previo, ...resto } = umbrales;
  const nuevo = tel ? { ...resto, aviso: { ...comoDetalle(umbrales.aviso), telefono: tel } } : resto;
  const w = await acotada(supabaseAdmin().from('peaje_atipico_config').upsert({
    tenant_id: tenantId, activo: data?.activo === true, umbrales: nuevo, actualizado_en: new Date().toISOString(),
  }, { onConflict: 'tenant_id' }), 'peajes.atipicos_destinatario_guardar');
  if (w.error) {
    logger.error('peajes.atipicos_destinatario_guardar', { tenant: tenantId, err: w.error.message });
    return { ok: false, motivo: 'No se pudo guardar el destinatario. Intenta de nuevo.' };
  }
  return { ok: true, telefono: tel };
}
