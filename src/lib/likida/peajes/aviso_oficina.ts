// ═══════════════════════════════════════════════════════════════════════════
// EL AVISO A LA OFICINA cuando la conciliación automática encuentra algo que
// mirar (0563).
//
// Antes, un desglose que entraba por el buzón o por el pull y salía con cobros
// que el GPS NO ubica en la caseta (veredicto `no_coincide`) o sin respaldo en
// los tickets quedaba esperando a que alguien abriera la pantalla. Ahora el cron
// avisa por WhatsApp a quien ve DINERO (dueño o contador; nunca al encargado: ver
// `telefonoParaDineroDe`), por el selector central (texto en ventana, plantilla
// `aviso_operacion_v1` fuera).
//
// LA DOCTRINA NO CAMBIA: el aviso dice cuántos cobros hay que revisar y por qué
// categoría, y que es una señal, no una acusación. No lleva montos por cobro ni
// afirma que algo sea indebido. «No coincide» del GPS es un hecho sobre la
// posición de la unidad, no sobre el proveedor.
//
// IDEMPOTENTE: UNA vez por desglose. El intento se reclama con compare-and-set
// (`aviso_intentos`), así que dos procesos no mandan dos avisos; si el envío falla
// (sin destinatario, plantilla sin aprobar), el barrido del cron lo reintenta
// hasta MAX_INTENTOS_AVISO. Un desglose ANULADO jamás avisa.
// ═══════════════════════════════════════════════════════════════════════════

import { logger } from '@/lib/logger';
import { appUrl } from '@/lib/env';
import { avisarOficina, parametrosAvisoOficina } from '@/lib/meta/aviso_oficina';
import { telefonoParaDineroDe } from '../contactos';
import { bitacoraConciliada } from './bitacora_conciliada';
import {
  leerEstadoAvisoDesglose, reclamarIntentoAviso, devolverIntentoAviso, marcarAvisoRequerido, marcarAvisoEnviado, agotarIntentosAviso, avisosPendientesPeajes, MAX_INTENTOS_AVISO,
} from './datos';
import { quedoEnCola } from './aviso_en_cola';
import { superficiePeajesDeTenant, type SuperficiePeajes } from './superficie_perfil';

export type ResultadoAvisoDesglose =
  | 'enviado' | 'no_requerido' | 'ya_avisado' | 'anulado' | 'no_existe' | 'agotado' | 'ocupado' | 'sin_destinatario' | 'rechazado';

export interface DepsAvisoPeajes {
  telefono: (tenantId: string) => Promise<string | null>;
  avisar: typeof avisarOficina;
  /** Qué partes de peajes tiene la flota (perfil). Sin poder leer el perfil, la restringida (falla cerrado). */
  superficie: (tenantId: string) => Promise<SuperficiePeajes>;
}
const depsPorOmision: DepsAvisoPeajes = { telefono: telefonoParaDineroDe, avisar: avisarOficina, superficie: superficiePeajesDeTenant };

/**
 * Fracción mínima de cobros que deben cuadrar con un ticket de caseta para que «sin respaldo» SIGNIFIQUE algo. Si la flota casi no tiene
 * tickets de caseta cargados (un solo gasto en el periodo, o ninguno), TODO cobro sale «sin respaldo» — miles — y avisar de eso es ruido:
 * la comparación no tiene contra qué. Debajo de este umbral la categoría no se avisa (sigue visible en pantalla, con su explicación).
 */
export const COBERTURA_MINIMA_TICKETS = 0.05;

export interface ConteoAviso { gpsNoCoincide: number; sinRespaldo: number; porVerificar: number }

