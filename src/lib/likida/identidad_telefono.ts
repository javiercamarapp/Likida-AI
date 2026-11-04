// ═══════════════════════════════════════════════════════════════════════════
// IDENTIDAD POR TELÉFONO — la llave de WhatsApp (F1 lote B, L1H · CT-SEG-07 / X-01 / BK-03).
//
// El mensaje entrante trae SOLO el número, y ese número decide de qué flota es el dinero y la operación. Hasta ahora el bot
// resolvía `operador` y, si no había, `app_user`, cada uno con su propia consulta y sin ver a la otra: un número que era
// operador ACTIVO en la flota A y cuenta de oficina en la flota B resolvía en silencio a la A (la lectura de `operador`
// gana primero), y el vigía de B quedaba sin voz o, peor, con la operación de A.
//
// `resolver_identidad_telefono` (migración 0952) mira las TRES tablas a la vez y devuelve un solo veredicto. Este módulo:
//   · lo pide a la base y lo tipa;
//   · ante `ambigua` (identidades en más de una flota) FALLA CERRADO con `OperadorAmbiguo`, el mismo tipo que el proceso
//     ya sabe contestar ("tu número aparece dado de alta más de una vez… avísale a tu flota");
//   · con la base SIN migrar (la función no existe: 42883 / PGRST202) no hace nada nuevo — sigue el camino de siempre;
//   · con cualquier otro error de lectura NO bloquea el mensaje: devuelve `no_consultada` y lo registra. La consulta de
//     cada tabla de más abajo (`resolveOperador`, `resolverCuentaOficina`) lee la misma base y falla por su cuenta, así
//     que este guardián es un cinturón extra, no la única defensa; bloquear a todos por un blip de esta función sería peor.
//
// Un número que es operador Y cuenta de oficina de la MISMA flota (`misma_flota`) no es ambiguo para la flota: el rol lo
// sigue decidiendo el orden de siempre (operador primero). Lo que nunca se hace es elegir ENTRE flotas.
// ═══════════════════════════════════════════════════════════════════════════

import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { acotada } from './presupuesto';
import { OperadorAmbiguo } from './conv';

export type ResultadoIdentidad = 'ninguna' | 'unica' | 'misma_flota' | 'ambigua' | 'sin_migrar' | 'no_consultada';

export interface IdentidadDeTelefono {
  resultado: ResultadoIdentidad;
  /** `operador` | `app_user` | `vigia_contacto`; solo con `unica`. */
  tipo: string | null;
  /** Solo con `unica` y `misma_flota`. Con `ambigua` NUNCA viene. */
  tenantId: string | null;
  /** Solo con `unica`. */
  refId: string | null;
  filas: number;
  flotas: number;
}

/** Solo los 4 últimos dígitos (misma máscara que `destinatarioEnmascarado`; propia para no depender de `meta/client` en la compuerta del mensaje entrante). */
function destinatarioEnmascarado(telefono: string): string {
  const d = String(telefono ?? '').replace(/[^\d]/g, '');
  return d.length >= 4 ? `***${d.slice(-4)}` : '***';
}

const VEREDICTOS_DE_LA_BASE = new Set(['ninguna', 'unica', 'misma_flota', 'ambigua']);

const vacia = (resultado: ResultadoIdentidad): IdentidadDeTelefono => ({ resultado, tipo: null, tenantId: null, refId: null, filas: 0, flotas: 0 });

/** El veredicto de la base para este número. Nunca lanza: lo que no se pudo leer se dice, no se inventa. */
export async function identidadDeTelefono(telefono: string): Promise<IdentidadDeTelefono> {
  let respuesta: { data: unknown; error: { code?: string; message: string } | null };
  try {
    respuesta = await acotada(
      supabaseAdmin().rpc('resolver_identidad_telefono', { p_telefono: telefono }) as unknown as PromiseLike<{ data: unknown; error: { code?: string; message: string } | null }>,
      'identidadDeTelefono',
    );
  } catch (e) {
    logger.error('identidad_telefono.no_consultada', { para: destinatarioEnmascarado(telefono), err: e instanceof Error ? e.message : String(e) });
    return vacia('no_consultada');
  }
  const { data, error } = respuesta;
  if (error) {
    // Base sin la 0952: la función no existe. No es un fallo, es "todavía no se migró".
    if (error.code === '42883' || error.code === 'PGRST202') return vacia('sin_migrar');
    logger.error('identidad_telefono.no_consultada', { para: destinatarioEnmascarado(telefono), codigo: error.code ?? null, err: error.message });
    return vacia('no_consultada');
  }
  const f = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null | undefined;
  if (!f || typeof f.resultado !== 'string' || !VEREDICTOS_DE_LA_BASE.has(f.resultado)) {
    // Forma rara o sin filas: NO se lee como "ninguna" (eso afirmaría que el número no existe).
    logger.error('identidad_telefono.no_consultada', { para: destinatarioEnmascarado(telefono), err: 'respuesta del resolutor con forma inesperada' });
    return vacia('no_consultada');
  }
  return {
    resultado: f.resultado as ResultadoIdentidad,
    tipo: typeof f.tipo === 'string' ? f.tipo : null,
    tenantId: typeof f.tenant_id === 'string' ? f.tenant_id : null,
    refId: typeof f.ref_id === 'string' ? f.ref_id : null,
    filas: Number(f.filas ?? 0),
    flotas: Number(f.flotas ?? 0),
  };
}

/**
 * Compuerta del mensaje entrante: lanza `OperadorAmbiguo` si el número identifica a personas de MÁS DE UNA flota.
 * En cualquier otro caso devuelve el veredicto y el llamador sigue su camino de siempre.
 */
export async function exigirIdentidadUnica(telefono: string): Promise<IdentidadDeTelefono> {
  const id = await identidadDeTelefono(telefono);
  if (id.resultado === 'ambigua') {
    // Enmascarado (SEG-7): los 4 últimos dígitos alcanzan para cruzar con `telefono_identidad_conflictos()`.
    logger.error('identidad_telefono.ambigua', { para: destinatarioEnmascarado(telefono), filas: id.filas, flotas: id.flotas });
    throw new OperadorAmbiguo(`el teléfono ${destinatarioEnmascarado(telefono)} identifica a más de una flota`);
  }
  return id;
}
