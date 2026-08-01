// Cuadre determinístico a partir del estado en la DB (viaje + gastos + config).
// Fuente única de verdad del cuadre; la usan las tools del agente Y la guardia
// determinística del processor (para no depender de que el LLM llame la tool).

import { cuadrarViaje } from './engine';
import { ventanaDelViaje } from './fecha_dudosa';
import { getViaje, getGastos } from '../repo';
import { getConfig } from '../config';
import type { Liquidacion } from '@/types/cuadra';

/**
 * La ventana de un viaje sin cuadrarlo entero.
 *
 * La usa el INTAKE, que necesita saber si la fecha que acaba de leer cuadra con
 * el viaje —para pedirle otra foto al operador mientras todavía tiene el ticket
 * en la mano— y no puede pagar un cuadre completo por cada foto.
 */
export async function ventanaDesdeDB(tenantId: string, viajeId: string) {
  const [viaje, config] = await Promise.all([
    getViaje(viajeId, tenantId),
    getConfig(tenantId),
  ]);
  if (!viaje) return undefined;
  return ventanaDelViaje(
    viaje.fechaInicio, config.validacion.fechaToleranciaDiasAntes, new Date(),
  );
}

export async function cuadrarDesdeDB(tenantId: string, viajeId: string): Promise<Omit<Liquidacion, 'id' | 'creadaEn'>> {
  const [viaje, gastos, config] = await Promise.all([
    getViaje(viajeId, tenantId),
    getGastos(viajeId, tenantId),
    getConfig(tenantId),
  ]);
  if (!viaje) throw new Error('viaje no encontrado');
  // La ventana la calcula `ventanaDelViaje`, que es la MISMA que usa el intake
  // para decidir si le pide otra foto al operador. Calculadas por separado se
  // separan en silencio, y el operador acaba mandando fotos que el cuadre no
  // pedía —o al revés, recibiendo el reproche en el PDF sin que nadie se lo
  // hubiera dicho a tiempo.
  const { fechaMin, fechaMax, hoy } = ventanaDelViaje(
    viaje.fechaInicio, config.validacion.fechaToleranciaDiasAntes, new Date(),
  );
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
    // El motor es puro y no lee el reloj: la fecha se le inyecta aquí, que es
    // el borde con el mundo. Sin esto el aviso de "ticket por facturar" nunca
    // correría en producción aunque sus pruebas estén verdes.
    hoy,
  });
}
