import type { CorridaRegistrada } from '@/lib/likida/agentes/corridas';
import type { HechoSolo } from '@/lib/likida/analytics';
import { PERIODO_RANGO, type DatosResumen, type FilaAtencion } from './resumen-modelo';
import type { CifrasPesosCincoAgentes, SelloCifra } from './cinco-agentes-cifras-modelo';

// ═══════════════════════════════════════════════════════════════════════════
// MODELO PURO DEL INICIO v2 DE UNA FLOTA `cinco_agentes` (L11). Sin base, sin red, sin importar nada de servidor: lo usan las
// piezas presentacionales, los componentes de cliente y las pruebas. Regla de la casa: sin dato NUNCA es 0.
// ═══════════════════════════════════════════════════════════════════════════

const TZ = 'America/Mexico_City';
const DIA_MX = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const HORA_MX = new Intl.DateTimeFormat('es-MX', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const FECHA_CORTA_MX = new Intl.DateTimeFormat('es-MX', { timeZone: TZ, day: '2-digit', month: 'short' });
const PESOS = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0, minimumFractionDigits: 0 });

/** Pesos COMPLETOS sin decimales («$3,306,107»). El compacto («$3.3 M») pierde el detalle que finanzas necesita. `null` = «—». */
export function pesosCompletos(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  const r = Math.round(n);
  return PESOS.format(Object.is(r, -0) ? 0 : r);
}

// ── Estado de la última corrida de cada agente ────────────────────────────

export type PuntoEstado = 'ok' | 'warn' | 'bad' | 'muted';
export interface EstadoAgente { punto: PuntoEstado; texto: string }

const dia = (iso: string | number) => DIA_MX.format(new Date(iso));

/**
 * Qué se dice de un agente en su tarjeta. `corrida`: `null` = la lectura falló, `undefined` = no hay corridas registradas.
 * Verde solo si corrió bien HOY; una corrida buena de otro día queda en gris con su fecha (no se afirma que trabajó hoy).
 */
export function estadoDeAgente(
  corrida: CorridaRegistrada | null | undefined, ahora: number,
  o: { registraCorridas: boolean; proximamente?: boolean },
): EstadoAgente {
  if (o.proximamente) return { punto: 'muted', texto: 'Todavía no está activo' };
  if (!o.registraCorridas) return { punto: 'muted', texto: 'Sin corridas: abre su tablero' };
  if (corrida === null) return { punto: 'warn', texto: 'No se pudo leer la última corrida' };
  if (corrida === undefined) return { punto: 'muted', texto: 'Sin corridas registradas' };
  const hoy = dia(ahora) === dia(corrida.inicio);
  const cuando = `${hoy ? 'hoy' : FECHA_CORTA_MX.format(new Date(corrida.inicio))} ${HORA_MX.format(new Date(corrida.inicio))}`;
  if (corrida.estado === 'fallo') return { punto: 'bad', texto: `Falló ${cuando}` };
  if (corrida.estado === 'parcial') return { punto: 'warn', texto: `Con pendientes ${cuando}` };
  return hoy ? { punto: 'ok', texto: `Corrió ${cuando}` } : { punto: 'muted', texto: `Última corrida ${cuando}` };
}

// ── Una cifra real (conteo) por agente ────────────────────────────────────

export interface CifraAgente {
  /** `null` = sin dato (se pinta «—»). Nunca 0 por fallo. */
  valor: string | null;
  etiqueta: string;
  nota: string | null;
  /** La lectura falló (vs. todavía no hay dato). */
  error?: boolean;
}

export interface EntradaCifras {
  d: Pick<DatosResumen, 'kpis' | 'cartaPorte' | 'escalados' | 'rango'>;
  /** `undefined` = el rol no ve pesos (o la flota no tiene el perfil): Peajes cae a las tareas de su última corrida. */
  pesos?: CifrasPesosCincoAgentes | null;
  corridaPeajes?: CorridaRegistrada | null;
}

