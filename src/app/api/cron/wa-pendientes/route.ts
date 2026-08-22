import { NextResponse } from 'next/server';
import { processInbound, type ResultadoInbound } from '@/lib/likida/processor';
import { leerInterruptor } from '@/lib/likida/interruptores';
import {
  pendientesPorDrenar, reclamarPendiente, marcarPendienteProcesado,
  anotarFalloPendiente, cartasMuertas,
} from '@/lib/likida/wa_pendientes';
import { urgentesVencidas } from '@/lib/likida/agentes/cola';
import { logger } from '@/lib/logger';
import { codigoDeError } from '@/lib/observability/sentry';
import { alertarOperador } from '@/lib/observability/alerta';

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
// 5 minutos y, SOLO con la palanca arriba, procesa lo guardado por el motor
// real — el mismo processInbound del camino vivo, con el mismo dedup de
// claimMessage (0002) haciendo inofensivo el at-least-once.
//
// LOTE CHICO A PROPÓSITO: cada mensaje puede costar OCR + LLM. 10 por
// corrida drenan un apagón típico en pocas vueltas sin acercarse al techo
// de 120s; lo que no cupo hoy encabeza la corrida siguiente (el índice
// parcial ordena por llegada).
//
// FALLA CERRADO SIN SECRETO, como escalar: esta ruta dispara mensajes de
// WhatsApp a personas reales al procesar.
// ═══════════════════════════════════════════════════════════════════════════

const LOTE = 10;

/** Los resultados de `processInbound` que dejan la fila SIN sellar. Local a
 *  propósito: la prueba de esta ruta mockea el processor entero, y `undefined`
 *  (el contrato viejo de `void`) cuenta como hecho. */
function quedoPendiente(r: ResultadoInbound | undefined): boolean {
  return r === 'sin_tiempo' || r === 'en_curso' || r === 'reintentable';
}

export async function GET(req: Request) {
  const inicioInvocacion = Date.now();
  const secreto = process.env.CRON_SECRET;
  if (!secreto) {
    logger.error('cron.wa_pendientes.sin_secreto', {});
    return NextResponse.json({ error: 'CRON_SECRET no está configurado.' }, { status: 500 });
  }
  if (req.headers.get('authorization') !== `Bearer ${secreto}`) {
    return new NextResponse(null, { status: 401 });
  }

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
  // corre cada 5 min y, saltándose en 200 con `logger.info` (nivel que ni
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

  let procesados = 0;
  let fallidos = 0;
  let pospuestos = 0;
  let huboFalloDeCron = false;
  try {
    const lote = await pendientesPorDrenar(LOTE);
    // EN SERIE a propósito: el orden de llegada importa (una caption que
    // completa la foto anterior) y el motor ya paraleliza por dentro.
    for (const p of lote) {
      const claim = await reclamarPendiente(p.id, p.intentos);
      if (!claim) continue; // otra corrida lo tomó — resultado esperado
      try {
        // El reloj es el de ESTA invocación, compartido por los 10 del lote
        // (auditoría 18, C4): el mensaje 7 pide lo que queda, no 120s nuevos.
        const resultado = await processInbound(claim.evento, { inicioInvocacionMs: inicioInvocacion });
        if (quedoPendiente(resultado)) {
          // NO SE SELLA (A3/A27): el motor no lo terminó — sin presupuesto,
          // en vuelo en otra invocación, o abandonado por un fallo nuestro.
          // La fila sigue pendiente con su intento contado; la siguiente
          // corrida lo vuelve a tomar. No es fallo del cron: es la bandeja
          // haciendo su trabajo, así que no tumba el 200.
          pospuestos++;
          logger.warn('cron.wa_pendientes.pospuesto', { id: claim.id, intento: claim.intentos, resultado });
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

    // Las cartas muertas se GRITAN al operador: un mensaje de un chofer que
    // cinco intentos no pudieron procesar necesita ojos humanos, no otra
    // vuelta del cron.
    const muertas = await cartasMuertas();
    if (muertas > 0) {
      logger.error('cron.wa_pendientes.cartas_muertas', { muertas });
      await alertarOperador('cron.wa_pendientes', { error: `${muertas} mensaje(s) de WhatsApp agotaron sus reintentos en la bandeja del apagado`, codigo: 'cartas_muertas' });
    }
    return NextResponse.json({ corrio: true, procesados, fallidos, pospuestos, cartasMuertas: muertas }, { status: fallidos > 0 ? 500 : 200 });
  } catch (e) {
    huboFalloDeCron = true;
    const error = e instanceof Error ? e.message : String(e);
    const codigo = codigoDeError(e);
    logger.error('cron.wa_pendientes.falló', { error, codigo });
    await alertarOperador('cron.wa_pendientes', { error, codigo });
    return NextResponse.json({ error, procesados, fallidos, pospuestos }, { status: 500 });
  } finally {
    if (!huboFalloDeCron && (procesados > 0 || fallidos > 0 || pospuestos > 0)) {
      logger.info('cron.wa_pendientes.ok', { procesados, fallidos, pospuestos });
    }
  }
}
