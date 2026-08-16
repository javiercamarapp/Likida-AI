// ═══════════════════════════════════════════════════════════════════════════
// ORÁCULO #3 — Un comprobante = un gasto (dedup).
//
//   count(gasto WHERE tenant_id = t AND img_hash = h) == 1
//
// El índice real es `uq_gasto_img_hash` (mig. 0027), unique(tenant_id,
// img_hash) — POR TENANT, no por viaje. El pre-check del processor mira un
// solo viaje, así que la segunda foto (otro viaje del mismo tenant) tiene
// que chocar contra la BASE. El encargo exige el error EXACTO: la sonda de
// abajo intenta el duplicado con service_role y verifica que Postgres lo
// rechace con `duplicate key value` contra ese índice — no "algún error".
//
// La sonda ESCRIBE (un insert que debe fallar), así que pasa por el guard
// ZZZ antes; si el insert entrara (bug), la fila se borra al instante y el
// oráculo reporta fallo.
// ═══════════════════════════════════════════════════════════════════════════

import { randomUUID } from 'node:crypto';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { exigirTenantZZZ, type VeredictoOraculo } from '../config.qa';

export async function oraculoDedupComprobante(
  tenantId: string,
  /** El viaje al que la segunda foto INTENTÓ entrar. */
  viajeIntentoId: string,
  imgHash: string,
): Promise<VeredictoOraculo> {
  const nombre = 'dedup_comprobante (#3)';
  const db = supabaseAdmin();

  // (1) Exactamente UN gasto con ese hash en todo el tenant.
  let cuantos: number;
  try {
    const { data, error } = await db
      .from('gasto')
      .select('id, viaje_id')
      .eq('tenant_id', tenantId)
      .eq('img_hash', imgHash);
    if (error) {
      return { oraculo: nombre, estado: 'no_verificado', esperado: 'contar gastos por img_hash', real: `error de lectura: ${error.message}` };
    }
    cuantos = data?.length ?? 0;
  } catch (e) {
    return { oraculo: nombre, estado: 'no_verificado', esperado: 'contar gastos por img_hash', real: String(e) };
  }
  if (cuantos !== 1) {
    return {
      oraculo: nombre, estado: 'fallo',
      esperado: '1 gasto con ese img_hash en el tenant',
      real: `${cuantos} gastos`,
      detalle: cuantos === 0 ? 'la primera foto ni siquiera entró' : 'la misma foto entró más de una vez — dinero cobrado doble',
    };
  }

  // (2) La sonda del error exacto: el duplicado se rechaza con
  //     `duplicate key value` contra uq_gasto_img_hash.
  try {
    await exigirTenantZZZ(db, tenantId);
    const sondaId = randomUUID();
    const { error } = await db.from('gasto').insert({
      id: sondaId,
      tenant_id: tenantId,
      viaje_id: viajeIntentoId,
      concepto: 'diesel',
      monto: 1,
      img_hash: imgHash,
    });
    if (!error) {
      // El índice NO existe o no cubre este caso: se limpia la sonda y se
      // reporta el fallo — esto sería un duplicado silencioso en producción.
      await db.from('gasto').delete().eq('id', sondaId).eq('tenant_id', tenantId);
      return {
        oraculo: nombre, estado: 'fallo',
        esperado: `rechazo con 'duplicate key value' (uq_gasto_img_hash)`,
        real: 'el insert duplicado ENTRÓ (sonda borrada)',
      };
    }
    const mensaje = `${error.message} ${('details' in error && error.details) || ''}`;
    const exacto = error.code === '23505' && mensaje.includes('duplicate key value') && mensaje.includes('uq_gasto_img_hash');
    return exacto
      ? {
          oraculo: nombre, estado: 'ok',
          esperado: `rechazo con 'duplicate key value' contra uq_gasto_img_hash`,
          real: `${error.code}: ${error.message}`,
        }
      : {
          oraculo: nombre, estado: 'fallo',
          esperado: `23505 'duplicate key value' contra uq_gasto_img_hash`,
          real: `${error.code}: ${error.message}`,
          detalle: 'se rechazó, pero NO con el error exacto que el dedup promete',
        };
  } catch (e) {
    return { oraculo: nombre, estado: 'no_verificado', esperado: 'sondar el índice único', real: String(e) };
  }
}
