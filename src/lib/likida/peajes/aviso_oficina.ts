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
  leerEstadoAvisoDesglose, reclamarIntentoAviso, marcarAvisoEnviado, avisosPendientesPeajes, MAX_INTENTOS_AVISO,
} from './datos';

export type ResultadoAvisoDesglose =
  | 'enviado' | 'no_requerido' | 'ya_avisado' | 'anulado' | 'no_existe' | 'agotado' | 'ocupado' | 'sin_destinatario' | 'rechazado';

export interface DepsAvisoPeajes {
  telefono: (tenantId: string) => Promise<string | null>;
  avisar: typeof avisarOficina;
}
const depsPorOmision: DepsAvisoPeajes = { telefono: telefonoParaDineroDe, avisar: avisarOficina };

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
    const c = {
      gpsNoCoincide: b.filas.filter((f) => f.gps === 'no coincide').length,
      sinRespaldo: b.resumen.sinRespaldo,
      porVerificar: b.resumen.porVerificar,
    };
    if (c.gpsNoCoincide === 0 && c.sinRespaldo === 0) return 'no_requerido';

    if (!(await reclamarIntentoAviso(tenantId, desgloseId, estado.intentos))) return 'ocupado';

    const tel = await deps.telefono(tenantId);
    if (!tel) {
      logger.warn('peajes.aviso_sin_destinatario', { tenant: tenantId, desglose: desgloseId });
      return 'sin_destinatario';
    }
    const proveedor = estado.proveedor?.trim() || 'peajes';
    const r = await deps.avisar(tel, textoAvisoDesglose(estado, c), {
      parametros: parametrosAvisoOficina(`Peajes ${proveedor}`, `${c.gpsNoCoincide + c.sinRespaldo} cobros por revisar`, liga()),
      contexto: { tenantId, agente: 'peajes', desglose: desgloseId },
    });
    if (!r.ok) {
      logger.error('peajes.aviso_fallo', { tenant: tenantId, desglose: desgloseId, motivo: r.motivo, codigo: r.codigo });
      return 'rechazado';
    }
    await marcarAvisoEnviado(tenantId, desgloseId);
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
