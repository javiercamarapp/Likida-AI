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
// Nunca lanza. `true` solo si Meta ACEPTÓ el aviso: el chofer solo recibe la
// promesa «avisé a tu oficina» cuando de verdad salió.
// ═══════════════════════════════════════════════════════════════════════════

import { logger } from '@/lib/logger';
import { avisarOficina, parametrosAvisoOficina } from '@/lib/meta/aviso_oficina';
import { telefonoParaDineroDe } from '../contactos';
import { leerFormatoFlota } from './repo';
import type { LiquidacionExterna } from './repo';

export type AvisarNoCoincide = (liq: LiquidacionExterna) => Promise<boolean>;

const liga = () => `${(process.env.NEXT_PUBLIC_APP_URL || 'https://app.likida.ai').replace(/\/+$/, '')}/dashboard/agentes/liquidacion`;

/** A quién se le avisa: la persona responsable designada → la copia al jefe → quien ve dinero. */
export async function destinatariosDiscrepancia(tenantId: string): Promise<string[]> {
  const cfg = await leerFormatoFlota(tenantId);
  if (cfg && cfg.discrepanciaTelefonos.length > 0) return cfg.discrepanciaTelefonos;
  if (cfg && cfg.copiaTelefonos.length > 0) return cfg.copiaTelefonos;
  const tel = await telefonoParaDineroDe(tenantId);
  return tel ? [tel] : [];
}

export const avisarNoCoincidePorOmision: AvisarNoCoincide = async (liq) => {
  try {
    const destinos = await destinatariosDiscrepancia(liq.tenantId);
    if (destinos.length === 0) {
      logger.warn('liqext.no_coincide_sin_destinatario', { id: liq.id, tenant: liq.tenantId });
      return false;
    }
    const chofer = (liq.operadorNombre ?? '').trim() || 'Un chofer';
    const resumen = `liquidación ${liq.claveExterna} no coincide`;
    const texto = `⚠️ ${chofer} respondió «No coincide» a su liquidación ${liq.claveExterna}${liq.sistemaOrigen ? ` (${liq.sistemaOrigen})` : ''}. Revísala en el panel: ${liga()}`;
    // A TODOS los designados (cada uno por su cuenta: que uno falle no calla a los demás).
    // `true` si Meta aceptó al menos un aviso: el chofer solo recibe la promesa
    // «avisé a tu oficina» cuando de verdad le llegó a alguien.
    let aceptado = false;
    for (const tel of destinos) {
      const r = await avisarOficina(tel, texto, {
        parametros: parametrosAvisoOficina(chofer, resumen, liga()),
        contexto: { tenantId: liq.tenantId, agente: 'liquidacion_externa', liquidacion: liq.id },
      });
      if (r.ok) aceptado = true;
      else logger.error('liqext.no_coincide_aviso_fallo', { id: liq.id, motivo: r.motivo, codigo: r.codigo });
    }
    return aceptado;
  } catch (e) {
    logger.error('liqext.no_coincide_aviso_error', { id: liq.id, err: e instanceof Error ? e.message : String(e) });
    return false;
  }
};
