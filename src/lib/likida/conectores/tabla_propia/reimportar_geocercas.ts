import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { acotada } from '../../presupuesto';
import { importarGeocercasDeFlota, type ResultadoImportGeocercas } from './importar_geocercas';

// ═══════════════════════════════════════════════════════════════════════════
// RE-IMPORTACIÓN DIARIA DE GEOCERCAS DE «MIS PROPIAS TABLAS» (P1, 0631) — la corre el cron `gps`.
//
// Antes solo existía el botón manual de Conexiones: si el sistema del cliente agregaba o corregía un patio, el catálogo
// se quedaba viejo hasta que alguien se acordaba (y con polígonos reales, un catálogo viejo acusa de más). Aquí:
//
//   · Una consulta (`flotas_para_reimportar_geocercas`) dice a QUÉ flotas ya les toca (conexión activa y 23 h desde el
//     último intento; 60 min tras un error). El claim atómico (`reclamar_importacion_geocercas`) evita que dos
//     invocaciones solapadas lean a la vez la misma tabla del cliente.
//   · IDEMPOTENTE: con la misma HUELLA de contenido no se escribe NADA; si cambió, se importa todo-o-nada por la misma RPC
//     que el botón (actualiza por código, no duplica) y NO revive un sitio que la flota archivó (`conservar_activa`).
//   · Una flota sin geocercas configuradas en su conexión no es un error: se anota «sin cambios» y se le deja en paz un día.
//   · Un fallo de una flota NO frena a las demás ni tumba el cron: se anota en su estado (la huella buena no se gasta) y
//     se reintenta a la hora. Reloj duro: se corta antes del tope del cron, y lo que no alcanzó se DICE.
//   · Sin la 0631 aplicada todo esto se apaga con un aviso (`sinMigracion`): el cron de posiciones sigue como siempre.
// ═══════════════════════════════════════════════════════════════════════════

export const VENTANA_REIMPORTACION_MIN = 1380; // 23 h: una vez al día con holgura para el reloj del cron
export const TOPE_FLOTAS_POR_CORRIDA = 20;

export type EstadoReimportacion = 'importada' | 'sin_cambios' | 'error' | 'ocupada' | 'sin_turno';

export interface ResultadoReimportacionFlota {
  tenantId: string;
  estado: EstadoReimportacion;
  creados: number;
  actualizados: number;
  aproximadas: number;
  poligonos: number;
  error?: string;
}

export interface ResumenReimportacion {
  flotas: ResultadoReimportacionFlota[];
  importadas: number;
  sinCambios: number;
  conError: number;
  sinTurno: number;
  /** La base aún no tiene la 0631: la re-importación automática no corre (el botón manual sigue igual). */
  sinMigracion: boolean;
}

export interface PuertosReimportacion {
  /** Flotas a las que ya les toca; `null` = la base no tiene la 0631. */
  flotas(limite: number): Promise<string[] | null>;
  reclamar(tenantId: string): Promise<boolean>;
  huellaPrevia(tenantId: string): Promise<string | null>;
  registrar(tenantId: string, r: { resultado: 'importada' | 'sin_cambios' | 'error'; huella?: string | null; creados?: number; actualizados?: number; aproximadas?: number; error?: string | null }): Promise<void>;
  importar(tenantId: string, huellaPrevia: string | null): Promise<ResultadoImportGeocercas>;
}

const faltaEsquema = (e: { code?: string; message?: string } | null | undefined): boolean =>
  !!e && (e.code === '42883' || e.code === '42P01' || e.code === 'PGRST202' || e.code === 'PGRST205' || /could not find the function|does not exist|schema cache/i.test(e.message ?? ''));

export const puertosReimportacionReales: PuertosReimportacion = {
  async flotas(limite) {
    const { data, error } = await acotada(supabaseAdmin().rpc('flotas_para_reimportar_geocercas', { p_limite: limite, p_ventana_min: VENTANA_REIMPORTACION_MIN }), 'geocercas.flotas');
    if (error) {
      if (faltaEsquema(error)) return null;
      throw new Error(`geocercas.flotas: ${error.message}`);
    }
    return ((data ?? []) as Array<{ tenant_id: unknown }>).map((f) => String(f.tenant_id));
  },
  async reclamar(tenantId) {
    const { data, error } = await acotada(supabaseAdmin().rpc('reclamar_importacion_geocercas', { p_tenant: tenantId, p_ventana_min: VENTANA_REIMPORTACION_MIN }), 'geocercas.reclamar');
    if (error) throw new Error(`geocercas.reclamar: ${error.message}`);
    return data === true;
  },
  async huellaPrevia(tenantId) {
    const { data, error } = await acotada(supabaseAdmin().from('geocerca_importacion_estado').select('huella').eq('tenant_id', tenantId).maybeSingle(), 'geocercas.huella');
    if (error) throw new Error(`geocercas.huella: ${error.message}`);
    const h = (data as { huella?: unknown } | null)?.huella;
    return typeof h === 'string' && /^[0-9a-f]{64}$/.test(h) ? h : null;
  },
  async registrar(tenantId, r) {
    const { error } = await acotada(supabaseAdmin().rpc('registrar_importacion_geocercas', {
      p_tenant: tenantId, p_resultado: r.resultado, p_huella: r.huella ?? null, p_creados: r.creados ?? null,
      p_actualizados: r.actualizados ?? null, p_aproximadas: r.aproximadas ?? null, p_error: r.error ?? null,
    }), 'geocercas.registrar');
    if (error) throw new Error(`geocercas.registrar: ${error.message}`);
  },
  importar: (tenantId, huellaPrevia) => importarGeocercasDeFlota(tenantId, { huellaPrevia, conservarActiva: true }),
};

