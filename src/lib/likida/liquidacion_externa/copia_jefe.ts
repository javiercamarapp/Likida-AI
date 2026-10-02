// ═══════════════════════════════════════════════════════════════════════════
// LIQUIDACIÓN EXTERNA — LA COPIA AL JEFE DE FLOTA.
//
// El jefe de flota quiere ver lo que se le mandó a cada operador, sin que nadie
// se lo reenvíe a mano. Cuando la entrega al chofer queda en cola o enviada, se
// le manda UNA copia a cada teléfono que la flota designó
// (`liquidacion_formato_flota.copia_telefonos`, hasta 3, decisión de quien
// administra: la copia lleva cifras, así que NO se adivina un destinatario).
//
// Sale por el selector central de avisos a la oficina (`avisarOficina`): texto
// con el resumen y la liga de descarga del documento (vigente 24 h) si la
// ventana está abierta; plantilla `aviso_operacion_v1` con la liga del panel si
// no. Es UNA copia por liquidación y generación: la bitácora recuerda que ya se
// mandó y un segundo intento no la repite. Nunca lanza.
// ═══════════════════════════════════════════════════════════════════════════

import { logger } from '@/lib/logger';
import { appUrl } from '@/lib/env';
import { avisarOficina, parametrosAvisoOficina } from '@/lib/meta/aviso_oficina';
import { dinero, periodoTexto } from './presentacion';
import { eventosDe, leerFormatoFlota, registrarEvento, type LiquidacionExterna } from './repo';

export interface DocumentoCopia { url: string; nombre: string }

export type ResultadoCopia =
  | { estado: 'sin_destinatarios' }
  | { estado: 'ya_enviada' }
  | { estado: 'enviada'; aceptados: number; destinatarios: number }
  | { estado: 'no_enviada'; destinatarios: number };

export type CopiarAJefe = (liq: LiquidacionExterna, doc: DocumentoCopia | null) => Promise<ResultadoCopia>;

const liga = () => `${appUrl()}/dashboard/agentes/liquidacion`;

export const textoCopia = (liq: LiquidacionExterna, doc: DocumentoCopia | null): string => [
  `Copia de la liquidación ${liq.claveExterna} de ${(liq.operadorNombre ?? '').trim() || 'un operador'}.`,
  `Periodo: ${periodoTexto(liq.periodoDesde, liq.periodoHasta)} · Total: ${dinero(liq.total, liq.moneda)}`,
  ...(doc ? [`Documento (la liga vale 24 h): ${doc.url}`] : []),
  `También está en el panel: ${liga()}`,
].join('\n');

export const copiarAJefePorOmision: CopiarAJefe = async (liq, doc) => {
  try {
    const cfg = await leerFormatoFlota(liq.tenantId);
    const destinos = cfg?.copiaTelefonos ?? [];
    if (destinos.length === 0) return { estado: 'sin_destinatarios' };

    const previos = await eventosDe(liq.tenantId, liq.id);
    if (previos.some((e) => e.tipo === 'aviso_oficina' && e.detalle.destino === 'copia_jefe' && e.detalle.generacion === liq.generacion && e.detalle.enviado === true)) {
      return { estado: 'ya_enviada' };
    }

    const chofer = (liq.operadorNombre ?? '').trim() || 'Un operador';
    let aceptados = 0;
    for (const tel of destinos) {
      const r = await avisarOficina(tel, textoCopia(liq, doc), {
        parametros: parametrosAvisoOficina(chofer, `copia de la liquidación ${liq.claveExterna}`, liga()),
        contexto: { tenantId: liq.tenantId, agente: 'liquidacion_externa', liquidacion: liq.id },
      });
      if (r.ok) aceptados++;
      else logger.error('liqext.copia_jefe_fallo', { id: liq.id, motivo: r.motivo, codigo: r.codigo });
    }
    // La bitácora usa el evento que ya existe (`aviso_oficina`): no hace falta migrar su CHECK.
    await registrarEvento(liq.tenantId, liq.id, 'aviso_oficina', {
      destino: 'copia_jefe', generacion: liq.generacion, enviado: aceptados > 0, aceptados, destinatarios: destinos.length,
    });
    return aceptados > 0 ? { estado: 'enviada', aceptados, destinatarios: destinos.length } : { estado: 'no_enviada', destinatarios: destinos.length };
  } catch (e) {
    logger.error('liqext.copia_jefe_error', { id: liq.id, err: e instanceof Error ? e.message : String(e) });
    return { estado: 'no_enviada', destinatarios: 0 };
  }
};
