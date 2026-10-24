import { NextResponse } from 'next/server';
import { correrWorkerCartaPorte, type ResultadoWorker } from '@/lib/likida/carta_porte_docs/worker';
import { depsWorkerReales } from '@/lib/likida/carta_porte_docs/worker_deps';
import { correrWorkerEnvios, resultadoEnviosVacio, type ResultadoEnvios } from '@/lib/likida/carta_porte_docs/worker_envios';
import { depsEnviosReales } from '@/lib/likida/carta_porte_docs/worker_envios_deps';
import { leerInterruptor, type NombreInterruptor } from '@/lib/likida/interruptores';
import { appUrl } from '@/lib/env';
import { logger } from '@/lib/logger';
import { codigoDeError } from '@/lib/observability/sentry';
import { alertarOperador } from '@/lib/observability/alerta';
import { puertaCron, registrarLatido, type EstadoLatido } from '@/lib/admin/salud';
import { conRelojDuro } from '../_reloj_duro';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Una extracción con IA tarda decenas de segundos y la pasada procesa varias: el reloj de la corrida corta
// ANTES del claim de cada documento, y el techo duro la saca por la puerta si un motor se cuelga.
export const maxDuration = 120;

/** Margen para el latido y la respuesta dentro del `maxDuration`. */
const MARGEN_MS = 15_000;

// ═══════════════════════════════════════════════════════════════════════════
// EL CRON DE LA BANDEJA DE CARTA PORTE (0640-0642, Agente 3).
//
// Cada 5 minutos: extrae los documentos que quedaron «recibidos» (la petición que los recibió no alcanzó el
// reloj), los de lease vencido y los de fallo reintentable (con espera creciente y tope de 5 intentos), y avisa a
// la oficina UNA vez por documento cuando uno que entró por correo trae bloqueos o lectura poco segura, o cuando
// uno agotó sus intentos. Todo el trabajo vive en `lib/likida/carta_porte_docs/worker.ts`; esto es la puerta
// (secreto), las palancas (global y `agente:carta_porte`, ambas fail-closed: este cron le ESCRIBE a la oficina y
// le paga al modelo) y el latido en TODO camino de salida.
//
// SEGUNDA PASADA, MISMO CRON (T-A3-28): con el reloj que sobre de la extracción corre `worker_envios.ts`, que SUBE al TMS del
// cliente los documentos que la oficina aprobó (o los deja `listo` para descarga manual si la flota no tiene conector). Tiene
// su propia palanca fail-closed, `agente:carta_porte_salida_tms`: apagada o ilegible, la extracción sigue y solo la salida se
// salta. Un fallo de la salida no tumba lo ya extraído: queda en el latido como `parcial` y alerta al operador.
// ═══════════════════════════════════════════════════════════════════════════

function ilegible(interruptor: NombreInterruptor) {
  return {
    corrio: false,
    error: `No se pudo leer el interruptor ${interruptor}: no se corre sin saber si está apagado.`,
    codigo: 'interruptor_ilegible',
    interruptor,
  };
}

interface SalidaPasada {
  parcial: boolean;
  /** Para el latido: solo cifras. */
  resumen: Record<string, unknown>;
  /** Para la respuesta: cifras y los primeros fallos. */
  respuesta: Record<string, unknown>;
}

/** La pasada de envíos al TMS tras la extracción. Nunca lanza: lo que falle aquí no debe borrar lo que la extracción ya hizo. */
async function correrSalida(venceEn: number): Promise<SalidaPasada> {
  const palanca = await leerInterruptor('agente:carta_porte_salida_tms');
  if (palanca === 'apagado') {
    logger.warn('cron.carta_porte_docs.salida_saltada', { interruptor: 'agente:carta_porte_salida_tms' });
    return { parcial: false, resumen: { corrio: false, saltado: 'apagada' }, respuesta: { corrio: false, saltado: 'interruptor agente:carta_porte_salida_tms' } };
  }
  if (palanca === 'ilegible') {
    // Fail-closed: sin saber si está apagada no se sube nada. La extracción ya corrió; esto deja el latido en `parcial`.
    return { parcial: true, resumen: { corrio: false, codigo: 'interruptor_ilegible' }, respuesta: ilegible('agente:carta_porte_salida_tms') };
  }
  try {
    const e = await conRelojDuro(
      correrWorkerEnvios(depsEnviosReales(), { venceEn }),
      venceEn,
      (): ResultadoEnvios => ({ ...resultadoEnviosVacio(), errores: 1, fallos: ['el reloj duro cortó la pasada de envíos'] }),
    );
    const { fallos, ...cifras } = e;
    logger.info('cron.carta_porte_docs.salida_ok', { ...cifras, fallos: fallos.length });
    // El circuito abierto y la credencial caducada ya alertaron al operador desde el motor; aquí solo cuentan como «no limpio».
    const parcial = e.errores > 0 || e.alertasFallidas > 0 || e.circuitosAbiertos > 0 || e.credencialesCaducadas > 0 || e.cortadosPorReloj > 0 || e.sinMigracion;
    // Lo que mira el panel de salud interno (T-A3-38): cuántos envíos siguen esperando y si el circuito del TMS está abierto.
    const observables = { envios_pendientes: e.pendientesReque + e.enEsperaManual + e.reintentos + e.soltados, circuito_tms_abierto: e.circuitosAbiertos > 0 };
    return { parcial, resumen: { corrio: true, ...cifras, ...observables, fallos: fallos.length }, respuesta: { corrio: true, ...cifras, fallos: fallos.slice(0, 20) } };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    const codigo = codigoDeError(err);
    logger.error('cron.carta_porte_docs.salida_fallo', { error, codigo });
    await alertarOperador('cron.carta_porte_docs.salida', { error, codigo });
    return { parcial: true, resumen: { corrio: false, error, codigo }, respuesta: { corrio: false, error, codigo } };
  }
}

