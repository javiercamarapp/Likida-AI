// Cuadre determinístico a partir del estado en la DB (viaje + gastos + config).
// Fuente única de verdad del cuadre; la usan las tools del agente Y la guardia
// determinística del processor (para no depender de que el LLM llame la tool).

import { cuadrarViaje } from './engine';
import { ventanaDelViaje } from './fecha_dudosa';
import { getViaje, getGastos, getOperador, getAcumuladoCombustible } from '../repo';
import { getConfig } from '../config';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
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
  // AUDITORÍA 12, MEDIO (fiscal): `operadorRfc` no tenía productor — la rama
  // buena de RLISR 57 (viático timbrado al RFC del operador, trabajador
  // subordinado) era inalcanzable y todo viático a su nombre caía en 'revisar'.
  // El RFC vive en operador.rfc (mig. 0080); null = no capturado, y el motor
  // ya maneja ese caso con el aviso honesto en vez de quitar la deducción.
  const operador = viaje.operadorId
    ? await getOperador(viaje.operadorId, tenantId).catch(() => null)
    : null;
  const operadorRfc = operador?.rfc ?? undefined;

  // ── RFA 2026 regla 2.9 — la facilidad del 15% (deber ser completo) ────────
  // El motor necesita tres insumos del EJERCICIO, no de este viaje:
  //   1. ¿la flota declaró dedicación exclusiva Y régimen elegible? (config)
  //   2. el total pagado por combustible en el ejercicio (la base del 15%)
  //   3. el efectivo ya corrido ANTES de esta liquidación (el contador previo)
  // Los tres se calculan aquí —el motor es puro— con el mismo patrón de
  // agregación del resto del archivo.
  const f15 = config.facilidadCombustibleEfectivo;
  const facilidad15 = (f15 && f15.dedicacionExclusivaCarga !== undefined && f15.regimenElegible !== undefined)
    ? (f15.dedicacionExclusivaCarga === true && f15.regimenElegible === true)
    : undefined;
  // AUDITORÍA 14, MEDIO: el ejercicio es el de los COMPROBANTES, no el del
  // proceso — una liquidación de diciembre cerrada en enero declaraba todo el
  // diésel en efectivo NO deducible contra un tope de $0 (año equivocado).
  // El ancla es la fecha del viaje; los gastos sin fecha no pueden anclar.
  const anioEjercicio = String(
    (viaje.fechaInicio ?? gastos.find((g) => g.fecha)?.fecha ?? new Date().toISOString()).slice(0, 4),
  );
  const clavesCombustible = config.hidrocarburos?.claves ?? [];
  // AUDITORÍA 14, MEDIO: se REUSA getAcumuladoCombustible (el mismo que usa la
  // tool de periodo) con las claves del SAT — una sola barrida del ejercicio,
  // no dos consultas duplicadas con criterios que podían divergir.
  //
  // Best-effort a propósito: el contador del 15% es CONTEXTO valioso, no un
  // requisito para cerrar un viaje. Un fallo aquí no puede tumbar la
  // liquidación (mismo criterio que la tool de periodo en tools.ts) — el motor
  // recibe ceros y la rama 'sin datos del ejercicio' marca el efectivo para
  // revisar, que es el fail-cerrado honesto.
  let totalesEjercicio = { efectivo: 0, totalCombustible: 0 };
  try {
    totalesEjercicio = await getAcumuladoCombustible(tenantId, Number(anioEjercicio), clavesCombustible);
  } catch (e) {
    logger.warn('desde_db.contador_15_no_disponible', { tenant: tenantId, err: e instanceof Error ? e.message : String(e) });
  }
  // El efectivo PREVIO excluye los gastos de ESTE viaje (los está procesando
  // el motor; sumarlos doblaría el contador).
  const efectivoDeEsteViaje = gastos
    .filter((g) => g.formaPago === '01' && (g.concepto === 'diesel' || clavesCombustible.includes(g.claveProdServ ?? '')))
    .reduce((s, g) => s + Number(g.monto ?? 0), 0);
  const efectivoPrevEjercicio = Math.max(0, totalesEjercicio.efectivo - efectivoDeEsteViaje);
  const totalCombustibleEjercicio = totalesEjercicio.totalCombustible;

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
    operadorRfc,
    facilidad15,
    totalCombustibleEjercicio,
    efectivoPrevEjercicio,
    // El motor es puro y no lee el reloj: la fecha se le inyecta aquí, que es
    // el borde con el mundo. Sin esto el aviso de "ticket por facturar" nunca
    // correría en producción aunque sus pruebas estén verdes.
    hoy,
  });
}
