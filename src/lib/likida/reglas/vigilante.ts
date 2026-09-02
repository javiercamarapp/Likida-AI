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
// EL ORDEN IMPORTA Y ES EL DE LA 0202: se manda PRIMERO y se sella DESPUÉS.
// Un WhatsApp que no salió se reintenta a la corrida siguiente; un sello
// puesto antes convertiría un fallo de red en un aviso perdido para siempre.
//
// CADA REGLA FALLA POR SU LADO. Una regla con una consulta que truena no
// puede dejar sin vigilancia a las otras veintinueve de la misma flota, ni a
// las de las demás flotas.
// ═══════════════════════════════════════════════════════════════════════════
import { sendText } from '@/lib/meta/client';
import { telefonoJefeDe, telefonoParaDineroDe } from '../contactos';
import { logger } from '@/lib/logger';
import { CATALOGO } from './catalogo';
import { evaluar, type Disparo } from './lectores';
import {
  reglasActivas, sellosDe, sellarDisparos, anotarCorrida, llaveSello,
  type ReglaGuardada,
} from './repo';

export interface ResultadoVigilancia {
  reglas: number;
  /** Reglas que encontraron algo NUEVO y lo avisaron. */
  disparadas: number;
  /** Avisos individuales que salieron (filas citadas). */
  avisos: number;
  fallos: number;
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

/** Corre UNA regla. `true` si esta corrida mandó algo. */
async function correrRegla(regla: ReglaGuardada, ahora: Date): Promise<number> {
  const plantilla = CATALOGO[regla.plantilla];
  const candidatos = await evaluar(regla.plantilla, regla.params, regla.tenantId, ahora);
  if (candidatos.length === 0) {
    await anotarCorrida(regla.tenantId, regla.id, ahora, 0);
    return 0;
  }

  // ¿Cuáles ya se avisaron? Una consulta por regla, no una por candidato — el
  // mismo criterio que `avisarVencimientos` tras c2-4.
  const sellados = await sellosDe(regla.tenantId, regla.id, candidatos);
  const nuevos: Disparo[] = candidatos.filter((d) => !sellados.has(llaveSello(d)));
  if (nuevos.length === 0) {
    await anotarCorrida(regla.tenantId, regla.id, ahora, 0);
    return 0;
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

  const enviado = await sendText(telefono, mensajeDeRegla(regla.frase, nuevos.map((d) => d.evidencia)));
  if (!enviado) {
    // Sin sello: se reintenta a la siguiente corrida. Es exactamente el
    // contrato de `avisarVencimientos`.
    throw new Error('el WhatsApp no salió');
  }

  await sellarDisparos(regla.tenantId, regla.id, nuevos);
  await anotarCorrida(regla.tenantId, regla.id, ahora, nuevos.length);
  logger.info('reglas.disparo', {
    regla: regla.id, tenant: regla.tenantId, plantilla: regla.plantilla, casos: nuevos.length,
  });
  return nuevos.length;
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
  const r: ResultadoVigilancia = { reglas: reglas.length, disparadas: 0, avisos: 0, fallos: 0 };
  for (const regla of reglas) {
    if (opts.venceEn && Date.now() >= opts.venceEn) break;
    try {
      const avisos = await correrRegla(regla, ahora);
      if (avisos > 0) {
        r.disparadas += 1;
        r.avisos += avisos;
      }
    } catch (e) {
      r.fallos += 1;
      logger.error('reglas.regla_fallo', {
        regla: regla.id, tenant: regla.tenantId, plantilla: regla.plantilla,
        err: e instanceof Error ? e.message.slice(0, 200) : String(e),
      });
    }
  }
  return r;
}
