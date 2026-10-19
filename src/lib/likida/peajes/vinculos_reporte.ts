import { logger } from '@/lib/logger';
import {
  leerDesgloseVigenteParaVinculos, leerLineasParaVinculosArchivo, leerViajesConOrigenDestino,
  vinculosDeDesglose, listarUnidades, revisionDeDesglose,
} from './repo';
import type { LineaParaVinculos, VinculoParaArchivo } from './vinculos_archivos';
import { costoPorViaje, type CostoViaje, type ViajeCosto } from './costo_viaje';

// T-A2-22 — lee lo que necesita el archivo «casetas ligadas a viaje» de UN desglose, siempre con el
// tenant de la sesión. `null` = el desglose no existe (o está anulado) en esa flota. Lanza ante error
// de base o lectura incompleta: jamás devuelve un archivo corto.
//
// T-A2-35: las consultas directas a Supabase se movieron a `./repo`
// (`leerDesgloseVigenteParaVinculos`, `leerLineasParaVinculosArchivo`,
// `leerViajesConOrigenDestino`); esta función se quedó aquí porque llama a
// `revisionDeDesglose` como una dependencia de OTRO archivo a propósito
// (`costo_viaje_cableado.test.ts` la mockea para probar la resiliencia ante
// un fallo al calcular candidatos) — ver la nota en `repo.ts`.

export interface DatosVinculos {
  lineas: LineaParaVinculos[];
  vinculos: VinculoParaArchivo[];
  folios: Map<string, string>;
  /** T-A2-23: costo por viaje (id de viaje → costo). Solo viajes con cruces ligados o candidatos ambiguos. */
  costos: Map<string, CostoViaje>;
}

export async function leerVinculosParaArchivo(tenantId: string, desgloseId: string): Promise<DatosVinculos | null> {
  const desglose = await leerDesgloseVigenteParaVinculos(tenantId, desgloseId);
  if (!desglose) return null;

  const [crudas, vinculos, unidades] = await Promise.all([
    leerLineasParaVinculosArchivo(tenantId, desgloseId),
    vinculosDeDesglose(tenantId, desgloseId),
    listarUnidades(tenantId),
  ]);
  const ecoPorUnidad = new Map(unidades.map((u) => [u.id, u.numeroEconomico]));

  const lineas: LineaParaVinculos[] = crudas.map((l) => ({
    id: String(l.id),
    fecha: typeof l.fecha === 'string' ? l.fecha.slice(0, 10) : null,
    hora: typeof l.hora === 'string' ? l.hora.slice(0, 8) : null,
    unidad: typeof l.unidad_archivo === 'string' && l.unidad_archivo !== ''
      ? l.unidad_archivo
      : typeof l.unidad_id === 'string' ? ecoPorUnidad.get(l.unidad_id) ?? null : null,
    caseta: typeof l.caseta === 'string' ? l.caseta : null,
    clase: l.clase === null || l.clase === undefined ? null : Number(l.clase),
    importe: Number(l.monto),
  }));

  const viajeIds = [...new Set(vinculos.flatMap((v) => [...(v.viajeId ? [v.viajeId] : []), ...v.candidatos]))];
  const folios = new Map<string, string>();
  const viajesCosto: ViajeCosto[] = [];
  if (viajeIds.length > 0) {
    const vs = await leerViajesConOrigenDestino(tenantId, viajeIds);
    for (const v of vs) {
      if (typeof v.folio === 'string' && v.folio !== '') folios.set(String(v.id), v.folio);
      viajesCosto.push({
        id: String(v.id), folio: typeof v.folio === 'string' ? v.folio : '',
        origen: typeof v.origen === 'string' ? v.origen : null, destino: typeof v.destino === 'string' ? v.destino : null,
      });
    }
  }

  // Candidatos a reclamación por línea (se computan al leer). Si no se pueden calcular, el costo del
  // viaje sale igual y el campo de candidatos dice «no calculado» (null): jamás un 0 inventado.
  let lineasCandidatas: Set<string> | null = null;
  try {
    const rev = await revisionDeDesglose(tenantId, desgloseId);
    if (rev) {
      const idPorIndice = new Map(crudas.map((l) => [Number(l.indice), String(l.id)]));
      lineasCandidatas = new Set(rev.revision.candidatos.flatMap((c) => idPorIndice.get(c.indice) ?? []));
    }
  } catch (e) {
    logger.warn('peajes.vinculos_archivo.candidatos_no_calculados', { tenant: tenantId, err: e instanceof Error ? e.message : String(e) });
  }
  const costos = costoPorViaje({
    lineas: lineas.map((l) => ({ id: l.id, caseta: l.caseta, importe: l.importe })),
    vinculos, viajes: viajesCosto, lineasCandidatas,
  });

  return {
    lineas,
    vinculos: vinculos.map((v) => ({ lineaId: v.lineaId, estado: v.estado, viajeId: v.viajeId, via: v.via, candidatos: v.candidatos, motivo: v.motivo })),
    folios,
    costos,
  };
}
