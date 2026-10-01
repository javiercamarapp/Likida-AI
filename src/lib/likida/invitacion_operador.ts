// ═══════════════════════════════════════════════════════════════════════════
// LA INVITACIÓN DEL OPERADOR POR WHATSAPP (W2 «producto», 1-oct-2026).
//
// Dar de alta a 250 choferes y avisarles «escríbele a este número» es el último
// tramo del alta que hasta hoy se hacía a mano. Este módulo manda UNA invitación
// a cada chofer que la flota decide invitar. Reglas que lo hacen seguro:
//
//  · NUNCA AUTOMÁTICA. La invitación la dispara una persona de la flota, con una
//    confirmación que dice a cuántos y que ellos aceptaron recibir mensajes de
//    la empresa. Un import no manda 250 plantillas sin que nadie lo diga: cada
//    plantilla es un cobro de Meta y un mensaje a una persona.
//  · POR EL SELECTOR (`enviarConFallback`): ventana de 24 h abierta → texto;
//    cerrada o desconocida (el caso normal de quien nunca ha escrito) →
//    plantilla `operador_invitacion_v1` del catálogo.
//  · IDEMPOTENTE POR RECLAMO, no por intención. Antes de mandar nada, la fila se
//    RECLAMA con un UPDATE condicionado a «sin enviar» (0460): dos clics, dos
//    pestañas o dos jefes no le mandan dos plantillas al mismo chofer — quien no
//    reclama la fila no la envía. Un reclamo que quedó colgado (el proceso murió
//    entre reclamar y enviar) caduca a los 15 minutos y otro envío lo recoge.
//  · FALLA SIN BLOQUEAR A LOS DEMÁS. Si Meta rechaza un número, el motivo queda
//    en la ficha (0462) y ese chofer sale de «pendientes»: no frena a los otros
//    ni se reintenta solo. Un fallo reintentable (429, red) suelta el reclamo
//    sin marcar fallo, para el siguiente intento.
//  · ACOTADO: `LIMITE_POR_LLAMADA` por vez (con concurrencia 5). Las flotas con
//    cientos de choferes repiten el botón; lo que queda lo dice el resultado.
//  · ALCANCE DE PATIO: un jefe con patio solo invita a los de su patio.
// ═══════════════════════════════════════════════════════════════════════════

import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { acotada } from './presupuesto';
import { anotarBitacora } from './bitacora_escritura';
import { DatoInvalido } from './errores';
import { esUuidValido } from './intake/cfdi';
import { enviarConFallback } from '@/lib/meta/enviar_con_fallback';
import { opcionesDeEnvio, textoRenderizado, PLANTILLA } from '@/lib/meta/plantillas_catalogo';
import type { AlcancePatio } from '@/lib/auth/patio';

/** Cuántas invitaciones sale por llamada. */
export const LIMITE_POR_LLAMADA = 40;
/** Cuántos envíos a Meta corren a la vez. */
const CONCURRENCIA = 5;
/** Un reclamo más viejo que esto se considera huérfano y se puede recoger. */
export const MINUTOS_RECLAMO_HUERFANO = 15;
const MAX_FALLO = 200;

export interface FalloInvitacion { operadorId: string; nombre: string; motivo: string }

export interface ResultadoInvitacion {
  enviadas: number;
  fallidas: FalloInvitacion[];
  /** Pendientes (activos, sin enviar, sin fallo) que NO entraron en esta tanda. */
  pendientesRestantes: number;
  /** Cuántos pidieron invitarse y ya tenían invitación (o no son de la flota,
   *  están de baja, o caen fuera del patio del jefe): no se tocan. */
  saltadas: number;
  error?: string;
}

type FilaOperador = { id: string; nombre: string; telefono: string };

/** Corre `tarea` sobre cada elemento con un máximo de `n` a la vez. */
async function conConcurrencia<T>(items: readonly T[], n: number, tarea: (x: T) => Promise<void>): Promise<void> {
  let i = 0;
  const trabajador = async () => {
    while (i < items.length) {
      const mio = items[i++];
      await tarea(mio);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, trabajador));
}

