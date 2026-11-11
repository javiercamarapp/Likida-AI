// ═══════════════════════════════════════════════════════════════════════════
// BRIEFING «DECIDE HOY» DEL COPILOTO (F5, mejora 3 de la sección 2 del plan).
//
// Junta lo que de verdad pide una decisión del dueño: agentes parados, bandeja de aprobaciones vencida e incidentes S1/S2 de la
// guardia. Cada tarjeta lleva la decisión propuesta y la pantalla donde se toma; NUNCA ejecuta nada (las acciones pasan por el
// Copiloto con confirmación). Una fuente que no se pudo leer se declara como «ciega»: jamás se reporta como «sin pendientes».
// La construcción de las tarjetas es PURA (`tarjetasDeBriefing`) para poder probarla sin base.
// ═══════════════════════════════════════════════════════════════════════════

import { getAgentesParados, type AgentesParados } from './agentes-parados';
import { contarVencidas, type ResumenVencidas } from './cola-aprobacion';
import { clasificacionDeGuardia, type ClasificacionGuardia } from './guardia';
import { logger } from '@/lib/logger';

export type SeveridadTarjeta = 'alta' | 'media' | 'info';

export interface TarjetaDecision {
  id: 'agentes_parados' | 'bandeja_vencida' | 'incidentes' | 'sin_pendientes';
  severidad: SeveridadTarjeta;
  titulo: string;
  detalle: string;
  /** La decisión que se propone, en una oración. */
  decision: string;
  /** Pantalla donde se toma (ruta de /admin que existe). */
  href: string | null;
  /** Pregunta lista para hacerle al Copiloto sobre este punto. */
  pregunta: string;
}

export interface Briefing {
  tarjetas: TarjetaDecision[];
  /** Fuentes que no se pudieron leer: el briefing NO afirma nada sobre ellas. */
  fuentesCiegas: string[];
}

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

/** Pura. `null` en una entrada = esa fuente no se pudo leer. */
export function tarjetasDeBriefing(e: {
  parados: AgentesParados | null;
  vencidas: ResumenVencidas | null;
  guardia: ClasificacionGuardia | null;
}): Briefing {
  const tarjetas: TarjetaDecision[] = [];
  const fuentesCiegas: string[] = [];

  if (e.parados === null) fuentesCiegas.push('Agentes parados');
  else if (e.parados.parados.length > 0) {
    const n = e.parados.parados.length;
    tarjetas.push({
      id: 'agentes_parados', severidad: 'alta',
      titulo: `${plural(n, 'agente lleva', 'agentes llevan')} ${e.parados.umbralHoras} horas o más sin correr`,
      detalle: `De ${e.parados.habilitados} agentes habilitados en el runner. El motivo de cada salto sale del último latido del runner.`,
      decision: 'Ver por qué no corren y, si es la bandeja llena, archivar lo vencido.',
      href: '/admin/agentes',
      pregunta: '¿Qué agentes están parados y por qué no corren?',
    });
  }

  if (e.vencidas === null) fuentesCiegas.push('Bandeja de aprobaciones');
  else if (e.vencidas.vencidas > 0) {
    tarjetas.push({
      id: 'bandeja_vencida', severidad: 'media',
      titulo: `${plural(e.vencidas.vencidas, 'pieza espera', 'piezas esperan')} más de ${e.vencidas.dias} días en la bandeja`,
      detalle: 'Una bandeja llena frena a los agentes que fabrican piezas (contrapresión del runner).',
      decision: 'Archivar el lote vencido, empezando por un conteo sin escribir.',
      href: '/admin/aprobaciones',
      pregunta: '¿Cuántas piezas vencidas hay en la bandeja de aprobaciones, de qué tipo?',
    });
  }

  if (e.guardia === null) fuentesCiegas.push('Incidentes (guardia)');
  else {
    for (const c of e.guardia.fuentesCiegas) fuentesCiegas.push(`Escalaciones: ${c.fuente}`);
    const graves = e.guardia.porSeveridad.S1 + e.guardia.porSeveridad.S2;
    if (graves > 0) {
      tarjetas.push({
        id: 'incidentes', severidad: 'alta',
        titulo: `${plural(graves, 'incidente grave abierto', 'incidentes graves abiertos')} (S1 y S2)`,
        detalle: `S1: ${e.guardia.porSeveridad.S1} · S2: ${e.guardia.porSeveridad.S2}. La severidad la fija una regla determinista, no el modelo.`,
        decision: 'Abrir Escalaciones y resolver primero lo más viejo.',
        href: '/admin/escalaciones',
        pregunta: '¿Qué incidentes graves hay y cuál atiendo primero?',
      });
    }
  }

  if (tarjetas.length === 0 && fuentesCiegas.length === 0) {
    tarjetas.push({
      id: 'sin_pendientes', severidad: 'info',
      titulo: 'Nada exige tu decisión ahora',
      detalle: 'Agentes, bandeja de aprobaciones e incidentes graves se leyeron sin pendientes.',
      decision: 'Ninguna.',
      href: null,
      pregunta: '¿Cómo va el negocio hoy?',
    });
  }
  const orden: Record<SeveridadTarjeta, number> = { alta: 0, media: 1, info: 2 };
  tarjetas.sort((a, b) => orden[a.severidad] - orden[b.severidad]);
  return { tarjetas, fuentesCiegas };
}

async function leer<T>(nombre: string, fn: () => Promise<T>): Promise<T | null> {
  try { return await fn(); } catch (e) {
    logger.warn('copiloto_briefing.fuente_ciega', { fuente: nombre, err: e instanceof Error ? e.message : String(e) });
    return null;
  }
}

/** La lectura. Cada fuente cae por separado; NUNCA lanza. */
export async function armarBriefing(ahoraMs: number = Date.now()): Promise<Briefing> {
  const [parados, vencidas, guardia] = await Promise.all([
    leer('parados', () => getAgentesParados(ahoraMs)),
    leer('vencidas', () => contarVencidas({}, ahoraMs)),
    leer('guardia', () => clasificacionDeGuardia(ahoraMs)),
  ]);
  return tarjetasDeBriefing({ parados, vencidas, guardia });
}
