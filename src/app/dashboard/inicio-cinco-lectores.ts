import { unstable_cache } from 'next/cache';
import { puedeVerArea } from '@/lib/auth/visibilidad';
import { ultimasCorridas, type CorridaRegistrada } from '@/lib/likida/agentes/corridas';
import { contarViajes } from '@/lib/likida/analytics';
import { logger } from '@/lib/logger';
import { leerCifrasPesosCincoAgentes } from './cinco-agentes-cifras';
import { cifrasSinDato, type CifrasPesosCincoAgentes } from './cinco-agentes-cifras-modelo';
import { FICHAS_CINCO_AGENTES } from './inicio-cinco-fichas';

// ═══════════════════════════════════════════════════════════════════════════
// LECTORES DEL INICIO v2 DE `cinco_agentes` (solo servidor). Reutilizan lectores que ya existen; ninguno consulta dinero de las
// tablas internas. La lectura de pesos es pesada (hasta tres meses de archivos IAVE): cache corto por flota, y un fallo NUNCA se cachea.
// ═══════════════════════════════════════════════════════════════════════════

export const SEGUNDOS_CACHE_PESOS = 120;

export interface PesosLeidos {
  cifras: CifrasPesosCincoAgentes;
  /** Cuándo se leyó de verdad (aunque venga del cache): alimenta «actualizado hace …». */
  leidoEn: string;
}

class LecturaFallida extends Error {}

async function leerPesos(tenantId: string, rol: string): Promise<PesosLeidos | null> {
  const cifras = await leerCifrasPesosCincoAgentes(tenantId, rol);
  if (cifras === null) return null;
  // Un fallo de lectura no entra al cache: «Reintentar» debe volver a leer, no repetir el fallo por dos minutos.
  if (cifras.importeDecena.reintentar || cifras.extemporaneos.reintentar) throw new LecturaFallida();
  return { cifras, leidoEn: new Date().toISOString() };
}

// Mismo guard que `lib/admin/negocio.ts`: fuera de Next (pruebas, scripts) `unstable_cache` lanza.
const leerPesosConCache: (tenantId: string, rol: string) => Promise<PesosLeidos | null> =
  process.env.NEXT_RUNTIME === 'nodejs'
    ? unstable_cache(leerPesos, ['inicio-cinco-pesos'], { revalidate: SEGUNDOS_CACHE_PESOS })
    : leerPesos;

/**
 * Las cifras en pesos del Inicio. `null` = no corresponde (rol sin dinero o flota sin perfil): la puerta está ANTES del cache y
 * dentro del lector de #777. Nunca lanza: un fallo es «Sin dato» con `reintentar`.
 */
export async function leerPesosInicio(tenantId: string, rol: string): Promise<PesosLeidos | null> {
  if (!puedeVerArea(rol, 'dinero')) return null;
  try {
    return await leerPesosConCache(tenantId, rol);
  } catch (e) {
    if (!(e instanceof LecturaFallida)) logger.warn('inicio_cinco.pesos', { tenant: tenantId, err: e instanceof Error ? e.name : 'desconocido' });
    return { cifras: cifrasSinDato('No se pudo leer el estado de cuenta.', true), leidoEn: new Date().toISOString() };
  }
}

/** La última corrida de cada agente que registra corridas. `null` = la lectura falló; `undefined` = no hay corridas. */
export async function leerUltimasCorridas(tenantId: string): Promise<Record<string, CorridaRegistrada | null | undefined>> {
  const pares = await Promise.all(FICHAS_CINCO_AGENTES.map(async (f) => {
    if (!f.corridas) return [f.clave, undefined] as const;
    try { return [f.clave, (await ultimasCorridas(tenantId, f.corridas, 1))[0]] as const; } catch { return [f.clave, null] as const; }
  }));
  return Object.fromEntries(pares);
}

/** Viajes en curso = abiertos (sin cerrar ni liquidar). `null` = no se pudo contar. */
export async function leerViajesEnCurso(tenantId: string): Promise<number | null> {
  try { return await contarViajes(tenantId, ['abierto']); } catch { return null; }
}
