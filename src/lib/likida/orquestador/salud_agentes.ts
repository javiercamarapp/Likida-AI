import { nombreSeguro } from './resumenes';

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

export interface AgenteVigilado { id: string; etiqueta: string; cron: string | null; corridas: string | null; pantalla: string }

/** Solo pares que de verdad existen en el repo: el cron que despierta a cada agente y su nombre de corridas. */
export const AGENTES_VIGILADOS: readonly AgenteVigilado[] = [
  { id: 'conductor', etiqueta: 'Conductor (ciclo del chofer)', cron: 'conductor-hitos', corridas: 'conductores', pantalla: '/dashboard/agentes/conductores' },
  { id: 'vigia', etiqueta: 'Vigía (servicio al cliente)', cron: 'vigia', corridas: null, pantalla: '/dashboard/agentes/vigia' },
  { id: 'buzon', etiqueta: 'Buzón de facturas', cron: 'buzon-entrega', corridas: 'facturas', pantalla: '/dashboard/agentes/facturas' },
  { id: 'cobranza', etiqueta: 'Cobranza', cron: 'runner', corridas: 'cobranza', pantalla: '/dashboard/agentes/cobranza' },
  { id: 'peajes', etiqueta: 'Peajes', cron: 'peajes', corridas: 'peajes', pantalla: '/dashboard/agentes/peajes' },
  { id: 'autofactura', etiqueta: 'Autofactura', cron: 'portales-vivos', corridas: null, pantalla: '/dashboard/agentes/facturas' },
  { id: 'liquidacion', etiqueta: 'Liquidación', cron: 'liquidaciones-externas', corridas: 'liquidacion', pantalla: '/dashboard/agentes/liquidacion' },
];

export interface LatidoVisto { estado: 'ok' | 'vencido' | 'sin_latido'; haceMin: number | null; ultimoEstado: 'ok' | 'fallo' | 'saltado' | 'parcial' | null }
export interface CorridaVista { estado: 'ok' | 'parcial' | 'fallo'; inicio: string; fin: string | null; error: string | null }

export interface EntradaSalud {
  ahora: Date;
  /** null = no se pudo leer (se dice, no se calla). */
  latidos: Record<string, LatidoVisto> | null;
  /** Por nombre de corridas; la lista viene de la más reciente a la más vieja; null = no se pudo leer. */
  corridas: Record<string, CorridaVista[] | null>;
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
    let hayDato = false;
    const lat = a.cron && e.latidos ? e.latidos[a.cron] ?? null : null;
    if (a.cron && e.latidos === null) problemas.push('no se pudo leer el latido del proceso que lo despierta');
    if (lat) {
      hayDato = true;
      if (lat.estado === 'vencido') problemas.push(`el proceso que lo despierta dejó de latir (último latido hace ${lat.haceMin ?? '?'} min)`);
      else if (lat.estado === 'sin_latido') problemas.push('el proceso que lo despierta nunca ha latido');
      else if (lat.ultimoEstado === 'fallo') problemas.push('su último latido reportó un fallo');
    }
    const lista = a.corridas ? e.corridas[a.corridas] : undefined;
    let ultima: SaludAgente['ultimaCorrida'] = null;
    if (a.corridas && lista === null) problemas.push('no se pudieron leer sus corridas');
    if (lista && lista.length > 0) {
      hayDato = true;
      const c = lista[0];
      ultima = { estado: c.estado, hace: haceTexto(c.fin ?? c.inicio, e.ahora), error: nombreSeguro(c.error, 140) };
      if (c.estado === 'fallo') problemas.push(`su última corrida falló${ultima.error ? `: ${ultima.error}` : ''}`);
      else if (c.estado === 'parcial') problemas.push('su última corrida terminó a medias');
      const fallos = lista.filter((x) => x.estado === 'fallo').length;
      if (fallos >= 3) problemas.push(`${fallos} de sus últimas ${lista.length} corridas fallaron`);
    }
    if (a.id === 'vigia' && e.enviosSinSalir.vigiaFallidos24h !== null) {
      hayDato = true;
      if (e.enviosSinSalir.vigiaFallidos24h > 0) problemas.push(`${e.enviosSinSalir.vigiaFallidos24h} respuestas a clientes no salieron en las últimas 24 h`);
    }
    if (a.id === 'buzon' && e.enviosSinSalir.buzonEntregasConProblema !== null) {
      hayDato = true;
      if (e.enviosSinSalir.buzonEntregasConProblema > 0) problemas.push(`${e.enviosSinSalir.buzonEntregasConProblema} entregas al contador fallaron o rebotaron`);
    }
    const estado: EstadoAgente = problemas.length > 0 ? 'con_problema' : hayDato ? 'al_dia' : 'sin_datos';
    return { agente: a.id, etiqueta: a.etiqueta, estado, problemas, ultimaCorrida: ultima, latido: lat ? { estado: lat.estado, haceMin: lat.haceMin } : null, ver: a.pantalla };
  });
  return {
    generadoEn: e.ahora.toISOString(),
    conProblema: agentes.filter((a) => a.estado === 'con_problema').length,
    sinDatos: agentes.filter((a) => a.estado === 'sin_datos').length,
    agentes,
  };
}
