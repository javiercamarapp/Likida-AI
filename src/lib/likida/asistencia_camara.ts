// ═══════════════════════════════════════════════════════════════════════════
// EL DISPARO POR CÁMARA — la cámara del cliente reporta lo que el chofer
// todavía no puede.
//
// Un evento GRAVE (crash/impacto/volcadura, ver `esEventoGrave`) de las
// cámaras Samsara de la flota abre el MISMO expediente de asistencia que un
// "chocamos" por WhatsApp: incidencia tipo `siniestro` prioridad `critica`,
// bitácora en `incidencia_evento`, 🚨 al jefe con el botón `asi_ok:` — y de
// ahí el escalamiento de la Fase 5 corre igual que siempre.
//
// ── LA VERDAD DEL AVISO ───────────────────────────────────────────────────
// El jefe tiene que saber DOS cosas distintas: que la fuente es la cámara
// (no el chofer), y que el chofer NO ha reportado nada — porque la reacción
// correcta es distinta: aquí el jefe MARCA él, no espera el mensaje. Un
// aviso que no distinga la fuente convertiría una detección automática en
// un "el chofer dijo" que nadie dijo.
//
// ── POR QUÉ NO SE DUPLICA CON EL REPORTE DEL CHOFER ───────────────────────
// El expediente es ÚNICO por chofer (0201): si el chofer YA reportó, el
// evento de cámara se anota en su expediente (evidencia, no un segundo 🚨);
// si la cámara llega primero y el chofer escribe después, su mensaje cae en
// `atenderConExpedienteAbierto` de asistencia_wa y se reenvía al jefe como
// siempre. Sin operador identificable (unidad sin viaje abierto), el
// expediente se ata a la UNIDAD y la dedupe es por incidencia abierta de esa
// unidad — dos labels graves del mismo choque no abren dos filas.
// ═══════════════════════════════════════════════════════════════════════════
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { acotada } from './presupuesto';
import { crearIncidencia } from './operacion';
import { anotarEventoIncidencia, TIPOS_ASISTENCIA } from './asistencia_wa';
import { telefonoJefeDe } from './contactos';
import { sendButtons } from '@/lib/meta/client';

export interface EventoCamaraGrave {
  tenantId: string;
  /** La unidad YA mapeada vía gps_device_id. Sin unidad no hay disparo (el
   *  sync la reporta como huérfana). */
  unidadId: string;
  proveedor: string;
  eventoIdExterno: string;
  etiquetas: string[];
  lat: number | null;
  lng: number | null;
  ocurridoEn: string;
  urlEvento: string | null;
  maxG: number | null;
}

export interface ResultadoDisparo {
  resultado: 'abierta' | 'anotada_en_existente' | 'fallo';
  incidenciaId?: string;
  avisado?: boolean;
}

/** El viaje ABIERTO de la unidad, si lo hay — es la ruta al operador. */
async function viajeAbiertoDeUnidad(
  tenantId: string, unidadId: string,
): Promise<{ viajeId: string; operadorId: string | null; folio: string | null } | null> {
  const { data, error } = await acotada(supabaseAdmin()
    .from('viaje')
    .select('id, operador_id, folio')
    .eq('tenant_id', tenantId)
    .eq('unidad_id', unidadId)
    .eq('estatus', 'abierto')
    .order('created_at', { ascending: false })
    .limit(1), 'asistencia_camara.viaje');
  if (error) throw new Error(`asistencia_camara.viaje: ${error.message}`);
  const f = (data ?? [])[0];
  if (!f) return null;
  return {
    viajeId: f.id as string,
    operadorId: (f.operador_id as string | null) ?? null,
    folio: (f.folio as string | null) ?? null,
  };
}

/**
 * El expediente de asistencia abierto que este evento debe alimentar en vez
 * de duplicar: por OPERADOR si se conoce (la semántica de la 0201), y si no,
 * por UNIDAD — el caso de la unidad sin viaje, donde dos labels graves del
 * mismo choque llegan en la misma corrida.
 */
async function expedienteAbierto(
  tenantId: string, operadorId: string | null, unidadId: string,
): Promise<string | null> {
  const consulta = supabaseAdmin()
    .from('incidencia')
    .select('id')
    .eq('tenant_id', tenantId)
    .in('tipo', [...TIPOS_ASISTENCIA])
    .neq('estado', 'resuelta')
    .order('abierta_en', { ascending: false })
    .limit(1);
  const { data, error } = await acotada(
    operadorId ? consulta.eq('operador_id', operadorId) : consulta.eq('unidad_id', unidadId),
    'asistencia_camara.abierta',
  );
  if (error) throw new Error(`asistencia_camara.abierta: ${error.message}`);
  const f = (data ?? [])[0];
  return f ? (f.id as string) : null;
}

/** Rótulo de la unidad para el aviso. Best-effort: es un rótulo. */
async function rotuloUnidad(tenantId: string, unidadId: string): Promise<string> {
  try {
    const { data } = await supabaseAdmin()
      .from('unidad').select('numero_economico, placas')
      .eq('id', unidadId).eq('tenant_id', tenantId).maybeSingle();
    if (data?.numero_economico) {
      return `la unidad ${data.numero_economico}${data.placas ? ` (placas ${data.placas})` : ''}`;
    }
  } catch { /* rótulo, no verdad crítica */ }
  return 'una de tus unidades';
}

function descripcionDelEvento(e: EventoCamaraGrave): string {
  const partes = [
    `Detección automática de la cámara ${e.proveedor} (evento ${e.eventoIdExterno}): ${e.etiquetas.join(', ') || 'evento grave'}.`,
  ];
  if (e.maxG !== null) partes.push(`Fuerza máxima registrada: ${e.maxG.toFixed(1)} G.`);
  if (e.urlEvento) partes.push(`Video en el panel del proveedor: ${e.urlEvento}`);
  partes.push('El chofer NO ha reportado por WhatsApp al momento de esta detección.');
  return partes.join(' ');
}

