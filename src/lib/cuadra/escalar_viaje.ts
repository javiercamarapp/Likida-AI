import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { avisarAlChofer } from './operacion';
import { telefonosJefe } from './contactos';
import { sendTemplate, motivoDeFalloWhatsApp } from '@/lib/meta/client';

// ═══════════════════════════════════════════════════════════════════════════
// EL VIAJE QUE NADIE ACEPTÓ.
//
// El jefe asigna, el agente le escribe al chofer, y el chofer no contesta.
// Hasta hoy nadie se enteraba: el jefe daba por hecho que arrancó y se
// descubría cuando no llegaban fotos — con el viaje ya empezado tarde o ya
// perdido.
//
// A las 5 horas: se le insiste al chofer UNA vez y se le avisa al jefe, que es
// quien puede cambiar de personal. Ese es el punto: el aviso al jefe no es
// información, es una decisión que solo él puede tomar y que necesita tiempo
// para ejecutarse.
//
// ── POR QUÉ SE ESCALA UNA SOLA VEZ ───────────────────────────────────────
//
// `escalado_en` marca el viaje al avisar. Sin eso, cada corrida del cron le
// mandaría el mismo mensaje al jefe cada hora sobre el mismo viaje, y en dos
// días habría aprendido a ignorar el canal — que es el modo de falla que este
// repo evita en todos sus avisos.
//
// ── POR QUÉ NO SE REASIGNA SOLO ──────────────────────────────────────────
//
// Sería fácil buscar otro chofer libre y moverle el viaje. No se hace: quién
// maneja qué unidad depende de licencias, descansos, confianza y acuerdos que
// no están en esta base. Se le da al jefe el dato y la decisión.
// ═══════════════════════════════════════════════════════════════════════════

/** Cuánto se espera antes de insistir. Decisión de Javier, 4-ago-2026. */
export const HORAS_PARA_ESCALAR = 5;

/** Plantilla de Meta para avisarle al jefe. Tiene que estar aprobada. */
const PLANTILLA_JEFE = 'recordatorio_cierre';

export interface ViajeSinAceptar {
  id: string;
  tenantId: string;
  folio: string | null;
  operadorId: string | null;
  operadorNombre: string | null;
  avisadoEn: string;
  avisosEnviados: number;
}

/**
 * Los viajes avisados que el chofer no ha aceptado y que ya pasaron el plazo.
 *
 * `ahora` se inyecta para que la prueba no dependa del reloj de la máquina.
 */
export async function viajesSinAceptar(ahora: Date = new Date()): Promise<ViajeSinAceptar[]> {
  const limite = new Date(ahora.getTime() - HORAS_PARA_ESCALAR * 3_600_000).toISOString();

  const { data, error } = await supabaseAdmin()
    .from('viaje')
    .select('id, tenant_id, folio, operador_id, avisado_en, avisos_enviados, operador(nombre)')
    .eq('estatus', 'abierto')
    .is('aceptado_en', null)
    .is('escalado_en', null)
    .not('avisado_en', 'is', null)
    .lte('avisado_en', limite)
    .limit(100);

  if (error) throw new Error(`viajesSinAceptar: ${error.message}`);

  return (data ?? []).map((v) => {
    const rel = v.operador as { nombre?: string } | Array<{ nombre?: string }> | null;
    const nombre = Array.isArray(rel) ? rel[0]?.nombre : rel?.nombre;
    return {
      id: v.id as string,
      tenantId: v.tenant_id as string,
      folio: (v.folio as string) ?? null,
      operadorId: (v.operador_id as string) ?? null,
      operadorNombre: nombre ?? null,
      avisadoEn: v.avisado_en as string,
      avisosEnviados: Number(v.avisos_enviados ?? 0),
    };
  });
}

/** El texto para el jefe. Corto: lo que pasó y qué puede hacer. */
export function armarAvisoJefe(v: ViajeSinAceptar): string {
  const quien = v.operadorNombre ?? 'El chofer asignado';
  const viaje = v.folio ? `el viaje ${v.folio}` : 'el viaje que le asignaste';
  return [
    `${quien} no ha confirmado ${viaje} en ${HORAS_PARA_ESCALAR} horas.`,
    'Le insistimos una vez más.',
    'Si no va a poder, conviene reasignarlo desde Despacho.',
  ].join(' ');
}

export interface ResultadoEscalacion {
  revisados: number;
  reintentados: number;
  escalados: number;
  fallos: string[];
}

