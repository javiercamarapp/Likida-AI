import { NextResponse } from 'next/server';
import { clasificacionDeGuardia, decidirAvisos, decidirBaseCaida, estadoDeDetalle, lineasDeAviso, huellaDeClave } from '@/lib/admin/guardia';
import { COMPONENTES_ESTADO, detalleLatidos, leerLatido, puertaCron, purgarObservabilidad, registrarEstado, registrarLatido, type EstadoLatido } from '@/lib/admin/salud';
import { componentesDesdeHealth, componentesDesdeLatidos, esVentanaDeMantenimiento, medicionVacia, sondearHealth } from '@/lib/admin/estado';
import { leerInterruptor } from '@/lib/likida/interruptores';
import { conRelojDuro } from '../_reloj_duro';
import { appUrl } from '@/lib/env';
import { correoConfigurado } from '@/lib/correo/enviar';
import { logger } from '@/lib/logger';
import { codigoDeError } from '@/lib/observability/sentry';
import { alertarOperador } from '@/lib/observability/alerta';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Lecturas acotadas y un GET a /api/health: segundos. El reloj de abajo corta antes de los 60 s.
export const maxDuration = 60;

// ═══════════════════════════════════════════════════════════════════════════
// LA GUARDIA DE PRODUCCIÓN, EN EL SERVIDOR (E1-A · P0-8 · E4).
//
// Hasta hoy el vigía de producción (la guardia A0) corría en launchd en la Mac
// de Javier cada 2 horas: una Mac apagada, dormida o sin red era una guardia
// ausente, y nadie se enteraba. Esta ruta es esa misma guardia, ahora con
// latido (si ella se calla, /api/health lo dice) y el interruptor global.
// Reusa las MISMAS reglas (`lib/admin/guardia.ts`: la matriz del runbook) y la
// MISMA decisión de avisar (`decidirAvisos`, que también usa el script de la Mac).
//
// Cada 5 minutos, en una pasada:
//   1. Clasifica la bandeja con las reglas del A0. Lo S1/S2 NUEVO (o una fuente
//      ciega) se avisa al operador (correo a ALERTA_EMAIL; WhatsApp a ALERTA_WA
//      si está configurado). El dedup es por CAMBIO y vive en el `detalle` del
//      latido de este mismo cron (huellas, no texto de negocio). Una base
//      inalcanzable avisa una vez por racha.
//   2. Pega a `/api/health` por la URL PÚBLICA (lo que vería un monitor externo)
//      y lee los latidos de WhatsApp y correo: de ahí salen los cinco
//      componentes de la página pública /estado. Cada medición suma a
//      `estado_dia` (0701); sin medición no se escribe nada (no se inventa un ok).
//   3. Una vez al día (3:00 MX) borra la retención de latencias y de estado.
//
// QUÉ NO PUEDE HACER (y se dice): si TODA la plataforma cae —app y base— esta
// ruta tampoco corre, y la página /estado vive en la misma plataforma. Un
// monitor EXTERNO sigue siendo lo único que ve eso: ver
// docs/operacion/GUARDIA-EN-SERVIDOR.md.
//
// Respeta la palanca `global` y falla CERRADO si no puede leerla, igual que sus
// hermanos — pero un interruptor ilegible AVISA (la guardia ciega que calla es
// el fallo que la casa no acepta).
// ═══════════════════════════════════════════════════════════════════════════

/** El reloj corta antes de que Vercel mate la función (la ruta no escribiría latido). */
const MARGEN_MS = 12_000;

