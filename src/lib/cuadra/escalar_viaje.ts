import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { avisarAlChofer } from './operacion';
import { telefonosJefe } from './contactos';
import { sendText, sendTemplate, motivoDeFalloWhatsApp } from '@/lib/meta/client';

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
// ── POR QUÉ EL SELLO ES UN CLAIM, Y NO SOLO UN CIERRE ────────────────────
//
// Vercel Cron entrega *at-least-once* (`vercel.json`, cada hora): dos corridas
// pueden solaparse. `viajesSinAceptar` lee `escalado_en IS NULL`, y si el
// UPDATE que pone el sello se hiciera hasta el final —después de mandar los
// mensajes, como este archivo hacía antes—, las dos corridas leerían la misma
// fila en `NULL`, las dos mandarían el recordatorio al chofer y el aviso al
// jefe, y las dos escribirían el sello sin pisarse porque ninguna depende de
// lo que escribió la otra. Es la MISMA carrera que `al_vuelo.ts` cierra
// contra el doble CFDI (`al_vuelo.ts:590-656`) — aquí el precio de perderla no
// es un documento fiscal duplicado, es un WhatsApp de más, pero el mecanismo
// es el mismo: `reclamarEscalacion` mueve la decisión a Postgres con un
// UPDATE condicional que devuelve solo la fila que de verdad ganó, ANTES de
// tocar ningún canal.
//
// ── POR QUÉ NO SE REASIGNA SOLO ──────────────────────────────────────────
//
// Sería fácil buscar otro chofer libre y moverle el viaje. No se hace: quién
// maneja qué unidad depende de licencias, descansos, confianza y acuerdos que
// no están en esta base. Se le da al jefe el dato y la decisión.
// ═══════════════════════════════════════════════════════════════════════════

/** Cuánto se espera antes de insistir. Decisión de Javier, 4-ago-2026. */
export const HORAS_PARA_ESCALAR = 5;

/**
 * Plantilla de Meta para avisarle al jefe. Tiene que estar aprobada.
 *
 * ES EL PLAN B, NO EL MENSAJE. Su cuerpo aprobado se escribió para OTRO evento
 * (el recordatorio de cierre de una liquidación) y aquí se manda con dos
 * parámetros —nombre y folio— dentro de una frase que habla de otra cosa. El
 * texto que de verdad describe lo que pasó es `armarAvisoJefe`, y sale por
 * `sendText`; esta plantilla queda para cuando ese texto no puede salir, que es
 * lo único que WhatsApp permite fuera de la ventana de 24 h.
 */
const PLANTILLA_JEFE = 'recordatorio_cierre';

export interface ViajeSinAceptar {
  id: string;
  tenantId: string;
  folio: string | null;
  operadorId: string | null;
  operadorNombre: string | null;
  /** Para poder mandarle el recordatorio en texto. `null` = no lo tiene capturado. */
  operadorTelefono: string | null;
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
    .select('id, tenant_id, folio, operador_id, avisado_en, avisos_enviados, operador(nombre, telefono)')
    .eq('estatus', 'abierto')
    .is('aceptado_en', null)
    .is('escalado_en', null)
    .not('avisado_en', 'is', null)
    .lte('avisado_en', limite)
    .limit(100);

  if (error) throw new Error(`viajesSinAceptar: ${error.message}`);

