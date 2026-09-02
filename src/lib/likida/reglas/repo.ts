// ═══════════════════════════════════════════════════════════════════════════
// EL REPOSITORIO DE REGLAS (0229) — el único escritor de `regla_vigilancia`.
//
// Dos clases de función conviven aquí a propósito, con contratos distintos:
//
//  · Las que atiende una PERSONA (crear, confirmar, pausar, borrar, listar)
//    devuelven el error POR VALOR. Una server action tiene que poder pintar
//    "esa regla ya la tienes declarada" sin atrapar excepciones.
//  · Las que atiende el CRON (`reglasActivas`, `sellarDisparo`) LANZAN. Un
//    barrido que no pudo leer sus reglas no puede reportar "ninguna regla
//    disparó": eso se lee igual que una flota tranquila.
// ═══════════════════════════════════════════════════════════════════════════
import { supabaseAdmin } from '@/lib/supabase/admin';
import { acotada } from '../presupuesto';
import { anotarBitacora } from '../bitacora_escritura';
import { logger } from '@/lib/logger';
import {
  CATALOGO, esPlantilla, validarParams,
  type PlantillaId, type ParamsCualquiera, type CanalAviso,
} from './catalogo';
import type { Disparo } from './lectores';

export type EstadoRegla = 'pendiente' | 'activa' | 'pausada';

export interface ReglaGuardada {
  id: string;
  tenantId: string;
  plantilla: PlantillaId;
  params: ParamsCualquiera;
  textoOriginal: string;
  frase: string;
  estado: EstadoRegla;
  creadaEn: string;
  confirmadaEn: string | null;
  ultimaCorridaEn: string | null;
  ultimoDisparoEn: string | null;
  modelo: string | null;
}

/** Lo que la pantalla necesita para pintar una regla. */
export interface ReglaEnPantalla extends ReglaGuardada {
  titulo: string;
  canal: CanalAviso;
  /** Los últimos disparos, para que "última vez que sonó" tenga un porqué. */
  ultimasEvidencias: Array<{ evidencia: string; disparadoEn: string }>;
}

export type Resultado<T> = { ok: true; valor: T } | { ok: false; error: string };

/** Cuántas reglas puede tener una flota a la vez.
 *
 *  No es una restricción comercial: cada regla activa es una consulta por
 *  corrida horaria y un WhatsApp potencial. Treinta cubre de sobra lo que un
 *  dueño de flota va a querer vigilar, y pone un techo al costo de una
 *  pantalla que invita a escribir. */
export const TOPE_REGLAS_POR_FLOTA = 30;

interface FilaRegla {
  id: string; tenant_id: string; plantilla: string; params: unknown;
  texto_original: string; frase: string; estado: string; creada_en: string;
  confirmada_en: string | null; ultima_corrida_en: string | null;
  ultimo_disparo_en: string | null; modelo: string | null;
}

/**
 * De fila a objeto, VALIDANDO los parámetros contra el catálogo de hoy.
 *
 * `null` = la fila no se puede correr: una plantilla que ya no existe o unos
 * parámetros que dejaron de ser válidos porque el catálogo cambió de dominio.
 * Se descarta con log en vez de correrse a medias — una regla que el lector
 * no entiende no puede mandar un WhatsApp.
 */
export function desdeFila(f: FilaRegla): ReglaGuardada | null {
  if (!esPlantilla(f.plantilla)) {
    logger.warn('reglas.plantilla_desconocida', { regla: f.id, plantilla: f.plantilla });
    return null;
  }
  const v = validarParams(f.plantilla, f.params);
  if (!v.ok) {
    logger.warn('reglas.params_invalidos', { regla: f.id, plantilla: f.plantilla, motivo: v.error });
    return null;
  }
  return {
    id: f.id,
    tenantId: f.tenant_id,
    plantilla: f.plantilla,
    params: v.params,
    textoOriginal: f.texto_original,
    frase: f.frase,
    estado: f.estado as EstadoRegla,
    creadaEn: f.creada_en,
    confirmadaEn: f.confirmada_en,
    ultimaCorridaEn: f.ultima_corrida_en,
    ultimoDisparoEn: f.ultimo_disparo_en,
    modelo: f.modelo,
  };
}

