import type { DashboardKpis, DineroObservadoTipo, HechoSolo, GastoSemanalPorCategoria } from '@/lib/likida/analytics';
import type { EstadoCartaPorte } from '@/lib/likida/carta_porte_datos';
import type { AgenteInsight, Insight } from '@/lib/likida/insights/tipos';
import { type TResto, T_RESTO_ES } from '@/lib/i18n/resto_tr';

// ═══════════════════════════════════════════════════════════════════════════
// MODELO DEL RESUMEN v2 (rediseño): tipos y funciones PURAS, sin importar nada de servidor (lo importan también los componentes de
// cliente; un import de `analytics` aquí arrastraría supabase/ssh2 al navegador). El lector vive en `resumen-datos.ts`. Usa lectores que ya existen (ninguna consulta propia): el Resumen no abre una
// frontera de datos nueva. Cada lectura cae a `null` POR SEPARADO (null ≠ 0): una consulta caída no tumba la página ni se
// vuelve un cero. Las funciones puras de abajo (semanas, filas de atención, siguiente acción) llevan la lógica y se prueban sin base.
// ═══════════════════════════════════════════════════════════════════════════

export type RangoResumen = '7' | '30' | 'todo';
export const RANGO_POR_OMISION: RangoResumen = '30';
export const RANGOS: readonly RangoResumen[] = ['7', '30', 'todo'];
export const rotuloRango = (t: TResto = T_RESTO_ES): Record<RangoResumen, string> => ({ '7': t('op.7_dias'), '30': t('op.30_dias'), todo: t('op.todo') });
export const ROTULO_RANGO = rotuloRango();
/** Cómo se dice el periodo en un sello de procedencia. */
export const periodoRango = (t: TResto = T_RESTO_ES): Record<RangoResumen, string> => ({ '7': t('op.ultimos_7_dias'), '30': t('op.ultimos_30_dias'), todo: 'todo el historial' });
export const PERIODO_RANGO = periodoRango();

/** Cualquier valor raro de la URL cae al periodo por omisión (nunca rompe la página). */
export function leerRango(v: string | null | undefined): RangoResumen {
  return v === '7' || v === '30' || v === 'todo' ? v : RANGO_POR_OMISION;
}

/** Semanas ISO que cubre el gasto de peajes: la semana en curso, cinco (≈ un mes) o un año. */
export const SEMANAS_PEAJES: Record<RangoResumen, number> = { '7': 1, '30': 5, todo: 52 };
export const SEMANAS_CIERRES = 8;

// ── Semanas de cierres ────────────────────────────────────────────────────

export interface SemanaCierre {
  /** Lunes de la semana (AAAA-MM-DD, día de México). */
  inicio: string;
  /** «26 oct»: el lunes con el que se rotula la columna. */
  etiqueta: string;
  valor: number;
  /** La semana en curso: aún le faltan días (se pinta con trama). */
  parcial: boolean;
}

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const DIA_MS = 86_400_000;
const fechaUtc = (f: string) => new Date(`${f}T00:00:00Z`);
const aIso = (d: Date) => d.toISOString().slice(0, 10);
/** Días desde el lunes (0 = lunes … 6 = domingo) de una fecha simple. */
const diasDesdeLunes = (f: string) => (fechaUtc(f).getUTCDay() + 6) % 7;
const sumarDias = (f: string, n: number) => aIso(new Date(fechaUtc(f).getTime() + n * DIA_MS));
const lunesDe = (f: string) => sumarDias(f, -diasDesdeLunes(f));

/** Cuántos días hay que pedir al lector diario para cubrir `semanas` semanas COMPLETAS (lunes a hoy). Pura. */
export function diasParaSemanas(hoy: string, semanas: number = SEMANAS_CIERRES): number {
  return diasDesdeLunes(hoy) + 1 + 7 * (semanas - 1);
}

/** Agrupa la serie diaria en semanas (lunes a domingo). Siempre devuelve `semanas` columnas, con cero donde no hubo cierre
 *  (el lector diario ya rellena los días); la semana de `hoy` va marcada como parcial. Pura. */
