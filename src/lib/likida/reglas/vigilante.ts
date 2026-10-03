// ═══════════════════════════════════════════════════════════════════════════
// EL VIGILANTE — el barrido horario que corre las reglas de la flota.
//
// Cuarto chequeo del cron de `escalar`, junto a los relojes legales. La
// decisión de dónde vive está escrita en la 0229 y se repite aquí porque es
// la que más se va a cuestionar: esto NO es un agente del catálogo de la
// compañía (no lleva fila en `agente_definicion` ni palanca propia), es una
// FEATURE DEL PRODUCTO. No llama a ningún modelo, no fabrica piezas para una
// bandeja de aprobación y no tiene techo en dólares que vigilar: lo que hace
// es correr consultas y mandar el aviso que la flota pidió por escrito. El
// interruptor `global` lo apaga con todo lo demás, igual que a los relojes.
//
// EL ORDEN IMPORTA: se RECLAMA, se manda y se CONFIRMA (0660). Reclamar es
// insertar la llave con estado «enviando» y un arriendo, ANTES de tocar Meta:
// de dos corridas solapadas del cron (Vercel entrega at-least-once) que ven los
// mismos casos, cada llave la gana una sola y la otra no manda nada. Si Meta
// rechaza, la llave se LIBERA y el caso se reintenta a la hora siguiente (un
// sello puesto sin que el aviso saliera lo perdería para siempre); si la
// corrida muere a media, el arriendo vence y otra la retoma. Sin la 0660 en la
// base cae al orden de la 0202: se manda primero y se sella después.
//
// CADA REGLA FALLA POR SU LADO. Una regla con una consulta que truena no
// puede dejar sin vigilancia a las otras veintinueve de la misma flota, ni a
// las de las demás flotas.
// ═══════════════════════════════════════════════════════════════════════════
import { enviarConFallback } from '@/lib/meta/enviar_con_fallback';
import { PLANTILLA, parametrosReglaAviso } from '@/lib/meta/plantillas_catalogo';
import { appUrl } from '@/lib/env';
import { telefonoJefeDe, telefonoParaDineroDe } from '../contactos';
import { logger } from '@/lib/logger';
import { CATALOGO } from './catalogo';
import { evaluar, type Disparo } from './lectores';
import {
  reglasActivas, sellosDe, sellarDisparos, anotarCorrida, llaveSello,
  avisosEnviadosDesde, registrarAviso, purgarAvisosViejos,
  reclamarDisparos, confirmarDisparos, liberarDisparos, hayEnvioAjenoEnVuelo,
  type ReglaGuardada,
} from './repo';
import { evaluarFrecuencia } from './frecuencia';

export interface ResultadoVigilancia {
  reglas: number;
  /** Reglas que encontraron algo NUEVO y lo avisaron. */
  disparadas: number;
  /** Avisos individuales que salieron (filas citadas). */
  avisos: number;
  fallos: number;
  /** Reglas con casos nuevos cuyo aviso se POSPUSO por su límite de frecuencia
   *  (no se sellaron: salen en el siguiente aviso permitido). */
  diferidas: number;
}

/** Cuántas filas caben en un aviso antes de resumir. Diez líneas se leen en
 *  WhatsApp; cuarenta se ignoran y entrenan a ignorar las siguientes. */
export const MAX_LINEAS_AVISO = 10;

/**
 * El texto del aviso. Puro, probado solo — como los mensajes de los relojes
 * legales. Cita la frase QUE LA PERSONA CONFIRMÓ (no el texto libre que
 * escribió: la regla viva es la interpretación) y después la evidencia,
 * renglón por renglón.
 */
export function mensajeDeRegla(frase: string, evidencias: string[]): string {
  const cabeza = `🔔 Tu regla: ${frase}`;
  const visibles = evidencias.slice(0, MAX_LINEAS_AVISO).map((e) => `· ${e}`);
  const resto = evidencias.length - visibles.length;
  const cola = resto > 0
    ? `\n…y ${resto} caso${resto === 1 ? '' : 's'} más. Están todos en «Mis reglas» del panel.`
    : '';
  return `${cabeza}\n${visibles.join('\n')}${cola}\nPara dejar de recibir esto, pausa la regla en «Mis reglas».`;
}