const COLUMNAS = 'id, tenant_id, plantilla, params, texto_original, frase, estado, creada_en, confirmada_en, ultima_corrida_en, ultimo_disparo_en, modelo';

// ── Lo que atiende una persona ─────────────────────────────────────────────

export interface NuevaRegla {
  plantilla: PlantillaId;
  params: ParamsCualquiera;
  textoOriginal: string;
  frase: string;
  modelo: string | null;
  costoUsd: number;
}

/**
 * Guarda la interpretación como regla PENDIENTE. No vigila nada todavía: la
 * base no la deja salir de 'pendiente' sin firma (`regla_activa_confirmada`).
 */
export async function crearReglaPendiente(
  tenantId: string, nueva: NuevaRegla, userId: string | null,
): Promise<Resultado<ReglaGuardada>> {
  const cuantas = await contarReglas(tenantId);
  if (!cuantas.ok) return cuantas;
  if (cuantas.valor >= TOPE_REGLAS_POR_FLOTA) {
    return { ok: false, error: `Ya tienes ${cuantas.valor} reglas declaradas, que es el tope. Borra o pausa alguna antes de agregar otra.` };
  }

  const { data, error } = await acotada(supabaseAdmin()
    .from('regla_vigilancia')
    .insert({
      tenant_id: tenantId,
      plantilla: nueva.plantilla,
      params: nueva.params,
      texto_original: nueva.textoOriginal.trim().slice(0, 400),
      frase: nueva.frase.slice(0, 400),
      estado: 'pendiente',
      creada_por: userId,
      modelo: nueva.modelo,
      costo_usd: nueva.costoUsd > 0 ? nueva.costoUsd : null,
    })
    .select(COLUMNAS)
    .single(), 'reglas.crear');

  if (error) {
    // El índice parcial `regla_vigilancia_unica`: la misma vigilancia con los
    // mismos parámetros ya está viva. Es una respuesta, no un fallo.
    if ((error as { code?: string }).code === '23505') {
      return { ok: false, error: 'Esa misma vigilancia ya está declarada, con esos mismos números.' };
    }
    logger.error('reglas.crear_fallo', { tenant: tenantId, err: error.message });
    return { ok: false, error: 'No se pudo guardar la regla.' };
  }
  const regla = desdeFila(data as unknown as FilaRegla);
  if (!regla) return { ok: false, error: 'La regla se guardó con parámetros que el vigilante no sabe leer. Vuelve a declararla.' };
  return { ok: true, valor: regla };
}

/**
 * La CONFIRMACIÓN HUMANA. Es lo único que enciende una regla, y va anclada
 * por `id + estado='pendiente'`: dos clics del mismo botón no la confirman dos
 * veces ni le cambian la firma.
 */
export async function confirmarRegla(
  tenantId: string, reglaId: string, actor: { id: string; email?: string | null },
): Promise<Resultado<'confirmada'>> {
  const { data, error } = await acotada(supabaseAdmin()
    .from('regla_vigilancia')
    .update({ estado: 'activa', confirmada_por: actor.id, confirmada_en: new Date().toISOString() })
    .eq('tenant_id', tenantId)
    .eq('id', reglaId)
    .eq('estado', 'pendiente')
    .select('id, frase'), 'reglas.confirmar');
  if (error) {
    logger.error('reglas.confirmar_fallo', { tenant: tenantId, regla: reglaId, err: error.message });
    return { ok: false, error: 'No se pudo confirmar la regla.' };
  }
  if (!data || (data as unknown[]).length === 0) {
    return { ok: false, error: 'Esa regla ya no está esperando confirmación.' };
  }
  await anotarBitacora({
    tenantId, actor, accion: 'regla.confirmada', entidad: 'regla_vigilancia', entidadId: reglaId,
    detalle: { frase: (data as Array<{ frase: string }>)[0].frase },
  }, { evento: 'reglas.bitacora_no_escribio' });
  return { ok: true, valor: 'confirmada' };
}

/** Pausar o reanudar. Una pausada conserva su firma —por eso puede volver a
 *  'activa' sin re-confirmarse— y deja de barrerse en la corrida. */
