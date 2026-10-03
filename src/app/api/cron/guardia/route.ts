import { NextResponse } from 'next/server';
import { clasificacionDeGuardia, decidirApp, decidirAvisos, decidirBaseCaida, estadoDeDetalle, estadoTrasAviso, lineasDeAviso, huellaDeClave, memoriaDeEstado, ESTADO_GUARDIA_INICIAL, SONDEOS_FALLIDOS_PARA_CAIDA, type EstadoGuardia } from '@/lib/admin/guardia';
import { COMPONENTES_ESTADO, detalleLatidos, leerLatido, puertaCron, purgarObservabilidad, registrarEstado, registrarLatido, type EstadoLatido } from '@/lib/admin/salud';
import { componentesDesdeHealth, componentesDesdeLatidos, esVentanaDeMantenimiento, medicionVacia, sondearHealth, sondeoCiego } from '@/lib/admin/estado';
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
    // El estado previo viene del latido anterior. Si la LECTURA falla (base caída) se usa la memoria del proceso (M4): sin
    // ella cada pasada de una caída creía partir de cero y nunca se emitía «base volvió». Si la lectura va bien pero el
    // latido no trae la caída (porque no se pudo escribir durante ella), la memoria completa `baseCaidaDesde`.
    const enMemoria = memoriaDeEstado.leer();
    let previoIlegible = false;
    let previo: EstadoGuardia;
    try {
      previo = estadoDeDetalle((await leerLatido('guardia'))?.detalle);
      if (previo.baseCaidaDesde === null && enMemoria?.baseCaidaDesde) previo = { ...previo, baseCaidaDesde: enMemoria.baseCaidaDesde };
    } catch {
      previoIlegible = true;
      previo = enMemoria ?? { ...ESTADO_GUARDIA_INICIAL };
    }
    const vence = inicio + maxDuration * 1000 - MARGEN_MS;
    const ahoraIso = new Date(inicio).toISOString();

    // ── 1. La bandeja ──────────────────────────────────────────────────────
    // M6 (ronda 19): si la bandeja lenta/fallida lanza con la base SANA, no es «base inalcanzable»: se aísla, y se sigue
    // al sondeo de health y al registro de estado (si no, huecos «sin medición» en /estado y un falso aviso de base).
    const CORTE = Symbol('corte');
    let clasificacion: Awaited<ReturnType<typeof clasificacionDeGuardia>> | typeof CORTE | null = null;
    let bandejaError: string | null = null;
    try {
      clasificacion = await conRelojDuro<Awaited<ReturnType<typeof clasificacionDeGuardia>> | typeof CORTE>(clasificacionDeGuardia(inicio), vence, () => CORTE);
    } catch (e) {
      bandejaError = e instanceof Error ? e.message : String(e);
      logger.error('cron.guardia.bandeja_fallo', { error: bandejaError, codigo: codigoDeError(e) });
    }

    let cortadoPorReloj = false;
    let detalleBandeja: Record<string, unknown> = {};
    let estadoNuevo: EstadoGuardia = { ...previo, rachaBandeja: bandejaError === null ? 0 : previo.rachaBandeja + 1 };
    if (clasificacion === CORTE) {
      cortadoPorReloj = true;
      logger.warn('cron.guardia.cortado_por_reloj', {});
    } else if (clasificacion !== null) {
      const decision = decidirAvisos(clasificacion, previo);
      for (const f of clasificacion.fuentesCiegas) {
        logger.warn('cron.guardia.fuente_ciega', { fuente: f.fuente, error: (f.error ?? 'sin detalle').slice(0, 160) });
      }
      if (decision.baseVolvio) {
        await alertarOperador('guardia.base_volvio', { error: 'La base volvió: la guardia vuelve a ver producción.', codigo: 'guardia_base_volvio' });
      }
      let avisoSalio = true;
      if (decision.nuevos.length > 0 || decision.ciegasNuevas.length > 0) {
        const lineas = lineasDeAviso(decision);
        // `cual`: la huella de lo nuevo — dos tandas distintas de incidentes son dos alarmas aunque caigan en la misma hora
        // (el piso por evento del correo se parte por huella; sin esto el segundo grupo se descartaba).
        avisoSalio = await alertarOperador('guardia.incidente_nuevo', {
          codigo: 'guardia_incidente_nuevo',
          cual: huellaDeClave(lineas.join('\n')),
          resumen: `${decision.nuevos.length} incidente(s) nuevo(s) y ${decision.ciegasNuevas.length} fuente(s) ciega(s)`,
          ...Object.fromEntries(lineas.slice(0, 6).map((l, i) => [`incidente_${i + 1}`, l])),
          ...(lineas.length > 6 ? { y_mas: `${lineas.length - 6} más: abre /admin/escalaciones` } : {}),
        });
      }
      // M5: «visto» solo si el aviso salió (sin canal o con el piso, el incidente nuevo sigue pendiente).
      estadoNuevo = { ...estadoTrasAviso(decision, avisoSalio), rachaBandeja: 0 };
      detalleBandeja = {
        urgentes: decision.urgentes.length, nuevos: decision.nuevos.length,
        ciegas: clasificacion.fuentesCiegas.length, porSeveridad: clasificacion.porSeveridad,
      };
    } else {
      detalleBandeja = { bandejaFallo: true };
    }

    // ── 2. Los componentes de /estado ──────────────────────────────────────
    const medicion = medicionVacia();
    const sondeo = await sondearHealth(`${appUrl()}/api/health`);
    Object.assign(medicion, componentesDesdeHealth(sondeo));

    // ¿Base inalcanzable? Solo si la bandeja no se pudo armar Y hay otra señal de base (el latido previo ilegible o el
    // propio /api/health diciendo db=fallo): una bandeja lenta con la base sana no lo es (M6).
    const baseInalcanzable = bandejaError !== null && (previoIlegible || sondeo.db === 'fallo');
    if (baseInalcanzable) {
      const caida = decidirBaseCaida(previo, ahoraIso);
      if (caida.avisar) {
        await alertarOperador('guardia.base_inalcanzable', {
          error: `La guardia no pudo leer la base de producción: ${bandejaError!.slice(0, 160)}`,
          codigo: 'guardia_base_inalcanzable',
        });
      }
      estadoNuevo = { ...estadoNuevo, baseCaidaDesde: caida.estado.baseCaidaDesde };
    } else if (bandejaError !== null && estadoNuevo.rachaBandeja === SONDEOS_FALLIDOS_PARA_CAIDA) {
      // Con la base sana pero la bandeja rota dos pasadas seguidas, la guardia está ciega para los S1/S2: se dice.
      await alertarOperador('guardia.sin_vista', {
        error: `La guardia no pudo armar la bandeja de escalaciones: ${bandejaError.slice(0, 160)}`,
        codigo: 'guardia_bandeja_fallo',
      });
    }

    // A3 (ronda 19): histéresis. UN sondeo fallido (timeout de 8 s, arranque en frío) no avisa ni marca la app caída; hacen
    // falta dos seguidos (la racha vive en el detalle del latido). `cual` (desde cuándo) va en la huella del aviso: una
    // caída que vuelve y cae de nuevo dentro de la hora es OTRA alarma, y el piso de 1 h de alerta.ts no la silencia.
    const dApp = decidirApp(previo, medicion.app === 'caido', ahoraIso);
    if (medicion.app === 'caido' && !dApp.caida) medicion.app = null;
    let appAvisada = dApp.racha === 0 ? false : previo.appAvisada;
    if (dApp.avisar) {
      appAvisada = await alertarOperador('guardia.app_sin_respuesta', {
        error: 'La guardia no obtuvo respuesta válida de /api/health por la URL pública en dos sondeos seguidos.',
        codigo: 'guardia_app_sin_respuesta',
        cual: `desde=${dApp.desde}`,
      });
    }
    estadoNuevo = { ...estadoNuevo, rachaApp: dApp.racha, appCaidaDesde: dApp.desde, appAvisada };
    // A2: un health que contestó algo que NO es JSON de health (firewall, 404, mantenimiento) deja la app sin medir; se dice.
    if (sondeoCiego(sondeo)) {
      await alertarOperador('guardia.app_sin_medicion', {
        error: 'La guardia obtuvo una respuesta que no es el JSON de /api/health (firewall, URL mal puesta o mantenimiento): la app no se está midiendo.',
        codigo: 'guardia_app_sin_medicion',
        status: String(sondeo.httpStatus),
      });
    }
    try {
      Object.assign(medicion, componentesDesdeLatidos(await detalleLatidos(inicio), correoConfigurado()));
    } catch (e) {
      logger.warn('cron.guardia.latidos_ilegibles', { err: e instanceof Error ? e.message : String(e) });
    }
    // B2: en paralelo (cada escritura está acotada a ~9.5 s: en serie, con la base lenta, cinco pasaban de maxDuration).
    const escritas = await Promise.all(COMPONENTES_ESTADO.map(async (c) => {
      const m = medicion[c];
      return m === null ? true : registrarEstado(c, m);
    }));
    const sinEscribir = escritas.filter((ok) => !ok).length;
    memoriaDeEstado.guardar(estadoNuevo);

    if (baseInalcanzable) {
      await registrarLatido('guardia', 'fallo', { ...estadoNuevo, error: bandejaError!.slice(0, 200), codigo: 'guardia_base_inalcanzable' });
      return NextResponse.json({ corrio: false, error: 'base inalcanzable', codigo: 'guardia_base_inalcanzable' }, { status: 500 });
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

    const parcial = cortadoPorReloj || bandejaError !== null || sinEscribir > 0 || (mantenimiento !== undefined && 'error' in mantenimiento);
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
