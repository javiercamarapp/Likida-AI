// ═══════════════════════════════════════════════════════════════════════════
// EL ID DE UNA LIQUIDACIÓN SE DERIVA DE SU VIAJE (auditoría 18, DAT-41).
//
// El PDF se genera ANTES de que la fila exista —hay que subirlo para poder
// guardar su ruta—, así que `tools.ts` armaba el objeto a imprimir con un
// `randomUUID()`. Ese id no era el que `guardar_liquidacion_tx` iba a generar:
// cuando el viaje no trae folio, el papel encabeza «Folio A1B2C3D4» con los
// ocho primeros de un identificador que NO EXISTE en la base. El contralor
// archiva un documento cuyo número no se puede buscar.
//
// Derivarlo del viaje resuelve el orden sin invertirlo: el papel y la fila
// llegan al mismo número sin tener que hablarse. La base impone la misma regla
// con el trigger `liquidacion_id_del_viaje` (migración 0159) y el bloque 131 de
// verificaciones.sql comprueba que las dos mitades coinciden contra Postgres.
//
// Una liquidación por viaje ya era invariante (`liquidacion_viaje_uidx`, 0005),
// así que derivarlo del viaje no colisiona con nada.
// ═══════════════════════════════════════════════════════════════════════════
import { createHash } from 'crypto';

/**
 * El id que la liquidación de este viaje va a tener en la base.
 *
 * Gemelo exacto de `md5(viaje_id::text || ':liquidacion')::uuid` (0159). El
 * `toLowerCase()` no es cosmético: Postgres imprime los uuid en minúsculas y un
 * id que llegue en mayúsculas daría OTRO hash — el mismo desajuste que esto
 * viene a cerrar, con una causa más difícil de ver.
 */
export function idLiquidacionDeViaje(viajeId: string): string {
  const hex = createHash('md5').update(`${viajeId.trim().toLowerCase()}:liquidacion`).digest('hex');
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
}
