// ═══════════════════════════════════════════════════════════════════════════
// MAPEO MASIVO UNIDAD ↔ DISPOSITIVO GPS (W3 «GPS/Jornada»).
//
// 250 camiones no se ligan a su GPS uno por uno. El CSV trae tres columnas —
// número económico, proveedor, id del dispositivo en el sistema del proveedor—
// y esto escribe `unidad.gps_proveedor` + `unidad.gps_device_id`.
//
// ── LO QUE NO HACE, Y ES EL DISEÑO ───────────────────────────────────────
//  · NO da de alta unidades: un número económico que la flota no tiene se
//    rechaza diciéndolo (esto liga GPS, no crea camiones; para eso está la
//    carga de unidades).
//  · NO acepta un dispositivo ya ligado a OTRA unidad (un GPS = una unidad;
//    `uq_unidad_gps` lo exige y aquí se dice con el económico del que lo tiene).
//  · NO toca unidades dadas de baja, ni (para un jefe con patio) de otro patio.
//  · NO acepta un proveedor que no tenga lector: un dispositivo ligado a un
//    proveedor que nadie sincroniza es una promesa muerta.
// Ligar un dispositivo borra su renglón de «huérfanos» (ya no lo es).
//
// MISMO MOTOR PARA LA VISTA PREVIA Y LA ESCRITURA: `planificarMapeoGps` no
// escribe; `aplicarMapeoGps` vuelve a planificar y escribe lo que el plan dijo.
// ═══════════════════════════════════════════════════════════════════════════
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { anotarBitacora } from '@/lib/likida/bitacora_escritura';
import type { AlcancePatio } from '@/lib/auth/patio';
import { acotada } from '../presupuesto';
import { traerTodo, conteo } from '../pg';
import { conPool } from '../lotes';
import { LECTORES_POSICION } from '../conectores/posiciones';
import {
  type Descartada, TOPE_FILAS_IMPORTACION, detectarColumnas, filaVacia, celdaTexto, normalizarEncabezado,
  encabezadosLeidos, avisoDeTope, plantillaCsv, MARCA_EJEMPLO, esFilaDeEjemplo, enTandas, chocaContra,
} from './archivo';

/** Los proveedores a los que se puede ligar un dispositivo: los que tienen lector + el push propio. */
export const PROVEEDORES_MAPEABLES: readonly string[] = [...Object.keys(LECTORES_POSICION), 'gps_push'];

const SINONIMOS_PROVEEDOR: Record<string, string> = {
  generico: 'gps_generico', otro: 'gps_generico', 'gps generico': 'gps_generico',
  push: 'gps_push', propio: 'gps_push', 'gps propio': 'gps_push', 'gps push': 'gps_push',
};

export function normalizarProveedor(crudo: string): string | null {
  const k = normalizarEncabezado(crudo).replace(/\s+/g, ' ');
  const directo = k.replace(/ /g, '_');
  if (PROVEEDORES_MAPEABLES.includes(directo)) return directo;
  const sin = SINONIMOS_PROVEEDOR[k];
  return sin && PROVEEDORES_MAPEABLES.includes(sin) ? sin : null;
}

const COLUMNAS_GPS = {
  numeroEconomico: ['numero economico', 'economico', 'no economico', 'num economico', 'unidad', 'eco', 'numero eco'],
  proveedor: ['proveedor', 'proveedor gps', 'proveedor de gps', 'plataforma', 'plataforma gps', 'gps', 'sistema'],
  dispositivo: ['dispositivo', 'id dispositivo', 'id del dispositivo', 'device', 'device id', 'id gps', 'id de gps', 'id unidad en gps'],
} as const;

export const PLANTILLA_GPS = {
  encabezados: ['numero_economico', 'proveedor', 'dispositivo'] as const,
  ejemplo: [`${MARCA_EJEMPLO}`, 'wialon', '12001'] as const,
};
export function plantillaGpsCsv(): string { return plantillaCsv(PLANTILLA_GPS.encabezados, PLANTILLA_GPS.ejemplo); }

export interface FilaGps { fila: number; numeroEconomico: string; proveedor: string; dispositivo: string }
export interface LecturaGps { filas: FilaGps[]; descartadas: Descartada[]; error?: string }