/** El motivo, corto y sin datos personales, tal como se guarda en la ficha. */
export function motivoCorto(m: string): string {
  const limpio = m.replace(/\s+/g, ' ').trim() || 'Meta rechazó el mensaje';
  return limpio.length > MAX_FALLO ? `${limpio.slice(0, MAX_FALLO - 1)}…` : limpio;
}

/** El primer nombre para saludar; «Hola Juan Pérez García» sobra. */
export function primerNombre(nombre: string): string {
  const p = nombre.replace(/\s+/g, ' ').trim().split(' ')[0];
  return p || 'operador';
}

/** Cuántos operadores activos esperan invitación (sin enviar y sin fallo). */
export async function contarPendientes(tenantId: string, alcance: AlcancePatio): Promise<number> {
  let q = supabaseAdmin().from('operador').select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId).eq('activo', true)
    .is('invitacion_enviada_en', null).is('invitacion_fallo_en', null);
  if (alcance.tipo === 'patio') q = q.eq('terminal_id', alcance.terminalId);
  const { count, error } = await acotada(q, 'contarPendientesInvitacion');
  if (error) throw new Error(`contarPendientes: ${error.message}`);
  return count ?? 0;
}

/** Cuántos tienen un fallo vigente (para el botón «Reintentar»). */
export async function contarConFallo(tenantId: string, alcance: AlcancePatio): Promise<number> {
  let q = supabaseAdmin().from('operador').select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId).eq('activo', true).not('invitacion_fallo_en', 'is', null);
  if (alcance.tipo === 'patio') q = q.eq('terminal_id', alcance.terminalId);
  const { count, error } = await acotada(q, 'contarConFalloInvitacion');
  if (error) throw new Error(`contarConFallo: ${error.message}`);
  return count ?? 0;
}

/**
 * RECLAMA las filas: UPDATE condicionado a «sin invitación enviada» (o con un
 * reclamo huérfano). Devuelve SOLO las que este envío ganó. `modo`:
 *  · `pendientes` — sin fallo vigente (lo que recorre el botón masivo);
 *  · `ids` — los pedidos, con o sin fallo (reintento a mano).
 */
async function reclamar(
  tenantId: string,
  alcance: AlcancePatio,
  modo: { tipo: 'pendientes' } | { tipo: 'ids'; ids: string[] },
  ahora: Date,
): Promise<FilaOperador[]> {
  const admin = supabaseAdmin();
  const huerfano = new Date(ahora.getTime() - MINUTOS_RECLAMO_HUERFANO * 60_000).toISOString();

  // Los candidatos (hasta el límite) se eligen aparte para que el UPDATE lleve
  // `in(ids)` acotado: un UPDATE sin LIMIT sobre «todos los pendientes» le
  // reclamaría a este envío 800 filas de las que solo manda 40.
  let sel = admin.from('operador').select('id').eq('tenant_id', tenantId).eq('activo', true)
    .or(`invitacion_enviada_en.is.null,and(invitacion_via.eq.reclamada,invitacion_enviada_en.lt.${huerfano})`);
  if (alcance.tipo === 'patio') sel = sel.eq('terminal_id', alcance.terminalId);
  if (modo.tipo === 'pendientes') sel = sel.is('invitacion_fallo_en', null).order('created_at').order('id').limit(LIMITE_POR_LLAMADA);
  else sel = sel.in('id', modo.ids.slice(0, LIMITE_POR_LLAMADA));
  const { data: cand, error: errSel } = await acotada(sel, 'invitarOperadores.candidatos');
  if (errSel) throw new Error(`invitarOperadores: no se pudo elegir a quién invitar — ${errSel.message}`);
  const ids = ((cand ?? []) as Array<{ id: unknown }>).map((c) => String(c.id));
  if (ids.length === 0) return [];

  let upd = admin.from('operador')
    .update({
      invitacion_enviada_en: ahora.toISOString(), invitacion_via: 'reclamada',
      invitacion_fallo: null, invitacion_fallo_en: null,
    })
    .eq('tenant_id', tenantId).eq('activo', true).in('id', ids)
    .or(`invitacion_enviada_en.is.null,and(invitacion_via.eq.reclamada,invitacion_enviada_en.lt.${huerfano})`);
  if (alcance.tipo === 'patio') upd = upd.eq('terminal_id', alcance.terminalId);
  const { data, error } = await acotada(upd.select('id, nombre, telefono'), 'invitarOperadores.reclamar');
  if (error) throw new Error(`invitarOperadores: no se pudo reclamar — ${error.message}`);
  return ((data ?? []) as Array<{ id: unknown; nombre: unknown; telefono: unknown }>)
    .map((f) => ({ id: String(f.id), nombre: String(f.nombre ?? ''), telefono: String(f.telefono ?? '') }));
}

