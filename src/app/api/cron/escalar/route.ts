import { NextResponse } from 'next/server';
import { escalarViajesSinAceptar } from '@/lib/likida/escalar_viaje';
import { ejecutarCobranzaGlobal } from '@/lib/likida/agentes/cobranza';
import { estaApagado } from '@/lib/likida/interruptores';
import { logger } from '@/lib/logger';
import { codigoDeError } from '@/lib/observability/sentry';
import { alertarOperador } from '@/lib/observability/alerta';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Una corrida toca N viajes y cada uno manda hasta dos mensajes de WhatsApp.
// Con el índice parcial de la 0058 la consulta es corta; el presupuesto es para
// los envíos, no para la lectura.
export const maxDuration = 120;

// ═══════════════════════════════════════════════════════════════════════════
// EL CRON QUE DESTAPA LOS VIAJES QUE NADIE ATIENDE.
//
// Primer cron del repo, y desde el 8-ago-2026 corre DOS chequeos por hora —
// no dos rutas: los dos son "viaje abierto que se está pasando de tiempo",
// misma cadencia, mismo secreto, mismo modo de falla. Separarlos en dos
// URLs hubiera sido ceremonia sin beneficio.
//
//   1. Viajes que el CHOFER no aceptó — le da al jefe de flota la única
//      cosa que él puede resolver y el sistema no: cambiar de chofer
//      (`escalar_viaje.ts`).
//   2. Viajes abiertos con `fecha_inicio` vieja y sin comprobantes — le
//      insiste AL CHOFER directo, sin que nadie tenga que apretar un botón
//      (decisión de Javier el 8-ago-2026: automático, no dependiente del
//      jefe de flota). Desde el 14-ago-2026 lo corre el Agente de Cobranza
//      (`agentes/cobranza.ts`, 0089) con tiers/ventana POR FLOTA —
//      `recordatorio_comprobacion.ts` se borró al quedar supersedido.
//
// Corren en su propio try/catch cada uno: si uno truena, el otro igual
// intenta — dos causas de falla independientes no deberían dejar ciego al
// chequeo que sí funciona.
//
// ── POR QUÉ FALLA CERRADO SIN SECRETO ────────────────────────────────────
//
// Esta ruta MANDA MENSAJES DE WHATSAPP, que cuestan dinero y llegan a personas
// reales. Sin `CRON_SECRET` configurado no se ejecuta y devuelve 500 — y no 200
// con un aviso: un 200 le diría a Vercel que la corrida salió bien, el cron se
// vería verde en el panel para siempre, y nadie se enteraría de que la
// escalación lleva meses sin correr. Es el mismo modo de falla que el repo ya
// documenta en `exigir()`: quedarse ciego se lee igual que "no hay nada".
//
// ── POR QUÉ NO SE PUEDE INVOCAR DESDE EL NAVEGADOR ───────────────────────
//
// Vercel Cron manda `Authorization: Bearer <CRON_SECRET>`. Cualquiera que
// conociera la URL podría disparar avisos a voluntad; el secreto es lo único
// entre eso y un teléfono sonando de madrugada.
// ═══════════════════════════════════════════════════════════════════════════

export async function GET(req: Request) {
  const secreto = process.env.CRON_SECRET;
  if (!secreto) {
    logger.error('cron.escalar.sin_secreto', {});
    return NextResponse.json(
      { error: 'CRON_SECRET no está configurado. La escalación no corre sin él.' },
      { status: 500 },
    );
  }
  if (req.headers.get('authorization') !== `Bearer ${secreto}`) {
    // Sin cuerpo: a quien no está autorizado no se le dice qué hay detrás.
    return new NextResponse(null, { status: 401 });
  }

  // ── EL KILL SWITCH (0110), DESPUÉS de la puerta y ANTES de trabajar ──────
  //
  // 'global' apaga los dos motores. Responde 200, no 500: apagado A PROPÓSITO
  // no es un fallo — un 500 aquí pintaría el cron rojo en Vercel y dispararía
  // a alguien a investigar exactamente lo que Javier acaba de decidir. El
  // `saltado` en el cuerpo es lo que distingue esta corrida de una sana.
  // El interruptor es GLOBAL por agente (v1), no por tenant: este cron barre
  // todas las flotas en una corrida y la palanca corta el barrido entero.
  // Fail-closed: si el interruptor no se puede LEER, `estaApagado` devuelve
  // apagado con grito en el log (ver interruptores.ts) — este cron manda
  // WhatsApp a personas reales, y "no sé si está apagado" no es permiso.
  if (await estaApagado('global')) {
    logger.warn('cron.escalar.saltado', { interruptor: 'global' });
    return NextResponse.json({ corrio: false, saltado: 'interruptor global' });
  }

  const resultado: Record<string, unknown> = {};
  // AUDITORÍA 3, OP-C1 (CRÍTICO): este cron respondía 200 con un motor
  // entero reventado — el único con ese vicio (purgar/facturar responden
  // 500/503) — y así fue como el embed roto de la 0075 acumuló ~216 corridas
  // "verdes" sin que Vercel ni Sentry levantaran la mano. Un motor caído =
  // 500, para que la plataforma cuente el cron como FALLIDO.
  let huboFallo = false;

  try {
    const r = await escalarViajesSinAceptar();
    logger.info('cron.escalar.ok', { ...r });
    resultado.aceptacion = r;
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    // El `codigo` es lo que separa "token vencido" de "tabla no existe" en el
    // fingerprint de Sentry (`discriminadores`): sin él, la causa nueva caía en
    // el issue viejo y no notificaba (reincidencia de OP-A1). Estable por
    // construcción — misma causa, mismo código, mismo issue. No hay tenant que
    // emitir: el motor corre global, sobre todas las flotas a la vez.
    const codigo = codigoDeError(e);
    logger.error('cron.escalar.falló', { error, codigo });
    await alertarOperador('cron.escalar', { error, codigo });
    resultado.aceptacion = { error };
    huboFallo = true;
  }

  // El segundo motor ES el Agente de Cobranza, así que tiene su propia
  // palanca además de la global. El primero (aceptación) no la tiene: la
  // escalación de aceptación no es un agente del catálogo (0102) y no hay
  // nombre honesto que darle — se apaga con 'global', y se dice aquí para
  // que nadie busque un interruptor que no existe.
  if (await estaApagado('agente:cobranza')) {
    logger.warn('cron.cobranza.saltado', { interruptor: 'agente:cobranza' });
    resultado.comprobacion = { saltado: 'interruptor agente:cobranza' };
  } else {
    try {
      const r = await ejecutarCobranzaGlobal();
      logger.info('cron.cobranza.ok', { ...r });
      resultado.comprobacion = r;
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      // Mismo criterio que el catch de arriba: código estable para el
      // fingerprint, alerta directa al operador del sistema.
      const codigo = codigoDeError(e);
      logger.error('cron.cobranza.falló', { error, codigo });
      await alertarOperador('cron.cobranza', { error, codigo });
      resultado.comprobacion = { error };
      huboFallo = true;
    }
  }

  // Los fallos van en la RESPUESTA, no solo en el log. "Esa flota no tiene
  // teléfono de jefe registrado" es un problema de configuración que se
  // arregla en un minuto — si solo vive en el log, nadie lo ve hasta que
  // alguien pregunta por qué no le avisaron.
  return NextResponse.json(resultado, { status: huboFallo ? 500 : 200 });
}
