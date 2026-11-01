import Link from 'next/link';
import { LayoutGrid, Route, Plus, Users, Truck, Container } from 'lucide-react';
import { saludo, ahoraMs } from '@/lib/saludo';
import { fechaMx, fechaHoraMx, hoyMx } from '@/lib/formato';
import { ultimasCorridas, duracionLegible, type AgenteConCorridas, type CorridaRegistrada } from '@/lib/likida/agentes/corridas';
import { BarraPagina, ChipFecha, HeroSaludo, TituloSeccion } from './resumen-visual';
import { AvisoSinFlota } from './sin-flota';
import { Bloque, EsqTabla } from './bloque';
import { moduloProximamenteDeRuta, puedeVerRuta, rutaProximamente, type PerfilTenant } from '@/lib/auth/visibilidad';
import { AGENTES_INSIGHT, PESO_SEVERIDAD, type AgenteInsight, type Insight } from '@/lib/likida/insights/tipos';
import { TarjetaInsight } from './agentes/insights/tarjeta-insight';
import { InicioCincoV2 } from './inicio-cinco-v2';
import type { RangoResumen } from './resumen-datos';

// ═══════════════════════════════════════════════════════════════════════════
// EL RESUMEN DE UNA FLOTA CON PERFIL `cinco_agentes` (mig. 0770).
//
// Reemplaza al Resumen de siempre SOLO bajo el perfil. El de siempre trae KPIs
// fiscales y de dinero, el chat, la suscripción con planes y precios, y las
// alertas de módulos que el perfil deja en stand-by: nada de eso se enseña
// aquí. Lo que hay son los cinco agentes, cada uno con su enlace y con el
// ÚNICO indicador que ya existe y es verdad para todos: cuándo corrió por
// última vez y cómo terminó (`agente_corrida`). Sin corrida registrada se dice
// «sin corridas registradas», nunca un cero con cara de medición. Bajo cada
// agente va su insight más severo (qué pasó · qué significa · qué hacer, T-INS-02/03)
// o el vacío llano; el detalle lo pule cada agente en su propia pantalla.
//
// Cero pesos en esta pantalla (el Resumen es de `operacion`).
// ═══════════════════════════════════════════════════════════════════════════

export { FICHAS_CINCO_AGENTES, type FichaAgente } from './inicio-cinco-fichas';
import { FICHAS_CINCO_AGENTES, type FichaAgente } from './inicio-cinco-fichas';

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

export const TEXTO_VACIO_RESUMEN = 'Todavía no hay datos para interpretar. Cuando llegue el primer archivo, aquí verás qué pasó y qué hacer.';
export const TEXTO_ERROR_RESUMEN = 'No pudimos preparar la interpretación de este agente. Vuelve a cargar en un momento.';
export const TEXTO_PROXIMAMENTE_RESUMEN = 'Todavía no está activo en tu cuenta, por eso aquí no hay nada que interpretar.';

/** Qué se ve bajo cada agente: su insight más severo, el vacío llano, el error o «próximamente». */
export function InsightDeAgente({
  insights, proximamente = false, href, nombre, sufijo = '',
}: {
  insights: readonly Insight[] | null | undefined;
  proximamente?: boolean;
  href: string;
  nombre: string;
  sufijo?: string;
}) {
  const principal = proximamente || !insights ? null : insightMasSevero(insights);
  return (
    <div className="mt-2" data-insight-agente>
      {proximamente ? (
        <p className="card p-3 text-[12px]" style={{ color: 'var(--muted)' }} data-estado="proximamente">{TEXTO_PROXIMAMENTE_RESUMEN}</p>
      ) : insights == null ? (
        <p role="alert" className="card p-3 text-[12px]" style={{ color: 'var(--ink)' }} data-estado="error">{TEXTO_ERROR_RESUMEN}</p>
      ) : principal === null ? (
        <p className="card p-3 text-[12px]" style={{ color: 'var(--muted)' }} data-estado="vacio">{TEXTO_VACIO_RESUMEN}</p>
      ) : (
        <TarjetaInsight insight={principal} />
      )}
      {!proximamente && (
        <Link href={`${href}${sufijo}`} className="inline-block mt-1.5 text-[12px] font-medium underline" style={{ color: 'var(--ink)' }}>
          Abrir {nombre}
        </Link>
      )}
    </div>
  );
}