async function marcarEnviada(tenantId: string, id: string, via: 'texto' | 'botones' | 'plantilla'): Promise<void> {
  const { error } = await acotada(
    supabaseAdmin().from('operador').update({ invitacion_via: via })
      .eq('id', id).eq('tenant_id', tenantId).eq('invitacion_via', 'reclamada').select('id'),
    'invitarOperadores.marcarEnviada',
  );
  // El mensaje YA salió: si la constancia no se pudo afinar, queda «reclamada»
  // (que caduca a los 15 min y se podría reenviar). Se loguea para que se vea.
  if (error) logger.warn('invitacion_operador.constancia_no_afinada', { tenantId, operadorId: id, err: error.message });
}

async function soltarReclamo(tenantId: string, id: string, fallo: string | null): Promise<void> {
  const cambios = fallo === null
    ? { invitacion_enviada_en: null, invitacion_via: null }
    : { invitacion_enviada_en: null, invitacion_via: null, invitacion_fallo: fallo, invitacion_fallo_en: new Date().toISOString() };
  const { error } = await acotada(
    supabaseAdmin().from('operador').update(cambios)
      .eq('id', id).eq('tenant_id', tenantId).eq('invitacion_via', 'reclamada').select('id'),
    'invitarOperadores.soltar',
  );
  if (error) logger.warn('invitacion_operador.reclamo_no_soltado', { tenantId, operadorId: id, err: error.message });
}

export type EstadoInvitacion = 'enviada' | 'pendiente' | 'fallo';

export interface InvitacionDeOperador {
  estado: EstadoInvitacion;
  /** Por qué canal salió (texto / botones / plantilla), si salió. */
  via: string | null;
  /** El motivo, si falló. */
  fallo: string | null;
}

/** El estado de la invitación de cada operador de una página (UN `in(...)`).
 *  `reclamada` —un envío en curso o colgado— se cuenta como pendiente: todavía no
 *  hay constancia de que haya salido. Falla cerrado: sin poder leer, lanza. */
export async function estadoInvitaciones(tenantId: string, ids: string[]): Promise<Map<string, InvitacionDeOperador>> {
  const validos = [...new Set(ids.filter(esUuidValido))];
  const salida = new Map<string, InvitacionDeOperador>();
  if (validos.length === 0) return salida;
  const { data, error } = await acotada(
    supabaseAdmin().from('operador')
      .select('id, invitacion_enviada_en, invitacion_via, invitacion_fallo, invitacion_fallo_en')
      .eq('tenant_id', tenantId).in('id', validos),
    'estadoInvitaciones',
  );
  if (error) throw new Error(`estadoInvitaciones: ${error.message}`);
  for (const f of (data ?? []) as Array<Record<string, unknown>>) {
    const via = typeof f.invitacion_via === 'string' ? f.invitacion_via : null;
    const enviada = f.invitacion_enviada_en != null && via !== null && via !== 'reclamada';
    const fallo = typeof f.invitacion_fallo === 'string' && f.invitacion_fallo !== '' ? f.invitacion_fallo : null;
    salida.set(String(f.id), enviada
      ? { estado: 'enviada', via, fallo: null }
      : fallo ? { estado: 'fallo', via: null, fallo } : { estado: 'pendiente', via: null, fallo: null });
  }
  return salida;
}

