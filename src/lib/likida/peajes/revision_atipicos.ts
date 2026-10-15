import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { acotada } from '../presupuesto';
import { traerTodo, conteo } from '../pg';
import { registrarCorrida } from '../agentes/corridas';
import { detectarAtipicos, type CruceEntrada, type ResultadoAtipicos } from './atipicos';
import { leerConfigAtipicos, listarCasetas, upsertAtipicos, type ResultadoUpsertAtipicos } from './datos';

// ═══════════════════════════════════════════════════════════════════════════
// T-A2-13 — EL DETECTOR DE CRUCES ATÍPICOS DENTRO DE LA CONCILIACIÓN.
//
// Un archivo decenal solo ve 10 días: un patrón que cruza el límite entre dos
// decenas se pierde. Por eso, tras conciliar un desglose, el detector corre
// sobre ESE desglose más los hasta 2 anteriores del MISMO mes de la flota
// (el cierre mensual junta archivos). Los hallazgos se guardan idempotentes
// (T-A2-12): re-correr no duplica ni pisa un estado ya revisado.
//
// Garantías: apagado de origen (si la flota no lo activó no se lee nada más
// que su configuración); un fallo aquí NUNCA tumba la ingesta (se atrapa, se
// registra y la corrida del agente queda `parcial`); aislado por flota.
// ═══════════════════════════════════════════════════════════════════════════

/** Cuántas decenas previas del mismo mes se suman al desglose actual. */
export const DECENAS_PREVIAS = 2;

export type ResultadoRevisionAtipicos =
  | { estado: 'apagado' }
  | { estado: 'sin_desglose' }
  | { estado: 'ok'; desglosesRevisados: number; cruces: number; hallazgos: number; nuevos: number; yaExistian: number; reglasNoAplicadas: number }
  | { estado: 'fallo'; motivo: string };

interface DesgloseVentana { id: string; periodoDesde: string | null }

/** El primer día del mes de una fecha AAAA-MM-DD. */
const inicioDeMes = (fecha: string): string => `${fecha.slice(0, 7)}-01`;

/** El desglose actual + hasta `DECENAS_PREVIAS` anteriores del mismo mes (no anulados). Lanza ante error de base. */
export async function ventanaDeDesgloses(tenantId: string, desgloseId: string): Promise<DesgloseVentana[] | null> {
  const { data: actual, error } = await acotada(supabaseAdmin().from('desglose_peaje')
    .select('id, periodo_desde').eq('tenant_id', tenantId).eq('id', desgloseId).is('anulado_en', null).maybeSingle(), 'peajes.atipicos.desglose');
  if (error) throw new Error(`ventanaDeDesgloses: ${error.message}`);
  if (!actual) return null;
  const desde = typeof actual.periodo_desde === 'string' ? actual.periodo_desde : null;
  const ventana: DesgloseVentana[] = [{ id: desgloseId, periodoDesde: desde }];
  // Sin periodo medido no hay «mismo mes» que probar: se revisa solo el archivo actual.
  if (!desde) return ventana;

  const previos = await acotada(supabaseAdmin().from('desglose_peaje')
    .select('id, periodo_desde').eq('tenant_id', tenantId).is('anulado_en', null)
    .gte('periodo_desde', inicioDeMes(desde)).lte('periodo_desde', desde)
    .order('periodo_desde', { ascending: false }).limit(DECENAS_PREVIAS + 5), 'peajes.atipicos.previos');
  if (previos.error) throw new Error(`ventanaDeDesgloses: ${previos.error.message}`);
  const otros = ((previos.data ?? []) as Array<{ id: unknown; periodo_desde: unknown }>)
    .filter((f) => String(f.id) !== desgloseId)
    .map((f) => ({ id: String(f.id), periodoDesde: String(f.periodo_desde) }))
    .sort((a, b) => (a.periodoDesde! < b.periodoDesde! ? 1 : a.periodoDesde! > b.periodoDesde! ? -1 : 0))
    .slice(0, DECENAS_PREVIAS);
  return [...ventana, ...otros];
}

const llaveCruce = (c: CruceEntrada) => `${c.unidad_archivo}|${c.caseta}|${c.fecha}|${c.hora}|${c.monto}`;