const ICONO_BARRA = { width: 15, height: 15, strokeWidth: 1.75, style: { color: 'var(--muted)' } } as const;

/** Resuelve a `null` ante cualquier fallo: la tarjeta lo confiesa, nunca lo vuelve un cero. */
async function ultima(tenantId: string, agente: AgenteConCorridas): Promise<CorridaRegistrada | null | undefined> {
  try {
    const l = await ultimasCorridas(tenantId, agente, 1);
    return l[0];
  } catch {
    return null;
  }
}

const ETIQUETA_ESTADO: Record<string, string> = { ok: 'terminó bien', parcial: 'terminó con pendientes', fallo: 'falló' };

function Indicador({ corrida }: { corrida: CorridaRegistrada | null | undefined }) {
  if (corrida === null) {
    return <p className="text-[12px]" style={{ color: 'var(--muted)' }}>No se pudo leer la última corrida.</p>;
  }
  if (corrida === undefined) {
    return <p className="text-[12px]" style={{ color: 'var(--muted)' }}>Sin corridas registradas todavía.</p>;
  }
  const dur = duracionLegible(corrida.duracionMs);
  return (
    <p className="text-[12px]" style={{ color: 'var(--muted)' }}>
      Última corrida: {fechaHoraMx(corrida.inicio)} · {ETIQUETA_ESTADO[corrida.estado] ?? corrida.estado}
      {dur ? ` · ${dur}` : ''}
    </p>
  );
}

export async function TarjetaAgente({ ficha, tenantId, sufijo, insights }: { ficha: FichaAgente; tenantId: string; sufijo: string; insights: InsightsPorAgente }) {
  // «Próximamente» (fase 1): la ficha se ve pero no consulta nada de la flota y su enlace va al anuncio, no a la función.
  const proximamente = moduloProximamenteDeRuta('cinco_agentes', ficha.href);
  const corrida = ficha.corridas && !proximamente ? await ultima(tenantId, ficha.corridas) : undefined;
  return (
    <div data-agente-resumen={ficha.clave}>
    <Link href={`${proximamente ? rutaProximamente(proximamente) : ficha.href}${sufijo}`} className="card p-4 block transition-opacity hover:opacity-85" data-agente={ficha.clave}>
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: 'var(--canvas)', border: '1px solid var(--line)' }}>
          <ficha.Icono width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />
        </div>
        <div className="min-w-0">
          <h3 className="text-[14px] font-medium">
            {ficha.nombre}
            {proximamente && (
              <span className="ml-2 align-middle text-[11px] font-medium px-1.5 py-0.5 rounded-full" style={{ background: 'var(--canvas)', color: 'var(--muted)' }}>Próximamente</span>
            )}
          </h3>
          <p className="text-[12px] mt-0.5" style={{ color: 'var(--ink2)' }}>{ficha.descripcion}</p>
          <div className="mt-2">
            {proximamente ? (
              <p className="text-[12px]" style={{ color: 'var(--muted)' }}>Todavía no está activo en tu cuenta.</p>
            ) : ficha.corridas ? <Indicador corrida={corrida} /> : (
              <p className="text-[12px]" style={{ color: 'var(--muted)' }}>Abre su tablero para ver y aprobar las respuestas.</p>
            )}
          </div>
        </div>
      </div>
    </Link>
    <InsightDeAgente insights={insights[ficha.insight]} proximamente={!!proximamente} href={ficha.href} nombre={ficha.nombre} sufijo={sufijo} />
    </div>
  );
}

const ATAJOS: ReadonlyArray<{ href: string; nombre: string; Icono: typeof Route }> = [
  { href: '/dashboard/despacho', nombre: 'Nuevo viaje', Icono: Plus },
  { href: '/dashboard/viajes', nombre: 'Viajes', Icono: Truck },
  { href: '/dashboard/operadores', nombre: 'Operadores', Icono: Users },
  { href: '/dashboard/unidades', nombre: 'Unidades', Icono: Container },
];