async function nombreDeLaFlota(tenantId: string): Promise<string> {
  const { data, error } = await acotada(
    supabaseAdmin().from('tenant').select('nombre').eq('id', tenantId).maybeSingle(),
    'invitarOperadores.flota',
  );
  if (error) throw new Error(`invitarOperadores: no se pudo leer el nombre de la flota — ${error.message}`);
  const n = (data as { nombre?: unknown } | null)?.nombre;
  return typeof n === 'string' && n.trim() ? n.trim().slice(0, 60) : 'Tu empresa';
}

/**
 * Manda la invitación a los operadores pedidos (`ids`) o a los pendientes de la
 * flota. NUNCA LANZA por un rechazo de Meta: lo cuenta en `fallidas`. Lanza
 * `DatoInvalido` solo por una petición mal formada (ids que no son uuid).
 */
export async function invitarOperadores(
  tenantId: string,
  opciones: {
    /** Sin `ids` = los pendientes de la flota (o del patio del jefe). */
    ids?: string[];
    alcance: AlcancePatio;
    actor?: { id?: string; email?: string };
    ahora?: Date;
  },
): Promise<ResultadoInvitacion> {
  if (!tenantId) throw new Error('invitarOperadores: falta tenantId');
  const ahora = opciones.ahora ?? new Date();
  const vacio: ResultadoInvitacion = { enviadas: 0, fallidas: [], pendientesRestantes: 0, saltadas: 0 };

  let modo: { tipo: 'pendientes' } | { tipo: 'ids'; ids: string[] };
  let pedidos = 0;
  if (opciones.ids) {
    const ids = [...new Set(opciones.ids.map((i) => String(i).trim()))];
    if (ids.length === 0) throw new DatoInvalido('Elige al menos un operador para invitar.');
    if (ids.some((i) => !esUuidValido(i))) throw new DatoInvalido('No se reconoce a alguno de los operadores. Vuelve a abrir la pantalla.');
    pedidos = ids.length;
    modo = { tipo: 'ids', ids };
  } else {
    modo = { tipo: 'pendientes' };
  }

  let reclamadas: FilaOperador[];
  let flota: string;
  try {
    flota = await nombreDeLaFlota(tenantId);
    reclamadas = await reclamar(tenantId, opciones.alcance, modo, ahora);
  } catch (e) {
    logger.error('invitacion_operador.preparacion_fallo', { tenantId, err: e instanceof Error ? e.message : String(e) });
    return { ...vacio, error: 'No pude preparar las invitaciones — no mandé ninguna. Vuelve a intentar.' };
  }

  const resultado: ResultadoInvitacion = { ...vacio, saltadas: Math.max(0, pedidos - reclamadas.length) };

  await conConcurrencia(reclamadas, CONCURRENCIA, async (op) => {
    const valores = [primerNombre(op.nombre), flota];
    try {
      const r = await enviarConFallback(op.telefono, {
        texto: textoRenderizado(PLANTILLA.operadorInvitacion, valores),
        plantilla: { nombre: PLANTILLA.operadorInvitacion, ...opcionesDeEnvio(PLANTILLA.operadorInvitacion, { cuerpo: valores }) },
        contexto: 'operador.invitacion',
        tenantId,
      });
      if (r.ok) {
        await marcarEnviada(tenantId, op.id, r.via);
        resultado.enviadas += 1;
        return;
      }
      // Reintentable (429, bloqueo temporal, red): se suelta SIN marcar fallo, para
      // que el siguiente intento lo recoja. Permanente: queda el motivo en la ficha.
      await soltarReclamo(tenantId, op.id, r.reintentable ? null : motivoCorto(r.mensaje));
      resultado.fallidas.push({ operadorId: op.id, nombre: op.nombre, motivo: motivoCorto(r.mensaje) });
    } catch (e) {
      // `enviarConFallback` no lanza; esto es el cinturón (p. ej. un uuid de plantilla mal armado).
      logger.error('invitacion_operador.envio_lanzo', { tenantId, operadorId: op.id, err: e instanceof Error ? e.message : String(e) });
      await soltarReclamo(tenantId, op.id, null);
      resultado.fallidas.push({ operadorId: op.id, nombre: op.nombre, motivo: 'Error inesperado al enviar; vuelve a intentar.' });
    }
  });

  try {
    resultado.pendientesRestantes = await contarPendientes(tenantId, opciones.alcance);
  } catch {
    resultado.pendientesRestantes = 0;
  }

  if (reclamadas.length > 0) {
    await anotarBitacora({
      tenantId, actor: opciones.actor ?? {}, accion: 'operador.invitados', entidad: 'tenant', entidadId: tenantId,
      detalle: {
        modo: modo.tipo, enviadas: resultado.enviadas, fallidas: resultado.fallidas.length, saltadas: resultado.saltadas,
        // Ids, no nombres ni teléfonos: la bitácora sobrevive a un borrado ARCO.
        ids: reclamadas.map((r) => r.id),
      },
    });
  }
  logger.info('operadores.invitados', {
    tenantId, modo: modo.tipo, enviadas: resultado.enviadas, fallidas: resultado.fallidas.length, saltadas: resultado.saltadas,
  });
  return resultado;
}

