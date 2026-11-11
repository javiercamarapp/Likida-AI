import { moduloProximamenteDeRuta, puedeVerRuta, type PerfilTenant } from '@/lib/auth/visibilidad';
import { AGENTES_INSIGHT, PESO_SEVERIDAD, type AgenteInsight, type Insight } from '@/lib/likida/insights/tipos';
import { InicioCincoV2 } from './inicio-cinco-v2';
import type { RangoResumen } from './resumen-datos';

// ═══════════════════════════════════════════════════════════════════════════
// EL RESUMEN DE UNA FLOTA CON PERFIL `cinco_agentes` (mig. 0770).
//
// Reemplaza al Resumen de siempre SOLO bajo el perfil: los cinco agentes, cada uno con su enlace y con el indicador que ya
// existe y es verdad para todos (cuándo corrió por última vez y cómo terminó, `agente_corrida`). Sin corrida registrada se
// dice «sin corridas registradas», nunca un cero con cara de medición. Este archivo lee los insights por agente
// (`leerInsightsResumen`) y delega el dibujo en `InicioCincoV2`; el respaldo v1 se retiró el 11-nov-2026 (ninguna flota lo usaba).
// ═══════════════════════════════════════════════════════════════════════════

export { FICHAS_CINCO_AGENTES, type FichaAgente } from './inicio-cinco-fichas';
import { FICHAS_CINCO_AGENTES } from './inicio-cinco-fichas';

/**
 * Lectores de insights por agente: cada frente registra aquí el suyo cuando su regla
 * (`Regla<D>` + `componer`) ya tenga datos reales. Mientras un agente no tenga lector, su
 * tarjeta dice el vacío llano: nunca se inventa una cifra para llenar el hueco.
 */
export type LectorInsights = (tenantId: string) => Promise<readonly Insight[]>;
export const LECTORES_INSIGHTS: Partial<Record<AgenteInsight, LectorInsights>> = {};

/** `null` = la lectura falló (se confiesa); `[]` = no hay nada que decir todavía. */
export type InsightsPorAgente = Record<AgenteInsight, readonly Insight[] | null>;

/** El más grave (urgente > atención > info); en empate, el primero declarado. Pura. */
export function insightMasSevero(lista: readonly Insight[]): Insight | null {
  let mejor: Insight | null = null;
  for (const i of lista) {
    if (mejor === null || PESO_SEVERIDAD[i.severidad] > PESO_SEVERIDAD[mejor.severidad]) mejor = i;
  }
  return mejor;
}

/**
 * Los agentes cuyo insight ESTE rol puede ver en ESTE perfil: su pantalla la abre `puedeVerRuta` y no está en «Próximamente».
 * Es la compuerta de los lectores: un agente que el rol no ve no se LEE (ni se pinta), así que poblar `LECTORES_INSIGHTS`
 * no filtra datos de un área ajena (p. ej. los de dinero al encargado) ni consulta módulos en stand-by.
 */
export function agentesInsightVisibles(rol: string, perfil: PerfilTenant | null = null): AgenteInsight[] {
  return FICHAS_CINCO_AGENTES
    .filter((f) => puedeVerRuta(rol, f.href, perfil) && !(perfil && moduloProximamenteDeRuta(perfil, f.href)))
    .map((f) => f.insight);
}

export async function leerInsightsPorAgente(
  tenantId: string,
  lectores: Partial<Record<AgenteInsight, LectorInsights>> = LECTORES_INSIGHTS,
  /** Solo se leen estos agentes (`agentesInsightVisibles`); los demás quedan en `[]` sin llamar a su lector. Sin lista: todos. */
  visibles?: readonly AgenteInsight[],
): Promise<InsightsPorAgente> {
  const claves = FICHAS_CINCO_AGENTES.map((f) => f.insight);
  const pares = await Promise.all(
    claves.map(async (a) => {
      const lector = lectores[a];
      if (!lector || (visibles && !visibles.includes(a))) return [a, []] as const;
      try {
        return [a, await lector(tenantId)] as const;
      } catch {
        return [a, null] as const;
      }
    }),
  );
  return Object.fromEntries(pares) as InsightsPorAgente;
}

/**
 * Lo que el Resumen v2 necesita de los insights: el más grave de cada agente VISIBLE para el rol, y los agentes cuyo lector
 * FALLÓ (`null`), que se confiesan en la pantalla en vez de omitirse (omitirlos se leería como «sin pendientes»).
 */
export function resumirInsights(insights: InsightsPorAgente, visibles: readonly AgenteInsight[]): { principales: Insight[]; fallidos: AgenteInsight[] } {
  const principales: Insight[] = [];
  const fallidos: AgenteInsight[] = [];
  for (const a of AGENTES_INSIGHT) {
    if (!visibles.includes(a)) continue;
    const lista = insights[a];
    if (lista === null) { fallidos.push(a); continue; }
    const mas = insightMasSevero(lista);
    if (mas) principales.push(mas);
  }
  return { principales, fallidos };
}

export async function leerInsightsResumen(
  tenantId: string, rol: string, perfil: PerfilTenant | null,
  lectores: Partial<Record<AgenteInsight, LectorInsights>> = LECTORES_INSIGHTS,
): Promise<{ principales: Insight[]; fallidos: AgenteInsight[] }> {
  const visibles = agentesInsightVisibles(rol, perfil);
  return resumirInsights(await leerInsightsPorAgente(tenantId, lectores, visibles), visibles);
}

export async function InicioCincoAgentes({
  tenantId, tenantNombre, nombre, tenantExiste = true, sufijo = '', userId, soloLectura = false, veAsistente = false, rango, rol = '',
}: {
  tenantId: string;
  tenantNombre: string | null;
  nombre: string | null;
  tenantExiste?: boolean;
  sufijo?: string;
  userId?: string | null;
  soloLectura?: boolean;
  /** ¿El rol puede abrir Puesta en marcha? (lo decide la página con `puedeVerRuta`; por omisión NO: falla cerrado). */
  veAsistente?: boolean;
  /** Periodo elegido en la barra de filtros (`?rango=`). */
  rango?: RangoResumen;
  /** Rol efectivo (decide qué enlaces e insights se ofrecen en el Resumen). Por omisión vacío: falla cerrado. */
  rol?: string;
}) {
  const { principales, fallidos } = await leerInsightsResumen(tenantId, rol, 'cinco_agentes');
  return (
    <InicioCincoV2
      tenantId={tenantId} userId={userId ?? 'sin-usuario'} tenantNombre={tenantNombre} nombre={nombre} tenantExiste={tenantExiste}
      sufijo={sufijo} soloLectura={soloLectura} veAsistente={veAsistente} rango={rango} rol={rol}
      principales={principales} fallidos={fallidos}
    />
  );
}