export function interpretarFilasGps(matriz: unknown[][]): LecturaGps {
  if (matriz.length === 0) return { filas: [], descartadas: [], error: 'El archivo está vacío.' };
  const indice = detectarColumnas(matriz[0], COLUMNAS_GPS);
  for (const [k, nombre] of [['numeroEconomico', 'número económico'], ['proveedor', 'proveedor'], ['dispositivo', 'dispositivo']] as const) {
    if (indice[k] === undefined) {
      return { filas: [], descartadas: [], error: `No encontré la columna de ${nombre}. Encabezados leídos: ${encabezadosLeidos(matriz)}. Descarga la plantilla (numero_economico, proveedor, dispositivo).` };
    }
  }
  const filas: FilaGps[] = [];
  const descartadas: Descartada[] = [];
  const porUnidad = new Map<string, number>();
  const porDispositivo = new Map<string, number>();
  for (let f = 1; f < matriz.length && f <= TOPE_FILAS_IMPORTACION; f++) {
    const fila = matriz[f];
    if (filaVacia(fila)) continue;
    const n = f + 1;
    if (esFilaDeEjemplo(fila)) { descartadas.push({ fila: n, motivo: 'es la fila de ejemplo de la plantilla' }); continue; }
    const eco = celdaTexto(fila[indice.numeroEconomico as number], 40);
    const provCrudo = celdaTexto(fila[indice.proveedor as number], 40);
    const dispositivo = celdaTexto(fila[indice.dispositivo as number], 200);
    if (!eco) { descartadas.push({ fila: n, motivo: 'falta el número económico' }); continue; }
    if (!dispositivo) { descartadas.push({ fila: n, motivo: `falta el id del dispositivo de ${eco}` }); continue; }
    const proveedor = normalizarProveedor(provCrudo);
    if (!proveedor) {
      descartadas.push({ fila: n, motivo: `el proveedor «${provCrudo}» no es uno de los que sincronizamos (${PROVEEDORES_MAPEABLES.join(', ')})` });
      continue;
    }
    const llaveU = eco.toLowerCase();
    const llaveD = `${proveedor}|${dispositivo}`;
    if (porUnidad.has(llaveU)) { descartadas.push({ fila: n, motivo: `la unidad ${eco} ya viene en la fila ${porUnidad.get(llaveU)}: una unidad tiene un solo dispositivo` }); continue; }
    if (porDispositivo.has(llaveD)) { descartadas.push({ fila: n, motivo: `el dispositivo ${dispositivo} ya viene en la fila ${porDispositivo.get(llaveD)}: un dispositivo es de una sola unidad` }); continue; }
    porUnidad.set(llaveU, n); porDispositivo.set(llaveD, n);
    filas.push({ fila: n, numeroEconomico: eco, proveedor, dispositivo });
  }
  const tope = avisoDeTope(matriz);
  if (tope) { descartadas.unshift(tope); return { filas, descartadas, error: tope.motivo }; }
  return { filas, descartadas };
}

type Unidad = { id: string; numero_economico: string; activo: boolean | null; terminal_id: string | null; gps_proveedor: string | null; gps_device_id: string | null };

async function parque(tenantId: string): Promise<Unidad[]> {
  return traerTodo<Unidad>((d, h) => acotada(
    supabaseAdmin().from('unidad')
      .select('id, numero_economico, activo, terminal_id, gps_proveedor, gps_device_id', conteo(d))
      .eq('tenant_id', tenantId).order('id').range(d, h),
    'mapeoGps.parque',
  ), 'mapeoGps.parque');
}

export interface PlanGps {
  /** Se ligarían (o cambiarían). */
  aplicar: Array<FilaGps & { unidadId: string; cambiaDe: string | null }>;
  /** Ya estaban ligadas exactamente así. */
  yaEstaban: Array<FilaGps & { unidadId: string }>;
  errores: Array<{ fila: number; motivo: string }>;
  error?: string;
}

export async function planificarMapeoGps(tenantId: string, filas: readonly FilaGps[], alcance: AlcancePatio): Promise<PlanGps> {
  const plan: PlanGps = { aplicar: [], yaEstaban: [], errores: [] };
  if (!filas.length) return plan;
  let unidades: Unidad[];
  try { unidades = await parque(tenantId); } catch (e) {
    logger.error('mapeo_gps.parque_ilegible', { tenantId, err: e instanceof Error ? e.message : String(e) });
    return { ...plan, error: 'No pude leer tus unidades para comprobar el mapeo — no cambié nada. Vuelve a intentar.' };
  }
  const porEco = new Map(unidades.map((u) => [u.numero_economico.trim().toLowerCase(), u] as const));
  const dueno = new Map(unidades.filter((u) => u.gps_device_id && u.gps_proveedor).map((u) => [`${u.gps_proveedor}|${u.gps_device_id}`, u] as const));
  // Unidades que ESTE archivo reasigna DE VERDAD (fila válida cuyo dispositivo cambia): su
  // dispositivo viejo queda libre para otra fila. Una unidad que se queda como está, o cuya
  // fila es inválida, NO libera nada.
  const valida = (u: Unidad | undefined) =>
    !!u && u.activo !== false && !(alcance.tipo === 'patio' && u.terminal_id !== alcance.terminalId);
  const reasignadas = new Set<string>();
  for (const f of filas) {
    const u = porEco.get(f.numeroEconomico.toLowerCase());
    if (u && valida(u) && !(u.gps_proveedor === f.proveedor && u.gps_device_id === f.dispositivo)) reasignadas.add(u.id);
  }

  for (const f of filas) {
    const u = porEco.get(f.numeroEconomico.toLowerCase());
    if (!u) { plan.errores.push({ fila: f.fila, motivo: `la unidad ${f.numeroEconomico} no existe en tu flota. Este archivo liga GPS, no da de alta unidades` }); continue; }
    if (u.activo === false) { plan.errores.push({ fila: f.fila, motivo: `la unidad ${u.numero_economico} está dada de baja` }); continue; }
    if (alcance.tipo === 'patio' && u.terminal_id !== alcance.terminalId) {
      plan.errores.push({ fila: f.fila, motivo: `la unidad ${u.numero_economico} no es de tu patio` }); continue;
    }
    const otro = dueno.get(`${f.proveedor}|${f.dispositivo}`);
    if (otro && otro.id !== u.id && !reasignadas.has(otro.id)) {
      plan.errores.push({ fila: f.fila, motivo: `el dispositivo ${f.dispositivo} de ${f.proveedor} ya es de la unidad ${otro.numero_economico}; un GPS es de una sola unidad` }); continue;
    }
    if (u.gps_proveedor === f.proveedor && u.gps_device_id === f.dispositivo) { plan.yaEstaban.push({ ...f, unidadId: u.id }); continue; }
    plan.aplicar.push({ ...f, unidadId: u.id, cambiaDe: u.gps_device_id ? `${u.gps_proveedor}:${u.gps_device_id}` : null });
  }
  return plan;
}