/**
 * Corre la escalación sobre todos los viajes vencidos.
 *
 * SE MARCA `escalado_en` AUNQUE EL AVISO AL JEFE FALLE. Parece contraintuitivo,
 * pero la alternativa es peor: si el número del jefe está mal, cada corrida
 * volvería a intentarlo y a fallar para siempre, y el registro no distinguiría
 * "no se ha revisado" de "se revisó y no hubo a quién avisar". El fallo queda en
 * el log y el viaje sigue visible en el panel, que es donde se ve sin depender
 * de WhatsApp.
 */
export async function escalarViajesSinAceptar(args: {
  /**
   * Teléfono del jefe por flota. Se resuelve solo si no se pasa.
   *
   * SE DERIVA DE LA MISMA LISTA DE VIAJES, y por eso no lo arma quien llama: si
   * el cron consultara los viajes y los teléfonos por separado, un viaje que
   * cruce las 5 h justo entre las dos consultas quedaría sin teléfono en el mapa
   * y se marcaría como escalado sin que nadie le avisara al jefe. Se pasa a mano
   * solo en las pruebas.
   */
  telefonoJefePorTenant?: Record<string, string>;
  ahora?: Date;
} = {}): Promise<ResultadoEscalacion> {
  const viajes = await viajesSinAceptar(args.ahora);
  const telefonos = args.telefonoJefePorTenant
    ?? await telefonosJefe(viajes.map((v) => v.tenantId));
  const r: ResultadoEscalacion = { revisados: viajes.length, reintentados: 0, escalados: 0, fallos: [] };
  const admin = supabaseAdmin();

  for (const v of viajes) {
    // 1) Insistirle al chofer. Best-effort: que falle no puede impedir que el
    //    jefe se entere, que es la mitad importante.
    if (v.operadorId) {
      try {
        await avisarAlChofer(v.tenantId, v.operadorId, v.id);
        r.reintentados++;
      } catch (e) {
        r.fallos.push(`reaviso ${v.folio ?? v.id}: ${e instanceof Error ? e.message : 'error'}`);
      }
    }

    // 2) Avisarle al jefe, que es quien puede cambiar de personal.
    const tel = telefonos[v.tenantId];
    if (tel) {
      // EN SU PROPIO try/catch. `sendTemplate` hoy atrapa sus errores de red y
      // devuelve `{ok:false}`, así que este catch no se dispara nunca — y por eso
      // mismo hay que ponerlo: la invariante de abajo ("se marca pase lo que
      // pase") depende de que aquí no salga una excepción. Con un `await`
      // desnudo, el día que esa función lance —un JSON inválido, un timeout que
      // cambie de forma— el viaje en curso quedaría sin marcar Y el resto del
      // lote ni se miraría. Una invariante que solo aguanta fallos por valor no
      // es una invariante.
      try {
        const env = await sendTemplate(tel, PLANTILLA_JEFE, {
          parametros: [v.operadorNombre ?? 'Tu chofer', v.folio ?? 'sin folio'],
        });
        if (!env.ok) r.fallos.push(`jefe ${v.folio ?? v.id}: ${motivoDeFalloWhatsApp(env.error, env.codigo)}`);
      } catch (e) {
        r.fallos.push(`jefe ${v.folio ?? v.id}: ${e instanceof Error ? e.message : 'error inesperado al enviar'}`);
      }
    } else {
      // ERROR, no un fallo más: esta flota NUNCA va a recibir la escalación
      // hasta que alguien capture el teléfono, y el viaje se marca igual.
      logger.error('escalacion.sin_telefono_de_jefe', { tenantId: v.tenantId, viaje: v.id });
      r.fallos.push(`${v.folio ?? v.id}: esa flota no tiene teléfono de jefe registrado`);
    }

    // 3) Marcar. Ver la nota de arriba: se marca pase lo que pase con el envío.
    //
    // Acotado por tenant aunque `id` sea la PK: es la disciplina del repo
    // (`acotada`), y un update sin acotar que hoy es inofensivo se copia mañana
    // a uno que sí puede cruzar flotas.
    const { error } = await admin
      .from('viaje')
      .update({ escalado_en: new Date().toISOString(), avisos_enviados: v.avisosEnviados + 1 })
      .eq('id', v.id)
      .eq('tenant_id', v.tenantId);
    if (error) r.fallos.push(`marcar ${v.id}: ${error.message}`);
    else r.escalados++;
  }

  logger.info('viaje.escalacion', { revisados: r.revisados, escalados: r.escalados, fallos: r.fallos.length });
  return r;
}