const sinEstado = (tenantId: string, estado: EstadoReimportacion, extra: Partial<ResultadoReimportacionFlota> = {}): ResultadoReimportacionFlota =>
  ({ tenantId, estado, creados: 0, actualizados: 0, aproximadas: 0, poligonos: 0, ...extra });

/** Una flota: reclama, compara huellas, importa si cambió y deja el estado. Nunca lanza: un fallo es el resultado de ESA flota. */
export async function reimportarGeocercasDeFlota(tenantId: string, p: PuertosReimportacion = puertosReimportacionReales): Promise<ResultadoReimportacionFlota> {
  try {
    if (!(await p.reclamar(tenantId))) return sinEstado(tenantId, 'ocupada');
    const previa = await p.huellaPrevia(tenantId);
    const r = await p.importar(tenantId, previa);
    if (!r.ok) {
      // «No aplica» (sin conexión o sin geocercas configuradas) no es una falla de la flota: se anota y se le deja en paz.
      if (r.motivo) { await p.registrar(tenantId, { resultado: 'sin_cambios', huella: previa }); return sinEstado(tenantId, 'sin_cambios'); }
      const detalle = [r.error, ...(r.detalles ?? []).slice(0, 2)].join(' ');
      await p.registrar(tenantId, { resultado: 'error', error: detalle });
      return sinEstado(tenantId, 'error', { error: detalle.slice(0, 300) });
    }
    await p.registrar(tenantId, { resultado: r.sinCambios ? 'sin_cambios' : 'importada', huella: r.huella, creados: r.creados, actualizados: r.actualizados, aproximadas: r.aproximadas.length });
    return { tenantId, estado: r.sinCambios ? 'sin_cambios' : 'importada', creados: r.creados, actualizados: r.actualizados, aproximadas: r.aproximadas.length, poligonos: r.poligonos };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error('tabla_propia.reimportar_geocercas_fallo', { tenantId, err: msg });
    try { await p.registrar(tenantId, { resultado: 'error', error: 'falla interna al reimportar' }); } catch { /* el estado no se pudo anotar: el próximo ciclo reintenta */ }
    return sinEstado(tenantId, 'error', { error: 'falla interna al reimportar' });
  }
}

/** La pasada del cron: las flotas a las que ya les toca, una a una, con reloj duro. Nunca lanza. */
export async function reimportarGeocercasTodas(
  opts: { venceEn?: number; ahora?: () => number; puertos?: PuertosReimportacion; tope?: number } = {},
): Promise<ResumenReimportacion> {
  const p = opts.puertos ?? puertosReimportacionReales;
  const ahora = opts.ahora ?? Date.now;
  const vacio: ResumenReimportacion = { flotas: [], importadas: 0, sinCambios: 0, conError: 0, sinTurno: 0, sinMigracion: false };
  let ids: string[] | null;
  try {
    ids = await p.flotas(opts.tope ?? TOPE_FLOTAS_POR_CORRIDA);
  } catch (e) {
    logger.error('tabla_propia.reimportar_geocercas_lista_fallo', { err: e instanceof Error ? e.message : String(e) });
    return { ...vacio, conError: 1 };
  }
  if (ids === null) return { ...vacio, sinMigracion: true };
  const flotas: ResultadoReimportacionFlota[] = [];
  for (const id of ids) {
    if (opts.venceEn !== undefined && ahora() >= opts.venceEn) { flotas.push(sinEstado(id, 'sin_turno')); continue; }
    flotas.push(await reimportarGeocercasDeFlota(id, p));
  }
  const n = (e: EstadoReimportacion) => flotas.filter((f) => f.estado === e).length;
  const resumen: ResumenReimportacion = { flotas, importadas: n('importada'), sinCambios: n('sin_cambios'), conError: n('error'), sinTurno: n('sin_turno'), sinMigracion: false };
  if (resumen.sinTurno > 0) logger.warn('tabla_propia.reimportar_geocercas_corte_por_reloj', { sinTurno: resumen.sinTurno });
  return resumen;
}