/**
 * Lo que de verdad se avisa de una conciliación, según el PERFIL de la flota y la cobertura de sus tickets (puro):
 *  · «el GPS no ubica la unidad» solo si la flota tiene la superficie GPS (bajo `cinco_agentes` la evidencia GPS es stand-by);
 *  · «sin respaldo en tus tickets» / «por verificar» solo si la flota tiene tickets de caseta (`cfdiYTickets`) Y al menos
 *    `COBERTURA_MINIMA_TICKETS` de los cobros cuadró con alguno.
 * `motivoOmitido` dice por qué se calló una categoría que sí traía casos (para el log, no para el cliente).
 */
export function contarParaAviso(
  b: { filas: ReadonlyArray<{ gps?: string | null }>; resumen: { total?: number; cuadra?: number; sinRespaldo: number; porVerificar: number } },
  superficie: SuperficiePeajes,
): { conteo: ConteoAviso; motivoOmitido: string | null } {
  let motivoOmitido: string | null = null;
  const gpsNoCoincide = superficie.gps ? b.filas.filter((f) => f.gps === 'no coincide').length : 0;
  let sinRespaldo = b.resumen.sinRespaldo;
  let porVerificar = b.resumen.porVerificar;
  if (!superficie.cfdiYTickets) {
    if (sinRespaldo > 0 || porVerificar > 0) motivoOmitido = 'perfil_sin_tickets';
    sinRespaldo = 0; porVerificar = 0;
  } else {
    const total = b.resumen.total ?? b.filas.length;
    const cuadra = b.resumen.cuadra ?? 0;
    if (total > 0 && cuadra / total < COBERTURA_MINIMA_TICKETS) {
      if (sinRespaldo > 0 || porVerificar > 0) motivoOmitido = 'sin_cobertura_de_tickets';
      sinRespaldo = 0; porVerificar = 0;
    }
  }
  return { conteo: { gpsNoCoincide, sinRespaldo, porVerificar }, motivoOmitido };
}

const liga = () => `${appUrl()}/dashboard/agentes/peajes`;

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

/** El texto del aviso (puro, para probarlo): solo cuenta categorías con casos. */
export function textoAvisoDesglose(
  d: { proveedor: string | null; periodoDesde: string | null; periodoHasta: string | null },
  c: { gpsNoCoincide: number; sinRespaldo: number; porVerificar: number },
): string {
  const partes: string[] = [];
  if (c.gpsNoCoincide > 0) partes.push(`${plural(c.gpsNoCoincide, 'cobro donde el GPS no ubica', 'cobros donde el GPS no ubica')} la unidad en la caseta`);
  if (c.sinRespaldo > 0) partes.push(`${plural(c.sinRespaldo, 'cobro sin respaldo', 'cobros sin respaldo')} en tus tickets`);
  if (c.porVerificar > 0) partes.push(`${plural(c.porVerificar, 'cobro', 'cobros')} por verificar`);
  const periodo = d.periodoDesde && d.periodoHasta ? ` (${d.periodoDesde} a ${d.periodoHasta})` : '';
  return `⚠️ Peajes: en el desglose${d.proveedor ? ` de ${d.proveedor}` : ''}${periodo} hay ${partes.join(', ')}. Es una señal para revisar, no afirma que el cobro sea indebido. Revísalo: ${liga()}`;
}

