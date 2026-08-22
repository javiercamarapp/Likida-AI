import { NextResponse } from 'next/server';
import { Client as QstashClient } from '@upstash/qstash';
import { processInbound, type ResultadoInbound } from '@/lib/likida/processor';
import { leerInterruptor } from '@/lib/likida/interruptores';
import {
  pendientesPorDrenar, reclamarPendiente, marcarPendienteProcesado,
  anotarFalloPendiente, devolverIntentoPendiente, cartasMuertas,
} from '@/lib/likida/wa_pendientes';
import { conPool } from '@/lib/likida/lotes';
import { urgentesVencidas } from '@/lib/likida/agentes/cola';
import { logger } from '@/lib/logger';
import { appUrl } from '@/lib/env';
import { codigoDeError } from '@/lib/observability/sentry';
import { alertarOperador } from '@/lib/observability/alerta';
import { puertaCron, registrarLatido } from '@/lib/admin/salud';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// El drenado procesa hasta LOTE mensajes por el motor completo (OCR + LLM):
// mismo presupuesto que el webhook vivo, que atiende lo mismo en una ráfaga.
export const maxDuration = 120;

// ═══════════════════════════════════════════════════════════════════════════
// EL CRON QUE DRENA LA BANDEJA DEL APAGADO (`wa_evento_pendiente`, 0119).
//
// P1 de la auditoría externa: con el kill switch global abajo, el webhook
// GUARDA los mensajes en vez de tirarlos tras el 200. Este cron corre cada
// minuto y, SOLO con la palanca arriba, procesa lo guardado por el motor
// real — el mismo processInbound del camino vivo, con el mismo dedup de
// claimMessage (0002) haciendo inofensivo el at-least-once.
//
// ── EL CAUDAL (auditoría prod, ESC-1) ───────────────────────────────────
//
// Era LOTE=10 en serie cada 5 minutos: ~60 mensajes/hora de capacidad contra
// 490-1,100/hora de entrada a 50k viajes. La bandeja no se drenaba, CRECÍA —
// y como `sin_tiempo` contaba como intento, a las cinco corridas la foto de
// un chofer se volvía carta muerta sin que nadie la hubiera mirado.
//
// Ahora: cada minuto (vercel.json), lote de 40, y hasta 5 mensajes EN VUELO
// a la vez. El paralelismo es POR CHOFER, no por mensaje: los de una misma
// persona siguen en serie —una caption completa la foto anterior— y los de
// personas distintas corren a la vez. Con el lote lleno se AUTO-REENCOLA por
// QStash (el patrón de facturar/cola): la vuelta siguiente arranca con su
// propio presupuesto en vez de esperar al minuto siguiente.
//
// FALLA CERRADO SIN SECRETO, como escalar: esta ruta dispara mensajes de
// WhatsApp a personas reales al procesar.
// ═══════════════════════════════════════════════════════════════════════════

/** Mensajes por vuelta. 40 × 5 en vuelo entra de sobra en los 120 s. */
export const LOTE = 40;
/** Cuántos mensajes se procesan a la vez. Cinco: el techo lo pone el pool de
 *  PostgREST y el rate limit de Meta, no el CPU. */
export const ANCHO_POOL = 5;
/** Techo de vueltas encadenadas por QStash en un mismo minuto (40 × 20 = 800
 *  mensajes). Sin techo, una bandeja envenenada se reencolaría para siempre. */
export const MAX_VUELTAS_QSTASH = 20;

/** Los resultados de `processInbound` que dejan la fila SIN sellar. Local a
 *  propósito: la prueba de esta ruta mockea el processor entero, y `undefined`
 *  (el contrato viejo de `void`) cuenta como hecho. */
function quedoPendiente(r: ResultadoInbound | undefined): boolean {
  return r === 'sin_tiempo' || r === 'en_curso' || r === 'reintentable';
}

