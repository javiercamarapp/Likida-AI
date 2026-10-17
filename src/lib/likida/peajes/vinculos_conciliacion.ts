import { logger } from '@/lib/logger';
import { codigoDeError } from '@/lib/observability/sentry';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { acotada } from '../presupuesto';
import { traerTodo, conteo } from '../pg';
import { leerVinculosActivo, guardarVinculos, listarCasetas, type VinculoGuardado } from './datos';
import { vincularPorIcident, type CruceIcident } from './vincular_viaje';
import { desdeTablaViajeLocal, type ViajeFuente, type PosicionConViaje, type RangoFechas } from './viajes_fuente';

// ═══════════════════════════════════════════════════════════════════════════
// T-A2-21 — EL VÍNCULO CRUCE → VIAJE DENTRO DE LA CONCILIACIÓN.
//
// Tras conciliar un desglose, y SOLO si la flota lo activó (depende de tener
// viajes cargados), se liga cada línea con su viaje (Icident si hay posiciones,
// si no unidad+ventana) y se guarda aparte de `desglose_peaje_linea.viaje_id`.
// Recalculable: correrlo de nuevo sobrescribe, nunca duplica. NUNCA lanza: un
// fallo se registra y la ingesta que lo llamó no se entera (queda `fallo`).
// ═══════════════════════════════════════════════════════════════════════════

/** De dónde salen los viajes y las posiciones; por omisión la tabla local `viaje` y ninguna posición (aún sin API). */
export interface FuenteVinculos {
  cargar(tenantId: string, rango: RangoFechas): Promise<{ viajes: ViajeFuente[]; posiciones: PosicionConViaje[] }>;
}

export const fuenteLocal: FuenteVinculos = {
  async cargar(tenantId, rango) {
    const { viajes } = await desdeTablaViajeLocal(tenantId, rango);
    return { viajes, posiciones: [] };
  },
};

export type ResultadoVinculos =
  | { estado: 'apagado' }
  | { estado: 'ok'; lineas: number; ligados: number; ambiguos: number; sinViaje: number; sinUnidad: number; conflictos: number }
  | { estado: 'fallo'; motivo: string };

const MARGEN_DIAS = 1;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

const desplazar = (ymd: string, dias: number): string =>
  new Date(Date.parse(`${ymd}T00:00:00Z`) + dias * 86_400_000).toISOString().slice(0, 10);

/** Calcula y guarda los vínculos de un desglose. No lanza. */
export async function vincularDesglose(
  tenantId: string, desgloseId: string, fuente: FuenteVinculos = fuenteLocal,
): Promise<ResultadoVinculos> {
  try {
    if (!(await leerVinculosActivo(tenantId))) return { estado: 'apagado' };

    const lineas = await traerTodo<Record<string, unknown>>(
      (d, h) => acotada(supabaseAdmin().from('desglose_peaje_linea')
        .select('id, indice, fecha, caseta, hora, unidad_archivo', conteo(d))
        .eq('tenant_id', tenantId).eq('desglose_id', desgloseId).order('indice').range(d, h), 'peajes.vinculos.lineas'),
      'peajes.vinculos.lineas',
    );
    const resumen = { lineas: lineas.length, ligados: 0, ambiguos: 0, sinViaje: 0, sinUnidad: 0, conflictos: 0 };
    if (lineas.length === 0) return { estado: 'ok', ...resumen };

    const cruces: CruceIcident[] = lineas.map((l) => ({
      id: String(l.id),
      unidadArchivo: typeof l.unidad_archivo === 'string' ? l.unidad_archivo : null,
      fecha: typeof l.fecha === 'string' ? l.fecha.slice(0, 10) : '',
      caseta: typeof l.caseta === 'string' ? l.caseta : null,
      hora: typeof l.hora === 'string' ? l.hora : null,
    }));
    const fechas = cruces.map((c) => c.fecha).filter((f) => FECHA.test(f)).sort();
    // Sin una sola fecha válida no hay rango que buscar: todas caen en «sin_viaje» con su motivo.
    const { viajes, posiciones } = fechas.length === 0
      ? { viajes: [] as ViajeFuente[], posiciones: [] as PosicionConViaje[] }
      : await fuente.cargar(tenantId, { desde: desplazar(fechas[0], -MARGEN_DIAS), hasta: desplazar(fechas[fechas.length - 1], MARGEN_DIAS) });

    // El catálogo solo importa para equivaler caseta↔punto de interés: sin posiciones no se lee.
    const catalogo = posiciones.length > 0 ? await listarCasetas(tenantId, true) : undefined;
    const vinculos = vincularPorIcident(cruces, viajes, posiciones, { margenDias: MARGEN_DIAS, catalogo });

    const guardar: VinculoGuardado[] = vinculos.map((v) => ({
      lineaId: String(v.id), estado: v.estado, viajeId: v.viajeId, via: v.via,
      candidatos: v.candidatos, icident: v.icident ?? null, motivo: v.motivo,
    }));
    await guardarVinculos(tenantId, desgloseId, guardar);

    for (const v of vinculos) {
      if (v.estado === 'ligado') resumen.ligados++;
      else if (v.estado === 'ambiguo') resumen.ambiguos++;
      else if (v.estado === 'sin_viaje') resumen.sinViaje++;
      else if (v.estado === 'sin_unidad') resumen.sinUnidad++;
      else resumen.conflictos++;
    }
    return { estado: 'ok', ...resumen };
  } catch (e) {
    // Solo un código estable: el mensaje de la base puede traer el valor de una columna (unidad, caseta).
    logger.error('cron.peajes.vinculos_fallo', { tenant: tenantId, desglose: desgloseId, codigo: codigoDeError(e) });
    return { estado: 'fallo', motivo: e instanceof Error ? e.message : String(e) };
  }
}
