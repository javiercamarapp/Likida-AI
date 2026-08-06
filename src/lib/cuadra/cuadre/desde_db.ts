// Cuadre determinístico a partir del estado en la DB (viaje + gastos + config).
// Fuente única de verdad del cuadre; la usan las tools del agente Y la guardia
// determinística del processor (para no depender de que el LLM llame la tool).

import { cuadrarViaje } from './engine';
import { ventanaDelViaje } from './fecha_dudosa';
import { getViaje, getGastos, getOperador } from '../repo';
import { getConfig } from '../config';
import { traerTodo, conteo } from '../pg';
import { supabaseAdmin } from '@/lib/supabase/admin';
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
  const anioEjercicio = String(new Date().getFullYear());
  const clavesCombustible = config.hidrocarburos?.claves ?? [];
  const [totalesEjercicio] = await Promise.all([
    (async () => {
      const filas = await traerTodo<{ monto: unknown; forma_pago: unknown }>(
        (desde, hasta) => supabaseAdmin()
          .from('gasto')
          .select('monto, forma_pago', conteo(desde))
          .eq('tenant_id', tenantId)
          .gte('fecha', `${anioEjercicio}-01-01`)
          .lte('fecha', `${anioEjercicio}-12-31`)
          .or(`concepto.eq.diesel,clave_prod_serv.in.(${clavesCombustible.join(',')})`)
          .order('id')
          .range(desde, hasta),
        'desde_db.totalCombustibleEjercicio',
      );
      let total = 0, efectivo = 0;
      for (const f of filas) {
        const m = Number(f.monto ?? 0);
        total += m;
        if (f.forma_pago === '01') efectivo += m;
      }
      return { total, efectivo };
    })(),
  ]);
  // El efectivo PREVIO excluye los gastos de ESTE viaje (los está procesando
  // el motor; sumarlos doblaría el contador).
  const efectivoDeEsteViaje = gastos
    .filter((g) => g.formaPago === '01' && (g.concepto === 'diesel' || clavesCombustible.includes(g.claveProdServ ?? '')))
    .reduce((s, g) => s + Number(g.monto ?? 0), 0);
  const efectivoPrevEjercicio = Math.max(0, totalesEjercicio.efectivo - efectivoDeEsteViaje);

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
    totalCombustibleEjercicio: totalesEjercicio.total,
    efectivoPrevEjercicio,
    // El motor es puro y no lee el reloj: la fecha se le inyecta aquí, que es
    // el borde con el mundo. Sin esto el aviso de "ticket por facturar" nunca
    // correría en producción aunque sus pruebas estén verdes.
    hoy,
  });
}
