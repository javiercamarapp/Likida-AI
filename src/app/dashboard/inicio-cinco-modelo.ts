import { fechaCorta, horaMx, hoyMx } from '@/lib/formato';
import type { CorridaRegistrada } from '@/lib/likida/agentes/corridas';
import type { HechoSolo } from '@/lib/likida/analytics';
import { PERIODO_RANGO, type DatosResumen, type FilaAtencion } from './resumen-modelo';
import type { CifrasPesosCincoAgentes, SelloCifra } from './cinco-agentes-cifras-modelo';
import { type TResto, T_RESTO_ES } from '@/lib/i18n/resto_tr';

// ═══════════════════════════════════════════════════════════════════════════
// MODELO PURO DEL INICIO v2 DE UNA FLOTA `cinco_agentes` (L11). Sin base, sin red, sin importar nada de servidor: lo usan las
// piezas presentacionales, los componentes de cliente y las pruebas. Regla de la casa: sin dato NUNCA es 0.
// ═══════════════════════════════════════════════════════════════════════════

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

const dia = (iso: string | number) => hoyMx(new Date(iso));

/**
 * Qué se dice de un agente en su tarjeta. `corrida`: `null` = la lectura falló, `undefined` = no hay corridas registradas.
 * Verde solo si corrió bien HOY; una corrida buena de otro día queda en gris con su fecha (no se afirma que trabajó hoy).
 */
export function estadoDeAgente(
  corrida: CorridaRegistrada | null | undefined, ahora: number,
  o: { registraCorridas: boolean; proximamente?: boolean }, t: TResto = T_RESTO_ES,
): EstadoAgente {
  if (o.proximamente) return { punto: 'muted', texto: t('op.todavia_no_esta_activo') };
  if (!o.registraCorridas) return { punto: 'muted', texto: t('op.sin_corridas_abre_su_tablero') };
  if (corrida === null) return { punto: 'warn', texto: t('op.no_se_pudo_leer_la_ultima_2') };
  if (corrida === undefined) return { punto: 'muted', texto: t('op.sin_corridas_registradas') };
  const hoy = dia(ahora) === dia(corrida.inicio);
  const cuando = `${hoy ? 'hoy' : fechaCorta(corrida.inicio)} ${horaMx(corrida.inicio)}`;
  if (corrida.estado === 'fallo') return { punto: 'bad', texto: t('op.fallo_2', { cuando }) };
  if (corrida.estado === 'parcial') return { punto: 'warn', texto: `Con pendientes ${cuando}` };
  return hoy ? { punto: 'ok', texto: t('op.corrio', { cuando }) } : { punto: 'muted', texto: t('op.ultima_corrida_2', { cuando }) };
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

export function cifraDeAgente(clave: string, e: EntradaCifras, t: TResto = T_RESTO_ES): CifraAgente {
  const periodo = PERIODO_RANGO[e.d.rango];
  switch (clave) {
    case 'liquidacion': {
      const k = e.d.kpis;
      if (!k) return { valor: null, etiqueta: t('op.por_revisar'), nota: t('op.no_se_pudo_leer_no_es'), error: true };
      return { valor: String(k.porRevisar), etiqueta: t('op.por_revisar'), nota: `de ${k.viajesLiquidados} cerradas · ${periodo}` };
    }
    case 'peajes': {
      if (e.pesos) {
        const x = e.pesos.extemporaneos;
        if (x.n === null) return { valor: null, etiqueta: t('op.candidatos_extemporaneos'), nota: x.motivo ?? 'Sin dato' }; // el Reintentar vive UNA vez, en el bloque de pesos
        return { valor: String(x.n), etiqueta: x.n === 1 ? t('op.candidato_extemporaneo') : t('op.candidatos_extemporaneos'), nota: `${x.periodo} · ${x.sello}` };
      }
      const c = e.corridaPeajes;
      if (c && c.tareasHechas !== null && c.tareasTotal !== null) return { valor: `${c.tareasHechas} de ${c.tareasTotal}`, etiqueta: t('op.tareas_ultima_corrida'), nota: null };
      return { valor: null, etiqueta: t('op.sin_dato'), nota: t('op.sin_tareas_registradas_en_su_ultima') };
    }
    case 'carta_porte': {
      const cp = e.d.cartaPorte;
      if (cp === null) return { valor: null, etiqueta: 'completas', nota: t('op.no_se_puede_afirmar_con_los'), error: false };
      if (cp.total === 0) return { valor: null, etiqueta: 'completas', nota: t('op.sin_viajes_abiertos') };
      return { valor: `${cp.completas} / ${cp.total}`, etiqueta: 'completas', nota: t('op.viajes_abiertos') };
    }
    case 'conductor': {
      const n = e.d.escalados;
      if (n === null) return { valor: null, etiqueta: 'escalados', nota: t('op.no_se_pudo_leer_no_es'), error: true };
      return { valor: String(n), etiqueta: n === 1 ? 'viaje escalado' : 'viajes escalados', nota: 'ahora' };
    }
    default:
      // Servicio al cliente: todavía no hay un lector de conteos ligero (pendientes de aprobar). No se inventa.
      return { valor: null, etiqueta: t('op.sin_dato'), nota: t('op.abre_su_tablero_para_ver_y') };
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

/** Cuenta aparte las corridas LEGIBLES y las que no se pudieron leer (`null`): una lectura caída no es «no corrió». */
export function contarCorridas(corridas: ReadonlyArray<CorridaRegistrada | null | undefined>): { conCorrida: number; sinLectura: number } {
  return { conCorrida: corridas.filter((c) => c).length, sinLectura: corridas.filter((c) => c === null).length };
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
  const hora = horaMx(iso);
  const d = dia(t);
  if (d === dia(ahora)) return `hoy ${hora}`;
  if (d === dia(ahora - 86_400_000)) return `ayer ${hora}`;
  return `${fechaCorta(iso)} ${hora}`;
}

// ── Fila «viajes en curso» de «Hoy» ───────────────────────────────────────

/** La fila informativa de viajes abiertos. 0 → sin fila (el relleno honesto dice «sin pendientes»); `null` → se confiesa que no se pudo leer. */
export function filaViajesEnCurso(n: number | null, enlace: string | null, t: TResto = T_RESTO_ES): FilaAtencion | null {
  if (n === null) {
    return { id: 'en-curso-sin-lectura', severidad: 'atencion', titulo: t('op.viajes_en_curso'), detalle: t('op.no_se_pudo_leer_ahora_no'), href: null, sinPendiente: true };
  }
  if (n === 0) return null;
  return {
    id: 'en-curso', severidad: 'info', titulo: `${n} ${n === 1 ? 'viaje en curso' : 'viajes en curso'}`,
    detalle: t('op.abiertos_aun_sin_cerrar_ni_liquidar'), href: enlace,
    queSignifica: t('op.son_los_viajes_de_tu_flota'),
    queHacer: t('op.abre_viajes_para_ver_cual_sigue'), fuente: t('op.viajes_de_tu_flota_ahora'), textoAccion: t('op.abrir_viajes'),
  };
}