export async function GET(req: Request) {
  const inicio = Date.now();
  const puerta = await puertaCron('guardia', req, 'La guardia de producción no corre sin él.');
  if (puerta) return puerta;

  const global = await leerInterruptor('global');
  if (global === 'ilegible') {
    await registrarLatido('guardia', 'fallo', { codigo: 'interruptor_ilegible' });
    // El interruptor se lee de la base: si no se puede leer, quizá la guardia está ciega — y aquí no hay otro canal.
    await alertarOperador('guardia.sin_vista', {
      error: 'No se pudo leer el interruptor global: la guardia no puede ver producción.',
      codigo: 'interruptor_ilegible',
    });
    return NextResponse.json({
      corrio: false,
      error: 'No se pudo leer el interruptor global: no se corre sin saber si está apagado.',
      codigo: 'interruptor_ilegible', interruptor: 'global',
    }, { status: 500 });
  }
  if (global === 'apagado') {
    logger.warn('cron.guardia.saltado', { interruptor: 'global' });
    await registrarLatido('guardia', 'saltado', { interruptor: 'global' });
    return NextResponse.json({ corrio: false, saltado: 'interruptor global' });
  }

  try {
    // El estado previo viene del latido anterior. Ilegible = se parte de cero (a lo más repite un aviso: mejor eso que callar).
    const previo = estadoDeDetalle((await leerLatido('guardia').catch(() => null))?.detalle);
    const vence = inicio + maxDuration * 1000 - MARGEN_MS;
    const ahoraIso = new Date(inicio).toISOString();

    // ── 1. La bandeja ──────────────────────────────────────────────────────
    const CORTE = Symbol('corte');
    let clasificacion: Awaited<ReturnType<typeof clasificacionDeGuardia>> | typeof CORTE;
    try {
      clasificacion = await conRelojDuro<Awaited<ReturnType<typeof clasificacionDeGuardia>> | typeof CORTE>(clasificacionDeGuardia(inicio), vence, () => CORTE);
    } catch (e) {
      // Base inalcanzable (o la bandeja entera no se pudo armar): avisar UNA vez por racha.
      const error = e instanceof Error ? e.message : String(e);
      const caida = decidirBaseCaida(previo, ahoraIso);
      if (caida.avisar) {
        await alertarOperador('guardia.base_inalcanzable', {
          error: `La guardia no pudo leer la base de producción: ${error.slice(0, 160)}`,
          codigo: 'guardia_base_inalcanzable',
        });
      }
      logger.error('cron.guardia.base_inalcanzable', { error, codigo: codigoDeError(e) });
      await registrarLatido('guardia', 'fallo', { ...caida.estado, error: error.slice(0, 200), codigo: 'guardia_base_inalcanzable' });
      return NextResponse.json({ corrio: false, error: 'base inalcanzable', codigo: 'guardia_base_inalcanzable' }, { status: 500 });
    }

    let cortadoPorReloj = false;
    let detalleBandeja: Record<string, unknown> = {};
    let estadoNuevo = previo;
    if (clasificacion === CORTE) {
      cortadoPorReloj = true;
      logger.warn('cron.guardia.cortado_por_reloj', {});
    } else {
      const decision = decidirAvisos(clasificacion, previo);
      for (const f of clasificacion.fuentesCiegas) {
        logger.warn('cron.guardia.fuente_ciega', { fuente: f.fuente, error: (f.error ?? 'sin detalle').slice(0, 160) });
      }
      if (decision.baseVolvio) {
        await alertarOperador('guardia.base_volvio', { error: 'La base volvió: la guardia vuelve a ver producción.', codigo: 'guardia_base_volvio' });
      }
      if (decision.nuevos.length > 0 || decision.ciegasNuevas.length > 0) {
        const lineas = lineasDeAviso(decision);
        // `cual`: la huella de lo nuevo — dos tandas distintas de incidentes son dos alarmas aunque caigan en la misma hora
        // (el piso por evento del correo se parte por huella; sin esto el segundo grupo se descartaba).
        await alertarOperador('guardia.incidente_nuevo', {
          codigo: 'guardia_incidente_nuevo',
          cual: huellaDeClave(lineas.join('\n')),
          resumen: `${decision.nuevos.length} incidente(s) nuevo(s) y ${decision.ciegasNuevas.length} fuente(s) ciega(s)`,
          ...Object.fromEntries(lineas.slice(0, 6).map((l, i) => [`incidente_${i + 1}`, l])),
          ...(lineas.length > 6 ? { y_mas: `${lineas.length - 6} más: abre /admin/escalaciones` } : {}),
        });
      }
      estadoNuevo = decision.estado;
      detalleBandeja = {
        urgentes: decision.urgentes.length, nuevos: decision.nuevos.length,
        ciegas: clasificacion.fuentesCiegas.length, porSeveridad: clasificacion.porSeveridad,
      };
    }

    // ── 2. Los componentes de /estado ──────────────────────────────────────
    const medicion = medicionVacia();
    const sondeo = await sondearHealth(`${appUrl()}/api/health`);
    Object.assign(medicion, componentesDesdeHealth(sondeo));
    if (!sondeo.respondio) {
      await alertarOperador('guardia.app_sin_respuesta', {
        error: 'La guardia no obtuvo respuesta de /api/health por la URL pública.',
        codigo: 'guardia_app_sin_respuesta',
      });
    }
    try {
      Object.assign(medicion, componentesDesdeLatidos(await detalleLatidos(inicio), correoConfigurado()));
    } catch (e) {
      logger.warn('cron.guardia.latidos_ilegibles', { err: e instanceof Error ? e.message : String(e) });
    }
    let sinEscribir = 0;
    for (const c of COMPONENTES_ESTADO) {
      const m = medicion[c];
      if (m !== null && !(await registrarEstado(c, m))) sinEscribir++;
    }

    // ── 3. La retención, una vez al día ────────────────────────────────────
    let mantenimiento: Record<string, unknown> | undefined;
    if (esVentanaDeMantenimiento(inicio)) {
      try {
        mantenimiento = await purgarObservabilidad();
      } catch (e) {
        mantenimiento = { error: (e instanceof Error ? e.message : String(e)).slice(0, 160) };
        logger.error('cron.guardia.mantenimiento_fallo', { err: mantenimiento.error as string });
      }
    }

    const parcial = cortadoPorReloj || sinEscribir > 0 || (mantenimiento !== undefined && 'error' in mantenimiento);
    const estado: EstadoLatido = parcial ? 'parcial' : 'ok';
    // `componentes` va en el latido: es lo que lee /estado para el estado ACTUAL (con la hora del propio latido).
    const detalle = { ...estadoNuevo, ...detalleBandeja, componentes: medicion, ...(mantenimiento ? { mantenimiento } : {}), ...(cortadoPorReloj ? { cortadoPorReloj } : {}) };
    logger.info('cron.guardia.ok', { ...detalleBandeja, componentes: JSON.stringify(medicion), parcial });
    await registrarLatido('guardia', estado, detalle);
    return NextResponse.json({ corrio: true, parcial, ...detalleBandeja, componentes: medicion });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    const codigo = codigoDeError(e);
    logger.error('cron.guardia.fallo', { error, codigo });
    await alertarOperador('cron.guardia', { error, codigo });
    await registrarLatido('guardia', 'fallo', { error: error.slice(0, 200), codigo });
    return NextResponse.json({ corrio: false, error, codigo }, { status: 500 });
  }
}
