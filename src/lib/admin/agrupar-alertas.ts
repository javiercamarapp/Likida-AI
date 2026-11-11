import type { DecisionGuardia, ItemClasificado, Severidad } from './guardia';
import type { EvaluacionQuema } from './slo-quema';
import { REGLAS_QUEMA } from './slo-quema';

// ═══════════════════════════════════════════════════════════════════════════
// ALERTAS AGRUPADAS POR SÍNTOMA, CON SU RUNBOOK (F14-A, PLAN-MAESTRO §10.3).
//
// Reglas (Google SRE): se alerta de lo que el dueño o el cliente ya sufre, no de la causa; un grupo = un aviso (seis corridas en
// fallo no son seis correos); cada aviso lleva síntoma, SLO afectado y ventana (si aplica), el enlace a su runbook y el último
// cambio visto. PURA: no consulta nada; la guardia le pasa lo que ya leyó.
//
// El enlace al runbook se valida contra el disco en `agrupar-alertas.test.ts`: un aviso que apunta a un archivo que no existe
// es peor que uno sin enlace.
// ═══════════════════════════════════════════════════════════════════════════

export type ClaveSintoma =
  | 'agente_en_fallo' | 'arco_plazo' | 'ticket_vencido' | 'fuente_ciega' | 'espera_decision' | 'slo_quema';

export interface RunbookRef { ruta: string; seccion: string }

/** Un runbook por clase de alerta. Todas las rutas existen en `docs/operacion/` (lo comprueba la prueba). */
export const RUNBOOK_DE: Readonly<Record<ClaveSintoma, RunbookRef>> = {
  agente_en_fallo: { ruta: 'docs/operacion/runbook-incidentes.md', seccion: 'S2: algo dejó de operar' },
  arco_plazo: { ruta: 'docs/operacion/runbook-incidentes.md', seccion: 'S2: algo dejó de operar' },
  ticket_vencido: { ruta: 'docs/operacion/runbook-incidentes.md', seccion: 'S2: algo dejó de operar' },
  espera_decision: { ruta: 'docs/operacion/runbook-incidentes.md', seccion: 'S3: se atiende en el día' },
  fuente_ciega: { ruta: 'docs/operacion/GUARDIA-EN-SERVIDOR.md', seccion: 'Lo que esto NO puede hacer' },
  slo_quema: { ruta: 'docs/operacion/runbook-quema-slo.md', seccion: 'Quema del presupuesto de error' },
};

const SINTOMA: Readonly<Record<ClaveSintoma, { uno: string; varios: (n: number) => string }>> = {
  agente_en_fallo: { uno: 'Un agente dejó de operar', varios: (n) => `${n} corridas de agentes en fallo` },
  arco_plazo: { uno: 'Solicitud ARCO cerca del plazo legal', varios: (n) => `${n} solicitudes ARCO cerca del plazo legal` },
  ticket_vencido: { uno: 'Ticket con SLA vencido', varios: (n) => `${n} tickets con SLA vencido` },
  espera_decision: { uno: 'Algo espera tu decisión', varios: (n) => `${n} cosas esperan tu decisión` },
  fuente_ciega: { uno: 'La guardia no puede ver una fuente', varios: (n) => `La guardia no puede ver ${n} fuentes` },
  slo_quema: { uno: 'Se está consumiendo el presupuesto de error', varios: (n) => `Se consume el presupuesto de error de ${n} objetivos` },
};

export interface GrupoAlerta {
  clave: ClaveSintoma;
  severidad: Severidad;
  sintoma: string;
  /** Cuántos eventos individuales cubre el grupo (un solo aviso). */
  casos: number;
  /** Hasta 3 ejemplos, para reconocerlo sin abrir la bandeja. */
  ejemplos: string[];
  /** Solo en `slo_quema`: el objetivo, la regla disparada y las ventanas. */
  slo: { clave: string; nombre: string; regla: string; ventanas: string } | null;
  runbook: RunbookRef;
}

function sintomaDeItem(i: ItemClasificado): ClaveSintoma {
  if (i.fuente === 'corridas') return 'agente_en_fallo';
  if (i.fuente === 'arco') return i.severidad === 'S3' ? 'espera_decision' : 'arco_plazo';
  if (i.fuente === 'tickets') return i.severidad === 'S3' ? 'espera_decision' : 'ticket_vencido';
  return 'espera_decision';
}

const SEV_ORDEN: Readonly<Record<Severidad, number>> = { S1: 0, S2: 1, S3: 2, no_incidente: 3 };

