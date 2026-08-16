// ═══════════════════════════════════════════════════════════════════════════
// ORÁCULO #4 — El ticket post-cierre no altera la liquidación, pero VA a
// huérfanos. Las DOS mitades, porque un gasto que se pierde en silencio es
// peor que uno rechazado con ruido:
//
//   SI viaje.estatus == 'liquidado' Y llega un comprobante nuevo
//   ENTONCES liquidacion.total_comprobado NO cambia
//            Y el comprobante aparece pendiente en comprobante_huerfano
//
// Además sonda el trigger real `trg_gasto_no_tras_liquidar` (mig. 0036):
// un insert directo de gasto sobre el viaje liquidado debe rechazarse con
// SQLSTATE CU001 — el código propio de "llegó tarde" (pg_errores.ts).
// ═══════════════════════════════════════════════════════════════════════════

import { randomUUID } from 'node:crypto';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { contarHuerfanosPendientes } from '@/lib/likida/repo';
import { GASTO_TARDE } from '@/lib/likida/pg_errores';
import { exigirTenantZZZ, type VeredictoOraculo } from '../config.qa';

const cerca = (a: number, b: number) => Math.abs(a - b) < 0.005;

export async function oraculoHuerfanoPostCierre(
  tenantId: string,
  viajeId: string,
  opts: {
    /** Los totales que la liquidación tenía ANTES del ataque. */
    liqSembrada: { totalComprobado: number; totalAnticipo: number; diferencia: number };
    /** El monto del ticket que llegó tarde (para ubicarlo en huérfanos). */
    montoTicket: number;
  },
): Promise<VeredictoOraculo> {
  const nombre = 'huerfano_post_cierre (#4)';
  const db = supabaseAdmin();

  // (1) La liquidación NO cambió.
  try {
    const { data, error } = await db
      .from('liquidacion')
      .select('total_comprobado, total_anticipo, diferencia')
      .eq('tenant_id', tenantId)
      .eq('viaje_id', viajeId)
      .maybeSingle();
    if (error || !data) {
      return { oraculo: nombre, estado: 'no_verificado', esperado: 'leer liquidacion', real: error?.message ?? 'sin fila' };
    }
    const { totalComprobado, diferencia } = opts.liqSembrada;
    if (!cerca(Number(data.total_comprobado), totalComprobado) || !cerca(Number(data.diferencia), diferencia)) {
      return {
        oraculo: nombre, estado: 'fallo',
        esperado: { total_comprobado: totalComprobado, diferencia },
        real: { total_comprobado: data.total_comprobado, diferencia: data.diferencia },
        detalle: 'el comprobante tardío ALTERÓ una liquidación ya emitida',
      };
    }
  } catch (e) {
    return { oraculo: nombre, estado: 'no_verificado', esperado: 'leer liquidacion', real: String(e) };
  }

  // (2) El comprobante quedó VISIBLE en la sala de espera, con su monto.
  try {
    const pendientes = await contarHuerfanosPendientes(tenantId);
    if (pendientes === null) {
      return { oraculo: nombre, estado: 'no_verificado', esperado: 'contar huérfanos', real: 'la consulta falló (null)' };
    }
    const { data, error } = await db
      .from('comprobante_huerfano')
      .select('id, gasto, motivo')
      .eq('tenant_id', tenantId)
      .is('resuelto_en', null);
    if (error) {
      return { oraculo: nombre, estado: 'no_verificado', esperado: 'leer comprobante_huerfano', real: error.message };
    }
    const conMonto = (data ?? []).filter((h) => {
      const g = h.gasto as { monto?: number } | null;
      return g && typeof g.monto === 'number' && cerca(g.monto, opts.montoTicket);
    });
    if (pendientes < 1 || conMonto.length < 1) {
      return {
        oraculo: nombre, estado: 'fallo',
        esperado: `≥1 huérfano pendiente con monto $${opts.montoTicket.toFixed(2)}`,
        real: `${pendientes} pendientes; ${conMonto.length} con ese monto`,
        detalle: 'el comprobante tardío se PERDIÓ en silencio — peor que rechazarlo con ruido',
      };
    }
  } catch (e) {
    return { oraculo: nombre, estado: 'no_verificado', esperado: 'leer huérfanos', real: String(e) };
  }

  // (3) Sonda del trigger 0036: el insert directo sobre el viaje liquidado
  //     se rechaza con CU001, no con cualquier error.
  try {
    await exigirTenantZZZ(db, tenantId);
    const sondaId = randomUUID();
    const { error } = await db.from('gasto').insert({
      id: sondaId,
      tenant_id: tenantId,
      viaje_id: viajeId,
      concepto: 'diesel',
      monto: 1,
    });
    if (!error) {
      await db.from('gasto').delete().eq('id', sondaId).eq('tenant_id', tenantId);
      return {
        oraculo: nombre, estado: 'fallo',
        esperado: `rechazo CU001 (trg_gasto_no_tras_liquidar)`,
        real: 'el gasto ENTRÓ a un viaje liquidado (sonda borrada)',
      };
    }
    if (error.code !== GASTO_TARDE) {
      return {
        oraculo: nombre, estado: 'fallo',
        esperado: `SQLSTATE ${GASTO_TARDE} del trigger 0036`,
        real: `${error.code}: ${error.message}`,
        detalle: 'se rechazó, pero no con el código propio del trigger',
      };
    }
    return {
      oraculo: nombre, estado: 'ok',
      esperado: 'liquidación intacta + huérfano visible + trigger CU001',
      real: `liquidación sin cambio; huérfano pendiente con monto; ${error.code}: ${error.message}`,
    };
  } catch (e) {
    return { oraculo: nombre, estado: 'no_verificado', esperado: 'sondar el trigger 0036', real: String(e) };
  }
}
