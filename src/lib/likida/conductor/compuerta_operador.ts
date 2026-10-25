import { logger } from '@/lib/logger';
import type { ConfigConductor } from './config';
import type { ViajeContexto } from './repo';
import { evaluarCompuertaDeViajes, type PuertosConductor } from './ejecutor';
import { leerMuestrasGps, leerSitiosGeometriaDeViajes, leerViajesAbiertosDeTelefono } from './trabajo';

// ═══════════════════════════════════════════════════════════════════════════
// A39-A5-03 — ¿LA UNIDAD DE ESTE OPERADOR ESTÁ DETENIDA? Para los avisos que le llegan por teléfono y no por un viaje de la lista de
// trabajo (la alerta de tope de jornada al operador). Reutiliza la misma compuerta que todo mensaje proactivo al chofer
// (`evaluarCompuertaDeViajes` → `puedeEscribirAlChofer`) sobre CADA viaje abierto del operador: basta una unidad en marcha, sin GPS, sin
// unidad ligada o una lectura fallida para que NO se escriba (fail-closed). La compuerta apagada también es un NO aquí: ese aviso sale
// al 80 % de un tope de jornada, es decir, con la jornada en curso, y «apagada» significa «no hay manera de saber si va rodando».
// No registra coordenadas.
// ═══════════════════════════════════════════════════════════════════════════

export interface PuertosCompuertaOperador {
  viajesAbiertos(tenantId: string, telefono: string): Promise<ViajeContexto[]>;
  gps: Pick<PuertosConductor, 'muestrasUnidad' | 'sitiosDe' | 'senalesConduccion'>;
}

export const puertosCompuertaOperadorReales: PuertosCompuertaOperador = {
  viajesAbiertos: leerViajesAbiertosDeTelefono,
  gps: { muestrasUnidad: leerMuestrasGps, sitiosDe: leerSitiosGeometriaDeViajes },
};

export async function operadorConUnidadDetenida(
  tenantId: string, telefono: string, config: ConfigConductor, ahora: Date,
  p: PuertosCompuertaOperador = puertosCompuertaOperadorReales,
): Promise<{ permitido: boolean; razon: string }> {
  if (config.compuertaMovimientoActiva !== true) return { permitido: false, razon: 'compuerta_de_movimiento_apagada' };
  let viajes: ViajeContexto[];
  try { viajes = await p.viajesAbiertos(tenantId, telefono); } catch (e) {
    logger.warn('conductor.compuerta_operador_lectura_fallo', { err: e instanceof Error ? e.message : String(e) });
    return { permitido: false, razon: 'lectura_fallida' };
  }
  if (viajes.length === 0) return { permitido: false, razon: 'sin_viaje_abierto' };
  if (viajes.some((v) => !v.unidadId)) return { permitido: false, razon: 'sin_unidad' };
  const veredictos = await evaluarCompuertaDeViajes(p.gps, viajes, new Map([[tenantId, config]]), ahora);
  for (const v of viajes) {
    const r = veredictos.get(v.id);
    if (!r) return { permitido: false, razon: 'sin_veredicto' }; // ante la duda, silencio
    if (!r.permitido) return r;
  }
  return { permitido: true, razon: 'detenida' };
}