export function cifraDeAgente(clave: string, e: EntradaCifras): CifraAgente {
  const periodo = PERIODO_RANGO[e.d.rango];
  switch (clave) {
    case 'liquidacion': {
      const k = e.d.kpis;
      if (!k) return { valor: null, etiqueta: 'por revisar', nota: 'No se pudo leer. No es cero.', error: true };
      return { valor: String(k.porRevisar), etiqueta: 'por revisar', nota: `de ${k.viajesLiquidados} cerradas · ${periodo}` };
    }
    case 'peajes': {
      if (e.pesos) {
        const x = e.pesos.extemporaneos;
        if (x.n === null) return { valor: null, etiqueta: 'candidatos extemporáneos', nota: x.motivo ?? 'Sin dato', error: x.reintentar };
        return { valor: String(x.n), etiqueta: x.n === 1 ? 'candidato extemporáneo' : 'candidatos extemporáneos', nota: `${x.periodo} · ${x.sello}` };
      }
      const c = e.corridaPeajes;
      if (c && c.tareasHechas !== null && c.tareasTotal !== null) return { valor: `${c.tareasHechas} de ${c.tareasTotal}`, etiqueta: 'tareas, última corrida', nota: null };
      return { valor: null, etiqueta: 'sin dato', nota: 'Sin tareas registradas en su última corrida' };
    }
    case 'carta_porte': {
      const cp = e.d.cartaPorte;
      if (cp === null) return { valor: null, etiqueta: 'completas', nota: 'No se puede afirmar con los viajes leídos', error: false };
      if (cp.total === 0) return { valor: null, etiqueta: 'completas', nota: 'Sin viajes abiertos' };
      return { valor: `${cp.completas} / ${cp.total}`, etiqueta: 'completas', nota: 'viajes abiertos' };
    }
    case 'conductor': {
      const n = e.d.escalados;
      if (n === null) return { valor: null, etiqueta: 'escalados', nota: 'No se pudo leer. No es cero.', error: true };
      return { valor: String(n), etiqueta: n === 1 ? 'viaje escalado' : 'viajes escalados', nota: 'ahora' };
    }
    default:
      // Servicio al cliente: todavía no hay un lector de conteos ligero (pendientes de aprobar). No se inventa.
      return { valor: null, etiqueta: 'sin dato', nota: 'Abre su tablero para ver y aprobar las respuestas.' };
  }
}

// ── Sellos de las cifras en pesos ─────────────────────────────────────────

export const TONO_SELLO: Record<SelloCifra, 'ok' | 'warn' | 'muted'> = { Medido: 'ok', Estimado: 'warn', 'Sin dato': 'muted' };

// ── «Lo que hizo solo» (últimas 24 h) ─────────────────────────────────────

export const VENTANA_HECHOS_MS = 24 * 3_600_000;

/** Solo los hechos de las últimas 24 h. El lector trae los N más recientes: si hubiera más de N en la ventana, la lista es parcial. */
export function hechosUltimas24h(h: readonly HechoSolo[] | null, ahora: number): HechoSolo[] | null {
  if (h === null) return null;
  return h.filter((x) => { const t = Date.parse(x.cuando); return Number.isFinite(t) && ahora - t <= VENTANA_HECHOS_MS && t <= ahora + 60_000; });
}

// ── Flota nueva ───────────────────────────────────────────────────────────

/**
 * Una flota «nueva»: todo lo que se pudo leer está vacío (ninguna corrida registrada, sin viajes abiertos, sin cierres en ocho
 * semanas ni hechos del agente). Si alguna lectura falló NO se afirma que es nueva (null ≠ 0).
 */
export function esFlotaNueva(e: {
  corridas: ReadonlyArray<CorridaRegistrada | null | undefined>;
  enCurso: number | null;
  d: Pick<DatosResumen, 'cierres' | 'hechos'>;
}): boolean {
  if (e.corridas.some((c) => c !== undefined)) return false; // con corrida o con fallo de lectura
  if (e.enCurso !== 0) return false;
  if (e.d.cierres === null || e.d.cierres.some((c) => c.valor > 0)) return false;
  if (e.d.hechos === null || e.d.hechos.length > 0) return false;
  return true;
}

// ── Atajos ────────────────────────────────────────────────────────────────

export const ATAJOS_CINCO: ReadonlyArray<{ href: string; nombre: string }> = [
  { href: '/dashboard/despacho', nombre: 'Nuevo viaje' },
  { href: '/dashboard/viajes', nombre: 'Viajes' },
  { href: '/dashboard/agentes/peajes', nombre: 'Peajes' },
  { href: '/dashboard/agentes/carta-porte', nombre: 'Carta Porte' },
];

/** «hoy 07:02» / «ayer 22:10» / «29 oct 07:02», en hora de México. */
export function cuandoMx(iso: string, ahora: number): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '—';
  const hora = HORA_MX.format(new Date(t));
  const d = dia(t);
  if (d === dia(ahora)) return `hoy ${hora}`;
  if (d === dia(ahora - 86_400_000)) return `ayer ${hora}`;
  return `${FECHA_CORTA_MX.format(new Date(t))} ${hora}`;
}

// ── Fila «viajes en curso» de «Hoy» ───────────────────────────────────────

/** La fila informativa de viajes abiertos. 0 → sin fila (el relleno honesto dice «sin pendientes»); `null` → se confiesa que no se pudo leer. */
export function filaViajesEnCurso(n: number | null, enlace: string | null): FilaAtencion | null {
  if (n === null) {
    return { id: 'en-curso-sin-lectura', severidad: 'atencion', titulo: 'Viajes en curso', detalle: 'No se pudo leer ahora. No es cero.', href: null, sinPendiente: true };
  }
  if (n === 0) return null;
  return {
    id: 'en-curso', severidad: 'info', titulo: `${n} ${n === 1 ? 'viaje en curso' : 'viajes en curso'}`,
    detalle: 'Abiertos: aún sin cerrar ni liquidar.', href: enlace,
    queSignifica: 'Son los viajes de tu flota que siguen abiertos; los agentes les dan seguimiento.',
    queHacer: 'Abre Viajes para ver cuál sigue sin reportar.', fuente: 'Viajes de tu flota, ahora', textoAccion: 'Abrir Viajes',
  };
}
