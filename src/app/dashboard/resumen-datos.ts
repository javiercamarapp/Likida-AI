import {
  getKpis, getLiquidacionesPorDia, getDineroObservadoPorTipo, getHechosSolos, getGastoPorSemana, contarEscalados, getViajes, getLiquidacionesDeViajes,
} from '@/lib/likida/analytics';
import { getEstadoCartaPorte } from '@/lib/likida/carta_porte_datos';
import { hoyMx } from '@/lib/formato';
import { ahoraMs } from '@/lib/saludo';
import {
  cartaPorteCompletas, diasParaMeses, diasParaSemanas, mesesDeSerie, peajesDeGasto, semanasDeSerie, SEMANAS_PEAJES, type DatosResumen, type RangoResumen, type ViajeReciente,
} from './resumen-modelo';

export * from './resumen-modelo';

// LECTOR del Resumen v2: SOLO usa lectores que ya existen (ninguna consulta propia). Cada lectura cae a `null` POR SEPARADO
// (null ≠ 0). Solo para componentes de servidor: la lógica pura y los tipos viven en `resumen-modelo.ts`.

const ventanaDias = (r: RangoResumen): number | undefined => (r === '7' ? 7 : r === '30' ? 30 : undefined);

async function seguro<T>(f: () => Promise<T>): Promise<T | null> {
  try { return await f(); } catch { return null; }
}

/** Los 5 viajes más recientes de la flota. La diferencia en pesos solo se lee con acceso al dinero (el jefe de tráfico ni la consulta) y es null si el viaje no tiene liquidación. */
async function viajesRecientes(tenantId: string, veDinero: boolean): Promise<ViajeReciente[]> {
  const viajes = await getViajes(tenantId, 5);
  const liqs = veDinero && viajes.length > 0 ? await getLiquidacionesDeViajes(tenantId, viajes.map((v) => v.id)) : [];
  return viajes.map((v) => ({
    id: v.id, folio: v.folio, estatus: v.estatus,
    ruta: v.origen && v.destino ? `${v.origen} → ${v.destino}` : v.origen ?? v.destino,
    diferencia: veDinero ? liqs.find((l) => l.viajeId === v.id)?.diferencia ?? null : null,
  }));
}

export async function leerDatosResumen(tenantId: string, rango: RangoResumen, veDinero: boolean): Promise<DatosResumen> {
  const hoy = hoyMx(new Date(ahoraMs()));
  // UNA lectura diaria cubre las 8 semanas y los 6 meses (se lee la ventana mayor y cada serie se deriva de ella).
  const lecturaDiaria = seguro(() => getLiquidacionesPorDia(tenantId, Math.max(diasParaSemanas(hoy), diasParaMeses(hoy)), hoy));
  const [kpis, peajes, cartaPorte, serieDiaria, porTipo, hechos, escalados, recientes] = await Promise.all([
    seguro(() => getKpis(tenantId, ventanaDias(rango))),
    veDinero ? seguro(async () => ({ total: peajesDeGasto(await getGastoPorSemana(tenantId, SEMANAS_PEAJES[rango], hoy)), semanas: SEMANAS_PEAJES[rango] })) : Promise.resolve(null),
    seguro(async () => cartaPorteCompletas(await getEstadoCartaPorte(tenantId))),
    lecturaDiaria,
    veDinero ? seguro(() => getDineroObservadoPorTipo(tenantId)) : Promise.resolve(null),
    seguro(() => getHechosSolos(tenantId, 5)),
    seguro(() => contarEscalados(tenantId)),
    seguro(() => viajesRecientes(tenantId, veDinero)),
  ]);
  const cierres = serieDiaria ? semanasDeSerie(serieDiaria, hoy) : null;
  const mensuales = serieDiaria ? mesesDeSerie(serieDiaria, hoy) : null;
  return { rango, hoy, veDinero, kpis, peajes, cartaPorte, cierres, mensuales, porTipo, hechos, escalados, recientes };
}
