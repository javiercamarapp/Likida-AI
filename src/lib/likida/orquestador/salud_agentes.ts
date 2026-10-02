import { nombreSeguro } from './resumenes';
import type { Destino } from './escalamiento';

// ═══════════════════════════════════════════════════════════════════════════
// LA SALUD DE LOS AGENTES — pura. «Si un agente falla, el orquestador lo reporta».
//
// Dos señales independientes por agente, y las dos se dicen:
//   · LATIDO: el cron que lo despierta dejó de latir (vencido) o nunca latió.
//     Es una señal de la PLATAFORMA (no de una flota): solo se expone su estado
//     y los minutos, nunca el detalle interno del cron.
//   · CORRIDAS de ESTA flota: la última terminó en fallo/parcial, o no hay
//     ninguna reciente. Se cita el error recortado.
// Más los envíos que se quedaron sin salir (la «cola muerta» DE LA FLOTA: lo del
// Vigía y del buzón; la cola de WhatsApp de la plataforma no lleva tenant y no
// se le enseña a una flota).
// Un agente sin señal de nadie NO es «sano»: es «sin datos».
// ═══════════════════════════════════════════════════════════════════════════

export interface AgenteVigilado {
  id: string; etiqueta: string; cron: string | null; corridas: string | null; pantalla: string;
  /** A quién le toca la tarea `falla_de_agente` que abre el barrido (dominio cerrado de `escalamiento.ts`). */
  destino: Destino;
}

/** Solo pares que de verdad existen en el repo: el cron que despierta a cada agente y su nombre de corridas. */
export const AGENTES_VIGILADOS: readonly AgenteVigilado[] = [
  { id: 'conductor', etiqueta: 'Conductor (ciclo del chofer)', cron: 'conductor-hitos', corridas: 'conductores', pantalla: '/dashboard/agentes/conductores', destino: 'jefe_de_trafico' },
  { id: 'vigia', etiqueta: 'Vigía (servicio al cliente)', cron: 'vigia', corridas: null, pantalla: '/dashboard/agentes/vigia', destino: 'mesa_de_control' },
  { id: 'buzon', etiqueta: 'Buzón de facturas', cron: 'buzon-entrega', corridas: 'facturas', pantalla: '/dashboard/agentes/facturas', destino: 'contador' },
  { id: 'cobranza', etiqueta: 'Cobranza', cron: 'runner', corridas: 'cobranza', pantalla: '/dashboard/agentes/cobranza', destino: 'contador' },
  { id: 'peajes', etiqueta: 'Peajes', cron: 'peajes', corridas: 'peajes', pantalla: '/dashboard/agentes/peajes', destino: 'liquidacion' },
  { id: 'autofactura', etiqueta: 'Autofactura', cron: 'portales-vivos', corridas: null, pantalla: '/dashboard/agentes/facturas', destino: 'contador' },
  { id: 'liquidacion', etiqueta: 'Liquidación', cron: 'liquidaciones-externas', corridas: 'liquidacion', pantalla: '/dashboard/agentes/liquidacion', destino: 'liquidacion' },
  // Carta Porte multiformato (P3, 0640-0642): SÍ entra. Su worker de la bandeja corre en su propio cron (`carta-porte-docs`, cada 5 min)
  // que ya escribe latido; un documento que nadie procesa se queda en «recibido» sin ruido, que es justo lo que este barrido existe para
  // destapar. Sin `corridas`: el worker no escribe `agente_corrida` (su señal es el latido y los eventos de cada documento).
  { id: 'carta_porte', etiqueta: 'Carta Porte (bandeja de documentos)', cron: 'carta-porte-docs', corridas: null, pantalla: '/dashboard/carta-porte/documentos', destino: 'jefe_de_trafico' },
];

export interface LatidoVisto { estado: 'ok' | 'vencido' | 'sin_latido'; haceMin: number | null; ultimoEstado: 'ok' | 'fallo' | 'saltado' | 'parcial' | null }
export interface CorridaVista { estado: 'ok' | 'parcial' | 'fallo'; inicio: string; fin: string | null; error: string | null }

export interface EntradaSalud {
  ahora: Date;
  /** null = no se pudo leer (se dice, no se calla). */
  latidos: Record<string, LatidoVisto> | null;
  /** Por nombre de corridas; la lista viene de la más reciente a la más vieja; null = no se pudo leer. */
  corridas: Record<string, CorridaVista[] | null>;
  /**
   * Qué agentes USA esta flota (por id). El LATIDO es global del entorno: un fallo transitorio de un cron abriría tareas en TODAS las
   * flotas, también en las que no usan ese agente. Con `usa[agente] === false` el latido (vencido o en fallo) se cuenta como problema
   * a la vista pero NO como falla de la flota; las corridas y los envíos sin salir, que sí son de la flota, siguen contando.
   * Sin la llave (o sin el mapa) se asume que lo usa (comportamiento anterior).
   */
  usa?: Record<string, boolean>;
  /** Envíos que no salieron: null = no se pudo contar. */
  enviosSinSalir: { vigiaFallidos24h: number | null; buzonEntregasConProblema: number | null };
}

export type EstadoAgente = 'al_dia' | 'con_problema' | 'sin_datos';

