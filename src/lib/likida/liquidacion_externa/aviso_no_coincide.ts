// ═══════════════════════════════════════════════════════════════════════════
// LIQUIDACIÓN EXTERNA — el aviso a la oficina cuando el chofer dice «No coincide».
//
// Antes «No coincide» solo quedaba MARCADO en el panel: una oficina que no abre
// el panel no se enteraba de que un chofer disputaba su pago. Ahora se le avisa
// por WhatsApp a la PERSONA RESPONSABLE que la flota designó
// (`liquidacion_formato_flota.discrepancia_telefonos`); si no designó a nadie, a
// quien recibe la copia de las liquidaciones (el jefe de flota) y, sin copia, a
// quien ve DINERO (dueño o contador; nunca al encargado «por lo menos»: el canal
// no puede ser la puerta trasera de la matriz de visibilidad, ver
// `telefonoParaDineroDe`).
//
// Sale por el selector central (`avisarOficina` → `enviarConFallback`): texto si
// la ventana de 24 h de la oficina está abierta, plantilla `aviso_operacion_v1`
// si no. El texto NO lleva cifras (clave externa y chofer), y la plantilla
// tampoco: el detalle vive en el panel.
//
// Nunca lanza. Devuelve a QUIÉN le llegó (Meta aceptó el aviso o quedó en el outbox, que lo
// entrega solo): el reintento va solo a los faltantes y el chofer solo recibe la promesa
// «avisé a tu oficina» cuando de verdad salió a alguien.
// ═══════════════════════════════════════════════════════════════════════════

import { logger } from '@/lib/logger';
import { appUrl } from '@/lib/env';
import { avisarOficina, parametrosAvisoOficina } from '@/lib/meta/aviso_oficina';
import { limpiarResumen } from '../orquestador/escalamiento';
import { telefonoParaDineroDe } from '../contactos';
import { leerTelefonosFlota } from './repo';
import type { LiquidacionExterna, TareaDiferencia } from './repo';

export interface ResultadoAvisoDiscrepancia {
  /** A quién le toca el aviso (los designados, o el respaldo). Vacío = no hay a quién avisar. */
  destinatarios: string[];
  /** Los que YA lo tienen: lo aceptó Meta, o quedó en el outbox (que lo entrega solo; mandarlo otra vez sería duplicarlo). */
  aceptados: string[];
  /** El último motivo de rechazo, en palabras, para el panel y el log. */
  motivo?: string;
}

/**
 * `ya` = teléfonos que ya recibieron este aviso (un reintento no se los repite). Nunca lanza.
 */
export type AvisarNoCoincide = (liq: LiquidacionExterna, ya?: readonly string[]) => Promise<ResultadoAvisoDiscrepancia>;

const liga = () => `${appUrl()}/dashboard/agentes/liquidacion`;

/** A quién se le avisa: la persona responsable designada → la copia al jefe → quien ve dinero. */
export async function destinatariosDiscrepancia(tenantId: string): Promise<string[]> {
  const tel = await leerTelefonosFlota(tenantId);
  if (tel && tel.discrepancia.length > 0) return tel.discrepancia;
  if (tel && tel.copia.length > 0) return tel.copia;
  const dinero = await telefonoParaDineroDe(tenantId);
  return dinero ? [dinero] : [];
}

/** El resumen de la tarea durable para una persona: sin cifras ni números largos (el detalle vive en el panel). */
export function tareaDeDiferencia(liq: LiquidacionExterna): TareaDiferencia {
  const chofer = (liq.operadorNombre ?? '').trim() || 'Un chofer';
  const origen = liq.sistemaOrigen ? ` (${liq.sistemaOrigen})` : '';
  return {
    resumen: limpiarResumen(`${chofer} respondió «No coincide» a su liquidación ${liq.claveExterna}${origen}. Revisa la diferencia con el operador en el panel de liquidaciones.`),
    viajeFolio: liq.foliosViaje.length === 1 ? liq.foliosViaje[0] : null,
    viajeId: liq.viajeIds.length === 1 ? liq.viajeIds[0] : null,
  };
}

export const avisarNoCoincidePorOmision: AvisarNoCoincide = async (liq, ya = []) => {
  try {
    const destinatarios = await destinatariosDiscrepancia(liq.tenantId);
    if (destinatarios.length === 0) {
      logger.warn('liqext.no_coincide_sin_destinatario', { id: liq.id, tenant: liq.tenantId });
      return { destinatarios, aceptados: [], motivo: 'No hay a quién avisar: designa a la persona responsable en «Formato de las liquidaciones».' };
    }
    const chofer = (liq.operadorNombre ?? '').trim() || 'Un chofer';
    const resumen = `liquidación ${liq.claveExterna} no coincide`;
    const texto = `⚠️ ${chofer} respondió «No coincide» a su liquidación ${liq.claveExterna}${liq.sistemaOrigen ? ` (${liq.sistemaOrigen})` : ''}. Revísala en el panel: ${liga()}`;
    // A TODOS los designados (cada uno por su cuenta: que uno falle no calla a los demás), salvo a quien ya lo recibió.
    const aceptados: string[] = destinatarios.filter((t) => ya.includes(t));
    let motivo: string | undefined;
    for (const tel of destinatarios) {
      if (ya.includes(tel)) continue;
      const r = await avisarOficina(tel, texto, {
        parametros: parametrosAvisoOficina(chofer, resumen, liga()),
        contexto: { tenantId: liq.tenantId, agente: 'liquidacion_externa', liquidacion: liq.id },
      });
      // Un rechazo transitorio (timeout, 429, 5xx) o con token vencido YA dejó el mensaje en `wa_outbox`, que lo entrega
      // solo: mandarlo de nuevo lo duplicaría. Cuenta como aceptado.
      if (r.ok || r.reintentable === true || r.encolado === true) {
        aceptados.push(tel);
        if (!r.ok) logger.warn('liqext.no_coincide_aviso_en_cola', { id: liq.id, motivo: r.motivo, codigo: r.codigo });
      } else {
        motivo = r.motivo;
        logger.error('liqext.no_coincide_aviso_fallo', { id: liq.id, motivo: r.motivo, codigo: r.codigo });
      }
    }
    return { destinatarios, aceptados, ...(motivo ? { motivo } : {}) };
  } catch (e) {
    logger.error('liqext.no_coincide_aviso_error', { id: liq.id, err: e instanceof Error ? e.message : String(e) });
    return { destinatarios: [], aceptados: [], motivo: 'No se pudo preparar el aviso.' };
  }
};