export async function GET(req: Request) {
  const inicioInvocacion = Date.now();
  // La puerta común (RES-7): 500 + alerta sin secreto, 401 con log y código.
  const puerta = await puertaCron('wa-pendientes', req, 'La bandeja no se drena sin él.');
  if (puerta) return puerta;

  // ── EL MONITOR DE SLA DE URGENTES viaja en este heartbeat ───────────────
  // (auditoría externa P2: la bandeja urgente se mide en minutos y nadie la
  // vigilaba). Va ANTES del kill switch a propósito: las urgentes envejecen
  // igual con el sistema apagado, y avisar de eso es lectura, no proceso.
  // Best-effort con grito: un monitor caído no puede tumbar el drenado.
  try {
    const vencidas = await urgentesVencidas(10);
    if (vencidas > 0) {
      logger.error('cron.wa_pendientes.urgentes_vencidas', { vencidas });
      await alertarOperador('aprobaciones.urgentes', { error: `${vencidas} pieza(s) URGENTE(s) llevan más de 10 minutos esperando aprobación en /admin/aprobaciones`, codigo: 'sla_urgente' });
    }
  } catch (e) {
    logger.error('cron.wa_pendientes.monitor_sla_caido', { err: e instanceof Error ? e.message : String(e) });
  }

  // Apagado = la pausa SIGUE: la bandeja espera, y eso es exactamente el
  // contrato nuevo. 200 con `saltado` — apagado a propósito no es fallo.
  // AUDITORÍA 18, ALTO (A17): NO haber podido leerlo SÍ lo es — este cron
  // corre cada minuto y, saltándose en 200 con `logger.info` (nivel que ni
  // llega a Sentry), la bandeja durable se quedaba sin drenar con el panel
  // en verde. Ilegible = 500 con `codigo`; el grito y el correo ya salieron
  // de `leerInterruptor`.
  const global = await leerInterruptor('global');
  if (global === 'ilegible') {
    return NextResponse.json({
      corrio: false,
      error: 'No se pudo leer el interruptor global: la bandeja no se drena sin saber si está apagado.',
      codigo: 'interruptor_ilegible',
      interruptor: 'global',
    }, { status: 500 });
  }
  if (global === 'apagado') {
    logger.warn('cron.wa_pendientes.saltado', { interruptor: 'global' });
    return NextResponse.json({ corrio: false, saltado: 'interruptor global' });
  }

  const r = await drenarBandeja(inicioInvocacion, req);
  if (r.error !== undefined) {
    return NextResponse.json({ error: r.error, procesados: r.procesados, fallidos: r.fallidos, pospuestos: r.pospuestos }, { status: 500 });
  }
  return NextResponse.json({
    corrio: true,
    procesados: r.procesados,
    fallidos: r.fallidos,
    pospuestos: r.pospuestos,
    cartasMuertas: r.cartasMuertas,
    ...(r.encolado ? { encolado: r.encolado } : {}),
  }, { status: r.fallidos > 0 ? 500 : 200 });
}

export interface ResultadoDrenado {
  procesados: number;
  fallidos: number;
  pospuestos: number;
  cartasMuertas: number;
  /** El messageId de la vuelta que quedó encolada en QStash, si la hubo. */
  encolado?: string;
  error?: string;
}

/**
 * Drena UNA vuelta de la bandeja. La comparten el cron (cada minuto) y el
 * callback de QStash (`cola/route.ts`), que es quien encadena las vueltas
 * mientras el lote salga lleno.
 *
 * `vuelta` es el número de vueltas encadenadas que YA se hicieron en esta
 * cadena: al llegar a `MAX_VUELTAS_QSTASH` deja de reencolar y el cron del
 * minuto siguiente retoma.
 */
