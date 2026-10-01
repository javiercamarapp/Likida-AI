import { supabaseAdmin } from '@/lib/supabase/admin';
import { acotada } from '../presupuesto';
import { traerTodo, conteo } from '../pg';
import type { CasetaCatalogo } from './casetas';
import {
  planificarGps, evaluarCruceGps, type LineaParaGps, type VeredictoGps, type Muestra,
} from './cruce_gps';

// ═══════════════════════════════════════════════════════════════════════════
// EL I/O DEL CRUCE POR CASETA: trae las posiciones de cada ventana y aplica el
// motor puro. Lanza ante error de base — un contexto a medias produciría
// «sin posiciones» falsos, que es el hueco que este módulo no inventa.
// ═══════════════════════════════════════════════════════════════════════════

/** Ventanas por consulta: 100 ventanas × ~8 posiciones (cadencia de 5 min) ≈ 800 filas por tanda. */
const VENTANAS_POR_TANDA = 100;

export interface ResultadoGpsLinea { lineaId: string; casetaId: string | null; veredicto: VeredictoGps }

export async function evaluarGpsDeLineas(
  tenantId: string,
  lineas: readonly LineaParaGps[],
  catalogo: readonly CasetaCatalogo[],
): Promise<ResultadoGpsLinea[]> {
  const planes = planificarGps(lineas, catalogo);
  const listos = planes.filter((p): p is Extract<typeof p, { listo: true }> => p.listo);

  const muestrasPorLinea = new Map<string, Muestra[]>();
  for (let i = 0; i < listos.length; i += VENTANAS_POR_TANDA) {
    const tanda = listos.slice(i, i + VENTANAS_POR_TANDA);
    const ventanas = tanda.map((p) => ({ linea_id: p.lineaId, unidad_id: p.unidadId, desde: p.desde, hasta: p.hasta }));
    const filas = await traerTodo<{ linea_id: unknown; lat: unknown; lng: unknown; medida_en: unknown }>(
      (d, h) => acotada(
        supabaseAdmin().rpc('peaje_posiciones_ventana', { p_tenant: tenantId, p_ventanas: ventanas }, conteo(d))
          .order('linea_id').order('medida_en').range(d, h),
        'peajes.posiciones_ventana',
      ),
      'peajes.posiciones_ventana',
    );
    for (const f of filas) {
      const id = String(f.linea_id);
      const l = muestrasPorLinea.get(id) ?? [];
      l.push({ lat: Number(f.lat), lng: Number(f.lng), t: Date.parse(String(f.medida_en)) });
      muestrasPorLinea.set(id, l);
    }
  }

  return planes.map((p) => {
    if (!p.listo) return { lineaId: p.lineaId, casetaId: p.casetaId, veredicto: p.veredicto };
    return { lineaId: p.lineaId, casetaId: p.casetaId, veredicto: evaluarCruceGps(p.cruceMs, p.caseta, muestrasPorLinea.get(p.lineaId) ?? []) };
  });
}
