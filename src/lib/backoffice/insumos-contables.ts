import { NO_DISPONIBLE, type Lectura } from './lectura';
import type { GastoMes } from './tipos';

// Insumos que el paquete contable recibe de OTROS lotes del Back-office. Se piden por import dinámico protegido: si el módulo del otro lote
// aún no existe (o falla al cargar), la respuesta honesta es `no_disponible` —«No disponible. No es cero.»—, jamás una lista vacía ni un cero.
// El paquete (`paquete-contable.ts`) no importa nada de esto: recibe los datos por parámetro.

type LectorDeGastos = (periodo: string) => Promise<Lectura<GastoMes[]>>;

/** Gastos del mes del lote C (`getGastosDelMes`). `no_disponible` si el lote C no está o su lectura no existe. */
export async function insumosGastos(periodo: string): Promise<Lectura<GastoMes[]>> {
  try {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore -- el módulo es del lote C; hasta que se fusione puede no existir y ese caso se tolera en tiempo de ejecución
    const m = (await import('./gastos')) as { getGastosDelMes?: LectorDeGastos };
    if (typeof m.getGastosDelMes !== 'function') return NO_DISPONIBLE;
    return await m.getGastosDelMes(periodo);
  } catch {
    return NO_DISPONIBLE;
  }
}