export function semanasDeSerie(serie: ReadonlyArray<{ dia: string; valor: number }>, hoy: string, semanas: number = SEMANAS_CIERRES): SemanaCierre[] {
  const lunesActual = lunesDe(hoy);
  const columnas: SemanaCierre[] = [];
  for (let i = semanas - 1; i >= 0; i--) {
    const inicio = sumarDias(lunesActual, -7 * i);
    const [, m, d] = inicio.split('-').map(Number);
    columnas.push({ inicio, etiqueta: `${d} ${MESES[m - 1]}`, valor: 0, parcial: i === 0 && diasDesdeLunes(hoy) < 6 });
  }
  const porInicio = new Map(columnas.map((c) => [c.inicio, c]));
  for (const p of serie) {
    const col = porInicio.get(lunesDe(p.dia));
    if (col) col.valor += p.valor;
  }
  return columnas;
}

// ── Meses de cierres (columnas mensuales a todo el ancho, plantilla Portada) ─────────────────────────────────────────

export const MESES_CIERRES = 6;

export interface MesCierre {
  /** Primer día del mes (AAAA-MM-DD). */
  inicio: string;
  /** «nov 2026». */
  etiqueta: string;
  valor: number;
  /** El mes en curso: aún le faltan días. */
  parcial: boolean;
}

/** Días que hay que pedir al lector diario para cubrir `meses` meses COMPLETOS más el actual (del día 1 del primero hasta hoy). Pura. */
export function diasParaMeses(hoy: string, meses: number = MESES_CIERRES): number {
  const [a, m] = hoy.split('-').map(Number);
  const primero = new Date(Date.UTC(a, m - 1 - (meses - 1), 1));
  return Math.round((fechaUtc(hoy).getTime() - primero.getTime()) / DIA_MS) + 1;
}

/** Agrupa la misma serie diaria en meses calendario. Siempre devuelve `meses` columnas (cero donde no hubo cierre: el lector
 *  diario ya rellena los días); el mes de `hoy` va marcado como parcial. Pura. */
export function mesesDeSerie(serie: ReadonlyArray<{ dia: string; valor: number }>, hoy: string, meses: number = MESES_CIERRES): MesCierre[] {
  const [a, m] = hoy.split('-').map(Number);
  const columnas: MesCierre[] = [];
  for (let i = meses - 1; i >= 0; i--) {
    const f = new Date(Date.UTC(a, m - 1 - i, 1));
    const clave = aIso(f).slice(0, 7);
    columnas.push({ inicio: `${clave}-01`, etiqueta: `${MESES[f.getUTCMonth()]} ${f.getUTCFullYear()}`, valor: 0, parcial: i === 0 });
  }
  const porMes = new Map(columnas.map((c) => [c.inicio.slice(0, 7), c]));
  for (const p of serie) {
    const col = porMes.get(p.dia.slice(0, 7));
    if (col) col.valor += p.valor;
  }
  return columnas;
}

// ── Cifras sueltas ────────────────────────────────────────────────────────

/** Peajes del periodo = el concepto «caseta» de la serie semanal. Si «caseta» no está entre las series (solo se listan los 3
 *  conceptos con más gasto) y hay menos de 3 conceptos, de verdad no hubo gasto de casetas (0 medido); si hay 3, no se sabe (null). */
export function peajesDeGasto(g: GastoSemanalPorCategoria): number | null {
  const s = g.series.find((x) => x.nombre === 'caseta');
  if (s) return Math.round(s.valores.reduce((a, b) => a + b, 0) * 100) / 100;
  return g.series.length < 3 ? 0 : null;
}

/** Carta Porte completas = viajes sin cerrar con el checklist del transportista listo y sin faltantes del cliente. Si la lista
 *  viene truncada (hay más viajes que los leídos), el «n de N» no se puede afirmar: null. Pura. */
export function cartaPorteCompletas(e: Pick<EstadoCartaPorte, 'viajes' | 'total'>): { completas: number; total: number } | null {
  if (e.total > e.viajes.length) return null;
  const completas = e.viajes.filter((v) => v.checklist.transportistaListo && v.checklist.faltanCliente === 0).length;
  return { completas, total: e.viajes.length };
}

// ── El conjunto de datos ──────────────────────────────────────────────────