export async function GET(req: Request) {
  // A37-S09-06: el reloj arranca ANTES del prólogo (puerta, interruptores): `maxDuration` corre desde que Vercel
  // invoca, no desde que termina la lectura de la base.
  const entrada = Date.now();
  const puerta = await puertaCron('carta-porte-docs', req, 'La bandeja de Carta Porte no se procesa sola sin él.');
  if (puerta) return puerta;

  for (const interruptor of ['global', 'agente:carta_porte'] as const) {
    const estado = await leerInterruptor(interruptor);
    if (estado === 'ilegible') {
      await registrarLatido('carta-porte-docs', 'fallo', { codigo: 'interruptor_ilegible' });
      return NextResponse.json(ilegible(interruptor), { status: 500 });
    }
    if (estado === 'apagado') {
      logger.warn('cron.carta_porte_docs.saltado', { interruptor });
      await registrarLatido('carta-porte-docs', 'saltado', { interruptor });
      return NextResponse.json({ corrio: false, saltado: `interruptor ${interruptor}` });
    }
  }

  let latido: { estado: EstadoLatido; detalle: Record<string, unknown> } = { estado: 'fallo', detalle: { codigo: 'corrida_sin_cerrar' } };
  try {
    const venceEn = entrada + maxDuration * 1000 - MARGEN_MS;
    const r = await conRelojDuro(
      correrWorkerCartaPorte(depsWorkerReales(), { venceEn, urlBandeja: `${appUrl()}/dashboard/carta-porte/documentos` }),
      venceEn,
      (): ResultadoWorker => ({
        pendientes: 0, procesados: 0, divididos: 0, fallidos: 0, yaTomados: 0, errores: 1, cortadosPorReloj: 0, paradaPorPresupuesto: false, omitidosPorPresupuesto: 0,
        paradaPorFallosSeguidos: false, agotados: 0, zombisCerrados: 0, divisionesAvisadas: 0, hallazgos: 0, avisosEnviados: 0, avisosEnCola: 0, avisosFallidos: 0,
        avisosPerdidos: 0, sinTelefono: 0, avisosSinMigracion: false, fallos: ['el reloj duro cortó la pasada'],
      }),
    );

    const salida = await correrSalida(venceEn);

    // «Parcial» = trabajo que NO terminó o que falló: ni un «ok» limpio ni un «fallo» total.
    const parcial = salida.parcial || r.errores > 0 || r.fallidos > 0 || r.avisosFallidos > 0 || r.cortadosPorReloj > 0
      || r.paradaPorPresupuesto || r.paradaPorFallosSeguidos || r.avisosSinMigracion
      // M3 (ronda 15): un zombi cerrado es trabajo que se perdió (cinco intentos interrumpidos): no es un «ok» limpio.
      || r.zombisCerrados > 0;
    const { fallos, ...cifras } = r;
    logger.info('cron.carta_porte_docs.ok', { ...cifras, fallos: fallos.length });
    latido = { estado: parcial ? 'parcial' : 'ok', detalle: { ...cifras, fallos: fallos.length, envios: salida.resumen } };
    if (r.paradaPorFallosSeguidos) {
      await alertarOperador('cron.carta_porte_docs', {
        error: 'El modelo de extracción falló varios documentos seguidos. La pasada se detuvo; los documentos siguen en la bandeja y se reintentan con espera.',
        codigo: 'cp_modelo_caido',
      });
    }
    return NextResponse.json({ corrio: true, ...cifras, fallos: fallos.slice(0, 20), envios: salida.respuesta });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    const codigo = codigoDeError(e);
    logger.error('cron.carta_porte_docs.fallo', { error, codigo });
    await alertarOperador('cron.carta_porte_docs', { error, codigo });
    latido = { estado: 'fallo', detalle: { error, codigo } };
    return NextResponse.json({ corrio: false, error, codigo }, { status: 500 });
  } finally {
    // En `finally`: un motor que lanza o una respuesta que no se serializa no deja el cron «sin cerrar».
    await registrarLatido('carta-porte-docs', latido.estado, latido.detalle);
  }
}