export async function drenarBandeja(inicioInvocacion: number, req: Request, vuelta = 0): Promise<ResultadoDrenado> {
  let procesados = 0;
  let fallidos = 0;
  let pospuestos = 0;
  let huboFalloDeCron = false;
  let tomados = 0;
  let encolado: string | undefined;
  try {
    const lote = await pendientesPorDrenar(LOTE);
    tomados = lote.length;

    // ── EN PARALELO POR CHOFER, EN SERIE DENTRO DE CADA CHOFER (ESC-1) ────
    // El orden de llegada importa DENTRO de una conversación (la caption que
    // completa la foto anterior, el "listo" que cierra); entre conversaciones
    // distintas no importa nada. Agrupar por remitente es lo que permite
    // multiplicar el caudal sin romper esa garantía.
    const porChofer = new Map<string, typeof lote>();
    for (const p of lote) {
      const cadena = porChofer.get(p.remitente) ?? [];
      cadena.push(p);
      porChofer.set(p.remitente, cadena);
    }

    await conPool([...porChofer.values()], ANCHO_POOL, async (cadena) => {
      for (const p of cadena) {
        const claim = await reclamarPendiente(p.id, p.intentos);
        if (!claim) continue; // otra corrida lo tomó — resultado esperado
        try {
          // El reloj es el de ESTA invocación, compartido por todo el lote
          // (auditoría 18, C4): el mensaje 7 pide lo que queda, no 120s nuevos.
          const resultado = await processInbound(claim.evento, { inicioInvocacionMs: inicioInvocacion });
          if (quedoPendiente(resultado)) {
            // NO SE SELLA (A3/A27): el motor no lo terminó — sin presupuesto,
            // en vuelo en otra invocación, o abandonado por un fallo nuestro.
            // La fila sigue pendiente y la siguiente corrida la vuelve a tomar.
            pospuestos++;
            logger.warn('cron.wa_pendientes.pospuesto', { id: claim.id, intento: claim.intentos, resultado });
            if (resultado === 'sin_tiempo') {
              // ESC-1: quedarse sin presupuesto NO es un intento fallido — el
              // mensaje ni se miró. Contarlo convertía en carta muerta, a las
              // cinco corridas cargadas, una foto que nadie llegó a procesar.
              // El resto de los pospuestos SÍ consumen: ahí el motor trabajó.
              await devolverIntentoPendiente(claim.id, claim.intentos);
              // Sin presupuesto para este mensaje tampoco lo hay para el
              // siguiente de la cadena: se corta y la vuelta siguiente sigue.
              return;
            }
            await anotarFalloPendiente(claim.id, `pospuesto: ${resultado}`);
            continue;
          }
          await marcarPendienteProcesado(claim.id);
          procesados++;
        } catch (e) {
          fallidos++;
          const err = e instanceof Error ? e.message : String(e);
          logger.error('cron.wa_pendientes.evento_fallo', { id: claim.id, intento: claim.intentos, err });
          await anotarFalloPendiente(claim.id, err);
        }
      }
    });

    // ── EL AUTO-REENCOLADO (ESC-1) ────────────────────────────────────────
    // Lote lleno = hay más esperando. En vez de dejarlo para el minuto
    // siguiente —que a 1,100 mensajes/hora es cómo la bandeja se vuelve
    // permanente—, se encola otra vuelta con su propio presupuesto. Mismo
    // patrón que `facturar` (ronda 16); sin QStash configurado, el cron del
    // minuto siguiente hace de reencolado y nada se pierde.
    if (tomados >= LOTE && vuelta < MAX_VUELTAS_QSTASH) {
      encolado = await encolarOtraVuelta(req, vuelta + 1);
    }

    // Las cartas muertas se GRITAN al operador: un mensaje de un chofer que
    // cinco intentos no pudieron procesar necesita ojos humanos, no otra
    // vuelta del cron.
    const muertas = await cartasMuertas();
    if (muertas > 0) {
      logger.error('cron.wa_pendientes.cartas_muertas', { muertas });
      await alertarOperador('cron.wa_pendientes', { error: `${muertas} mensaje(s) de WhatsApp agotaron sus reintentos en la bandeja del apagado`, codigo: 'cartas_muertas' });
    }
    await registrarLatido('wa-pendientes', fallidos > 0 ? 'fallo' : 'ok', { procesados, fallidos, pospuestos, vuelta });
    return { procesados, fallidos, pospuestos, cartasMuertas: muertas, encolado };
  } catch (e) {
    huboFalloDeCron = true;
    const error = e instanceof Error ? e.message : String(e);
    const codigo = codigoDeError(e);
    logger.error('cron.wa_pendientes.falló', { error, codigo });
    await alertarOperador('cron.wa_pendientes', { error, codigo });
    await registrarLatido('wa-pendientes', 'fallo', { codigo });
    return { procesados, fallidos, pospuestos, cartasMuertas: 0, error };
  } finally {
    if (!huboFalloDeCron && (procesados > 0 || fallidos > 0 || pospuestos > 0)) {
      logger.info('cron.wa_pendientes.ok', { procesados, fallidos, pospuestos, tomados, vuelta });
    }
  }
}

/**
 * Encola la vuelta siguiente en QStash. Best-effort A PROPÓSITO: si no se
 * puede encolar, el cron del minuto siguiente toma exactamente el mismo lote
 * (nada se marcó de más), así que un QStash caído baja el caudal pero no
 * pierde un solo mensaje. Por eso no lanza ni cuenta como fallo.
 */
async function encolarOtraVuelta(req: Request, vuelta: number): Promise<string | undefined> {
  const token = process.env.UPSTASH_QSTASH_TOKEN;
  if (!token) return undefined;
  try {
    const q = new QstashClient({ token, baseUrl: process.env.QSTASH_URL ?? undefined });
    // `appUrl()` es el ÚNICO accesor de la URL base (env.ts, guardia A2); el
    // host de la petición queda de red de seguridad para un preview sin env.
    const base = appUrl() || `https://${req.headers.get('host')}`;
    const { messageId } = await q.publishJSON({
      url: `${base}/api/cron/wa-pendientes/cola`,
      body: { vuelta },
      // Sin reintentos: la bandeja es durable y el cron del minuto siguiente
      // ES el reintento. Insistir aquí solo duplicaría trabajo en vuelo.
      retries: 0,
      timeout: 120,
    });
    logger.info('cron.wa_pendientes.encolado', { messageId, vuelta });
    return messageId;
  } catch (e) {
    logger.warn('cron.wa_pendientes.encolado_fallo', { vuelta, err: e instanceof Error ? e.message : String(e) });
    return undefined;
  }
}
