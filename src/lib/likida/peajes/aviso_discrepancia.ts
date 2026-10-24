import { logger } from '@/lib/logger';
import { quedoEnCola } from './aviso_en_cola';
import { appUrl } from '@/lib/env';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { acotada } from '../presupuesto';
import { avisarOficina, parametrosAvisoOficina } from '@/lib/meta/aviso_oficina';
import { revisionDeDesglose, type ReporteRevision } from './repo';
import { almacenAvisoAtipicos } from './aviso_atipicos';
import { discrepanciaDeCandidato, armarReporteDiscrepancia, type PosicionConocida } from './reporte_discrepancia';

// ═══════════════════════════════════════════════════════════════════════════
// EL AVISO DEL PROTOCOLO DE DISCREPANCIA GEOGRÁFICA (T-A2-37) — CONECTA
// `reporte_discrepancia.ts` A LA INGESTA REAL.
//
// Auditoría adversarial confirmada: `armarReporteDiscrepancia`/`discrepanciaDeCandidato`
// solo se llamaban desde sus propias pruebas. Ningún cron, API ni botón del panel los
// invocaba, así que el candidato CRÍTICO de `unidad_inmovilizada` (T-A2-36 — un TAG que
// cruza mientras la flota declaró su unidad en taller o siniestrada) nunca generaba el
// reporte ni el aviso que el cliente pidió. Esta pieza los invoca de verdad.
//
// CUÁNDO CORRE: justo después de conciliar un desglose (mismo punto del cron que ya
// manda `avisarDesgloseConciliado` y `reintentarAvisosAtipicos`). Revisa los candidatos
// de ESE desglose con `revisionDeDesglose` (la misma función que alimenta la pantalla de
// revisión) y, por cada candidato crítico de `unidad_inmovilizada`, arma el reporte
// completo (qué pasó / evidencia / qué hacer) y lo manda por el selector central.
//
// DESTINATARIO: el MISMO que configuran los avisos de cruces atípicos (T-A2-14,
// `peaje_atipico_config.umbrales.aviso.telefono`) — así lo documentaba ya
// `reporte_discrepancia.ts` antes de que nada lo llamara. Sin ese teléfono, el reporte
// se arma igual (`armarReporteDiscrepancia` lo deja ver en pantalla) pero no se envía a
// nadie, y se dice por qué.
//
// NUNCA LANZA Y SIN COLA DE REINTENTOS PROPIA: igual que `revisarAtipicosDeDesglose` y
// `vincularDesglose` en el mismo paso del cron, un fallo aquí no debe tumbar ni reabrir
// un archivo ya cerrado. A diferencia de los avisos de conciliación/atípicos (que SÍ
// reintentan porque son frecuentes), esta categoría es rara y crítica: si el envío falla,
// el candidato sigue visible en la pantalla de revisión y en el Excel de reclamo
// (`candidatos_archivos.ts`), así que no se pierde; solo se cuenta como pendiente en el
// resumen de la corrida para que alguien lo note.
// ═══════════════════════════════════════════════════════════════════════════

export interface DepsAvisoDiscrepancia {
  revisionDeDesglose: (tenantId: string, desgloseId: string) => Promise<ReporteRevision | null>;
  destinatario: (tenantId: string) => Promise<string | null>;
  ultimaPosicion: (tenantId: string, desgloseId: string, indice: number) => Promise<PosicionConocida | null>;
  avisar: typeof avisarOficina;
}

/**
 * A37-A2-14: máximo de reportes individuales por desglose. Una unidad «de baja» con TAG en uso genera cientos de
 * candidatos críticos; mandarlos todos en serie era un mensaje por candidato al mismo teléfono (y, si el cron moría
 * a los 120 s, el resto no salía nunca). Pasado el tope sale UN resumen; el detalle sigue en la pantalla de revisión.
 */
export const TOPE_AVISOS_DISCREPANCIA = 5;

const liga = () => `${appUrl()}/dashboard/agentes/peajes`;

/** La última posición GPS conocida de la unidad de ESA línea (sin ventana de tiempo: puede llevar días sin reportar). */
async function ultimaPosicionDeLinea(tenantId: string, desgloseId: string, indice: number): Promise<PosicionConocida | null> {
  const linea = await acotada(supabaseAdmin().from('desglose_peaje_linea')
    .select('unidad_id').eq('tenant_id', tenantId).eq('desglose_id', desgloseId).eq('indice', indice).maybeSingle(), 'peajes.discrepancia_unidad_id');
  if (linea.error) { logger.warn('peajes.discrepancia_unidad_id', { tenant: tenantId, desglose: desgloseId, err: linea.error.message }); return null; }
  const unidadId = linea.data?.unidad_id;
  if (typeof unidadId !== 'string' || !unidadId) return null;

  const pos = await acotada(supabaseAdmin().from('posicion')
    .select('lat, lng, medida_en').eq('tenant_id', tenantId).eq('unidad_id', unidadId)
    .order('medida_en', { ascending: false }).order('id').limit(1).maybeSingle(), 'peajes.discrepancia_posicion');
  if (pos.error) { logger.warn('peajes.discrepancia_posicion', { tenant: tenantId, desglose: desgloseId, err: pos.error.message }); return null; }
  if (!pos.data) return null;
  const t = Date.parse(String(pos.data.medida_en));
  if (!Number.isFinite(t)) return null;
  return { lat: Number(pos.data.lat), lng: Number(pos.data.lng), t };
}