export interface EntradaAgrupar {
  items: readonly ItemClasificado[];
  ciegas: ReadonlyArray<{ fuente: string; error: string | null }>;
  /** Evaluaciones de quema; solo `nivel === 'pagina'` entra a un aviso (el ticket no despierta a nadie). */
  quema?: ReadonlyArray<EvaluacionQuema>;
}

/** PURA. Agrupa por síntoma y severidad; el orden es del más grave al menos grave y, a igual gravedad, del grupo mayor. */
export function agruparAlertas(e: EntradaAgrupar): GrupoAlerta[] {
  const grupos = new Map<string, GrupoAlerta>();
  const sumar = (clave: ClaveSintoma, severidad: Severidad, ejemplo: string) => {
    const k = `${clave}|${severidad}`;
    const g = grupos.get(k) ?? { clave, severidad, sintoma: '', casos: 0, ejemplos: [], slo: null, runbook: RUNBOOK_DE[clave] };
    g.casos++;
    if (g.ejemplos.length < 3) g.ejemplos.push(ejemplo);
    grupos.set(k, g);
  };
  for (const i of e.items) sumar(sintomaDeItem(i), i.severidad, `${i.titulo} — ${i.flota}`);
  for (const f of e.ciegas) sumar('fuente_ciega', 'S2', f.fuente);

  const lista = [...grupos.values()];
  for (const q of e.quema ?? []) {
    if (q.nivel !== 'pagina') continue;
    const regla = REGLAS_QUEMA.find((r) => r.id === q.regla);
    const ventanas = regla ? `${regla.larga} y ${regla.corta}, quema ≥ ${regla.umbral}` : 'dos ventanas';
    lista.push({
      clave: 'slo_quema', severidad: 'S2', sintoma: '', casos: 1, ejemplos: [q.nombre],
      slo: { clave: q.clave, nombre: q.nombre, regla: q.regla ?? 'desconocida', ventanas }, runbook: RUNBOOK_DE.slo_quema,
    });
  }
  // Las quemas se juntan en un solo grupo: dos objetivos quemándose no son dos páginas.
  const quemas = lista.filter((g) => g.clave === 'slo_quema');
  const resto = lista.filter((g) => g.clave !== 'slo_quema');
  if (quemas.length > 0) {
    resto.push({
      ...quemas[0], casos: quemas.length, ejemplos: quemas.map((g) => g.ejemplos[0]).slice(0, 3),
      slo: quemas[0].slo,
    });
  }
  for (const g of resto) g.sintoma = g.casos === 1 ? SINTOMA[g.clave].uno : SINTOMA[g.clave].varios(g.casos);
  return resto.sort((a, b) => SEV_ORDEN[a.severidad] - SEV_ORDEN[b.severidad] || b.casos - a.casos);
}

/** La línea de aviso de un grupo: síntoma, ejemplos, SLO/ventana y runbook. */
export function lineaDeGrupo(g: GrupoAlerta, ultimoCambio?: string | null): string {
  const ej = g.ejemplos.length > 0 ? ` (${g.ejemplos.join('; ')}${g.casos > g.ejemplos.length ? `; y ${g.casos - g.ejemplos.length} más` : ''})` : '';
  const slo = g.slo ? ` · SLO: ${g.slo.nombre} · ${g.slo.ventanas}` : '';
  const cambio = ultimoCambio ? ` · último cambio visto: ${ultimoCambio}` : '';
  return `[${g.severidad}] ${g.sintoma}${ej}${slo} · runbook: ${g.runbook.ruta} (${g.runbook.seccion})${cambio}`;
}

/**
 * Las líneas del aviso de la guardia, agrupadas. Sustituye a `lineasDeAviso` en el cron: un solo renglón por síntoma y
 * severidad en vez de uno por evento. Lo que NO es S1/S2 nuevo no entra (igual que antes).
 */
export function lineasAgrupadas(
  d: Pick<DecisionGuardia, 'nuevos' | 'ciegasNuevas'> & { desborde?: DecisionGuardia['desborde'] },
  opts: { quema?: ReadonlyArray<EvaluacionQuema>; ultimoCambio?: string | null; tope?: number } = {},
): string[] {
  const grupos = agruparAlertas({ items: d.nuevos, ciegas: d.ciegasNuevas, quema: opts.quema });
  const lineas = grupos.map((g) => lineaDeGrupo(g, opts.ultimoCambio));
  if (d.desborde?.hayNuevos) {
    lineas.unshift(`[S2] Hay ${d.desborde.cuantos} urgentes vigentes por encima del tope de seguimiento: se siguen como conjunto, revisa la bandeja. · runbook: ${RUNBOOK_DE.agente_en_fallo.ruta}`);
  }
  return lineas.slice(0, opts.tope ?? 20);
}