/** Confirma con hasta 3 intentos; `null` = no se pudo (el aviso ya salió: nunca se relanza). */
async function confirmarConReintento(tenantId: string, reglaId: string, token: string, ahora: Date): Promise<number | null> {
  for (let i = 0; i < 3; i++) {
    try { return await confirmarDisparos(tenantId, reglaId, token, ahora); } catch (e) {
      logger.warn('reglas.confirmar_reintento', { regla: reglaId, tenant: tenantId, intento: i + 1, err: e instanceof Error ? e.message : String(e) });
    }
  }
  return null;
}

/** El resultado de correr UNA regla: cuántos casos avisó y si se pospuso. */
interface ResultadoRegla { avisados: number; diferida: boolean }

/** Corre UNA regla. */
async function correrRegla(regla: ReglaGuardada, ahora: Date): Promise<ResultadoRegla> {
  const plantilla = CATALOGO[regla.plantilla];
  const candidatos = await evaluar(regla.plantilla, regla.params, regla.tenantId, ahora);
  if (candidatos.length === 0) {
    await anotarCorrida(regla.tenantId, regla.id, ahora, 0);
    return { avisados: 0, diferida: false };
  }

  // ¿Cuáles ya se avisaron? Una consulta por regla, no una por candidato — el
  // mismo criterio que `avisarVencimientos` tras c2-4.
  const sellados = await sellosDe(regla.tenantId, regla.id, candidatos, ahora);
  const nuevos: Disparo[] = candidatos.filter((d) => !sellados.has(llaveSello(d)));
  if (nuevos.length === 0) {
    await anotarCorrida(regla.tenantId, regla.id, ahora, 0);
    return { avisados: 0, diferida: false };
  }

  // ── EL LÍMITE DE FRECUENCIA (0520) ─────────────────────────────────────────
  // Se evalúa ANTES de tocar el teléfono o el canal: un aviso pospuesto no gasta
  // una llamada a Meta. Lo pospuesto NO se sella — el caso sigue siendo «nuevo» y
  // sale agrupado cuando el límite lo permita. Si el historial no se puede leer,
  // `avisosEnviadosDesde` lanza y la regla falla POR SU LADO (se reintenta a la
  // hora siguiente): mandar sin saber cuántos van rompería el tope.
  const previos = await avisosEnviadosDesde(regla.tenantId, regla.id, new Date(ahora.getTime() - 24 * 3_600_000));
  const veredicto = evaluarFrecuencia(previos, ahora, {
    maxAvisosDia: regla.maxAvisosDia, minHorasEntreAvisos: regla.minHorasEntreAvisos,
  });
  if (!veredicto.permitido) {
    logger.info('reglas.aviso_diferido', {
      regla: regla.id, tenant: regla.tenantId, plantilla: regla.plantilla,
      motivo: veredicto.motivo, casos: nuevos.length, proximoEn: veredicto.proximoEn.toISOString(),
    });
    await anotarCorrida(regla.tenantId, regla.id, ahora, 0);
    return { avisados: 0, diferida: true };
  }

  const telefono = plantilla.canal === 'dinero'
    ? await telefonoParaDineroDe(regla.tenantId)
    : await telefonoJefeDe(regla.tenantId);
  if (!telefono) {
    // No se sella: cuando la flota registre el teléfono, el aviso sale. Se
    // dice en el log porque es un problema de configuración que se arregla en
    // un minuto — y si solo viviera en silencio, nadie sabría por qué su regla
    // "no funciona".
    logger.warn('reglas.sin_destinatario', {
      regla: regla.id, tenant: regla.tenantId, canal: plantilla.canal, casos: nuevos.length,
    });
    throw new Error(`la flota no tiene teléfono registrado para avisos de ${plantilla.canal}`);
  }

  // ── EL RECLAMO, ANTES DE TOCAR A META (0660) ───────────────────────────────
  // Va después del teléfono y de la frecuencia: lo que se pospone o no tiene a
  // quién avisarse no reclama nada. De dos corridas solapadas, quien pierde el
  // insert de una llave no la manda; si no ganó ninguna, no hay aviso que dar.
  const reclamo = await reclamarDisparos(regla.tenantId, regla.id, nuevos, ahora);
  const aMandar = reclamo.modo === 'reclamo' ? reclamo.ganados : nuevos;
  if (aMandar.length === 0) {
    logger.info('reglas.aviso_ya_reclamado', { regla: regla.id, tenant: regla.tenantId, casos: nuevos.length });
    await anotarCorrida(regla.tenantId, regla.id, ahora, 0);
    return { avisados: 0, diferida: false };
  }
  const token = reclamo.modo === 'reclamo' ? reclamo.token : '';

  // ── EL TOPE, OTRA VEZ, YA CON EL RECLAMO PUESTO (R10-6) ────────────────────
  // El chequeo de frecuencia de arriba lee el historial de avisos YA registrados. Dos corridas solapadas con casos distintos no se ven
  // ahí (ninguna ha registrado nada) y cada una gana SUS llaves: mandarían dos avisos en la hora. Con el reclamo ya insertado, quien
  // ve otro envío vigente de esta misma regla suelta lo suyo y lo deja para la hora siguiente (no se sella: sigue siendo «nuevo»).
  if (reclamo.modo === 'reclamo') {
    let ajeno: boolean;
    try {
      ajeno = await hayEnvioAjenoEnVuelo(regla.tenantId, regla.id, token, ahora);
    } catch (e) {
      await liberarDisparos(regla.tenantId, regla.id, token);
      throw e;
    }
    if (ajeno) {
      await liberarDisparos(regla.tenantId, regla.id, token);
      logger.info('reglas.aviso_diferido_por_envio_en_vuelo', { regla: regla.id, tenant: regla.tenantId, plantilla: regla.plantilla, casos: aMandar.length });
      await anotarCorrida(regla.tenantId, regla.id, ahora, 0);
      return { avisados: 0, diferida: true };
    }
  }

  // ── FUERA DE LA VENTANA DE 24 H TAMBIÉN SALE (auditoría 6-7-9-10-12-13, §13) ─
  // `sendText` a secas fallaba con 131047 cuando el jefe llevaba más de 24 h sin
  // escribirle al número: `correrRegla` lanzaba, no sellaba y reintentaba cada
  // hora SIN LLEGAR JAMÁS. Ahora el selector manda el texto completo dentro de
  // la ventana y la plantilla `regla_aviso_v1` fuera de ella. La semántica no
  // cambia: el sello definitivo solo se pone si Meta ACEPTÓ.
  const casos = aMandar.length;
  let envio: Awaited<ReturnType<typeof enviarConFallback>>;
  try {
    envio = await enviarConFallback(telefono, {
      texto: mensajeDeRegla(regla.frase, aMandar.map((d) => d.evidencia)),
      plantilla: {
        nombre: PLANTILLA.reglaAviso,
        parametros: parametrosReglaAviso(casos, regla.frase, `${appUrl()}/dashboard/reglas`),
      },
      contexto: `reglas.vigilante.${regla.plantilla}`,
      tenantId: regla.tenantId,
      ahora,
    });
  } catch (e) {
    // Una excepción antes de saber si Meta aceptó: se suelta el reclamo para que la hora siguiente reintente.
    await liberarDisparos(regla.tenantId, regla.id, token);
    throw e;
  }
  if (!envio.ok) {
    // Sin sello: se reintenta a la siguiente corrida. Es exactamente el
    // contrato de `avisarVencimientos`. El intento fallido SÍ queda en el
    // historial (no cuenta para el tope: no llegó nada al jefe).
    await liberarDisparos(regla.tenantId, regla.id, token);
    await registrarAviso(regla.tenantId, regla.id, {
      resultado: 'fallido', casos, motivo: envio.motivo, error: envio.mensaje,
    });
    throw new Error(`el WhatsApp no salió: ${envio.mensaje}`);
  }

  if (reclamo.modo === 'reclamo') {
    // R10-5: Meta YA aceptó. Si confirmar lanza (la base parpadeó), antes la regla fallaba sin registrar el aviso: las llaves quedaban
    // `enviando`, el tope de frecuencia no veía nada y a la hora siguiente (arriendo vencido) el aviso salía OTRA vez. Ahora se
    // reintenta, y si de verdad no se pudo se DICE en el log y la corrida sigue: el aviso se registra (el tope de la hora siguiente lo ve).
    const confirmadas = await confirmarConReintento(regla.tenantId, regla.id, token, ahora);
    if (confirmadas === null) {
      logger.error('reglas.confirmacion_fallo_tras_envio', { regla: regla.id, tenant: regla.tenantId, casos });
    } else if (confirmadas < casos) {
      // El arriendo venció durante el envío y otra corrida retomó la llave: el aviso pudo salir dos veces. No es un fallo
      // de ESTA corrida (Meta aceptó), pero se deja a la vista para quien lea el log.
      logger.warn('reglas.arriendo_perdido_al_confirmar', { regla: regla.id, tenant: regla.tenantId, casos, confirmadas });
    }
  } else {
    await sellarDisparos(regla.tenantId, regla.id, aMandar);
  }
  await registrarAviso(regla.tenantId, regla.id, {
    resultado: 'enviado', casos, via: envio.via, motivo: envio.motivo, enviadoEn: ahora,
  });
  await anotarCorrida(regla.tenantId, regla.id, ahora, aMandar.length);
  logger.info('reglas.disparo', {
    regla: regla.id, tenant: regla.tenantId, plantilla: regla.plantilla, casos: aMandar.length,
  });
  return { avisados: aMandar.length, diferida: false };
}

