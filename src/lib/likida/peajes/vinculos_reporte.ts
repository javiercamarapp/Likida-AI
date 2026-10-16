import { supabaseAdmin } from '@/lib/supabase/admin';
import { acotada } from '../presupuesto';
import { traerTodo, traerPorIds, conteo } from '../pg';
import { vinculosDeDesglose, listarUnidades } from './datos';
import type { LineaParaVinculos, VinculoParaArchivo } from './vinculos_archivos';

// T-A2-22 — lee lo que necesita el archivo «casetas ligadas a viaje» de UN desglose, siempre con el
// tenant de la sesión. `null` = el desglose no existe (o está anulado) en esa flota. Lanza ante error
// de base o lectura incompleta: jamás devuelve un archivo corto.

export interface DatosVinculos {
  lineas: LineaParaVinculos[];
  vinculos: VinculoParaArchivo[];
  folios: Map<string, string>;
}

export async function leerVinculosParaArchivo(tenantId: string, desgloseId: string): Promise<DatosVinculos | null> {
  const admin = supabaseAdmin();
  const { data: desglose, error } = await acotada(admin.from('desglose_peaje')
    .select('id').eq('tenant_id', tenantId).eq('id', desgloseId).is('anulado_en', null).maybeSingle(), 'peajes.vinculos_archivo.desglose');
  if (error) throw new Error(`leerVinculosParaArchivo: ${error.message}`);
  if (!desglose) return null;

  const [crudas, vinculos, unidades] = await Promise.all([
    traerTodo<Record<string, unknown>>(
      (d, h) => acotada(admin.from('desglose_peaje_linea')
        .select('id, indice, fecha, hora, caseta, monto, clase, unidad_archivo, unidad_id', conteo(d))
        .eq('tenant_id', tenantId).eq('desglose_id', desgloseId).order('indice').order('id').range(d, h), 'peajes.vinculos_archivo.lineas'),
      'peajes.vinculos_archivo.lineas',
    ),
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
  if (viajeIds.length > 0) {
    const vs = await traerPorIds<{ id: unknown; folio: unknown }>(
      viajeIds,
      (tanda) => acotada(admin.from('viaje').select('id, folio').eq('tenant_id', tenantId).in('id', tanda), 'peajes.vinculos_archivo.viajes'),
      'peajes.vinculos_archivo.viajes',
    );
    for (const v of vs) if (typeof v.folio === 'string' && v.folio !== '') folios.set(String(v.id), v.folio);
  }

  return {
    lineas,
    vinculos: vinculos.map((v) => ({ lineaId: v.lineaId, estado: v.estado, viajeId: v.viajeId, via: v.via, candidatos: v.candidatos, motivo: v.motivo })),
    folios,
  };
}