/**
 * Abre (o alimenta) el expediente de asistencia por un evento grave de
 * cámara. NUNCA lanza: la corrida de sincronización no puede morir por un
 * disparo — el fallo se reporta en el resultado y en el log.
 */
export async function dispararAsistenciaPorEventoCamara(e: EventoCamaraGrave): Promise<ResultadoDisparo> {
  try {
    const viaje = await viajeAbiertoDeUnidad(e.tenantId, e.unidadId);
    const operadorId = viaje?.operadorId ?? null;

    const abierta = await expedienteAbierto(e.tenantId, operadorId, e.unidadId);
    if (abierta) {
      // El chofer ya reportó (o un evento anterior ya abrió): la detección se
      // suma como EVIDENCIA a su expediente — un segundo 🚨 por el mismo
      // choque entrena al jefe a ignorar el primero.
      await anotarEventoIncidencia(e.tenantId, abierta, 'deteccion_camara', {
        proveedor: e.proveedor, evento: e.eventoIdExterno, etiquetas: e.etiquetas,
        lat: e.lat, lng: e.lng, maxG: e.maxG, urlEvento: e.urlEvento,
      });
      logger.info('asistencia_camara.anotada', { incidencia: abierta, evento: e.eventoIdExterno });
      return { resultado: 'anotada_en_existente', incidenciaId: abierta };
    }

    let incidenciaId: string;
    try {
      incidenciaId = await crearIncidencia(e.tenantId, {
        viajeId: viaje?.viajeId ?? null,
        unidadId: e.unidadId,
        operadorId,
        tipo: 'siniestro',
        prioridad: 'critica',
        descripcion: descripcionDelEvento(e).slice(0, 500),
        // La cámara NO sabe de lesionados: NULL = no preguntado, jamás false.
        hayLesionados: null,
        lat: e.lat,
        lng: e.lng,
      });
    } catch (err) {
      const msj = err instanceof Error ? err.message : String(err);
      // La carrera contra el reporte del chofer (o contra otro evento grave
      // de la misma corrida): el índice 0201 deja UN ganador. El perdedor
      // anota su detección en el expediente del ganador.
      if (/incidencia_asistencia_abierta_unica|duplicate key/i.test(msj)) {
        const ganadora = await expedienteAbierto(e.tenantId, operadorId, e.unidadId);
        if (ganadora) {
          await anotarEventoIncidencia(e.tenantId, ganadora, 'deteccion_camara', {
            proveedor: e.proveedor, evento: e.eventoIdExterno, etiquetas: e.etiquetas,
            lat: e.lat, lng: e.lng, maxG: e.maxG, urlEvento: e.urlEvento,
          });
          return { resultado: 'anotada_en_existente', incidenciaId: ganadora };
        }
      }
      throw err;
    }

    await anotarEventoIncidencia(e.tenantId, incidenciaId, 'abierta_por_camara', {
      proveedor: e.proveedor, evento: e.eventoIdExterno, etiquetas: e.etiquetas,
      lat: e.lat, lng: e.lng, maxG: e.maxG, urlEvento: e.urlEvento, ocurridoEn: e.ocurridoEn,
    });

    const avisado = await avisarAlJefePorCamara(e, incidenciaId, viaje?.folio ?? null);
    await anotarEventoIncidencia(e.tenantId, incidenciaId, avisado ? 'aviso_jefe_enviado' : 'aviso_jefe_fallido', { fuente: 'camara' });
    logger.info('asistencia_camara.abierta', { incidencia: incidenciaId, evento: e.eventoIdExterno, avisado });
    return { resultado: 'abierta', incidenciaId, avisado };
  } catch (err) {
    logger.error('asistencia_camara.fallo', {
      tenant: e.tenantId, unidad: e.unidadId, evento: e.eventoIdExterno,
      err: err instanceof Error ? err.message : String(err),
    });
    return { resultado: 'fallo' };
  }
}

/** El 🚨 al jefe, con la fuente dicha con todas sus letras. */
async function avisarAlJefePorCamara(
  e: EventoCamaraGrave, incidenciaId: string, folio: string | null,
): Promise<boolean> {
  let telefono: string | null = null;
  try {
    telefono = await telefonoJefeDe(e.tenantId);
  } catch (err) {
    logger.error('asistencia_camara.jefe_ilegible', { tenant: e.tenantId, err: err instanceof Error ? err.message : String(err) });
    return false;
  }
  if (!telefono) {
    logger.warn('asistencia_camara.sin_jefe', { tenant: e.tenantId, incidencia: incidenciaId });
    return false;
  }
  const unidad = await rotuloUnidad(e.tenantId, e.unidadId);
  const cuerpo =
    `🚨 La cámara de ${unidad} detectó una POSIBLE COLISIÓN` +
    `${folio ? ` en el viaje ${folio}` : ''} (${e.etiquetas.join(', ') || 'evento grave'}).\n\n` +
    `Tu chofer NO ha reportado nada por aquí todavía — puede que no pueda. ` +
    `MÁRCALE AHORA${e.urlEvento ? `, y el video está en tu panel del proveedor: ${e.urlEvento}` : ''}.` +
    `\n\nAprieta el botón para que sepamos que ya lo estás atendiendo.`;
  const enviado = await sendButtons(telefono, cuerpo, [
    { id: `asi_ok:${incidenciaId}`, titulo: 'Ya lo atiendo' },
  ]);
  return Boolean(enviado);
}
