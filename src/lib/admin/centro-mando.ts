import type { ItemClasificado } from './guardia';
import type { AgenteParado } from './agentes-parados';
import type { CalidadAgente } from './calidad-agentes';
import { autonomiaDe, type Nivel } from '@/lib/likida/agentes/autonomia';

// ═══════════════════════════════════════════════════════════════════════════
// EL CENTRO DE MANDO DE /admin (F2, PLAN-MAESTRO §10.1) — la parte PURA.
//
// Tres decisiones que la portada toma por el dueño, sin consultar nada:
//   1. el SEMÁFORO de salud (¿estoy bien?),
//   2. TU TURNO, máximo 5 filas (¿qué espera mi decisión?),
//   3. la tabla de CALIDAD por agente (¿quién trabaja bien?).
//
// Regla de la casa en las tres: lo que no se pudo leer es `null` y se DICE; nunca se convierte en «todo bien» ni en 0. Los lectores
// viven en `app/admin/resumen-lecturas.ts`; aquí solo hay reglas, para probarlas sin base.
// ═══════════════════════════════════════════════════════════════════════════

// ── 1. Semáforo ────────────────────────────────────────────────────────────

export type NivelSemaforo = 'verde' | 'amarillo' | 'rojo';

export interface CausaSemaforo { texto: string; href: string }

export interface EntradaSemaforo {
  /** El latido de la guardia y su estado propio (base/app caídas). `null` = no se pudo leer. */
  guardia: {
    juicio: 'ok' | 'vencido' | 'sin_latido';
    haceMin: number | null;
    baseCaidaDesde: string | null;
    appCaidaDesde: string | null;
  } | null;
  /** Lo vivo de la bandeja clasificada. `null` = la bandeja no se pudo leer. */
  bandeja: { s2: number; fuentesCiegas: number } | null;
  /** Alertas de crons y de crédito de IA (`alertasExtra`). `null` = no se pudieron leer. */
  extras: ReadonlyArray<{ id: string; texto: string; href: string }> | null;
  /** SLOs medidos. `cumple: null` = sin muestra (informativo, no ciega). `null` = no se pudieron leer. */
  slos: ReadonlyArray<{ nombre: string; cumple: boolean | null }> | null;
  /** Agentes que el runner dejó sin correr por contrapresión de la bandeja. `null` = sin dato. */
  frenadosPorBandeja: number | null;
}

export interface Semaforo {
  nivel: NivelSemaforo;
  /** Una frase: el estado en palabras. */
  titulo: string;
  causas: CausaSemaforo[];
  /** Lecturas que no se pudieron hacer: mientras haya una, el semáforo NO es verde. */
  ciegas: string[];
  /** Minutos desde el último latido de la guardia (`null` = sin dato). */
  guardiaHaceMin: number | null;
}

const plural = (n: number, s: string, p: string) => `${n} ${n === 1 ? s : p}`;

/**
 * Rojo: la base o la app no responden (lo que la guardia ya vio). Amarillo: alguna señal pide atención o hay una lectura ciega.
 * Verde solo si TODO se leyó y nada pide acción. S1 («el sistema miente») no se deriva de datos: lo reporta ALERTA_EMAIL y lo
 * clasifica una persona, y este semáforo no finge detectarlo.
 */
