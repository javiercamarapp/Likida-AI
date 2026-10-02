import { supabaseAdmin } from '@/lib/supabase/admin';
import { acotada } from '@/lib/likida/presupuesto';
import { anotarBitacora } from '@/lib/likida/bitacora_escritura';
import {
  LLAVE_PRESUPUESTO_LLM_TENANT, olvidarTopesDeTenant, pisoTopeTenantUsd, topeDiarioDelTenant, type OrigenTopeTenant,
} from '@/lib/llm/budget';
import { getPresupuestoPorProposito } from '@/lib/admin/consumo';

// ═══════════════════════════════════════════════════════════════════════════
// /admin/techo-ia — EL TECHO DIARIO DE IA POR FLOTA, A LA VISTA Y EDITABLE (Ola 9).
//
// Hasta hoy el techo se movía con una variable de entorno global y un redeploy, o con SQL a mano sobre
// `tenant.config.presupuestoLlmUsdDia`. `/admin/consumo` lo PINTA pero no deja moverlo (INVENTARIO,
// «Presupuesto IA por propósito»). Aquí cada flota muestra de dónde sale su techo (declarado / plan /
// piso), cuánto lleva gastado y reservado HOY, y el superadmin lo fija o lo quita.
//
// Lo que NO hace: no resuelve el techo por su cuenta (usa `topeDiarioDelTenant`, la MISMA función que
// aplica el presupuesto: lo que se ve es lo que se aplica) y no inventa un gasto cuando no puede leerlo
// (`usadoHoyUsd: null` = no se pudo medir, jamás un 0).
// ═══════════════════════════════════════════════════════════════════════════

/** Rango que la RPC 0682 vuelve a validar en la base. */
export const TECHO_IA_MIN_USD = 0.10;
export const TECHO_IA_MAX_USD = 1000;
/** Cuántas flotas se listan: el panel es del superadmin y el costo es una lectura por flota. */
export const MAX_FLOTAS_TECHO = 150;

export interface FilaTechoIa {
  tenantId: string;
  nombre: string;
  /** El techo que de verdad aplica hoy (el de `topeDiarioDelTenant`). */
  topeUsd: number;
  origen: OrigenTopeTenant;
  /** Lo declarado en `tenant.config`, o null si la flota no declaró. */
  declaradoUsd: number | null;
  /** Liquidado + reservado vivo hoy; null = no se pudo medir. */
  usadoHoyUsd: number | null;
  /** 0–100 sobre el techo; null si no hay gasto medido. */
  pctUsado: number | null;
}

export interface TechosIa {
  filas: FilaTechoIa[];
  pisoUsd: number;
  /** Hubo más flotas que `MAX_FLOTAS_TECHO`. */
  truncado: boolean;
  /** El gasto de hoy no se pudo leer (el resto sí): la pantalla lo dice. */
  gastoIlegible: boolean;
}

/** Lo que el formulario manda → un número válido, null (quitar) o un error dicho. Puro. */
export function validarTechoUsd(crudo: unknown): { ok: true; usd: number | null } | { ok: false; error: string } {
  if (crudo === null || crudo === undefined) return { ok: true, usd: null };
  const texto = String(crudo).trim().replace(/^\$/, '').replace(/,/g, '');
  if (texto === '') return { ok: true, usd: null };
  const [entero, decimales, ...resto] = texto.split('.');
  if (resto.length > 0 || !/^\d+$/.test(entero) || (decimales !== undefined && !/^\d{1,2}$/.test(decimales))) return { ok: false, error: 'Escribe un monto en dólares, por ejemplo 25 o 25.50.' };
  const n = Number(texto);
  if (n < TECHO_IA_MIN_USD || n > TECHO_IA_MAX_USD) {
    return { ok: false, error: `El techo diario va de ${TECHO_IA_MIN_USD.toFixed(2)} a ${TECHO_IA_MAX_USD} USD. Para apagar la IA de una flota usa el interruptor, no un techo de cero.` };
  }
  return { ok: true, usd: n };
}

export function declaradoDe(config: unknown): number | null {
  if (!config || typeof config !== 'object') return null;
  const v = (config as Record<string, unknown>)[LLAVE_PRESUPUESTO_LLM_TENANT];
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
}

