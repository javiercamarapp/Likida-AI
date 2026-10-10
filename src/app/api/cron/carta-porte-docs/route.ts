import { NextResponse } from 'next/server';
import { correrWorkerCartaPorte, type ResultadoWorker } from '@/lib/likida/carta_porte_docs/worker';
import { depsWorkerReales } from '@/lib/likida/carta_porte_docs/worker_deps';
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
// ═══════════════════════════════════════════════════════════════════════════

function ilegible(interruptor: NombreInterruptor) {
  return {
    corrio: false,
    error: `No se pudo leer el interruptor ${interruptor}: no se corre sin saber si está apagado.`,
    codigo: 'interruptor_ilegible',
    interruptor,
  };
}

export async function GET(req: Request) {
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
    const venceEn = Date.now() + maxDuration * 1000 - MARGEN_MS;
    const r = await conRelojDuro(
      correrWorkerCartaPorte(depsWorkerReales(), { venceEn, urlBandeja: `${appUrl()}/dashboard/carta-porte/documentos` }),
      venceEn,
      (): ResultadoWorker => ({
        pendientes: 0, procesados: 0, divididos: 0, fallidos: 0, yaTomados: 0, errores: 1, cortadosPorReloj: 0, paradaPorPresupuesto: false, omitidosPorPresupuesto: 0,
        paradaPorFallosSeguidos: false, agotados: 0, zombisCerrados: 0, divisionesAvisadas: 0, hallazgos: 0, avisosEnviados: 0, avisosEnCola: 0, avisosFallidos: 0,
        avisosPerdidos: 0, sinTelefono: 0, avisosSinMigracion: false, fallos: ['el reloj duro cortó la pasada'],
      }),
    );

    // «Parcial» = trabajo que NO terminó o que falló: ni un «ok» limpio ni un «fallo» total.
    const parcial = r.errores > 0 || r.fallidos > 0 || r.avisosFallidos > 0 || r.cortadosPorReloj > 0
      || r.paradaPorPresupuesto || r.paradaPorFallosSeguidos || r.avisosSinMigracion
      // M3 (ronda 15): un zombi cerrado es trabajo que se perdió (cinco intentos interrumpidos): no es un «ok» limpio.
      || r.zombisCerrados > 0;
    const { fallos, ...cifras } = r;
    logger.info('cron.carta_porte_docs.ok', { ...cifras, fallos: fallos.length });
    latido = { estado: parcial ? 'parcial' : 'ok', detalle: { ...cifras, fallos: fallos.length } };
    if (r.paradaPorFallosSeguidos) {
      await alertarOperador('cron.carta_porte_docs', {
        error: 'El modelo de extracción falló varios documentos seguidos. La pasada se detuvo; los documentos siguen en la bandeja y se reintentan con espera.',
        codigo: 'cp_modelo_caido',
      });
    }
    return NextResponse.json({ corrio: true, ...cifras, fallos: fallos.slice(0, 20) });
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
