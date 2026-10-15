import { diasEntre, sumarMeses } from './periodo';
import { TZ_MX, hoyMx } from '@/lib/formato';
import { PLAZO_RECLAMO_MESES } from './reclamos_seguimiento';

// ═══════════════════════════════════════════════════════════════════════════
// EL PLAZO DE RECLAMO sobre CANDIDATOS AÚN SIN RECLAMAR.
//
// «Si en 3 meses no reclamas, ya no hay reclamo»: lo dijo el cliente de palabra.
// `reclamos_seguimiento.ts` vigila los reclamos YA preparados/enviados; este módulo
// vigila lo que todavía NO se reclamó: qué cruce está por perder su derecho y cuál
// ya lo perdió (y por tanto sale de «qué hacer»).
//
// Qué fecha abre el plazo (cruce / decena / factura) aún no está confirmado por el
// proveedor: por eso la función recibe `fechaBase` y NO decide cuál es; el que llama
// pasa la fecha del cruce (la lectura más prudente de B2) hasta que se confirme.
//
// Calendario: se suman MESES de calendario (31-jul +3 = 31-oct; 30-nov +3 = 28/29-feb),
// el último día del plazo es INCLUSIVO (hoy = día límite -> por_vencer(0)) y las
// fechas con hora se llevan a la fecha LOCAL de México antes de contar (un cruce a
// las 23:30 de México es de ESE día aunque en UTC ya sea el siguiente).
//
// PURO: el reloj se inyecta (`hoy`); sin base, sin red.
// ═══════════════════════════════════════════════════════════════════════════

/** Zona del cliente. México no usa horario de verano desde 2022 (franja fronteriza: decisión pendiente). */
export const ZONA_PLAZO = TZ_MX;
/** Días antes del vencimiento en los que se avisa (el umbral vigente es el más chico alcanzado). */
export const UMBRALES_AVISO_DIAS: readonly number[] = [30, 7];

export interface OpcionesPlazo {
  meses?: number;
  avisoDias?: readonly number[];
}

export type EstadoPlazo =
  | { estado: 'vigente'; fechaLimite: string; diasRestantes: number }
  | { estado: 'por_vencer'; fechaLimite: string; diasRestantes: number; umbral: number }
  | { estado: 'vencido'; fechaLimite: string; diasVencido: number };

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;