export interface DatosResumen {
  rango: RangoResumen;
  hoy: string;
  /** ¿Se leyeron las cifras en pesos? (rol con acceso al área de dinero). Sin ello no se pinta ningún peso. */
  veDinero: boolean;
  kpis: DashboardKpis | null;
  peajes: { total: number | null; semanas: number } | null;
  cartaPorte: { completas: number; total: number } | null;
  cierres: SemanaCierre[] | null;
  /** Cierres por mes calendario (misma lectura diaria que `cierres`). Opcional: la portada de cinco agentes no lo pinta. */
  mensuales?: MesCierre[] | null;
  porTipo: DineroObservadoTipo[] | null;
  hechos: HechoSolo[] | null;
  escalados: number | null;
  /** Los viajes más recientes de la flota (fila 6-6 de la portada). Opcional: la portada de cinco agentes no lo lee. `undefined` = no se pidió; `null` = se pidió y falló. */
  recientes?: ViajeReciente[] | null;
}

/** Una fila de «Viajes recientes». `diferencia` solo se llena con acceso al dinero y si el viaje ya tiene liquidación (null = «—», nunca cero). */
export interface ViajeReciente { id: string; folio: string; ruta: string | null; estatus: string; diferencia: number | null }

/** Cuántas lecturas se intentaron y cuántas respondieron: el chip «Fuentes n de N» de la barra de filtros. */
export function coberturaDe(d: DatosResumen): { ok: number; total: number } {
  const intentadas: unknown[] = [d.kpis, d.cartaPorte, d.cierres, d.hechos, d.escalados];  // los meses salen de la misma lectura que las semanas: no suman fuente
  if (d.recientes !== undefined) intentadas.push(d.recientes);
  if (d.veDinero) intentadas.push(d.peajes, d.porTipo);
  return { ok: intentadas.filter((x) => x !== null).length, total: intentadas.length };
}

// ── «Requiere tu atención» ────────────────────────────────────────────────

/** Burdeos = te toca a ti · ocre = en espera / atención · gris = informativo (ESTILO §2). */
export type SeveridadFila = 'accion' | 'atencion' | 'info';

export interface FilaAtencion {
  id: string;
  severidad: SeveridadFila;
  titulo: string;
  /** Una línea. */
  detalle: string;
  href: string | null;
  /** Texto del detalle en el panel lateral (qué pasó · qué significa · qué hacer). */
  queSignifica?: string;
  queHacer?: string;
  fuente?: string;
  textoAccion?: string;
  /** Fila que dice «sin pendientes» (relleno honesto de lo revisado). */
  sinPendiente?: boolean;
}

const SEVERIDAD_INSIGHT: Record<Insight['severidad'], SeveridadFila> = { urgente: 'accion', atencion: 'atencion', info: 'info' };
const PESO: Record<SeveridadFila, number> = { accion: 0, atencion: 1, info: 2 };

export const RUTA_LIQUIDACION = '/dashboard/agentes/liquidacion';
const RUTA_VIAJES_ESCALADOS = '/dashboard/viajes?filtro=escalados';
const RUTA_AGENTE: Record<Insight['agente'], string> = {
  liquidacion: RUTA_LIQUIDACION, peajes: '/dashboard/agentes/peajes', 'carta-porte': '/dashboard/agentes/carta-porte',
  vigia: '/dashboard/agentes/vigia', conductores: '/dashboard/agentes/conductores',
};
const nombreAgente = (t: TResto = T_RESTO_ES): Record<Insight['agente'], string> => ({
  liquidacion: t('op.liquidacion'), peajes: t('op.peajes'), 'carta-porte': t('op.carta_porte'), vigia: t('op.servicio_al_cliente'), conductores: t('op.operadores'),
});


/** Une al sufijo de tenant/vista (`?tenant=…`) una ruta que ya puede traer su propio `?filtro=`. */
export function conSufijo(ruta: string, sufijo: string): string {
  if (!sufijo) return ruta;
  const s = sufijo.replace(/^\?/, '');
  return ruta.includes('?') ? `${ruta}&${s}` : `${ruta}?${s}`;
}

