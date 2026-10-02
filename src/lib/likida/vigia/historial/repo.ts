// ═══════════════════════════════════════════════════════════════════════════
// ACCESO A DATOS DE LOS GRUPOS E HISTÓRICO DEL VIGÍA (0484).
//
// Reglas: TODA consulta filtra por `tenant_id`; las consultas pasan por `acotada`; un error de la base LANZA, salvo la
// ausencia de las tablas (42P01, la 0484 aún no aplicada) que `leerGrupos`/`leerMensajesGrupo` devuelven como `null`
// para que la pantalla diga «falta aplicar la migración» en vez de un vacío que parezca «no hay grupos».
// ═══════════════════════════════════════════════════════════════════════════
import { supabaseAdmin } from '@/lib/supabase/admin';
import { acotada } from '../../presupuesto';
import type { MensajeHistorial } from './export_whatsapp';

type Fila = Record<string, unknown>;

export interface GrupoVigia {
  id: string;
  clienteId: string;
  clienteNombre: string | null;
  nombre: string;
  critico: boolean;
  importaciones: number;
  mensajes: number;
  ultimaImportacion: string | null;
}

const SIN_TABLA = new Set(['42P01', 'PGRST205']);
const esSinTabla = (e: { code?: string } | null): boolean => !!e && !!e.code && SIN_TABLA.has(e.code);

/** Los grupos de la flota con lo importado de cada uno; `null` = la base aún no tiene la 0484. */
export async function leerGrupos(tenantId: string): Promise<GrupoVigia[] | null> {
  const db = supabaseAdmin();
  const g = await acotada(db.from('vigia_grupo').select('id, cliente_id, nombre, critico').eq('tenant_id', tenantId).order('nombre').order('id').limit(500), 'vigia.grupos');
  if (esSinTabla(g.error)) return null;
  if (g.error) throw new Error(`vigia.grupos: ${g.error.message}`);
  const grupos = (g.data ?? []) as Fila[];
  if (grupos.length === 0) return [];
  const [c, i] = await Promise.all([
    acotada(db.from('cliente').select('id, nombre').eq('tenant_id', tenantId).in('id', [...new Set(grupos.map((x) => String(x.cliente_id)))]).order('id').limit(500), 'vigia.grupos_clientes'),
    acotada(db.from('vigia_historial_import').select('grupo_id, mensajes, created_at').eq('tenant_id', tenantId).order('created_at', { ascending: false }).order('id').limit(5000), 'vigia.grupos_imports'),
  ]);
  if (c.error) throw new Error(`vigia.grupos_clientes: ${c.error.message}`);
  if (i.error) throw new Error(`vigia.grupos_imports: ${i.error.message}`);
  const nombres = new Map(((c.data ?? []) as Fila[]).map((x) => [String(x.id), String(x.nombre ?? '')]));
  const imports = (i.data ?? []) as Fila[];
  return grupos.map((x) => {
    const mios = imports.filter((m) => String(m.grupo_id) === String(x.id));
    return {
      id: String(x.id), clienteId: String(x.cliente_id), clienteNombre: nombres.get(String(x.cliente_id)) ?? null, nombre: String(x.nombre), critico: x.critico === true,
      importaciones: mios.length, mensajes: mios.reduce((s, m) => s + (Number(m.mensajes) || 0), 0), ultimaImportacion: mios[0] ? String(mios[0].created_at) : null,
    };
  });
}

/** Los clientes de la flota (para elegir de quién es el grupo). */
export async function leerClientesParaGrupo(tenantId: string): Promise<Array<{ id: string; nombre: string }>> {
  const r = await acotada(supabaseAdmin().from('cliente').select('id, nombre').eq('tenant_id', tenantId).order('nombre').order('id').limit(500), 'vigia.clientes_para_grupo');
  if (r.error) throw new Error(`vigia.clientes_para_grupo: ${r.error.message}`);
  return ((r.data ?? []) as Fila[]).map((x) => ({ id: String(x.id), nombre: String(x.nombre ?? '') }));
}

export type ResultadoGrupo = { ok: true; id: string } | { ok: false; error: string };

export async function crearGrupo(tenantId: string, a: { clienteId: string; nombre: string; critico: boolean }): Promise<ResultadoGrupo> {
  const db = supabaseAdmin();
  // El cliente tiene que ser DE ESTA flota (la FK compuesta lo exige en la base; aquí el mensaje es legible).
  const cli = await acotada(db.from('cliente').select('id').eq('tenant_id', tenantId).eq('id', a.clienteId).maybeSingle(), 'vigia.crear_grupo_cliente');
  if (cli.error) throw new Error(`vigia.crear_grupo_cliente: ${cli.error.message}`);
  if (!cli.data) return { ok: false, error: 'Ese cliente no es de tu flota.' };
  const r = await acotada(db.from('vigia_grupo').insert({ tenant_id: tenantId, cliente_id: a.clienteId, nombre: a.nombre, critico: a.critico }).select('id').single(), 'vigia.crear_grupo');
  if (r.error) {
    if (r.error.code === '23505') return { ok: false, error: 'Ese cliente ya tiene un grupo con ese nombre.' };
    throw new Error(`vigia.crear_grupo: ${r.error.message}`);
  }
  return { ok: true, id: String((r.data as Fila).id) };
}