  type Rel = { nombre?: string; telefono?: string };
  return (data ?? []).map((v) => {
    const rel = v.operador as Rel | Rel[] | null;
    const op = Array.isArray(rel) ? rel[0] : rel;
    return {
      id: v.id as string,
      tenantId: v.tenant_id as string,
      folio: (v.folio as string) ?? null,
      operadorId: (v.operador_id as string) ?? null,
      operadorNombre: op?.nombre ?? null,
      operadorTelefono: op?.telefono ?? null,
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

/**
 * El recordatorio para el CHOFER, y por qué no es la asignación otra vez.
 *
 * Lo que se le reenviaba era la plantilla de asignación IDÉNTICA a la que ya
 * recibió: mismo texto, misma ruta, mismo anticipo, sin una palabra que dijera
 * que es la segunda vez. Quien la lee no puede distinguirla de un duplicado del
 * sistema, así que no produce la única acción que se le está pidiendo —
 * contestar—, y encima al jefe se le está diciendo al mismo tiempo que "le
 * insistimos una vez más".
 *
 * Dice CUÁNTO lleva y qué contestar. No regaña: puede estar manejando, sin
 * señal, o el viaje puede no ser suyo — y para eso el "no" es una respuesta
 * igual de útil que el "sí".
 */
export function armarRecordatorioChofer(v: ViajeSinAceptar): string {
  const viaje = v.folio ? `tu viaje *${v.folio}*` : 'el viaje que te asignaron';
  return [
    `Te recuerdo ${viaje}: lo tienes asignado desde hace ${HORAS_PARA_ESCALAR} horas y todavía no me confirmas si lo arrancas. 🚛`,
    '',
    'Contéstame *sí* si ya vas, o *no* si no te toca — con cualquiera de las dos le aviso a tu encargado.',
    'Mientras no me confirmes no puedo anotar tus gastos: se irían al viaje equivocado.',
  ].join('\n');
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
 *
 * EL SELLO SE PONE ANTES DE MANDAR NADA, NO DESPUÉS. Cada viaje se reclama con
 * `reclamarEscalacion` al entrar al loop; solo si esta corrida ganó el claim
 * se intenta el recordatorio al chofer y el aviso al jefe. Si otra corrida
 * solapada ya lo ganó, esta no reintenta ningún mensaje ni lo cuenta como
 * escalado — es el resultado esperado de la carrera, no un error. Ver el
 * comentario largo del encabezado del archivo y `reclamarEscalacion` más abajo.
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
  const ahoraIso = args.ahora?.toISOString();

  for (const v of viajes) {
    // 0) RECLAMAR, ANTES DE MANDAR CUALQUIER MENSAJE. Si el UPDATE condicional
    //    no devuelve esta fila, otra corrida la ganó entre la lectura de arriba
    //    y este punto — no se reintenta ningún mensaje y no cuenta como
    //    escalado ni como fallo: es el resultado esperado de dos corridas
    //    solapadas, no un error. Ver `reclamarEscalacion`.
    const claim = await reclamarEscalacion(admin, v, ahoraIso);
    if (claim.error) {
      r.fallos.push(`marcar ${v.id}: ${claim.error}`);
      continue;
    }
    if (!claim.ganado) {
      logger.info('escalacion.ya_en_proceso', { viaje: v.id });
      continue;
    }
    r.escalados++;

    // 1) Insistirle al chofer. Best-effort: que falle no puede impedir que el
    //    jefe se entere, que es la mitad importante.
    //
    //    EL RECORDATORIO PRIMERO, LA PLANTILLA DESPUÉS. El texto de
    //    `armarRecordatorioChofer` dice que es la segunda vez y qué contestar;
    //    la plantilla de asignación no dice ninguna de las dos cosas, pero es lo
    //    ÚNICO que WhatsApp entrega cuando ya pasaron 24 h desde el último
    //    mensaje del chofer — y ese es justo el caso probable de alguien que
    //    lleva cinco horas sin contestar. Así que se intenta el texto bueno y se
    //    cae a la plantilla solo cuando Meta lo rechaza (`sendText` devuelve
    //    `null`).
    if (v.operadorId) {
      try {
        let recordado = false;
        if (v.operadorTelefono) {
          recordado = Boolean(await sendText(v.operadorTelefono, armarRecordatorioChofer(v)));
        }
        // Sin teléfono en la fila o con el texto rechazado: la plantilla. Ella
        // resuelve el teléfono por su cuenta y marca lo que tenga que marcar.
        if (!recordado) await avisarAlChofer(v.tenantId, v.operadorId, v.id);
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
      // mismo hay que ponerlo. El viaje YA quedó marcado por `reclamarEscalacion`
      // antes de llegar aquí, así que una excepción sin atrapar no lo dejaría sin
      // marcar; lo que sí haría es tumbar el `for` completo y dejar SIN INTENTAR
      // el claim de todos los viajes que faltan en el lote. Con un `await`
      // desnudo, el día que esa función lance —un JSON inválido, un timeout que
      // cambie de forma— eso es lo que pasaría. Una invariante que solo aguanta
      // fallos por valor no es una invariante.
      try {
        // EL TEXTO QUE SÍ SE ESCRIBIÓ PARA ESTO. `armarAvisoJefe` existía con
        // sus pruebas y no lo llamaba nadie: salía la plantilla
        // `recordatorio_cierre`, cuyo cuerpo aprobado habla de OTRO evento, con
        // el nombre y el folio metidos como parámetros. El jefe leía un
        // recordatorio de cierre sobre un viaje que ni siquiera arrancó.
        //
        // La plantilla se conserva como plan B porque fuera de la ventana de
        // 24 h es lo único que WhatsApp entrega — y el jefe puede llevar días
        // sin escribirle al número.
        const enviado = await sendText(tel, armarAvisoJefe(v));
        if (!enviado) {
          const env = await sendTemplate(tel, PLANTILLA_JEFE, {
            parametros: [v.operadorNombre ?? 'Tu chofer', v.folio ?? 'sin folio'],
          });
          if (!env.ok) r.fallos.push(`jefe ${v.folio ?? v.id}: ${motivoDeFalloWhatsApp(env.error, env.codigo)}`);
        }
      } catch (e) {
        r.fallos.push(`jefe ${v.folio ?? v.id}: ${e instanceof Error ? e.message : 'error inesperado al enviar'}`);
      }
    } else {
      // ERROR, no un fallo más: esta flota NUNCA va a recibir la escalación
      // hasta que alguien capture el teléfono, y el viaje se marca igual.
      logger.error('escalacion.sin_telefono_de_jefe', { tenantId: v.tenantId, viaje: v.id });
      r.fallos.push(`${v.folio ?? v.id}: esa flota no tiene teléfono de jefe registrado`);
    }
  }

  logger.info('viaje.escalacion', { revisados: r.revisados, escalados: r.escalados, fallos: r.fallos.length });
  return r;
}

/**
 * Toma el viaje para ESTA corrida, ANTES de mandar cualquier mensaje. Devuelve
 * `ganado: true` solo si esta llamada fue la que puso el sello.
 *
 * MISMO MECANISMO QUE `reclamarIntentos` DE `al_vuelo.ts`
 * (`al_vuelo.ts:613-645`): el UPDATE es condicional y devuelve filas — la
 * condición incluye `escalado_en IS NULL`, que es justo la columna que el
 * propio UPDATE pisa, así que el primero en llegar deja a los demás sin fila
 * que actualizar. Cero filas no es un error: es que otra corrida ya ganó.
 *
 * SIN VENTANA DE REINTENTO, A DIFERENCIA DE `al_vuelo.ts`. Allá el claim puede
 * perderse de verdad —el portal truena a media sesión— y hace falta poder
 * reintentar diez minutos después (`CLAIM_MINUTOS`). Aquí no: el archivo se
 * marca a propósito aunque el aviso falle (ver el encabezado de
 * `escalarViajesSinAceptar`), así que el claim y el cierre son la MISMA
 * escritura — quien gana la fila queda escalado para siempre, sin nada que
 * expire ni que limpiar.
 *
 * Se falla CERRADO: si el UPDATE mismo revienta (no que pierda la carrera,
 * sino que la base no conteste), no se manda ningún mensaje. Mandarlo sin
 * saber si el sello quedó puesto es exactamente el riesgo que esto existe
 * para cerrar.
 */
async function reclamarEscalacion(
  admin: ReturnType<typeof supabaseAdmin>,
  v: ViajeSinAceptar,
  ahora?: string,
): Promise<{ ganado: boolean; error?: string }> {
  const { data, error } = await admin
    .from('viaje')
    .update({ escalado_en: ahora ?? new Date().toISOString(), avisos_enviados: v.avisosEnviados + 1 })
    .eq('id', v.id)
    // Acotado por tenant además de por id, aunque `id` sea la PK: es la
    // disciplina del repo (`acotada`) — un update sin acotar que hoy es
    // inofensivo se copia mañana a uno que sí puede cruzar flotas.
    .eq('tenant_id', v.tenantId)
    .is('escalado_en', null)
    .select('id');

  if (error) {
    logger.warn('escalacion.claim_sin_guardar', { viaje: v.id, err: error.message });
    return { ganado: false, error: error.message };
  }
  return { ganado: (data ?? []).length > 0 };
}