export async function alternarPausa(
  tenantId: string, reglaId: string, pausar: boolean, actor: { id: string; email?: string | null },
): Promise<Resultado<EstadoRegla>> {
  const destino: EstadoRegla = pausar ? 'pausada' : 'activa';
  const origen: EstadoRegla = pausar ? 'activa' : 'pausada';
  const { data, error } = await acotada(supabaseAdmin()
    .from('regla_vigilancia')
    .update({ estado: destino })
    .eq('tenant_id', tenantId)
    .eq('id', reglaId)
    .eq('estado', origen)
    .select('id'), 'reglas.pausa');
  if (error) {
    logger.error('reglas.pausa_fallo', { tenant: tenantId, regla: reglaId, err: error.message });
    return { ok: false, error: 'No se pudo cambiar el estado de la regla.' };
  }
  if (!data || (data as unknown[]).length === 0) {
    return { ok: false, error: pausar ? 'Esa regla no estaba activa.' : 'Esa regla no estaba pausada.' };
  }
  await anotarBitacora({
    tenantId, actor, accion: pausar ? 'regla.pausada' : 'regla.reanudada',
    entidad: 'regla_vigilancia', entidadId: reglaId,
  }, { evento: 'reglas.bitacora_no_escribio' });
  return { ok: true, valor: destino };
}

/** Borrar. Los sellos se van con ella (FK compuesta con cascade): la regla ya
 *  no existe, así que la memoria de qué le avisó tampoco tiene a quién
 *  pertenecer. */
export async function borrarRegla(
  tenantId: string, reglaId: string, actor: { id: string; email?: string | null },
): Promise<Resultado<'borrada'>> {
  const { data, error } = await acotada(supabaseAdmin()
    .from('regla_vigilancia')
    .delete()
    .eq('tenant_id', tenantId)
    .eq('id', reglaId)
    .select('id'), 'reglas.borrar');
  if (error) {
    logger.error('reglas.borrar_fallo', { tenant: tenantId, regla: reglaId, err: error.message });
    return { ok: false, error: 'No se pudo borrar la regla.' };
  }
  if (!data || (data as unknown[]).length === 0) {
    return { ok: false, error: 'Esa regla ya no existe.' };
  }
  await anotarBitacora({
    tenantId, actor, accion: 'regla.borrada', entidad: 'regla_vigilancia', entidadId: reglaId,
  }, { evento: 'reglas.bitacora_no_escribio' });
  return { ok: true, valor: 'borrada' };
}

async function contarReglas(tenantId: string): Promise<Resultado<number>> {
  const { count, error } = await supabaseAdmin()
    .from('regla_vigilancia')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId);
  if (error || typeof count !== 'number') {
    // Fail-closed: sin poder contar no se agrega. Es preferible un "intenta
    // de nuevo" a rebasar el tope sin enterarse.
    logger.warn('reglas.conteo_ilegible', { tenant: tenantId, err: error?.message });
    return { ok: false, error: 'No se pudo leer cuántas reglas tienes; intenta de nuevo.' };
  }
  return { ok: true, valor: count };
}

/** Las reglas de una flota, con sus últimas evidencias, para la pantalla. */
export async function listarReglas(tenantId: string): Promise<ReglaEnPantalla[]> {
  const { data, error } = await acotada(supabaseAdmin()
    .from('regla_vigilancia')
    .select(COLUMNAS)
    .eq('tenant_id', tenantId)
    .order('creada_en', { ascending: false })
    .limit(TOPE_REGLAS_POR_FLOTA * 2), 'reglas.listar');
  if (error) throw new Error(`listarReglas: ${error.message}`);

  const reglas = ((data ?? []) as unknown as FilaRegla[])
    .map(desdeFila)
    .filter((r): r is ReglaGuardada => r !== null);
  if (reglas.length === 0) return [];

  const { data: sellos, error: errSellos } = await acotada(supabaseAdmin()
    .from('regla_disparo')
    .select('regla_id, evidencia, disparado_en')
    .eq('tenant_id', tenantId)
    .in('regla_id', reglas.map((r) => r.id))
    .order('disparado_en', { ascending: false })
    .limit(200), 'reglas.sellos_recientes');
  if (errSellos) throw new Error(`listarReglas.sellos: ${errSellos.message}`);

  const porRegla = new Map<string, Array<{ evidencia: string; disparadoEn: string }>>();
  for (const s of (sellos ?? []) as Array<{ regla_id: string; evidencia: string; disparado_en: string }>) {
    const lista = porRegla.get(s.regla_id) ?? [];
    if (lista.length < 3) lista.push({ evidencia: s.evidencia, disparadoEn: s.disparado_en });
    porRegla.set(s.regla_id, lista);
  }

  return reglas.map((r) => ({
    ...r,
    titulo: CATALOGO[r.plantilla].titulo,
    canal: CATALOGO[r.plantilla].canal,
    ultimasEvidencias: porRegla.get(r.id) ?? [],
  }));
}