/** Marca o desmarca un grupo como crítico. `false` = el grupo no existe en esta flota. */
export async function marcarGrupoCritico(tenantId: string, grupoId: string, critico: boolean): Promise<boolean> {
  const r = await acotada(supabaseAdmin().from('vigia_grupo').update({ critico, updated_at: new Date().toISOString() }).eq('tenant_id', tenantId).eq('id', grupoId).select('id'), 'vigia.marcar_critico');
  if (r.error) throw new Error(`vigia.marcar_critico: ${r.error.message}`);
  return ((r.data ?? []) as Fila[]).length > 0;
}

export async function grupoDeFlota(tenantId: string, grupoId: string): Promise<{ id: string; nombre: string } | null> {
  const r = await acotada(supabaseAdmin().from('vigia_grupo').select('id, nombre').eq('tenant_id', tenantId).eq('id', grupoId).maybeSingle(), 'vigia.grupo_de_flota');
  if (r.error) throw new Error(`vigia.grupo_de_flota: ${r.error.message}`);
  return r.data ? { id: String((r.data as Fila).id), nombre: String((r.data as Fila).nombre) } : null;
}

export interface EntradaImportacion {
  grupoId: string;
  sha256: string;
  usuarioId: string | null;
  mensajes: readonly MensajeHistorial[];
}

const LOTE = 500;

/**
 * Guarda una exportación. La huella sha256 (única por grupo) hace que subir DOS veces el mismo archivo no duplique nada.
 * Si falla a la mitad, se borra la importación (los mensajes caen en cascada): nunca queda un histórico a medias.
 */
export async function guardarImportacion(tenantId: string, e: EntradaImportacion): Promise<{ ok: true; id: string } | { ok: false; duplicada: true }> {
  const db = supabaseAdmin();
  const ordenados = [...e.mensajes].sort((a, b) => (a.enviadoEn < b.enviadoEn ? -1 : 1));
  const imp = await acotada(db.from('vigia_historial_import').insert({
    tenant_id: tenantId, grupo_id: e.grupoId, sha256: e.sha256, mensajes: ordenados.length,
    desde: ordenados[0]?.enviadoEn ?? null, hasta: ordenados[ordenados.length - 1]?.enviadoEn ?? null, creado_por: e.usuarioId,
  }).select('id').single(), 'vigia.import_insert');
  if (imp.error) {
    if (imp.error.code === '23505') return { ok: false, duplicada: true };
    throw new Error(`vigia.import_insert: ${imp.error.message}`);
  }
  const id = String((imp.data as Fila).id);
  try {
    for (let i = 0; i < ordenados.length; i += LOTE) {
      const r = await acotada(db.from('vigia_historial_mensaje').insert(ordenados.slice(i, i + LOTE).map((m) => ({
        tenant_id: tenantId, import_id: id, grupo_id: e.grupoId, enviado_en: m.enviadoEn, rol: m.rol, autor_hash: m.autorHash, texto: m.texto,
      }))), 'vigia.import_mensajes');
      if (r.error) throw new Error(`vigia.import_mensajes: ${r.error.message}`);
    }
  } catch (err) {
    await acotada(db.from('vigia_historial_import').delete().eq('tenant_id', tenantId).eq('id', id), 'vigia.import_deshacer').catch(() => {});
    throw err;
  }
  return { ok: true, id };
}

const TOPE_ANALISIS = 50_000;

/** Los mensajes importados de un grupo (o de todos), en orden, hasta el tope del análisis. `null` = base sin la 0484. */
export async function leerMensajesHistorial(tenantId: string, grupoId: string | null): Promise<{ mensajes: MensajeHistorial[]; truncado: boolean } | null> {
  const db = supabaseAdmin();
  const salida: MensajeHistorial[] = [];
  const PAGINA = 1000;
  for (let desde = 0; desde < TOPE_ANALISIS; desde += PAGINA) {
    let q = db.from('vigia_historial_mensaje').select('enviado_en, rol, autor_hash, texto').eq('tenant_id', tenantId);
    if (grupoId) q = q.eq('grupo_id', grupoId);
    const r = await acotada(q.order('enviado_en').order('id').range(desde, desde + PAGINA - 1), 'vigia.leer_historial');
    if (esSinTabla(r.error)) return null;
    if (r.error) throw new Error(`vigia.leer_historial: ${r.error.message}`);
    const filas = (r.data ?? []) as Fila[];
    for (const f of filas) {
      salida.push({ enviadoEn: String(f.enviado_en), rol: f.rol === 'equipo' ? 'equipo' : 'cliente', autorHash: String(f.autor_hash), texto: String(f.texto) });
    }
    if (filas.length < PAGINA) return { mensajes: salida, truncado: false };
  }
  return { mensajes: salida, truncado: true };
}

/** Borra un grupo con todo su histórico (cascada). `false` = no existía en esta flota. */
export async function borrarGrupo(tenantId: string, grupoId: string): Promise<boolean> {
  const r = await acotada(supabaseAdmin().from('vigia_grupo').delete().eq('tenant_id', tenantId).eq('id', grupoId).select('id'), 'vigia.borrar_grupo');
  if (r.error) throw new Error(`vigia.borrar_grupo: ${r.error.message}`);
  return ((r.data ?? []) as Fila[]).length > 0;
}