/**
 * Une los cruces de varios archivos SIN contar dos veces lo que dos archivos
 * traslapados comparten: por cada cruce idéntico se toma el máximo de veces que
 * lo trae UN archivo (dos cobros reales idénticos dentro de un archivo se conservan).
 */
export function unirCruces(porArchivo: ReadonlyArray<readonly CruceEntrada[]>): CruceEntrada[] {
  const maximo = new Map<string, { cruce: CruceEntrada; n: number }>();
  for (const cruces of porArchivo) {
    const local = new Map<string, { cruce: CruceEntrada; n: number }>();
    for (const c of cruces) {
      const k = llaveCruce(c);
      const e = local.get(k);
      if (e) e.n++; else local.set(k, { cruce: c, n: 1 });
    }
    for (const [k, e] of local) {
      const previo = maximo.get(k);
      if (!previo || e.n > previo.n) maximo.set(k, e);
    }
  }
  const salida: CruceEntrada[] = [];
  for (const { cruce, n } of maximo.values()) for (let i = 0; i < n; i++) salida.push(cruce);
  return salida;
}

async function crucesDeDesgloses(tenantId: string, ids: readonly string[]): Promise<CruceEntrada[][]> {
  const porArchivo: CruceEntrada[][] = [];
  for (const id of ids) {
    const filas = await traerTodo<{ unidad_archivo: unknown; caseta: unknown; fecha: unknown; hora: unknown; monto: unknown; indice: unknown }>(
      (d, h) => acotada(supabaseAdmin().from('desglose_peaje_linea')
        .select('unidad_archivo, caseta, fecha, hora, monto, indice', conteo(d))
        .eq('tenant_id', tenantId).eq('desglose_id', id).order('indice').range(d, h), 'peajes.atipicos.lineas'),
      'peajes.atipicos.lineas',
    );
    porArchivo.push(filas.map((f) => ({
      unidad_archivo: typeof f.unidad_archivo === 'string' ? f.unidad_archivo : null,
      caseta: typeof f.caseta === 'string' ? f.caseta : null,
      fecha: typeof f.fecha === 'string' ? f.fecha : null,
      hora: typeof f.hora === 'string' ? f.hora : null,
      monto: Number(f.monto) || 0,
    })));
  }
  return porArchivo;
}

/**
 * Corre el detector sobre la ventana del desglose y guarda los hallazgos. NUNCA lanza:
 * un fallo devuelve `{ estado: 'fallo' }`, queda en el log y la corrida del agente se anota
 * `parcial` (el latido), sin tocar el resultado de la ingesta que la llamó.
 */
export async function revisarAtipicosDeDesglose(
  tenantId: string, desgloseId: string, disparo: 'cron' | 'manual' = 'cron',
): Promise<ResultadoRevisionAtipicos> {
  const inicio = new Date();
  try {
    const config = await leerConfigAtipicos(tenantId);
    if (!config.activo) return { estado: 'apagado' };

    const ventana = await ventanaDeDesgloses(tenantId, desgloseId);
    if (!ventana) return { estado: 'sin_desglose' };

    const cruces = unirCruces(await crucesDeDesgloses(tenantId, ventana.map((v) => v.id)));
    const catalogo = await listarCasetas(tenantId, true);
    const res: ResultadoAtipicos = detectarAtipicos(cruces, config.umbrales, catalogo);
    const guardado: ResultadoUpsertAtipicos = await upsertAtipicos(tenantId, desgloseId, res.hallazgos);
    return {
      estado: 'ok', desglosesRevisados: ventana.length, cruces: cruces.length, hallazgos: res.hallazgos.length,
      nuevos: guardado.nuevos, yaExistian: guardado.yaExistian, reglasNoAplicadas: res.reglasNoAplicadas.length,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error('peajes.atipicos.revision', { tenant: tenantId, desglose: desgloseId, err: msg });
    await registrarCorrida(tenantId, 'peajes', {
      inicio, fin: new Date(), estado: 'parcial', disparo,
      error: 'La revisión de cruces atípicos no se pudo completar; el desglose sí quedó conciliado. El detalle quedó en los registros del sistema.',
    });
    return { estado: 'fallo', motivo: msg };
  }
}
