import { NextResponse } from 'next/server';
import { depsReales, sincronizarTms, type ResumenSincronizacion } from '@/lib/likida/conectores/tms/sincronizar';
import { leerInterruptor } from '@/lib/likida/interruptores';
import { logger } from '@/lib/logger';
import { codigoDeError } from '@/lib/observability/sentry';
import { alertarOperador } from '@/lib/observability/alerta';
import { puertaCron, registrarLatido } from '@/lib/admin/salud';
import { conRelojDuro } from '../_reloj_duro';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Cada flota con el conector activo hace un login y, por recurso, un puñado de páginas de 15 s como tope; la corrida
// se corta por reloj (`venceEn`) ANTES de abrir otra flota o recurso, y el techo duro la saca por la puerta si algo se cuelga.
export const maxDuration = 120;

/** Margen para el latido y la respuesta dentro del `maxDuration`. */
const MARGEN_MS = 15_000;

// ═══════════════════════════════════════════════════════════════════════════
// EL CRON DEL SINCRONIZADOR DEL SISTEMA DE TRANSPORTE DEL CLIENTE (T-TMS-12).
//
// Cada 10 minutos lee, SOLO LEE, del sistema de transporte de cada flota que lo tenga conectado, probado y con mapeo
// activo, y entrega a las puertas existentes de los agentes (viajes, liquidaciones, peajes, posiciones). El trabajo
// vive en `conectores/tms/sincronizar.ts`; esto es la puerta (secreto), la palanca global (fail-closed) y el latido
// en TODO camino de salida.
//
// OPT-IN: sin una flota configurada el cron contesta `flotas: 0` y no llama a nadie. Que una flota entre es decisión de
// quien captura la credencial, la prueba y activa un mapeo; este cron no activa nada.
//
// No corre en el cron `gps` (≈180 s de sus 300): tiene su propia cadencia y su propio reloj.
// ═══════════════════════════════════════════════════════════════════════════

function ilegible(interruptor: string) {
  return {
    corrio: false,
    error: 'No se pudo leer el interruptor: no se corre sin saber si está apagado.',
    codigo: 'interruptor_ilegible',
    interruptor,
  };
}

const vacio = (): ResumenSincronizacion => ({
  flotas: [], filasPorRecurso: { liquidaciones: 0, peajes: 0, viajes: 0, posiciones: 0 },
  peticiones: 0, renovados401: 0, conError: 1, parciales: 0, sinTurno: 0, alarmas: 0, atrasadas: [],
});

export async function GET(req: Request) {
  const puerta = await puertaCron('tms', req, 'El sincronizador del sistema de transporte no corre sin él.');
  if (puerta) return puerta;

  const global = await leerInterruptor('global');
  if (global === 'ilegible') {
    await registrarLatido('tms', 'fallo', { codigo: 'interruptor_ilegible' });
    return NextResponse.json(ilegible('global'), { status: 500 });
  }
  if (global === 'apagado') {
    logger.warn('cron.tms.saltado', { interruptor: 'global' });
    await registrarLatido('tms', 'saltado', { interruptor: 'global' });
    return NextResponse.json({ corrio: false, saltado: 'interruptor global' });
  }

  try {
    const venceEn = Date.now() + maxDuration * 1000 - MARGEN_MS;
    const r = await conRelojDuro(sincronizarTms(depsReales(), { venceEn }), venceEn, vacio);

    const cuerpo = {
      corrio: true,
      flotas: r.flotas.length,
      filas: r.filasPorRecurso,
      peticiones: r.peticiones,
      renovados401: r.renovados401,
      conError: r.conError,
      parciales: r.parciales,
      sinTurnoPorReloj: r.sinTurno,
      alarmasDeCredencial: r.alarmas,
      flotasAtrasadas: r.atrasadas.length,
      // Por flota y recurso, SIN ninguna credencial ni dato del cliente: solo conteos y frases nuestras.
      detalle: r.flotas.map((f) => ({
        tenantId: f.tenantId,
        credencialRechazada: f.credencialRechazada,
        recursos: f.recursos.map((x) => ({
          recurso: x.recurso, estado: x.estado, leidas: x.leidas, nuevas: x.nuevas, omitidas: x.omitidas, entregadas: x.entregadas,
          rechazadas: x.rechazadas, pendientes: x.pendientes, conflictos: x.conflictos, backlog: x.backlog, aviso: x.aviso, error: x.error,
        })),
      })),
    };
    // «Parcial» = trabajo que NO terminó o que falló: ni un «ok» limpio ni un «fallo» total (los dos mienten).
    // A37-TRANSVERSAL-08: una flota que se queda sin turno y lleva horas sin una lectura exitosa se avisa (el turno ya rota, pero
    // si una flota sigue sin avanzar alguien tiene que verlo). Sin credenciales ni datos del cliente: solo los ids.
    if (r.atrasadas.length > 0) await alertarOperador('cron.tms.flota_atrasada', { flotas: r.atrasadas.slice(0, 20), total: r.atrasadas.length });
    const parcial = r.conError > 0 || r.parciales > 0 || r.sinTurno > 0 || r.alarmas > 0;
    if (parcial) logger.warn('cron.tms.parcial', cuerpo); else logger.info('cron.tms.ok', cuerpo);
    await registrarLatido('tms', parcial ? 'parcial' : 'ok', {
      flotas: cuerpo.flotas, filas: cuerpo.filas, peticiones: r.peticiones, renovados401: r.renovados401,
      conError: r.conError, parciales: r.parciales, sinTurnoPorReloj: r.sinTurno, alarmas: r.alarmas,
    });
    return NextResponse.json(cuerpo);
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    const codigo = codigoDeError(e);
    logger.error('cron.tms.fallo', { error, codigo });
    await alertarOperador('cron.tms', { error, codigo });
    await registrarLatido('tms', 'fallo', { error, codigo });
    return NextResponse.json({ corrio: false, error, codigo }, { status: 500 });
  }
}
