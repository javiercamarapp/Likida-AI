import { supabaseAdmin } from '@/lib/supabase/admin';
import { acotada } from '../presupuesto';
import { logger } from '@/lib/logger';
import { filtroIcpPostgrest, pasaCompuertaIcp } from './redactor';

// ═══════════════════════════════════════════════════════════════════════════
// A37-S28-01 (ALTO) — LA VENTANA DE CANDIDATOS DEL REDACTOR AVANZA.
//
// El runner leía los N `nuevo` con correo más viejos y dejaba que `redactarCorreoFrio` aplicara la compuerta
// de ICP, la cadencia de 48 h y la pieza pendiente DENTRO: el prospecto rebotado seguía `nuevo`, así que las
// mismas N filas volvían cada vuelta (con 32,900 de 32,986 sin SCIAN, ni una calificaba) y los que sí
// califican, más nuevos, jamás se alcanzaban. Peor: si un humano RECHAZABA una pieza, el mismo prospecto se
// volvía a redactar —con gasto de modelo— en la siguiente vuelta, porque el Redactor no lee `motivo_rechazo`.
//
// Ahora: la compuerta de ICP va EN LA CONSULTA; se pagina por cursor `(created_at, id)`; y cada página se
// depura en LOTE contra la pieza pendiente, la pieza rechazada reciente y la salida de las últimas 48 h.
// `redactarCorreoFrio` conserva todas sus guardas (defensa en profundidad).
// ═══════════════════════════════════════════════════════════════════════════

const PAGINA_REDACTOR = 50;
const TOPE_FILAS_ESCANEADAS_REDACTOR = 2_000;
const TOPE_FILAS_LOTE = 1_000;
/** Cuántos días una pieza RECHAZADA aparta al prospecto de la cola de redacción. */
export const DIAS_RECHAZO_REDACTOR = 30;

export interface CandidatoRedactor {
  id: string;
  vendedor: { nombre?: string } | null;
}

export async function candidatosDelRedactor(limite: number): Promise<CandidatoRedactor[]> {
  const encontrados: CandidatoRedactor[] = [];
  let cursor: { createdAt: string; id: string } | null = null;
  let escaneadas = 0;
  const hace48h = new Date(Date.now() - 48 * 3_600_000).toISOString();
  const haceRechazo = new Date(Date.now() - DIAS_RECHAZO_REDACTOR * 86_400_000).toISOString();
  while (encontrados.length < limite && escaneadas < TOPE_FILAS_ESCANEADAS_REDACTOR) {
    // AGB-3: sin correo capturado no hay pieza enviable. A37-S28-01: sin pasar la compuerta de ICP, tampoco.
    let q = supabaseAdmin()
      .from('prospecto')
      .select('id, created_at, scian, fuente, similitud_icp_pct, vendedor:vendedor_id(nombre)')
      .is('duplicado_de', null)
      .eq('estado', 'nuevo')
      .not('correo', 'is', null)
      .or(filtroIcpPostgrest())
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .limit(PAGINA_REDACTOR);
    if (cursor) q = q.or(`created_at.gt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.gt.${cursor.id})`);
    const { data, error } = await acotada(q, 'runner.candidatos');
    if (error) throw new Error(`loteRedactor.candidatos: ${error.message}`);
    const pagina = (data ?? []) as Array<{
      id: string; created_at: string; scian: string | null; fuente: string; similitud_icp_pct: number | null;
      vendedor: { nombre?: string } | null;
    }>;
    if (pagina.length === 0) break;
    escaneadas += pagina.length;
    const ids = pagina.map((f) => f.id);

    // Pieza pendiente, o rechazada hace poco: el prospecto no vuelve a la cola de redacción.
    const { data: piezas, error: errPiezas } = await acotada(supabaseAdmin()
      .from('cola_aprobacion')
      .select('prospecto_id, estado, resuelto_en')
      .in('prospecto_id', ids)
      .eq('tipo', 'correo_frio')
      .in('estado', ['pendiente', 'rechazado'])
      .order('id', { ascending: true })
      .limit(TOPE_FILAS_LOTE), 'runner.candidatos.piezas');
    if (errPiezas) throw new Error(`loteRedactor.candidatos.piezas: ${errPiezas.message}`);
    const filasPiezas = (piezas ?? []) as Array<{ prospecto_id: string; estado: string; resuelto_en: string | null }>;
    if (filasPiezas.length >= TOPE_FILAS_LOTE) throw new Error('loteRedactor.candidatos.piezas: la lectura llegó al tope y pudo truncarse');
    const apartados = new Set(filasPiezas
      .filter((x) => x.estado === 'pendiente' || (x.resuelto_en !== null && x.resuelto_en >= haceRechazo))
      .map((x) => x.prospecto_id));

    // Cadencia de 48 h: contactado hace poco no se vuelve a tocar.
    const { data: salidas, error: errSal } = await acotada(supabaseAdmin()
      .from('prospecto_contacto')
      .select('prospecto_id')
      .in('prospecto_id', ids)
      .eq('direccion', 'salida')
      .gte('ocurrio_en', hace48h)
      .order('id', { ascending: true })
      .limit(TOPE_FILAS_LOTE), 'runner.candidatos.salidas');
    if (errSal) throw new Error(`loteRedactor.candidatos.salidas: ${errSal.message}`);
    for (const s of (salidas ?? []) as Array<{ prospecto_id: string }>) apartados.add(s.prospecto_id);

    for (const f of pagina) {
      if (encontrados.length >= limite) break;
      if (apartados.has(f.id)) continue;
      // La compuerta final (misma función que usa `redactarCorreoFrio`): si el filtro SQL y esta divergieran,
      // manda la de código.
      if (!pasaCompuertaIcp({ scian: f.scian, fuente: f.fuente, similitudIcpPct: f.similitud_icp_pct })) continue;
      encontrados.push({ id: f.id, vendedor: f.vendedor });
    }

    const ultima = pagina[pagina.length - 1];
    cursor = { createdAt: ultima.created_at, id: ultima.id };
    if (pagina.length < PAGINA_REDACTOR) break;
  }
  if (encontrados.length < limite) logger.info('runner.redactor.candidatos_agotados', { encontrados: encontrados.length, escaneadas });
  return encontrados;
}
