// ═══════════════════════════════════════════════════════════════════════════
// ORÁCULO #1 — El cuadre balancea: anticipo − gastos válidos = diferencia.
//
// NO recalcula con fórmula propia (eso probaría el motor contra sí mismo):
// llama a la MISMA `cuadrarDesdeDB` de producción sobre los datos que el
// agente Operador metió, y compara contra lo que la DB terminó guardando en
// `liquidacion`. Cualquier diferencia es un bug del pipeline, no del cuadre.
// ═══════════════════════════════════════════════════════════════════════════

import { supabaseAdmin } from '@/lib/supabase/admin';
import { cuadrarDesdeDB } from '@/lib/likida/cuadre/desde_db';
import type { VeredictoOraculo } from '../config.qa';

const cerca = (a: number, b: number) => Math.abs(a - b) < 0.005;

export async function oraculoCuadreBalancea(
  tenantId: string,
  viajeId: string,
  opts: {
    /** ¿El escenario espera que exista una liquidación? (false = cerrar aquí
     *  sería el bug — p. ej. "ya subí todo" sin un solo comprobante). */
    esperaLiquidacion: boolean;
    /** Si viene: cuántas diferencias `sobre_politica` y con qué exceso total. */
    esperaSobrePolitica?: { cuantas: number; excesoTotal: number };
  },
): Promise<VeredictoOraculo> {
  const nombre = 'cuadre_balancea (#1)';
  let fila: Record<string, unknown> | null;
  try {
    const { data, error } = await supabaseAdmin()
      .from('liquidacion')
      .select('total_comprobado, total_anticipo, diferencia, estatus, diferencias')
      .eq('tenant_id', tenantId)
      .eq('viaje_id', viajeId)
      .maybeSingle();
    if (error) {
      return { oraculo: nombre, estado: 'no_verificado', esperado: 'leer liquidacion', real: `error de lectura: ${error.message}` };
    }
    fila = data;
  } catch (e) {
    return { oraculo: nombre, estado: 'no_verificado', esperado: 'leer liquidacion', real: String(e) };
  }

  if (!opts.esperaLiquidacion) {
    // El bug sería que EXISTA: un cierre sin comprobantes deja el anticipo
    // entero en contra del chofer, irreversible (triggers 0036/0037).
    return fila === null
      ? { oraculo: nombre, estado: 'ok', esperado: 'sin liquidación (no debe cerrar)', real: 'sin liquidación' }
      : {
          oraculo: nombre, estado: 'fallo',
          esperado: 'sin liquidación (no debe cerrar sin comprobantes)',
          real: { total_comprobado: fila.total_comprobado, diferencia: fila.diferencia, estatus: fila.estatus },
          detalle: 'el sistema cerró una liquidación con cero comprobantes',
        };
  }

  if (fila === null) {
    return { oraculo: nombre, estado: 'fallo', esperado: 'liquidación emitida', real: 'sin fila en liquidacion' };
  }

  const comprobado = Number(fila.total_comprobado);
  const anticipo = Number(fila.total_anticipo);
  const diferencia = Number(fila.diferencia);

  // (1) La fila es internamente consistente: anticipo − comprobado = diferencia.
  if (!cerca(anticipo - comprobado, diferencia)) {
    return {
      oraculo: nombre, estado: 'fallo',
      esperado: `diferencia = ${(anticipo - comprobado).toFixed(2)} (anticipo − comprobado)`,
      real: `diferencia = ${diferencia.toFixed(2)}`,
      detalle: 'la fila de liquidacion no balancea consigo misma',
    };
  }

  // (2) La MISMA función de producción, recalculada ahora, coincide con lo
  //     persistido — si no, algo cambió los datos después del cierre.
  try {
    const recalc = await cuadrarDesdeDB(tenantId, viajeId);
    if (!cerca(recalc.totalComprobado, comprobado) || !cerca(recalc.totalAnticipo, anticipo) || !cerca(recalc.diferencia, diferencia)) {
      return {
        oraculo: nombre, estado: 'fallo',
        esperado: { totalComprobado: recalc.totalComprobado, totalAnticipo: recalc.totalAnticipo, diferencia: recalc.diferencia },
        real: { totalComprobado: comprobado, totalAnticipo: anticipo, diferencia },
        detalle: 'cuadrarDesdeDB recalculado ≠ liquidacion persistida',
      };
    }
  } catch (e) {
    return { oraculo: nombre, estado: 'no_verificado', esperado: 'recalcular con cuadrarDesdeDB', real: String(e) };
  }

  // (3) La política disparó exactamente lo esperado (el ataque del ±$1).
  if (opts.esperaSobrePolitica) {
    const difs = (fila.diferencias as Array<{ tipo?: string; monto?: number }> | null) ?? [];
    const sobre = difs.filter((d) => d.tipo === 'sobre_politica');
    const exceso = Math.round(sobre.reduce((s, d) => s + Number(d.monto ?? 0), 0) * 100) / 100;
    const { cuantas, excesoTotal } = opts.esperaSobrePolitica;
    if (sobre.length !== cuantas || !cerca(exceso, excesoTotal)) {
      return {
        oraculo: nombre, estado: 'fallo',
        esperado: `${cuantas} sobre_politica con exceso $${excesoTotal.toFixed(2)}`,
        real: `${sobre.length} sobre_politica con exceso $${exceso.toFixed(2)}`,
        detalle: 'el borde del tope (±$1) no se marcó como debía',
      };
    }
  }

  return {
    oraculo: nombre, estado: 'ok',
    esperado: `anticipo − comprobado = diferencia (y recalculado coincide)`,
    real: { totalComprobado: comprobado, totalAnticipo: anticipo, diferencia },
  };
}