export interface ResultadoMapeoGps { ligadas: number; errores: Array<{ fila: number; motivo: string }>; error?: string }

export async function aplicarMapeoGps(
  tenantId: string, filas: readonly FilaGps[], alcance: AlcancePatio,
  opciones: { actor?: { id?: string; email?: string } } = {},
): Promise<ResultadoMapeoGps> {
  const plan = await planificarMapeoGps(tenantId, filas, alcance);
  if (plan.error) return { ligadas: 0, errores: [], error: plan.error };
  const errores = [...plan.errores];
  // Para evitar chocar con `uq_unidad_gps` a media escritura, primero se SUELTAN
  // los dispositivos de las unidades que cambian, luego se ligan los nuevos.
  const cambian = plan.aplicar.filter((a) => a.cambiaDe !== null);
  for (const tanda of enTandas(cambian.map((c) => c.unidadId), 200)) {
    const { error } = await acotada(
      supabaseAdmin().from('unidad').update({ gps_proveedor: null, gps_device_id: null, gps_visto_en: null })
        .eq('tenant_id', tenantId).in('id', tanda),
      'mapeoGps.soltar',
    );
    if (error) { logger.error('mapeo_gps.soltar_fallo', { tenantId, err: error.message }); return { ligadas: 0, errores, error: 'No se pudo actualizar la base; no se ligó nada. Vuelve a subir el archivo.' }; }
  }
  const resultados = await conPool(plan.aplicar, 8, async (a) => {
    const { data, error } = await acotada(
      supabaseAdmin().from('unidad')
        .update({ gps_proveedor: a.proveedor, gps_device_id: a.dispositivo, gps_visto_en: null })
        .eq('tenant_id', tenantId).eq('id', a.unidadId).select('id'),
      'mapeoGps.ligar',
    );
    if (error) {
      return { fila: a.fila, motivo: chocaContra(error.message, 'uq_unidad_gps') ? `el dispositivo ${a.dispositivo} ya lo ligó otra carga al mismo tiempo` : 'no se pudo guardar; vuelve a subir el archivo (lo ya ligado se salta solo)' };
    }
    if (!data || data.length === 0) return { fila: a.fila, motivo: `la unidad ${a.numeroEconomico} ya no existe` };
    return null;
  });
  const ligadasOk: typeof plan.aplicar = [];
  resultados.forEach((r, i) => {
    if ('error' in r) errores.push({ fila: plan.aplicar[i].fila, motivo: 'no se pudo guardar; vuelve a subir el archivo' });
    else if (r.ok) errores.push(r.ok);
    else ligadasOk.push(plan.aplicar[i]);
  });
  // Ya no son huérfanos: se limpian de la lista (best effort; la lista se filtra también al leer).
  const porProveedor = new Map<string, string[]>();
  for (const a of ligadasOk) porProveedor.set(a.proveedor, [...(porProveedor.get(a.proveedor) ?? []), a.dispositivo]);
  for (const [proveedor, ids] of porProveedor) {
    for (const tanda of enTandas(ids, 200)) {
      const { error } = await acotada(
        supabaseAdmin().from('gps_dispositivo_huerfano').delete().eq('tenant_id', tenantId).eq('proveedor', proveedor).in('device_id', tanda),
        'mapeoGps.limpiar_huerfanos',
      );
      if (error) logger.warn('mapeo_gps.huerfanos_no_limpiados', { tenantId, err: error.message });
    }
  }
  if (ligadasOk.length > 0 || errores.length > 0) {
    await anotarBitacora({
      tenantId, actor: opciones.actor ?? {}, accion: 'unidad.gps_mapeados', entidad: 'tenant', entidadId: tenantId,
      detalle: { ligadas: ligadasOk.length, yaEstaban: plan.yaEstaban.length, errores: errores.length },
    });
  }
  return { ligadas: ligadasOk.length, errores };
}
