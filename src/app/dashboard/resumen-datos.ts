import {
  getKpis, getLiquidacionesPorDia, getDineroObservadoPorTipo, getHechosSolos, getGastoPorSemana, contarEscalados,
} from '@/lib/likida/analytics';
import { getEstadoCartaPorte } from '@/lib/likida/carta_porte_datos';
import { hoyMx } from '@/lib/formato';
import { ahoraMs } from '@/lib/saludo';
import {
  cartaPorteCompletas, diasParaSemanas, peajesDeGasto, semanasDeSerie, SEMANAS_PEAJES, type DatosResumen, type RangoResumen,
} from './resumen-modelo';

export * from './resumen-modelo';

// LECTOR del Resumen v2: SOLO usa lectores que ya existen (ninguna consulta propia). Cada lectura cae a `null` POR SEPARADO
// (null ≠ 0). Solo para componentes de servidor: la lógica pura y los tipos viven en `resumen-modelo.ts`.

const ventanaDias = (r: RangoResumen): number | undefined => (r === '7' ? 7 : r === '30' ? 30 : undefined);

async function seguro<T>(f: () => Promise<T>): Promise<T | null> {
  try { return await f(); } catch { return null; }
}

export async function leerDatosResumen(tenantId: string, rango: RangoResumen, veDinero: boolean): Promise<DatosResumen> {
  const hoy = hoyMx(new Date(ahoraMs()));
  const [kpis, peajes, cartaPorte, cierres, porTipo, hechos, escalados] = await Promise.all([
    seguro(() => getKpis(tenantId, ventanaDias(rango))),
    veDinero ? seguro(async () => ({ total: peajesDeGasto(await getGastoPorSemana(tenantId, SEMANAS_PEAJES[rango], hoy)), semanas: SEMANAS_PEAJES[rango] })) : Promise.resolve(null),
    seguro(async () => cartaPorteCompletas(await getEstadoCartaPorte(tenantId))),
    seguro(async () => semanasDeSerie(await getLiquidacionesPorDia(tenantId, diasParaSemanas(hoy), hoy), hoy)),
    veDinero ? seguro(() => getDineroObservadoPorTipo(tenantId)) : Promise.resolve(null),
    seguro(() => getHechosSolos(tenantId, 5)),
    seguro(() => contarEscalados(tenantId)),
  ]);
  return { rango, hoy, veDinero, kpis, peajes, cartaPorte, cierres, porTipo, hechos, escalados };
}
