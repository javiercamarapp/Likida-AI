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
// no. Es UNA copia por liquidación, generación y TELÉFONO:
//   · la bitácora guarda QUÉ teléfonos la aceptaron (`telefonos_aceptados`); un
//     reintento va solo a los faltantes, no repite a quien ya la recibió ni da por
//     enviada una copia que solo llegó a uno de dos jefes;
//   · antes de mandar a un teléfono se RECLAMA (`reclamarCopiaJefe`, mig. 0620):
//     dos invocaciones concurrentes no duplican el WhatsApp con el monto. Sin la
//     0620 en la base el código cae a la bitácora sola (sin candado atómico).
// Nunca lanza.
// ═══════════════════════════════════════════════════════════════════════════

import { logger } from '@/lib/logger';
import { appUrl } from '@/lib/env';
import { avisarOficina, parametrosAvisoOficina } from '@/lib/meta/aviso_oficina';
import { dinero, periodoTexto } from './presentacion';
import { cerrarCopiaJefe, eventosDe, leerTelefonosFlota, reclamarCopiaJefe, registrarEvento, type LiquidacionExterna, type ReclamoCopia } from './repo';

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

/** Teléfonos que YA aceptaron la copia de esta generación según la bitácora. Un evento anterior a
 *  `telefonos_aceptados` con `enviado: true` se lee como «todos los designados» (era lo único que decía). */
function aceptadosPrevios(
  previos: Array<{ tipo: string; detalle: Record<string, unknown> }>, generacion: number, destinos: string[],
): Set<string> {
  const ok = new Set<string>();
  for (const e of previos) {
    if (e.tipo !== 'aviso_oficina' || e.detalle.destino !== 'copia_jefe' || e.detalle.generacion !== generacion) continue;
    if (Array.isArray(e.detalle.telefonos_aceptados)) {
      for (const t of e.detalle.telefonos_aceptados) if (typeof t === 'string') ok.add(t);
    } else if (e.detalle.enviado === true) {
      for (const t of destinos) ok.add(t);
    }
  }
  return ok;
}

export const copiarAJefePorOmision: CopiarAJefe = async (liq, doc) => {
  try {
    const cfg = await leerTelefonosFlota(liq.tenantId);
    const destinos = cfg?.copia ?? [];
    if (destinos.length === 0) return { estado: 'sin_destinatarios' };

    const previos = aceptadosPrevios(await eventosDe(liq.tenantId, liq.id), liq.generacion, destinos);
    const faltantes = destinos.filter((t) => !previos.has(t));
    if (faltantes.length === 0) return { estado: 'ya_enviada' };

    const chofer = (liq.operadorNombre ?? '').trim() || 'Un operador';
    const nuevos: string[] = [];
    const fallidos: string[] = [];
    for (const tel of faltantes) {
      let reclamo: ReclamoCopia | null | 'sin_candado';
      try {
        reclamo = await reclamarCopiaJefe(liq.tenantId, liq.id, liq.generacion, tel);
      } catch (e) {
        // Sin saber si otro ya la mandó, NO se manda: la copia lleva cifras.
        logger.error('liqext.copia_jefe_reclamo_fallo', { id: liq.id, err: e instanceof Error ? e.message : String(e) });
        fallidos.push(tel);
        continue;
      }
      if (reclamo === null) continue; // ya salió o la está mandando otra invocación
      const r = await avisarOficina(tel, textoCopia(liq, doc), {
        parametros: parametrosAvisoOficina(chofer, `copia de la liquidación ${liq.claveExterna}`, liga()),
        contexto: { tenantId: liq.tenantId, agente: 'liquidacion_externa', liquidacion: liq.id },
      });
      // Un rechazo transitorio (timeout, 429, 5xx) YA dejó el mensaje en `wa_outbox`, que lo entrega solo:
      // soltar el reclamo haría que un reintento (o «reenviar copia») lo mande otra vez y el jefe reciba dos
      // WhatsApp con el monto. Se cierra como aceptada (en cola) y no se vuelve a mandar.
      const enCola = !r.ok && r.reintentable === true;
      if (r.ok || enCola) {
        nuevos.push(tel);
        if (enCola) logger.warn('liqext.copia_jefe_en_cola', { id: liq.id, motivo: r.motivo, codigo: r.codigo });
      } else {
        fallidos.push(tel);
        logger.error('liqext.copia_jefe_fallo', { id: liq.id, motivo: r.motivo, codigo: r.codigo });
      }
      if (reclamo !== 'sin_candado') await cerrarCopiaJefe(liq.tenantId, liq.id, liq.generacion, tel, reclamo, r.ok || enCola);
    }
    // Nada que intentar por nuestra cuenta: otra invocación ya la manda o la mandó.
    if (nuevos.length === 0 && fallidos.length === 0) return { estado: 'ya_enviada' };

    const aceptados = new Set([...previos, ...nuevos]);
    const cubiertos = destinos.filter((t) => aceptados.has(t)).length;
    // La bitácora usa el evento que ya existe (`aviso_oficina`): no hace falta migrar su CHECK.
    await registrarEvento(liq.tenantId, liq.id, 'aviso_oficina', {
      destino: 'copia_jefe', generacion: liq.generacion, enviado: cubiertos === destinos.length,
      aceptados: cubiertos, destinatarios: destinos.length, telefonos_aceptados: nuevos,
    });
    return nuevos.length > 0
      ? { estado: 'enviada', aceptados: cubiertos, destinatarios: destinos.length }
      : { estado: 'no_enviada', destinatarios: destinos.length };
  } catch (e) {
    logger.error('liqext.copia_jefe_error', { id: liq.id, err: e instanceof Error ? e.message : String(e) });
    return { estado: 'no_enviada', destinatarios: 0 };
  }
};