export async function InicioCincoAgentes({
  tenantId, tenantNombre, nombre, tenantExiste = true, sufijo = '', ui = 'v1', userId, soloLectura = false, veAsistente = false, rango, rol = '',
}: {
  tenantId: string;
  tenantNombre: string | null;
  nombre: string | null;
  tenantExiste?: boolean;
  sufijo?: string;
  /** Interfaz con la que se pinta (`versionUi`). Sin 'v2' el Resumen es el de siempre, idéntico. */
  ui?: 'v1' | 'v2';
  userId?: string;
  soloLectura?: boolean;
  /** ¿El rol puede abrir Puesta en marcha? (lo decide la página con `puedeVerRuta`; por omisión NO: falla cerrado). */
  veAsistente?: boolean;
  /** Periodo elegido en la barra de filtros (`?rango=`). Solo lo usa el Inicio v2. */
  rango?: RangoResumen;
  /** Rol efectivo (decide qué enlaces e insights se ofrecen en el Resumen v2). Por omisión vacío: falla cerrado. */
  rol?: string;
}) {
  const diaMx = hoyMx(new Date(ahoraMs()));
  if (ui === 'v2' && userId) {
    const { principales, fallidos } = await leerInsightsResumen(tenantId, rol, 'cinco_agentes');
    return (
      <InicioCincoV2
        tenantId={tenantId} userId={userId} tenantNombre={tenantNombre} nombre={nombre} tenantExiste={tenantExiste}
        sufijo={sufijo} soloLectura={soloLectura} veAsistente={veAsistente} rango={rango} rol={rol}
        principales={principales} fallidos={fallidos}
      />
    );
  }
  const insights = await leerInsightsPorAgente(tenantId);
  return (
    <main className="h-full">
      <div className="rounded-2xl overflow-hidden min-h-full flex flex-col hairline" style={{ background: 'var(--g1)' }}>
        <BarraPagina
          icono={<LayoutGrid {...ICONO_BARRA} />}
          titulo="Resumen"
          derecha={tenantNombre && (
            <span className="inline-block text-[11px] px-2 py-0.5 rounded-full font-medium shrink-0" style={{ color: 'var(--accent-fg)', background: 'var(--accent)' }}>
              viendo como superadmin · {tenantNombre}
            </span>
          )}
        />
        <HeroSaludo
          saludo={saludo()} nombre={nombre ?? 'equipo'}
          tagline="Tus cinco agentes, de un vistazo"
          derecha={<div className="shrink-0 pt-1"><ChipFecha>{fechaMx(diaMx)}</ChipFecha></div>}
        />
        <div className="px-5 pb-5 flex-1">
          {!tenantExiste && <div className="mt-3"><AvisoSinFlota tenantId={tenantId} /></div>}

          <div className="mt-3">
            <TituloSeccion>Agentes</TituloSeccion>
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 mt-2">
              {FICHAS_CINCO_AGENTES.map((f) => (
                <Bloque key={f.clave} mensaje={`No se pudo leer ${f.nombre}.`} esqueleto={<EsqTabla filas={2} titulo={false} />}>
                  <TarjetaAgente ficha={f} tenantId={tenantId} sufijo={sufijo} insights={insights} />
                </Bloque>
              ))}
            </div>
          </div>

          <div className="mt-4">
            <TituloSeccion>Para operarlos</TituloSeccion>
            <div className="flex flex-wrap gap-2 mt-2">
              {ATAJOS.map((a) => (
                <Link key={a.href} href={`${a.href}${sufijo}`}
                  className="hairline h-8 px-3 rounded-lg text-[13px] font-medium inline-flex items-center gap-1.5 transition-opacity hover:opacity-85"
                  style={{ background: 'var(--surface)' }}>
                  <a.Icono width={15} height={15} strokeWidth={1.75} /> {a.nombre}
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