/**
 * Reintenta a los que tienen un fallo vigente (el teléfono se corrigió, o Meta
 * ya los acepta). Elige hasta `LIMITE_POR_LLAMADA` con fallo y los manda por la
 * vía de ids, que SÍ reclama a quien tiene fallo (a diferencia de «pendientes»).
 */
export async function reintentarFallidas(
  tenantId: string,
  opciones: { alcance: AlcancePatio; actor?: { id?: string; email?: string }; ahora?: Date },
): Promise<ResultadoInvitacion> {
  let q = supabaseAdmin().from('operador').select('id').eq('tenant_id', tenantId).eq('activo', true)
    .not('invitacion_fallo_en', 'is', null).order('invitacion_fallo_en').order('id').limit(LIMITE_POR_LLAMADA);
  if (opciones.alcance.tipo === 'patio') q = q.eq('terminal_id', opciones.alcance.terminalId);
  const { data, error } = await acotada(q, 'reintentarFallidas.ids');
  if (error) {
    logger.error('invitacion_operador.reintento_ilegible', { tenantId, err: error.message });
    return { enviadas: 0, fallidas: [], pendientesRestantes: 0, saltadas: 0, error: 'No pude leer a quién reintentar. Vuelve a intentar.' };
  }
  const ids = ((data ?? []) as Array<{ id: unknown }>).map((f) => String(f.id));
  if (ids.length === 0) return { enviadas: 0, fallidas: [], pendientesRestantes: 0, saltadas: 0 };
  return invitarOperadores(tenantId, { ids, alcance: opciones.alcance, actor: opciones.actor, ahora: opciones.ahora });
}

/**
 * El mensaje que la pantalla enseña tras un envío, dicho con lo que PASÓ y no con
 * lo que se pidió: «se enviaron 38», «2 no salieron», «quedan 120 pendientes».
 * PURA.
 */
export function mensajeDeInvitacion(r: ResultadoInvitacion):
  | { ok: true; mensaje: string; fallidas: FalloInvitacion[] }
  | { ok: false; error: string } {
  if (r.error) return { ok: false, error: r.error };
  if (r.enviadas === 0 && r.fallidas.length === 0) {
    return {
      ok: true, fallidas: [],
      mensaje: r.saltadas > 0
        ? 'No había nada que invitar: ya estaban invitados, están de baja o no son de tu patio.'
        : 'No hay operadores pendientes de invitar.',
    };
  }
  const partes = [`Se enviaron ${r.enviadas} ${r.enviadas === 1 ? 'invitación' : 'invitaciones'}`];
  if (r.fallidas.length > 0) partes.push(`${r.fallidas.length} no ${r.fallidas.length === 1 ? 'salió' : 'salieron'}`);
  if (r.saltadas > 0) partes.push(`${r.saltadas} ya estaban invitados`);
  let mensaje = `${partes.join('; ')}.`;
  if (r.pendientesRestantes > 0) mensaje += ` Quedan ${r.pendientesRestantes} por invitar: vuelve a enviar para seguir.`;
  return { ok: true, mensaje, fallidas: r.fallidas };
}