export function semaforoSalud(e: EntradaSemaforo): Semaforo {
  const rojas: CausaSemaforo[] = [];
  const amarillas: CausaSemaforo[] = [];
  const ciegas: string[] = [];

  if (e.guardia === null) ciegas.push('la guardia de producción');
  else {
    if (e.guardia.baseCaidaDesde) rojas.push({ texto: 'La base de datos no responde (lo vio la guardia).', href: '/admin/salud-sistema' });
    if (e.guardia.appCaidaDesde) rojas.push({ texto: 'La aplicación no responde (lo vio la guardia).', href: '/admin/salud-sistema' });
    if (e.guardia.juicio === 'sin_latido') amarillas.push({ texto: 'La guardia nunca ha latido: nadie vigila producción.', href: '/admin/crons' });
    else if (e.guardia.juicio === 'vencido') amarillas.push({ texto: `La guardia dejó de latir (último latido hace ${e.guardia.haceMin ?? '?'} min).`, href: '/admin/crons' });
  }

  if (e.bandeja === null) ciegas.push('la bandeja de escalaciones');
  else {
    if (e.bandeja.s2 > 0) amarillas.push({ texto: `${plural(e.bandeja.s2, 'incidente de severidad S2 vivo', 'incidentes de severidad S2 vivos')}.`, href: '/admin/escalaciones' });
    if (e.bandeja.fuentesCiegas > 0) ciegas.push(plural(e.bandeja.fuentesCiegas, 'fuente de la bandeja', 'fuentes de la bandeja'));
  }

  if (e.extras === null) ciegas.push('los latidos de los crons');
  else {
    for (const a of e.extras) {
      // «No se pudo leer el latido» es ceguera, no un pendiente.
      if (a.id === 'crons_ilegibles') ciegas.push('los latidos de los crons');
      else amarillas.push({ texto: a.texto, href: a.href });
    }
  }

  if (e.slos === null) ciegas.push('los objetivos de servicio');
  else {
    const rotos = e.slos.filter((s) => s.cumple === false);
    if (rotos.length > 0) amarillas.push({ texto: `${plural(rotos.length, 'objetivo de servicio no se cumple', 'objetivos de servicio no se cumplen')}: ${rotos.map((s) => s.nombre).join(', ')}.`, href: '/admin/salud-sistema' });
  }

  if (e.frenadosPorBandeja === null) ciegas.push('los agentes frenados por la bandeja');
  else if (e.frenadosPorBandeja > 0) amarillas.push({ texto: `${plural(e.frenadosPorBandeja, 'agente frenado', 'agentes frenados')} porque la bandeja de aprobación está sin atender.`, href: '/admin/aprobaciones' });

  const ciegasUnicas = [...new Set(ciegas)];
  const guardiaHaceMin = e.guardia?.haceMin ?? null;
  if (rojas.length > 0) {
    return { nivel: 'rojo', titulo: 'Hay una falla en producción', causas: [...rojas, ...amarillas], ciegas: ciegasUnicas, guardiaHaceMin };
  }
  if (amarillas.length > 0 || ciegasUnicas.length > 0) {
    const causas = [...amarillas];
    if (ciegasUnicas.length > 0) causas.push({ texto: `No se pudo leer: ${ciegasUnicas.join(', ')}. No es «todo bien».`, href: '/admin/salud-sistema' });
    return { nivel: 'amarillo', titulo: amarillas.length > 0 ? 'Algo pide tu atención' : 'No se puede confirmar que todo esté bien', causas, ciegas: ciegasUnicas, guardiaHaceMin };
  }
  return { nivel: 'verde', titulo: 'Todo en orden', causas: [], ciegas: [], guardiaHaceMin };
}

// ── 2. Tu turno ────────────────────────────────────────────────────────────

export const MAX_TU_TURNO = 5;

export interface FilaTuTurno {
  clave: string;
  titulo: string;
  detalle: string | null;
  /** `bad` = vencido o incidente; `warn` = pide decisión pronto; `neutral` = en lista del día. */
  urgencia: 'bad' | 'warn' | 'neutral';
  etiqueta: string;
  href: string | null;
  /** Rótulo del botón directo. */
  accion: string;
}

export interface EntradaTuTurno {
  /** La bandeja ya clasificada (`clasificarBandeja`). `null` = no se pudo leer. */
  items: ReadonlyArray<ItemClasificado> | null;
  /** Envíos por aprobar. `null` = no se pudo leer. */
  envios: { urgentes: number; normales: number } | null;
  /** Agentes frenados por la bandeja. `null` = sin dato. */
  frenados: number | null;
}