/** Evalúa y, si hay algo que mirar, avisa UNA vez. Nunca lanza. */
export async function avisarDesgloseConciliado(tenantId: string, desgloseId: string, deps: DepsAvisoPeajes = depsPorOmision): Promise<ResultadoAvisoDesglose> {
  try {
    const estado = await leerEstadoAvisoDesglose(tenantId, desgloseId);
    if (!estado) return 'no_existe';
    if (estado.anulado) return 'anulado';
    if (estado.avisoEn) return 'ya_avisado';
    if (estado.intentos >= MAX_INTENTOS_AVISO) return 'agotado';

    const b = await bitacoraConciliada(tenantId, desgloseId);
    if (!b) return 'anulado';
    const { conteo: c, motivoOmitido } = contarParaAviso(b, await deps.superficie(tenantId));
    if (motivoOmitido) logger.info('peajes.aviso_categoria_omitida', { tenant: tenantId, desglose: desgloseId, motivo: motivoOmitido });
    if (c.gpsNoCoincide === 0 && c.sinRespaldo === 0) return 'no_requerido';

    // A2P-05: sin destinatario NO se reclama el intento (antes se agotaban 5 en ~75 min y nunca se reenviaba al configurar el teléfono).
    const tel = await deps.telefono(tenantId);
    if (!tel) {
      logger.warn('peajes.aviso_sin_destinatario', { tenant: tenantId, desglose: desgloseId });
      // Queda pendiente para el barrido (sin gastar intentos): cuando haya teléfono, sale.
      await marcarAvisoRequerido(tenantId, desgloseId);
      return 'sin_destinatario';
    }
    if (!(await reclamarIntentoAviso(tenantId, desgloseId, estado.intentos))) return 'ocupado';
    const proveedor = estado.proveedor?.trim() || 'peajes';
    const r = await deps.avisar(tel, textoAvisoDesglose(estado, c), {
      parametros: parametrosAvisoOficina(`Peajes ${proveedor}`, `${c.gpsNoCoincide + c.sinRespaldo} cobros por revisar`, liga()),
      contexto: { tenantId, agente: 'peajes', desglose: desgloseId },
    });
    const enCola = quedoEnCola(r);
    if (!r.ok && !enCola) {
      logger.error('peajes.aviso_fallo', { tenant: tenantId, desglose: desgloseId, motivo: r.motivo, codigo: r.codigo });
      // A2P-05: ventana de 24 h cerrada y la plantilla no salió (sin aprobar): no es culpa del aviso, el intento se devuelve para cuando se apruebe.
      if (r.fueraDeVentana) await devolverIntentoAviso(tenantId, desgloseId, estado.intentos);
      return 'rechazado';
    }
    if (enCola) logger.warn('peajes.aviso_en_cola', { tenant: tenantId, desglose: desgloseId, motivo: r.ok ? null : r.motivo, codigo: r.ok ? null : r.codigo });
    // A37-S51-03: ya salió (o quedó en el outbox). Si el sello falla se reintenta una vez; si sigue fallando se agotan los
    // intentos del desglose para que el barrido NO lo reenvíe hasta MAX_INTENTOS_AVISO veces.
    if (!(await marcarAvisoEnviado(tenantId, desgloseId)) && !(await marcarAvisoEnviado(tenantId, desgloseId))) {
      const agotado = await agotarIntentosAviso(tenantId, desgloseId, MAX_INTENTOS_AVISO);
      logger.error('peajes.aviso_enviado_sin_sello', { tenant: tenantId, desglose: desgloseId, agotado });
    }
    return 'enviado';
  } catch (e) {
    logger.error('peajes.aviso_error', { tenant: tenantId, desglose: desgloseId, err: e instanceof Error ? e.message : String(e) });
    return 'rechazado';
  }
}

export interface ResumenAvisos { revisados: number; enviados: number; pendientes: number }

/** El barrido del cron: reintenta los avisos que quedaron por enviar. Nunca lanza. */
export async function reintentarAvisosPeajes(limite = 5, deps: DepsAvisoPeajes = depsPorOmision): Promise<ResumenAvisos> {
  const r: ResumenAvisos = { revisados: 0, enviados: 0, pendientes: 0 };
  let lista: Array<{ tenantId: string; desgloseId: string }> = [];
  try { lista = await avisosPendientesPeajes(limite); } catch (e) {
    logger.error('peajes.avisos_barrido', { err: e instanceof Error ? e.message : String(e) });
    return r;
  }
  for (const p of lista) {
    r.revisados++;
    const res = await avisarDesgloseConciliado(p.tenantId, p.desgloseId, deps);
    if (res === 'enviado') r.enviados++; else if (res === 'rechazado' || res === 'sin_destinatario') r.pendientes++;
  }
  return r;
}