export interface SaludAgente {
  agente: string;
  etiqueta: string;
  estado: EstadoAgente;
  problemas: string[];
  ultimaCorrida: { estado: CorridaVista['estado']; hace: string; error: string | null } | null;
  latido: { estado: LatidoVisto['estado']; haceMin: number | null } | null;
  ver: string;
  /**
   * El subconjunto de `problemas` que es una FALLA de verdad y merece una tarea para una persona (el barrido): el proceso que lo
   * despierta dejó de latir o su último latido falló, su última corrida falló o fallan las recientes, o hay respuestas a clientes
   * sin salir. NO lo son: «nunca ha latido» (un entorno nuevo no es una falla), «terminó a medias» (ruido de reloj) ni «no se pudo leer».
   * Tampoco las entregas del buzón (ventana de 30 días: la tarea no se cerraría sola en semanas).
   */
  fallas: string[];
  /** `true` si alguna lectura que lo respalda falló: sin lectura completa NO se puede cerrar una tarea abierta («no sé» ≠ «sano»). */
  lecturaIncompleta: boolean;
}

const MS_MIN = 60_000;
export function haceTexto(desde: string, ahora: Date): string {
  const t = Date.parse(desde);
  if (!Number.isFinite(t)) return 'fecha ilegible';
  const min = Math.max(0, Math.floor((ahora.getTime() - t) / MS_MIN));
  if (min < 60) return `hace ${min} min`;
  if (min < 48 * 60) return `hace ${Math.floor(min / 60)} h`;
  return `hace ${Math.floor(min / 1440)} días`;
}

export function resumirSalud(e: EntradaSalud) {
  const agentes: SaludAgente[] = AGENTES_VIGILADOS.map((a) => {
    const problemas: string[] = [];
    const fallas: string[] = [];
    let lecturaIncompleta = false;
    /** Un problema que además es una falla de verdad (ver `SaludAgente.fallas`). */
    const falla = (t: string): void => { problemas.push(t); fallas.push(t); };
    // Un latido es de la PLATAFORMA: solo es falla de ESTA flota si la flota usa el agente.
    const usaAgente = e.usa?.[a.id] !== false;
    const fallaDeLatido = (t: string): void => { if (usaAgente) falla(t); else problemas.push(t); };
    let hayDato = false;
    const lat = a.cron && e.latidos ? e.latidos[a.cron] ?? null : null;
    if (a.cron && e.latidos === null) { problemas.push('no se pudo leer el latido del proceso que lo despierta'); lecturaIncompleta = true; }
    if (lat) {
      hayDato = true;
      if (lat.estado === 'vencido') fallaDeLatido(`el proceso que lo despierta dejó de latir (último latido hace ${lat.haceMin ?? '?'} min)`);
      else if (lat.estado === 'sin_latido') problemas.push('el proceso que lo despierta nunca ha latido');
      else if (lat.ultimoEstado === 'fallo') fallaDeLatido('su último latido reportó un fallo');
    }
    const lista = a.corridas ? e.corridas[a.corridas] : undefined;
    let ultima: SaludAgente['ultimaCorrida'] = null;
    if (a.corridas && lista === null) { problemas.push('no se pudieron leer sus corridas'); lecturaIncompleta = true; }
    if (lista && lista.length > 0) {
      hayDato = true;
      const c = lista[0];
      ultima = { estado: c.estado, hace: haceTexto(c.fin ?? c.inicio, e.ahora), error: nombreSeguro(c.error, 140) };
      if (c.estado === 'fallo') falla(`su última corrida falló${ultima.error ? `: ${ultima.error}` : ''}`);
      else if (c.estado === 'parcial') problemas.push('su última corrida terminó a medias');
      const fallos = lista.filter((x) => x.estado === 'fallo').length;
      if (fallos >= 3) falla(`${fallos} de sus últimas ${lista.length} corridas fallaron`);
    }
    if (a.id === 'vigia' && e.enviosSinSalir.vigiaFallidos24h === null) lecturaIncompleta = true;
    if (a.id === 'vigia' && e.enviosSinSalir.vigiaFallidos24h !== null) {
      hayDato = true;
      if (e.enviosSinSalir.vigiaFallidos24h > 0) falla(`${e.enviosSinSalir.vigiaFallidos24h} respuestas a clientes no salieron en las últimas 24 h`);
    }
    if (a.id === 'buzon' && e.enviosSinSalir.buzonEntregasConProblema !== null) {
      hayDato = true;
      if (e.enviosSinSalir.buzonEntregasConProblema > 0) problemas.push(`${e.enviosSinSalir.buzonEntregasConProblema} entregas al contador fallaron o rebotaron`);
    }
    const estado: EstadoAgente = problemas.length > 0 ? 'con_problema' : hayDato ? 'al_dia' : 'sin_datos';
    return { agente: a.id, etiqueta: a.etiqueta, estado, problemas, ultimaCorrida: ultima, latido: lat ? { estado: lat.estado, haceMin: lat.haceMin } : null, ver: a.pantalla, fallas, lecturaIncompleta };
  });
  return {
    generadoEn: e.ahora.toISOString(),
    conProblema: agentes.filter((a) => a.estado === 'con_problema').length,
    sinDatos: agentes.filter((a) => a.estado === 'sin_datos').length,
    agentes,
  };
}