export interface TuTurno {
  filas: FilaTuTurno[];
  /** Cuántas cosas esperan en total (las filas son las primeras 5). */
  total: number;
  /** Lecturas que fallaron: se dicen debajo de la lista. */
  ciegas: string[];
}

const PUNTAJE: Record<ItemClasificado['severidad'], number> = { S1: 0, S2: 1, S3: 3, no_incidente: 4 };

function vencidoAl(i: ItemClasificado, ahoraMs: number): boolean {
  return i.vence !== null && Date.parse(i.vence) < ahoraMs;
}

/** Pura. Junta lo que espera una decisión, por urgencia, y lo recorta a `MAX_TU_TURNO` filas. Nada se cuenta dos veces. */
export function armarTuTurno(e: EntradaTuTurno, ahoraMs: number): TuTurno {
  const candidatas: Array<{ puntaje: number; fila: FilaTuTurno }> = [];
  const ciegas: string[] = [];

  if (e.items === null) ciegas.push('la bandeja de escalaciones');
  else {
    e.items.forEach((i, n) => {
      const vencido = vencidoAl(i, ahoraMs);
      candidatas.push({
        puntaje: vencido ? 0 : PUNTAJE[i.severidad],
        fila: {
          clave: `esc-${n}-${i.huella ?? i.fuente}`,
          titulo: i.titulo,
          detalle: i.flota,
          urgencia: vencido || i.severidad === 'S1' || i.severidad === 'S2' ? 'bad' : 'neutral',
          etiqueta: vencido ? 'Vencido' : i.severidad === 'S2' ? 'Urgente' : 'Pendiente',
          href: i.href,
          accion: 'Abrir',
        },
      });
    });
  }

  if (e.envios === null) ciegas.push('los envíos por aprobar');
  else {
    if (e.envios.urgentes > 0) {
      candidatas.push({
        puntaje: 2,
        fila: {
          clave: 'envios-urgentes', titulo: `${plural(e.envios.urgentes, 'envío urgente espera', 'envíos urgentes esperan')} tu aprobación`,
          detalle: 'Nada sale a un cliente sin tu visto bueno.', urgencia: 'warn', etiqueta: 'Urgente', href: '/admin/aprobaciones', accion: 'Revisar',
        },
      });
    }
    if (e.envios.normales > 0) {
      candidatas.push({
        puntaje: 3,
        fila: {
          clave: 'envios-normales', titulo: `${plural(e.envios.normales, 'envío espera', 'envíos esperan')} tu aprobación`,
          detalle: 'Nada sale a un cliente sin tu visto bueno.', urgencia: 'neutral', etiqueta: 'Pendiente', href: '/admin/aprobaciones', accion: 'Revisar',
        },
      });
    }
  }

  if (e.frenados === null) ciegas.push('los agentes frenados');
  else if (e.frenados > 0) {
    candidatas.push({
      puntaje: 2,
      fila: {
        clave: 'agentes-frenados', titulo: `${plural(e.frenados, 'agente frenado', 'agentes frenados')} por la bandeja sin atender`,
        detalle: 'Se reanudan cuando se resuelven las piezas pendientes.', urgencia: 'warn', etiqueta: 'Frenado', href: '/admin/aprobaciones', accion: 'Atender',
      },
    });
  }

  // Orden estable: por puntaje, y a igual puntaje se conserva el orden de la bandeja (ya viene por urgencia).
  const ordenadas = candidatas.map((c, n) => ({ ...c, n })).sort((a, b) => a.puntaje - b.puntaje || a.n - b.n);
  return { filas: ordenadas.slice(0, MAX_TU_TURNO).map((c) => c.fila), total: ordenadas.length, ciegas };
}

// ── 3. Calidad por agente ──────────────────────────────────────────────────

export type EstadoRealAgente = 'corriendo' | 'bloqueado_bandeja' | 'sin_palanca' | 'sin_presupuesto' | 'parado' | 'sin_dato';