const depsPorOmision: DepsAvisoDiscrepancia = {
  revisionDeDesglose,
  destinatario: almacenAvisoAtipicos.destinatario,
  ultimaPosicion: ultimaPosicionDeLinea,
  avisar: avisarOficina,
};

export interface ResumenAvisoDiscrepancia {
  /** Candidatos críticos de `unidad_inmovilizada` encontrados en el desglose. */
  evaluados: number;
  enviados: number;
  /** No hay teléfono configurado (T-A2-14): configuración pendiente, NO un fallo del sistema. El reporte sigue visible en pantalla. */
  sinDestinatario: number;
  /** Se armó el reporte, había destinatario, pero Meta lo rechazó. Esto SÍ es un fallo a notar. */
  pendientes: number;
}

/**
 * Evalúa el desglose recién conciliado y, por cada candidato crítico de `unidad_inmovilizada`,
 * manda el reporte del protocolo de discrepancia geográfica. Nunca lanza.
 */
export async function avisarDiscrepanciasDesglose(
  tenantId: string, desgloseId: string, deps: DepsAvisoDiscrepancia = depsPorOmision,
): Promise<ResumenAvisoDiscrepancia> {
  const r: ResumenAvisoDiscrepancia = { evaluados: 0, enviados: 0, sinDestinatario: 0, pendientes: 0 };
  try {
    const reporte = await deps.revisionDeDesglose(tenantId, desgloseId);
    if (!reporte) return r;
    const criticos = reporte.revision.candidatos.filter((c) => c.categoria === 'unidad_inmovilizada');
    if (criticos.length === 0) return r;
    r.evaluados = criticos.length;

    const tel = await deps.destinatario(tenantId);
    let cortado = false; // Meta rechazó un envío: no se insiste con el resto del desglose.
    for (const [i, c] of criticos.entries()) {
      if (i >= TOPE_AVISOS_DISCREPANCIA) break;
      if (cortado) { r.pendientes++; continue; }
      const entrada = discrepanciaDeCandidato(c);
      if (!entrada) continue; // no debería pasar (ya se filtró por categoría), pero el tipo lo permite.
      let posicion: PosicionConocida | null = null;
      try { posicion = await deps.ultimaPosicion(tenantId, desgloseId, c.indice); } catch (e) {
        logger.warn('peajes.discrepancia_posicion_error', { tenant: tenantId, desglose: desgloseId, err: e instanceof Error ? e.message : String(e) });
      }
      const armado = armarReporteDiscrepancia(entrada, posicion, tel);
      if (!armado.enviar) {
        logger.warn('peajes.discrepancia_sin_destinatario', { tenant: tenantId, desglose: desgloseId, indice: c.indice });
        r.sinDestinatario++;
        continue;
      }
      const resultado = await deps.avisar(armado.destinatario!, armado.texto, {
        parametros: parametrosAvisoOficina(
          'Peajes: discrepancia geográfica',
          `Unidad ${c.unidad ?? 'sin identificar'}: TAG en caseta con la unidad inmovilizada`,
          liga(),
        ),
        contexto: { tenantId, agente: 'peajes', desglose: desgloseId },
      });
      // A37-S51-04: en cola del outbox = enviado (saldrá solo; contarlo como pendiente invita a mandarlo otra vez).
      if (resultado.ok || quedoEnCola(resultado)) r.enviados++;
      else {
        logger.error('peajes.discrepancia_aviso_fallo', {
          tenant: tenantId, desglose: desgloseId, indice: c.indice, motivo: resultado.motivo, codigo: resultado.codigo,
        });
        r.pendientes++;
        cortado = true;
      }
    }
    // Lo que pasó del tope: un solo mensaje resumen (o pendiente si ya se cortó / no hay destinatario).
    const excedentes = criticos.length - TOPE_AVISOS_DISCREPANCIA;
    if (excedentes > 0) {
      if (!tel) r.sinDestinatario += excedentes;
      else if (cortado) r.pendientes += excedentes;
      else {
        const texto = `Peajes: además de los ${TOPE_AVISOS_DISCREPANCIA} reportes anteriores, este desglose trae ${excedentes} candidato(s) más de unidad inmovilizada con TAG en uso. Revísalos todos en ${liga()}.`;
        const resultado = await deps.avisar(tel, texto, {
          parametros: parametrosAvisoOficina('Peajes: discrepancia geográfica', `${excedentes} candidato(s) más de unidad inmovilizada`, liga()),
          contexto: { tenantId, agente: 'peajes', desglose: desgloseId },
        });
        if (resultado.ok) r.enviados++;
        else {
          logger.error('peajes.discrepancia_aviso_fallo', { tenant: tenantId, desglose: desgloseId, resumen: true, motivo: resultado.motivo, codigo: resultado.codigo });
          r.pendientes += excedentes;
        }
      }
    }
    return r;
  } catch (e) {
    logger.error('peajes.discrepancia_aviso_error', { tenant: tenantId, desglose: desgloseId, err: e instanceof Error ? e.message : String(e) });
    return r;
  }
}
