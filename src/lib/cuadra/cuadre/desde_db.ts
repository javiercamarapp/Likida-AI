// Cuadre determinístico a partir del estado en la DB (viaje + gastos + config).
// Fuente única de verdad del cuadre; la usan las tools del agente Y la guardia
// determinística del processor (para no depender de que el LLM llame la tool).

import { cuadrarViaje } from './engine';
import { getViaje, getGastos } from '../repo';
import { getConfig } from '../config';
import type { Liquidacion } from '@/types/cuadra';

export async function cuadrarDesdeDB(tenantId: string, viajeId: string): Promise<Omit<Liquidacion, 'id' | 'creadaEn'>> {
  const [viaje, gastos, config] = await Promise.all([
    getViaje(viajeId, tenantId),
    getGastos(viajeId, tenantId),
    getConfig(tenantId),
  ]);
  if (!viaje) throw new Error('viaje no encontrado');
  const hoy = new Date();
  const fechaMax = hoy.toISOString().slice(0, 10);
  const inicio = viaje.fechaInicio ? new Date(`${viaje.fechaInicio.slice(0, 10)}T00:00:00Z`) : hoy;
  const fechaMin = new Date(inicio.getTime() - config.validacion.fechaToleranciaDiasAntes * 86_400_000).toISOString().slice(0, 10);
  return cuadrarViaje({
    viajeId,
    anticipo: viaje.anticipo,
    gastos,
    politica: config.politica,
    ruta: viaje.destino,
    empresaRfc: config.empresa.rfc,
    rfcsAdicionales: config.empresa.rfcsAdicionales,
    hidrocarburos: config.hidrocarburos,
    estimulos: config.estimulos,
    fechaMin,
    fechaMax,
  });
}