function fechaValida(f: string): boolean {
  if (!RE_FECHA.test(f)) return false;
  const d = new Date(`${f}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === f;
}

/**
 * La fecha LOCAL de México (YYYY-MM-DD) de una fecha o instante.
 *  · `YYYY-MM-DD` ya es una fecha de calendario: se respeta tal cual.
 *  · Un instante con zona (`Z` o `+hh:mm`) o un `Date` se convierte a México.
 *  · Un texto con hora SIN zona se toma como hora local de México (no se desplaza).
 * Lanza si no es una fecha: un plazo sobre una fecha inventada sería peor que un error.
 */
export function fechaLocalMX(valor: string | Date): string {
  if (valor instanceof Date) {
    if (Number.isNaN(valor.getTime())) throw new Error('fecha_invalida');
    return hoyMx(valor);
  }
  const t = valor.trim();
  if (fechaValida(t)) return t;
  const conZona = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/i.test(t);
  if (conZona) {
    const d = new Date(t.replace(' ', 'T'));
    if (Number.isNaN(d.getTime())) throw new Error('fecha_invalida');
    return hoyMx(d);
  }
  const sinZona = /^(\d{4}-\d{2}-\d{2})[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.exec(t);
  if (sinZona && fechaValida(sinZona[1])) return sinZona[1];
  throw new Error('fecha_invalida');
}

/**
 * El estado del plazo de UN cobro a `hoy`.
 *  · `vencido` si `hoy` es posterior al día límite;
 *  · `por_vencer(d)` si faltan `d` días (d = 0 el propio día límite) y `d` <= el umbral mayor;
 *    `umbral` es el MÁS CHICO ya alcanzado (a 20 días es 30; a 5 días es 7);
 *  · `vigente` en otro caso.
 */
export function estadoPlazo(fechaBase: string | Date, hoy: string | Date, opciones: OpcionesPlazo = {}): EstadoPlazo {
  const meses = opciones.meses ?? PLAZO_RECLAMO_MESES;
  const umbrales = [...(opciones.avisoDias ?? UMBRALES_AVISO_DIAS)].filter((u) => Number.isInteger(u) && u >= 0).sort((a, b) => a - b);
  const fechaLimite = sumarMeses(fechaLocalMX(fechaBase), meses);
  const dias = diasEntre(fechaLocalMX(hoy), fechaLimite);
  if (dias < 0) return { estado: 'vencido', fechaLimite, diasVencido: -dias };
  const umbral = umbrales.find((u) => dias <= u);
  if (umbral !== undefined) return { estado: 'por_vencer', fechaLimite, diasRestantes: dias, umbral };
  return { estado: 'vigente', fechaLimite, diasRestantes: dias };
}

// ─── Candidatos sin reclamar ───────────────────────────────────────────────

export interface CandidatoPlazo {
  lineaId: string;
  desgloseId: string;
  /** Fecha base del plazo (hoy: la del cruce). */
  fechaCruce: string | Date;
  monto: number;
  /** Ya forma parte de un reclamo: no se avisa ni se descarta aquí. */
  reclamado?: boolean;
}

export interface GrupoPorVencer {
  desgloseId: string;
  umbral: number;
  cruces: number;
  monto: number;
  /** Días que le quedan al cobro MÁS urgente del grupo. */
  diasMinimos: number;
  /** Día límite más próximo del grupo. */
  fechaLimiteMasProxima: string;
  lineaIds: string[];
}

export interface ResumenVencidos {
  cruces: number;
  monto: number;
  lineaIds: string[];
}

export interface ClasificacionPlazos {
  /** Se pueden reclamar (vigentes o por vencer): lo que sigue en «qué hacer». */
  reclamables: string[];
  porVencer: GrupoPorVencer[];
  /** «Ya no reclamable»: salen de «qué hacer». */
  vencidos: ResumenVencidos;
  /** Candidatos ignorados por estar ya reclamados. */
  yaReclamados: number;
}

const aCentavos = (n: number) => Math.round(n * 100);

/** Separa los candidatos sin reclamar en vigentes, por vencer (agrupados por desglose y umbral, con monto) y vencidos. */
export function clasificarPlazos(candidatos: readonly CandidatoPlazo[], hoy: string | Date, opciones: OpcionesPlazo = {}): ClasificacionPlazos {
  const reclamables: string[] = [];
  const grupos = new Map<string, GrupoPorVencer & { centavos: number }>();
  const vencidos = { cruces: 0, centavos: 0, lineaIds: [] as string[] };
  let yaReclamados = 0;

  for (const c of candidatos) {
    if (c.reclamado) { yaReclamados++; continue; }
    const p = estadoPlazo(c.fechaCruce, hoy, opciones);
    if (p.estado === 'vencido') {
      vencidos.cruces++; vencidos.centavos += aCentavos(c.monto); vencidos.lineaIds.push(c.lineaId);
      continue;
    }
    reclamables.push(c.lineaId);
    if (p.estado !== 'por_vencer') continue;
    const clave = `${c.desgloseId}\u0000${p.umbral}`;
    const g = grupos.get(clave) ?? {
      desgloseId: c.desgloseId, umbral: p.umbral, cruces: 0, monto: 0, centavos: 0,
      diasMinimos: p.diasRestantes, fechaLimiteMasProxima: p.fechaLimite, lineaIds: [],
    };
    g.cruces++; g.centavos += aCentavos(c.monto); g.lineaIds.push(c.lineaId);
    if (p.diasRestantes < g.diasMinimos) { g.diasMinimos = p.diasRestantes; g.fechaLimiteMasProxima = p.fechaLimite; }
    grupos.set(clave, g);
  }

  const porVencer = [...grupos.values()]
    .map(({ centavos, ...g }) => ({ ...g, monto: centavos / 100 }))
    .sort((a, b) => a.diasMinimos - b.diasMinimos || a.desgloseId.localeCompare(b.desgloseId));
  return {
    reclamables,
    porVencer,
    vencidos: { cruces: vencidos.cruces, monto: vencidos.centavos / 100, lineaIds: vencidos.lineaIds },
    yaReclamados,
  };
}