export const ROTULO_ESTADO_REAL: Readonly<Record<EstadoRealAgente, string>> = {
  corriendo: 'Corriendo',
  bloqueado_bandeja: 'Bloqueado por la bandeja',
  sin_palanca: 'Sin palanca',
  sin_presupuesto: 'Sin presupuesto',
  parado: 'Parado',
  sin_dato: 'Sin dato',
};

export const TONO_ESTADO_REAL: Readonly<Record<EstadoRealAgente, 'ok' | 'warn' | 'bad' | 'muted'>> = {
  corriendo: 'ok', bloqueado_bandeja: 'warn', sin_palanca: 'warn', sin_presupuesto: 'warn', parado: 'bad', sin_dato: 'muted',
};

/** Pura. `parado === undefined` con la lectura de parados viva = sí corre; con la lectura caída (`paradosLeidos` falso) = sin dato. */
export function estadoReal(parado: AgenteParado | undefined, paradosLeidos: boolean): EstadoRealAgente {
  if (!paradosLeidos) return 'sin_dato';
  if (!parado) return 'corriendo';
  switch (parado.causa) {
    case 'contrapresion_bandeja': return 'bloqueado_bandeja';
    case 'apagado': return 'sin_palanca';
    case 'sin_presupuesto': case 'techo_diario': return 'sin_presupuesto';
    default: return 'parado';
  }
}

export interface FilaCalidad {
  agente: string;
  nombre: string;
  nivel: Nivel;
  estado: EstadoRealAgente;
  /** Fracción 0..1 de piezas revisadas por una persona; `null` = sin muestra o sin lectura. */
  revisionHumana: number | null;
  /** p95 de duración de corrida en ms; `null` = sin muestra. */
  p95Ms: number | null;
  /** Corridas de la ventana; `null` = la bitácora no se pudo leer. */
  corridas: number | null;
}

const humanizar = (id: string) => { const t = id.replace(/_/g, ' '); return t.charAt(0).toUpperCase() + t.slice(1); };

/**
 * Pura. Una fila por agente: la unión de los que tienen actividad medida y los que están parados (un agente que jamás corrió no aparece
 * en la calidad, pero sí en la lista de parados: sin esta unión «no corre» se vería como «no existe»). Los problemas, primero.
 */
export function filasCalidad(
  agentes: ReadonlyArray<CalidadAgente> | null,
  parados: ReadonlyArray<AgenteParado> | null,
  nombreDe: (id: string) => string | null = () => null,
): FilaCalidad[] {
  const porId = new Map<string, FilaCalidad>();
  const paradoDe = new Map((parados ?? []).map((p) => [p.agente, p]));
  const poner = (id: string, nombrePropio: string | null) => {
    porId.set(id, {
      agente: id, nombre: nombreDe(id) ?? nombrePropio ?? humanizar(id), nivel: autonomiaDe(id).nivel,
      estado: estadoReal(paradoDe.get(id), parados !== null),
      revisionHumana: null, p95Ms: null, corridas: agentes === null ? null : 0,
    });
  };
  for (const a of agentes ?? []) {
    poner(a.agente, null);
    const f = porId.get(a.agente)!;
    f.revisionHumana = a.revision?.tasaRevisionHumana ?? null;
    f.p95Ms = a.corridas?.p95Ms ?? null;
    f.corridas = a.corridas === null ? (agentes === null ? null : 0) : a.corridas.total;
  }
  for (const p of parados ?? []) if (!porId.has(p.agente)) poner(p.agente, p.nombre);
  const peso = (e: EstadoRealAgente) => (e === 'parado' ? 0 : e === 'sin_dato' ? 4 : e === 'corriendo' ? 5 : 1);
  return [...porId.values()].sort((a, b) => peso(a.estado) - peso(b.estado) || a.nombre.localeCompare(b.nombre, 'es'));
}
