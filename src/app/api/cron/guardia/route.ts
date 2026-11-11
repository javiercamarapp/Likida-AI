import { NextResponse } from 'next/server';
import { clasificacionDeGuardia, decidirApp, decidirAvisos, decidirBaseCaida, estadoDeDetalle, estadoTrasAviso, huellaDeClave, memoriaDeEstado, ESTADO_GUARDIA_INICIAL, SONDEOS_FALLIDOS_PARA_CAIDA, type EstadoGuardia } from '@/lib/admin/guardia';
import { COMPONENTES_ESTADO, detalleLatidos, leerLatido, puertaCron, purgarObservabilidad, registrarEstado, registrarLatido, type EstadoLatido } from '@/lib/admin/salud';
import { componentesDesdeHealth, componentesDesdeLatidos, esVentanaDeMantenimiento, medicionVacia, sondearHealth, sondeoCiego } from '@/lib/admin/estado';
import { alertasIaDeDetalle, alertasIaEncendidas, correrAlertasIa } from '@/lib/admin/alertas-ia';
import { lineasAgrupadas } from '@/lib/admin/agrupar-alertas';
import { correrDiagnostico, estadoDiagnosticoDeDetalle, avisoTopeDiagnostico, evaluarQuemaSegura, lineasDeQuemaNueva, resumenQuema, quemaCompacta, quemaDeDetalle, ultimoCambioVisto } from '@/lib/admin/guardia-mejora';
import { leerInterruptor } from '@/lib/likida/interruptores';
import { conRelojDuro } from '../_reloj_duro';
import { appUrl } from '@/lib/env';
import { correoConfigurado } from '@/lib/correo/enviar';
import { logger } from '@/lib/logger';
import { codigoDeError } from '@/lib/observability/sentry';
import { alertarOperador } from '@/lib/observability/alerta';
import { barrerAvisosSeguridad, anonimizarRedEventosSeguridad, type ResultadoBarrido } from '@/lib/seguridad/avisos';

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
    let detallePrevioCrudo: unknown = null;
    try {
      detallePrevioCrudo = (await leerLatido('guardia'))?.detalle;
      previo = estadoDeDetalle(detallePrevioCrudo);
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
    let nuevosParaDiagnostico: Awaited<ReturnType<typeof clasificacionDeGuardia>>['items'] = [];
    let estadoNuevo: EstadoGuardia = { ...previo, rachaBandeja: bandejaError === null ? 0 : previo.rachaBandeja + 1 };
    if (clasificacion === CORTE) {
      cortadoPorReloj = true;
      logger.warn('cron.guardia.cortado_por_reloj', {});
    } else if (clasificacion !== null) {
      const decision = decidirAvisos(clasificacion, previo);
      nuevosParaDiagnostico = decision.nuevos;
      for (const f of clasificacion.fuentesCiegas) {
        logger.warn('cron.guardia.fuente_ciega', { fuente: f.fuente, error: (f.error ?? 'sin detalle').slice(0, 160) });
      }
      if (decision.baseVolvio) {
        await alertarOperador('guardia.base_volvio', { error: 'La base volvió: la guardia vuelve a ver producción.', codigo: 'guardia_base_volvio' });
      }
      let avisoSalio = true;
      if (decision.nuevos.length > 0 || decision.ciegasNuevas.length > 0) {
        const lineas = lineasAgrupadas(decision, { ultimoCambio: await ultimoCambioVisto() });
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

    // ── 4. Seguridad (CT-SEG-11) ───────────────────────────────────────────
    // El barrido de avisos de evento_seguridad cuelga de esta guardia (cada 5 min) en vez de un cron propio: no se agrega un
    // componente al health ni al calendario. APAGADO por omisión (SEGURIDAD_AVISOS=encendido): apagado no toca la base. La
    // anonimización de la huella de red y el user-agent (30 días) corre una vez al día, en la ventana de mantenimiento.
    // Ninguno de los dos puede tumbar la guardia: sus rutinas atrapan todo y, si aun así algo lanza, se dice y se sigue.
    let barridoSeguridad: ResultadoBarrido | null = null;
    let redAnonimizada: number | null | undefined;
    if (Date.now() < vence - 6_000) {
      try {
        barridoSeguridad = await barrerAvisosSeguridad();
        if (esVentanaDeMantenimiento(inicio)) redAnonimizada = await anonimizarRedEventosSeguridad();
      } catch (e) {
        logger.error('cron.guardia.seguridad_fallo', { err: e instanceof Error ? e.message : String(e) });
        barridoSeguridad = { estado: 'error', reclamados: 0, enviados: 0, fallidos: 0 };
      }
    }
    const seguridad = barridoSeguridad && (barridoSeguridad.estado !== 'apagado' || redAnonimizada !== undefined)
      ? { avisos: barridoSeguridad, ...(redAnonimizada !== undefined ? { redAnonimizada } : {}) }
      : undefined;
    const seguridadMal = barridoSeguridad !== null && (barridoSeguridad.estado === 'error' || barridoSeguridad.estado === 'parcial');

    // ── 5. Gobierno de IA (CT-IA-01/05) ────────────────────────────────────
    // Sonda de la llave del proveedor y barrido de topes al 80/100 %, una de cada tres pasadas (cada 15 min). Apagado por
    // omisión (IA_GOBIERNO=encendido: necesita la migración 0990). No lanza; si algo falla se dice y se sigue.
    let gobiernoIa: Awaited<ReturnType<typeof import('@/lib/llm/gobierno').correrGobiernoIa>> | null = null;
    if (Date.now() < vence - 6_000) {
      try {
        const { correrGobiernoIa } = await import('@/lib/llm/gobierno');
        gobiernoIa = await correrGobiernoIa(inicio);
      } catch (e) {
        logger.error('cron.guardia.gobierno_ia_fallo', { err: e instanceof Error ? e.message : String(e) });
        gobiernoIa = { estado: 'error' };
      }
    }
    const gobiernoIaDetalle = gobiernoIa && gobiernoIa.estado !== 'apagado' && gobiernoIa.estado !== 'omitido' ? { gobiernoIa } : undefined;


    // ── 6. Alertas de IA (F16) ─────────────────────────────────────────────
    // «IA sin registro» y «tasa de respaldo alta», cada 15 min, colgadas de esta misma guardia (sin cron nuevo). Apagado
    // por omisión (ALERTAS_IA_GUARDIA=encendido). En las pasadas en que no toca se conserva lo último evaluado para que
    // la campana no parpadee. No lanza.
    const alertasIaPrevias = alertasIaDeDetalle(detallePrevioCrudo);
    let alertasIa: Awaited<ReturnType<typeof correrAlertasIa>> = { estado: 'omitido' };
    if (Date.now() < vence - 6_000) alertasIa = await correrAlertasIa(inicio, alertasIaPrevias);
    const alertasIaVigente = alertasIa.estado === 'ok' ? alertasIa.detalle : alertasIa.estado === 'omitido' && alertasIaEncendidas() ? alertasIaPrevias : null;

    // ── 7. Quema del presupuesto de error (F14-A) ──────────────────────────
    // Dos ventanas sobre los SLO que ya mide la guardia, sin cron nuevo. Sin muestra = `sin_medir` (no alerta ni tranquiliza).
    // Avisa solo la TRANSICIÓN a página. No lanza.
    let quemaDetalle: Record<string, string> | undefined;
    if (Date.now() < vence - 6_000) {
      const ev = await evaluarQuemaSegura();
      if (ev) {
        const nuevas = lineasDeQuemaNueva(ev, quemaDeDetalle(detallePrevioCrudo), await ultimoCambioVisto());
        let aviso = true;
        if (nuevas.length > 0) {
          aviso = await alertarOperador('guardia.quema_slo', {
            codigo: 'guardia_quema_slo', cual: huellaDeClave(nuevas.join('\n')), resumen: resumenQuema(nuevas.length),
            ...Object.fromEntries(nuevas.slice(0, 4).map((l, i) => [`quema_${i + 1}`, l])),
          });
        }
        const compacta = quemaCompacta(ev);
        // Si el aviso no salió, no se anota como página: la siguiente pasada vuelve a intentarlo.
        quemaDetalle = aviso ? compacta : Object.fromEntries(Object.entries(compacta).map(([k, v]) => [k, v === 'pagina' ? 'ninguna' : v]));
      }
    }

    // ── 8. Diagnóstico de solo lectura de las S1/S2 nuevas (F14-C) ─────────
    // APAGADO por omisión (DIAGNOSTICO_ALERTAS=encendido). Tope de US$20 al mes y falla cerrado si el gasto no se puede leer.
    // Solo propone (pieza en Aprobaciones); no ejecuta nada. Avisa una vez al cruzar el tope; la campana lo suma desde el latido.
    let diagnosticoDetalle: Record<string, unknown> | undefined;
    if (Date.now() < vence - 15_000) {
      const d = await correrDiagnostico(nuevosParaDiagnostico, detallePrevioCrudo);
      if (d) {
        diagnosticoDetalle = { diagnostico: d.resultado.detalle, diagnosticadas: d.diagnosticadas };
        if (d.resultado.estado === 'tope' && estadoDiagnosticoDeDetalle(detallePrevioCrudo) !== 'tope') {
          await alertarOperador('guardia.diagnostico_tope', { error: avisoTopeDiagnostico(d.resultado.gastoMesUsd, d.resultado.topeUsd), codigo: 'guardia_diagnostico_tope' });
        }
      }
    }

    const parcial = cortadoPorReloj || alertasIa.estado === 'error' || bandejaError !== null || sinEscribir > 0 || (mantenimiento !== undefined && 'error' in mantenimiento) || seguridadMal || gobiernoIa?.estado === 'error';
    const estado: EstadoLatido = parcial ? 'parcial' : 'ok';
    // `componentes` va en el latido: es lo que lee /estado para el estado ACTUAL (con la hora del propio latido).
    const detalle = { ...estadoNuevo, ...detalleBandeja, componentes: medicion, ...(mantenimiento ? { mantenimiento } : {}), ...(seguridad ? { seguridad } : {}), ...(gobiernoIaDetalle ?? {}), ...(alertasIaVigente ? { alertasIa: alertasIaVigente } : {}), ...(quemaDetalle ? { quema: quemaDetalle } : {}), ...(diagnosticoDetalle ?? {}), ...(cortadoPorReloj ? { cortadoPorReloj } : {}) };
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