async function enLotes<T, R>(items: T[], tamano: number, f: (x: T) => Promise<R>): Promise<R[]> {
  const salida: R[] = [];
  for (let i = 0; i < items.length; i += tamano) salida.push(...(await Promise.all(items.slice(i, i + tamano).map(f))));
  return salida;
}

/** LANZA si la lista de flotas no se puede leer: una pantalla de techos que no ve las flotas no debe pintar «ninguna». */
export async function getTechosIa(): Promise<TechosIa> {
  const r = await acotada(
    supabaseAdmin().from('tenant').select('id, nombre, config').not('nombre', 'ilike', 'ZZZ %').order('nombre').limit(MAX_FLOTAS_TECHO + 1),
    'techoIa.tenants',
  );
  if (r.error) throw new Error(`getTechosIa: ${r.error.message}`);
  const todas = (r.data ?? []) as Array<{ id: string; nombre: string; config: unknown }>;
  const truncado = todas.length > MAX_FLOTAS_TECHO;
  const tenants = todas.slice(0, MAX_FLOTAS_TECHO);

  const usado = new Map<string, number>();
  let gastoIlegible = false;
  try {
    const p = await getPresupuestoPorProposito();
    for (const f of p.filas) usado.set(f.tenantId, (usado.get(f.tenantId) ?? 0) + f.liquidadoUsd + f.reservadoVivoUsd);
  } catch {
    gastoIlegible = true;
  }

  const filas = await enLotes(tenants, 8, async (t): Promise<FilaTechoIa> => {
    const tope = await topeDiarioDelTenant(t.id);
    const u = gastoIlegible ? null : Number((usado.get(t.id) ?? 0).toFixed(4));
    return {
      tenantId: t.id,
      nombre: t.nombre,
      topeUsd: tope.topeUsd,
      origen: tope.origen,
      declaradoUsd: declaradoDe(t.config),
      usadoHoyUsd: u,
      pctUsado: u === null || tope.topeUsd <= 0 ? null : Math.min(100, Math.round((u / tope.topeUsd) * 100)),
    };
  });
  return { filas, pisoUsd: pisoTopeTenantUsd(), truncado, gastoIlegible };
}

export type ResultadoFijarTecho = { ok: true; antes: number | null; despues: number | null } | { ok: false; error: string };

/**
 * Fija (usd) o quita (null) el techo de una flota por la RPC 0682 y lo anota en la bitácora. El techo
 * cacheado de ESTA instancia se olvida al instante; las demás lo toman en ≤ 1 min (TTL de `budget.ts`).
 */
export async function fijarTechoIa(
  tenantId: string,
  usd: number | null,
  actor: { id?: string | null; email?: string | null },
): Promise<ResultadoFijarTecho> {
  if (!/^[0-9a-f-]{36}$/i.test(tenantId)) return { ok: false, error: 'Flota inválida.' };
  const v = validarTechoUsd(usd);
  if (!v.ok) return v;
  const r = await acotada(
    supabaseAdmin().rpc('fijar_techo_ia_tenant', { p_tenant: tenantId, p_usd: v.usd }),
    'techoIa.fijar',
  );
  if (r.error) return { ok: false, error: `No se pudo guardar el techo: ${r.error.message}` };
  const d = (r.data ?? {}) as { ok?: unknown; motivo?: unknown; antes?: unknown; despues?: unknown };
  if (d.ok !== true) return { ok: false, error: d.motivo === 'flota_inexistente' ? 'Esa flota ya no existe.' : 'La base no confirmó el cambio.' };
  const antes = typeof d.antes === 'number' ? d.antes : null;
  const despues = typeof d.despues === 'number' ? d.despues : null;
  olvidarTopesDeTenant();
  await anotarBitacora(
    {
      tenantId, actor, accion: despues === null ? 'techo_ia.quitado' : 'techo_ia.fijado', entidad: 'tenant', entidadId: tenantId,
      detalle: { antesUsd: antes, despuesUsd: despues },
    },
    { evento: 'techo_ia.bitacora_no_escribio', contexto: { tenantId } },
  );
  return { ok: true, antes, despues };
}