/**
 * El barrido: todas las reglas activas de todas las flotas, una pasada.
 *
 * LANZA solo si no se pudo leer la lista de reglas — quedarse ciego no se
 * puede reportar como calma. Un fallo POR REGLA se cuenta y se sigue.
 */
export async function vigilarReglas(
  ahora: Date = new Date(),
  /** AUDITORÍA 24, BE-7: el mismo `venceEn` (epoch ms) que `cron/escalar`
   *  ya pasa a sus otros barridos — antes solo lo cubría el techo duro de
   *  la ruta entera, así que un barrido lento de reglas podía dejar sin
   *  correr a la cobranza/relojes legales que van después en la misma
   *  invocación. */
  opts: { venceEn?: number } = {},
): Promise<ResultadoVigilancia> {
  const reglas = await reglasActivas();
  const r: ResultadoVigilancia = { reglas: reglas.length, disparadas: 0, avisos: 0, fallos: 0, diferidas: 0 };
  for (const regla of reglas) {
    if (opts.venceEn && Date.now() >= opts.venceEn) break;
    try {
      const { avisados, diferida } = await correrRegla(regla, ahora);
      if (avisados > 0) {
        r.disparadas += 1;
        r.avisos += avisados;
      }
      if (diferida) r.diferidas += 1;
    } catch (e) {
      r.fallos += 1;
      logger.error('reglas.regla_fallo', {
        regla: regla.id, tenant: regla.tenantId, plantilla: regla.plantilla,
        err: e instanceof Error ? e.message.slice(0, 200) : String(e),
      });
    }
  }
  // Retención del historial (0520): en la misma corrida que lo escribe, sin
  // tumbarla si falla. Una vez por barrido es una sola sentencia con índice.
  await purgarAvisosViejos(ahora);
  return r;
}
