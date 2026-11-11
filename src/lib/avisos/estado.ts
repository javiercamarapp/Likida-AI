// Estado PERSISTENTE de los avisos por persona (migración 1002): qué ya leyó, qué tipos recibe por qué canal y su horario de silencio.
// Se habla con la base con la llave de servicio (`clienteAvisos`): las tablas no tienen privilegios para anon ni authenticated (mig. 1002). Por
// eso TODA función recibe la persona y el ámbito ya resueltos por el servidor y filtra por ellos. Fallar cerrado y decirlo:
// supabase-js devuelve el error POR VALOR; aquí se comprueba siempre y se propaga como `{ ok: false }`, nunca como «no hay nada».
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  claveAmbito, esCanal, esCategoriaDe, SILENCIO_POR_OMISION, validarSilencio,
  type Ambito, type Canal, type Categoria, type Preferencia, type Silencio,
} from './modelo';

export type Resultado<T> = ({ ok: true } & T) | { ok: false; error: string };

/** Tope de claves leídas que se traen y se conservan por persona y ámbito (la base poda las más viejas). */
export const TOPE_LEIDAS = 1000;

export async function leerLeidas(db: SupabaseClient, ambito: Ambito, userId: string): Promise<Resultado<{ leidas: Set<string> }>> {
  try {
    // orden-no-importa: la poda de aviso_marcar deja a lo más 1000 claves por persona y ámbito, así que el límite nunca corta; el orden solo fija el desempate
    const { data, error } = await db.from('aviso_leido').select('clave').eq('usuario_id', userId).eq('ambito', claveAmbito(ambito)).order('leido_en', { ascending: false }).order('clave').limit(TOPE_LEIDAS);
    if (error) return { ok: false, error: error.message };
    return { ok: true, leidas: new Set((data ?? []).map((f) => String((f as { clave: unknown }).clave))) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'lectura caída' };
  }
}

/** Marca (o desmarca) claves como leídas, atómico en la base (`aviso_marcar`). Devuelve cuántas filas cambiaron. */
export async function marcarLeidas(db: SupabaseClient, ambito: Ambito, userId: string, claves: readonly string[], leido: boolean): Promise<Resultado<{ cambiadas: number }>> {
  if (claves.length === 0) return { ok: true, cambiadas: 0 };
  try {
    const { data, error } = await db.rpc('aviso_marcar', { p_usuario: userId, p_ambito: claveAmbito(ambito), p_claves: [...claves], p_leido: leido });
    if (error) return { ok: false, error: error.message };
    return { ok: true, cambiadas: typeof data === 'number' ? data : 0 };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'escritura caída' };
  }
}

export async function leerPreferencias(db: SupabaseClient, ambito: Ambito, userId: string): Promise<Resultado<{ prefs: Preferencia[] }>> {
  try {
    const { data, error } = await db.from('aviso_preferencia').select('categoria, canal, activo').eq('usuario_id', userId).eq('ambito', claveAmbito(ambito));
    if (error) return { ok: false, error: error.message };
    const prefs: Preferencia[] = [];
    for (const f of (data ?? []) as Array<{ categoria: unknown; canal: unknown; activo: unknown }>) {
      // Una fila con valores fuera del catálogo (un tipo retirado) se ignora: no rompe la pantalla ni inventa una preferencia.
      if (esCategoriaDe(ambito.tipo, f.categoria) && esCanal(f.canal) && typeof f.activo === 'boolean') prefs.push({ categoria: f.categoria, canal: f.canal, activo: f.activo });
    }
    return { ok: true, prefs };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'lectura caída' };
  }
}

export async function guardarPreferencia(db: SupabaseClient, ambito: Ambito, userId: string, categoria: Categoria, canal: Canal, activo: boolean): Promise<Resultado<object>> {
  if (!esCategoriaDe(ambito.tipo, categoria) || !esCanal(canal) || typeof activo !== 'boolean') return { ok: false, error: 'fuera_catalogo' };
  try {
    const { error } = await db.from('aviso_preferencia').upsert(
      { usuario_id: userId, ambito: claveAmbito(ambito), categoria, canal, activo, actualizado_en: new Date().toISOString() },
      { onConflict: 'usuario_id,ambito,categoria,canal' },
    );
    return error ? { ok: false, error: error.message } : { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'escritura caída' };
  }
}

/** Sin fila = el horario por omisión (apagado). Una fila ilegible no se «arregla» con la omisión: se reporta. */
export async function leerSilencio(db: SupabaseClient, ambito: Ambito, userId: string): Promise<Resultado<{ silencio: Silencio; guardado: boolean }>> {
  try {
    const { data, error } = await db.from('aviso_silencio').select('activo, desde, hasta, permite_criticos').eq('usuario_id', userId).eq('ambito', claveAmbito(ambito)).maybeSingle();
    if (error) return { ok: false, error: error.message };
    if (!data) return { ok: true, silencio: SILENCIO_POR_OMISION, guardado: false };
    const f = data as { activo: unknown; desde: unknown; hasta: unknown; permite_criticos: unknown };
    // La base devuelve `time` como HH:MM:SS: se recorta a HH:MM.
    const s = validarSilencio({ activo: f.activo, desde: typeof f.desde === 'string' ? f.desde.slice(0, 5) : f.desde, hasta: typeof f.hasta === 'string' ? f.hasta.slice(0, 5) : f.hasta, permiteCriticos: f.permite_criticos });
    return s ? { ok: true, silencio: s, guardado: true } : { ok: false, error: 'horario guardado con forma inválida' };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'lectura caída' };
  }
}

export async function guardarSilencio(db: SupabaseClient, ambito: Ambito, userId: string, entrada: unknown): Promise<Resultado<{ silencio: Silencio }>> {
  const s = validarSilencio((entrada ?? {}) as Parameters<typeof validarSilencio>[0]);
  if (!s) return { ok: false, error: 'horario_invalido' };
  try {
    const { error } = await db.from('aviso_silencio').upsert(
      { usuario_id: userId, ambito: claveAmbito(ambito), activo: s.activo, desde: s.desde, hasta: s.hasta, permite_criticos: s.permiteCriticos, actualizado_en: new Date().toISOString() },
      { onConflict: 'usuario_id,ambito' },
    );
    return error ? { ok: false, error: error.message } : { ok: true, silencio: s };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'escritura caída' };
  }
}