/** Opciones de `filasAtencion`: `puede` decide si un enlace se ofrece (por rol y perfil); `fallidos` son los agentes cuyo lector falló. */
export interface OpcionesFilas {
  puede?: (ruta: string) => boolean;
  fallidos?: readonly AgenteInsight[];
  /** Filas ya armadas por quien llama (p. ej. «viajes en curso» del Inicio de cinco agentes); cuentan para el mínimo. */
  extra?: readonly FilaAtencion[];
}

/** Los atajos del pie de «Siguiente mejor acción». Cada uno se ofrece solo si el rol los abre (`puedeVerRuta`). */
export const ATAJOS_RESUMEN: ReadonlyArray<{ href: string; nombre: string }> = [
  { href: '/dashboard/despacho', nombre: 'Nuevo viaje' },
  { href: '/dashboard/viajes', nombre: 'Viajes' },
  { href: '/dashboard/operadores', nombre: 'Operadores' },
];

/** Las filas de «Requiere tu atención» (sin la de Puesta en marcha, que depende del navegador): primero lo que te toca,
 *  después lo que espera, y para llegar a `minimo` filas rellena con lo ya revisado («sin pendientes» / «no se pudo leer»). Pura. */
export function filasAtencion(
  d: Pick<DatosResumen, 'kpis' | 'escalados'> & { rango?: RangoResumen },
  principales: readonly Insight[],
  sufijo: string,
  minimo = 3,
  opciones: OpcionesFilas = {}, t: TResto = T_RESTO_ES,
): FilaAtencion[] {
  const puede = opciones.puede ?? (() => true);
  /** El enlace de una fila solo existe si este rol (y este perfil) abre esa pantalla: jamás una fila que rebota. */
  const enlace = (ruta: string): string | null => (puede(ruta) ? conSufijo(ruta, sufijo) : null);
  const filas: FilaAtencion[] = [];
  for (const i of principales) {
    filas.push({
      id: `insight-${i.agente}`, severidad: SEVERIDAD_INSIGHT[i.severidad],
      titulo: `${nombreAgente(t)[i.agente]}: ${i.quePaso}`, detalle: i.queSignifica,
      href: enlace(RUTA_AGENTE[i.agente]), queSignifica: i.queSignifica, queHacer: i.queHacer,
      fuente: t(i.fuente.n === 1 ? 'op.fuente_n_registro.uno' : 'op.fuente_n_registro.otros', { periodo: i.fuente.periodo, n: i.fuente.n }), textoAccion: `Abrir ${nombreAgente(t)[i.agente]}`,
    });
  }
  // Un agente cuyo lector FALLÓ no se omite en silencio (eso se leería como «sin pendientes»): se confiesa como fila.
  for (const a of opciones.fallidos ?? []) {
    filas.push({
      id: `insight-sin-lectura-${a}`, severidad: 'atencion', titulo: t('op.no_se_pudo_leer_2', { nombreAgente: nombreAgente(t)[a] }),
      detalle: t('op.su_interpretacion_no_cargo_ahora_no'), href: enlace(RUTA_AGENTE[a]),
      queSignifica: t('op.la_lectura_de_este_agente_fallo'),
      queHacer: t('op.vuelve_a_cargar_en_un_momento'), fuente: 'Lectura del agente, ahora', textoAccion: `Abrir ${nombreAgente(t)[a]}`,
    });
  }
  filas.push(...(opciones.extra ?? []));
  const porRevisar = d.kpis?.porRevisar ?? null;
  if (porRevisar !== null && porRevisar > 0) {
    filas.push({
      id: 'por-revisar', severidad: 'accion',
      titulo: t(porRevisar === 1 ? 'op.n_liquidacion_por_revisar.uno' : 'op.n_liquidacion_por_revisar.otros', { n: porRevisar }),
      detalle: t('op.el_agente_las_dejo_con_estatus'),
      href: enlace(RUTA_LIQUIDACION),
      queSignifica: t('op.son_liquidaciones_del_periodo_que_el'),
      queHacer: t('op.abre_la_cola_de_revision_del'), fuente: t('op.liquidaciones_de_tu_flota_periodo_elegido'), textoAccion: t('op.revisar_liquidaciones'),
    });
  }
  const escalados = d.escalados;
  if (escalados !== null && escalados > 0) {
    filas.push({
      id: 'escalados', severidad: 'atencion',
      titulo: t(escalados === 1 ? 'op.n_viaje_escalado.uno' : 'op.n_viaje_escalado.otros', { n: escalados }),
      detalle: t('op.se_escalaron_por_falta_de_respuesta'),
      href: enlace(RUTA_VIAJES_ESCALADOS),
      queSignifica: t('op.el_agente_ya_intento_avisar_al'),
      queHacer: t('op.abre_los_viajes_escalados_y_da'), fuente: t('op.viajes_con_sello_de_escalado'), textoAccion: t('op.ver_viajes_escalados'),
    });
  }
  filas.sort((a, b) => PESO[a.severidad] - PESO[b.severidad]);

  // Relleno honesto: lo que se revisó y salió limpio (o no se pudo leer; jamás un «limpio» inventado).
  // Cada «sin pendientes» dice SU corte: las liquidaciones por revisar se leen con la ventana del periodo elegido; los
  // viajes escalados son un conteo de ahora (sin ventana), y no se les cuelga un periodo que no tienen.
  const periodo = periodoRango(t)[d.rango ?? RANGO_POR_OMISION];
  const revisadas: Array<[string, string, number | null, boolean, string]> = [
    ['por-revisar', 'Liquidaciones por revisar', porRevisar, filas.some((f) => f.id === 'por-revisar'), `Sin pendientes · ${periodo}.`],
    ['escalados', 'Viajes escalados', escalados, filas.some((f) => f.id === 'escalados'), 'Sin pendientes · ahora.'],
  ];
  for (const [id, rotulo, n, yaEsta, limpio] of revisadas) {
    if (filas.length >= minimo || yaEsta) continue;
    filas.push(n === null
      ? { id: `${id}-sin-lectura`, severidad: 'atencion', titulo: rotulo, detalle: t('op.no_se_pudo_leer_ahora_no'), href: null, sinPendiente: true }
      : { id: `${id}-limpio`, severidad: 'info', titulo: rotulo, detalle: limpio, href: null, sinPendiente: true });
  }
  return filas;
}