// ── Lo que atiende el cron ─────────────────────────────────────────────────

/**
 * TODAS las reglas activas, de todas las flotas. LANZA si no se pueden leer:
 * un barrido ciego no es un barrido tranquilo.
 */
export async function reglasActivas(tope = 500): Promise<ReglaGuardada[]> {
  const { data, error } = await acotada(supabaseAdmin()
    .from('regla_vigilancia')
    .select(COLUMNAS)
    .eq('estado', 'activa')
    .order('tenant_id')
    .order('creada_en')
    .limit(tope), 'reglas.activas');
  if (error) throw new Error(`reglasActivas: ${error.message}`);
  return ((data ?? []) as unknown as FilaRegla[])
    .map(desdeFila)
    .filter((r): r is ReglaGuardada => r !== null);
}

/** Los sellos que YA existen para esta regla, entre los disparos candidatos.
 *  Una consulta por regla, no una por candidato. */
export async function sellosDe(tenantId: string, reglaId: string, candidatos: Disparo[]): Promise<Set<string>> {
  if (candidatos.length === 0) return new Set();
  const { data, error } = await acotada(supabaseAdmin()
    .from('regla_disparo')
    .select('objeto, objeto_id, clave')
    .eq('tenant_id', tenantId)
    .eq('regla_id', reglaId)
    .in('objeto_id', [...new Set(candidatos.map((c) => c.objetoId))])
    .limit(1_000), 'reglas.sellos');
  if (error) throw new Error(`sellosDe: ${error.message}`);
  return new Set(((data ?? []) as Array<{ objeto: string; objeto_id: string; clave: string }>)
    .map((s) => `${s.objeto}|${s.objeto_id}|${s.clave}`));
}

export function llaveSello(d: Disparo): string {
  return `${d.objeto}|${d.objetoId}|${d.clave}`;
}

/**
 * Sella los disparos que YA se avisaron. Se llama DESPUÉS de mandar, nunca
 * antes: un aviso que no salió se reintenta a la siguiente corrida (el mismo
 * criterio que `avisarVencimientos`). `ignoreDuplicates` hace inofensiva la
 * carrera de dos crons solapados.
 */
export async function sellarDisparos(
  tenantId: string, reglaId: string, disparos: Disparo[],
): Promise<void> {
  if (disparos.length === 0) return;
  const { error } = await acotada(supabaseAdmin()
    .from('regla_disparo')
    .upsert(disparos.map((d) => ({
      tenant_id: tenantId, regla_id: reglaId,
      objeto: d.objeto, objeto_id: d.objetoId, clave: d.clave,
      evidencia: d.evidencia.slice(0, 1_000),
    })), { onConflict: 'tenant_id,regla_id,objeto,objeto_id,clave', ignoreDuplicates: true }),
  'reglas.sellar');
  if (error) throw new Error(`sellarDisparos: ${error.message}`);
}

/** La bitácora de operación de la regla. Best-effort declarado: si no se pudo
 *  anotar, el aviso YA salió y sellado está — perder el contador es menos
 *  grave que fingir que la corrida falló. */
export async function anotarCorrida(
  tenantId: string, reglaId: string, ahora: Date, nuevosDisparos: number,
): Promise<void> {
  const parche: Record<string, unknown> = { ultima_corrida_en: ahora.toISOString() };
  if (nuevosDisparos > 0) parche.ultimo_disparo_en = ahora.toISOString();
  const { error } = await acotada(supabaseAdmin()
    .from('regla_vigilancia')
    .update(parche)
    .eq('tenant_id', tenantId)
    .eq('id', reglaId), 'reglas.anotar_corrida');
  if (error) logger.warn('reglas.corrida_no_anotada', { regla: reglaId, err: error.message });
}