// ── «Siguiente mejor acción» ──────────────────────────────────────────────

/** `href` null = hay un pendiente real pero este rol no abre la pantalla que lo resuelve: se dice QUÉ pasa, sin botón que rebote. */
export interface AccionSugerida { id: string; titulo: string; porQue: string; textoBoton: string; href: string | null }

/** Regla fija (no un modelo): 1) el siguiente paso de la Puesta en marcha, 2) una alerta urgente de un agente,
 *  3) viajes escalados, 4) liquidaciones por revisar. Devuelve la lista ordenada; la primera es «la» acción. Pura. */
export function elegirAcciones(e: {
  marcha: { titulo: string; resumen: string; href: string } | null;
  filas: readonly FilaAtencion[];
}): AccionSugerida[] {
  const out: AccionSugerida[] = [];
  if (e.marcha) out.push({ id: 'marcha', titulo: `Puesta en marcha: ${e.marcha.titulo}`, porQue: e.marcha.resumen, textoBoton: 'Continuar', href: e.marcha.href });
  const por = (id: string) => e.filas.find((f) => f.id === id && f.href);
  const urgente = e.filas.find((f) => f.id.startsWith('insight-') && f.severidad === 'accion' && f.href);
  for (const f of [urgente, por('escalados'), por('por-revisar')]) {
    if (f?.href && f.textoAccion) out.push({ id: f.id, titulo: f.titulo, porQue: f.queSignifica ?? f.detalle, textoBoton: f.textoAccion, href: f.href });
  }
  // La tarjeta sale de lo MISMO que «Requiere tu atención»: un pendiente real sin enlace (el rol no abre esa pantalla) sigue siendo un
  // pendiente. Se enumera sin botón, nunca como «nada urgente» al lado de una fila que pide atención.
  for (const f of e.filas) {
    if (f.sinPendiente || f.severidad === 'info' || out.some((a) => a.id === f.id)) continue;
    out.push({ id: f.id, titulo: f.titulo, porQue: f.queSignifica ?? f.detalle, textoBoton: '', href: null });
  }
  return out;
}
