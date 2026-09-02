// ═══════════════════════════════════════════════════════════════════════════
// LEADS (0235) — los seis que quedaban en 'disenado' del departamento que
// alimenta el embudo. Con ellos el departamento queda completo y la compañía
// agente llega a 60/60.
//
//   · scorer      — puntúa la señal REAL del prospecto, o declara que no alcanza.
//   · dossier     — la ficha de una página para el vendedor, con lo verificado
//                   separado de lo NO verificado.
//   · vigia       — los ya contactados que piden volver: contestaron, se les
//                   venció el plazo, o cambiaron de etapa.
//   · demo_prep   — el brief de la demo agendada: quién es, qué le duele, qué
//                   números SUYOS ya conocemos.
//   · propuestas  — el borrador de propuesta con el pricing REAL de la base.
//   · cazador     — el encargo de caza: qué perfil convierte, qué celdas del
//                   mapa están sin trabajar, y a quién de los YA capturados
//                   nunca se le tocó.
//
// ── LAS REGLAS QUE GOBIERNAN A LOS SEIS ───────────────────────────────────
//
//  1. NINGUNO ESCRIBE A NADIE Y NINGUNO CIERRA NADA. Los seis fabrican una
//     pieza y la dejan en `cola_aprobacion`. Mandar el correo es del enviador
//     (0217), y firmar una propuesta es de una persona. Este módulo no importa
//     un solo canal de salida.
//  2. NINGUNO MUTA EL CRM. Ni una fila de `prospecto`, ni de
//     `prospecto_dossier`, ni de `prospecto_contacto`. Es una decisión y no un
//     olvido: `prospecto_dossier` lo ESCRIBE el investigador (0217) con lo que
//     leyó de la web, y un upsert determinista encima le borraría la
//     investigación de un modelo con una consolidación de lo que ya estaba —
//     el mismo dato, pero peor y sin fuentes. El `dossier` de aquí LEE ese
//     registro y arma la ficha; quien decida escribirlo de vuelta es una
//     persona aprobando la pieza. Y `cazador` NO da de alta prospectos por su
//     cuenta por lo mismo: una empresa nueva en el CRM es un hecho de negocio,
//     y este servidor no tiene de dónde sacar empresas que no estén ya aquí
//     (no navega la web) — fabricarlas sería exactamente la cifra inventada
//     que la casa prohíbe.
//  3. CERO LLM. Los seis son deterministas de punta a punta: las reglas
//     calculan Y redactan con plantilla fija. El techo de dinero se declara
//     igual (candado 3 del runner lo exige) y el runner lo mide contra el
//     gasto REAL, así que el día que alguno redacte con modelo el freno ya
//     está puesto y nadie tiene que acordarse de ponerlo.
//  4. NULL ≠ 0, Y «SIN SEÑAL» ≠ «SEÑAL MALA». Un prospecto sin `num_unidades`
//     no tiene flota de cero: no se sabe su flota. El scorer lo declara
//     INSUFICIENTE y NO le pone número — un 0 sobre 100 mandaría al vendedor a
//     descartar una empresa de la que no sabemos nada.
//  5. IDEMPOTENCIA POR CONSTRAINT. Título determinista por periodo contra el
//     índice único parcial `cola_pieza_leads_por_periodo` (0235), no un `if`
//     (estándar §7). Dos pasadas del runner que compitan por el mismo periodo
//     las resuelve la base: gana exactamente una.
//  6. TELÉFONOS Y CORREOS SOLO DE LA BASE. Lo que este módulo cita sale de
//     `prospecto`, `prospecto_persona`, `prospecto_correo` y
//     `prospecto_dossier`. No hay una sola dirección literal en este archivo.
// ═══════════════════════════════════════════════════════════════════════════
import { supabaseAdmin } from '@/lib/supabase/admin';
import { acotada } from '../presupuesto';
import { hoyMx, numero, mxn, fechaMx } from '@/lib/formato';
import { encolarPieza } from './cola';
import { registrarCorrida, type DisparoCorrida } from './corridas';
import { logger } from '@/lib/logger';

export const AGENTES_LEADS = [
  'scorer', 'dossier', 'vigia', 'demo_prep', 'propuestas', 'cazador',
] as const;
export type AgenteLeads = (typeof AGENTES_LEADS)[number];

export function esAgenteLeads(id: string): id is AgenteLeads {
  return (AGENTES_LEADS as readonly string[]).includes(id);
}

/** Lo que una corrida de leads le reporta al runner. Misma forma que la de
 *  crecimiento (0230): `resultado` distingue «no tocaba» de «corrió y no
 *  fabricó», que en un cron cada 4 horas no es lo mismo. */
export interface ResultadoLeads {
  resultado: 'corrio' | 'saltado';
  /** Piezas que ENTRARON a la bandeja en esta corrida (0 o 1). */
  piezas: number;
  /** Por qué no se fabricó, cuando piezas = 0 y no es un fallo. */
  motivo?: string;
  /** Gasto de modelo MEDIDO. $0 en los seis: ninguno llama a un modelo. */
  costoUsd: number;
  /** El reloj de la vuelta se agotó a media BÚSQUEDA de candidato y quedaron
   *  empresas sin mirar. No es un fallo y tampoco es «no había a quién»: es la
   *  tercera cosa, y sin ella el runner pintaría la vuelta completa. El runner
   *  la sube a `saltadosPorReloj` (regla de la #152). */
  sinTurno?: boolean;
}

/** El reloj de la vuelta, para los tres que BUSCAN candidato preguntándole a
 *  la bandeja una empresa a la vez. Se redefine aquí en vez de importarse de
 *  `runner.ts` a propósito: el runner importa ESTE módulo por import dinámico
 *  justo para no cargarlo en cada vuelta, y un import de vuelta cerraría el
 *  ciclo. Dos líneas no valen esa dependencia. */
function relojAgotado(venceEn: number | undefined): boolean {
  return venceEn !== undefined && Date.now() >= venceEn;
}

// ── Aritmética de fechas ───────────────────────────────────────────────────
//
// Se redefine aquí en vez de importarse de `crecimiento.ts` por lo mismo que
// aquel la redefinió de `backoffice.ts`: el runner carga estos módulos por
// import dinámico justo para no pagar sus árboles, y tres líneas de aritmética
// no justifican arrastrar la calculadora y el índice de normas.

/** El lunes de la semana de `dia` ('YYYY-MM-DD'). Anclado a mediodía UTC: el
 *  propio cálculo del día de la semana no puede cruzar de fecha. */
export function lunesDe(dia: string): string {
  const d = new Date(`${dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

/** Días calendario entre el día ISO `dia` y el instante `iso` (positivo = el
 *  instante quedó ATRÁS). `null` cuando el instante no consta: «nunca» no es
 *  «hace muchos días», y el que los confunda ordenaría el turno al revés. */
export function diasDesde(iso: string | null, dia: string): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Math.floor((Date.parse(`${dia}T12:00:00Z`) - t) / 86_400_000);
}

// ── La pieza hacia la bandeja, con su idempotencia por constraint ──────────

/** ¿Ya existe la pieza de este periodo (cualquier estado)? LANZA si no se
 *  puede saber: sin poder verificar, no se fabrica (fail closed). */
export async function piezaExistente(agente: AgenteLeads, titulo: string): Promise<boolean> {
  const { count, error } = await acotada(supabaseAdmin()
    .from('cola_aprobacion')
    .select('id', { count: 'exact', head: true })
    .eq('agente', agente)
    .eq('titulo', titulo), 'leads.pieza_existente');
  if (error) throw new Error(`piezaExistente(${agente}): ${error.message}`);
  if (typeof count !== 'number') throw new Error(`piezaExistente(${agente}): PostgREST no devolvió el conteo — no se afirma un 0 que nadie midió.`);
  return count > 0;
}

/** Encola la pieza. El índice único parcial de la 0235 es el árbitro real: si
 *  otra corrida ganó la carrera del mismo periodo, el duplicado rebota y se
 *  trata como «ya existía», no como fallo. */
export async function encolarPiezaLeads(
  agente: AgenteLeads, tipo: string, titulo: string, cuerpo: string,
  fuentes: Record<string, unknown>, prospectoId?: string | null,
): Promise<'encolada' | 'ya_existia'> {
  try {
    await encolarPieza({ tipo, prioridad: 'normal', agente, titulo, cuerpo, fuentes, prospectoId: prospectoId ?? null });
    return 'encolada';
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('duplicate key') || msg.includes('cola_pieza_leads_por_periodo')) return 'ya_existia';
    throw e;
  }
}

/** Registra la corrida — `registrarCorrida` jamás lanza (contrato 0102).
 *  Todas van con tenant NULL: un prospecto no es de ninguna flota (el CRM es
 *  de Likida, 0105). */
export async function anotarCorrida(
  agente: AgenteLeads, inicio: Date, estado: 'ok' | 'fallo', disparo: DisparoCorrida,
  resumen: Record<string, unknown>, extra?: { error?: string },
): Promise<void> {
  await registrarCorrida(null, agente, {
    inicio, fin: new Date(), estado, disparo,
    // 0 MEDIDO, no NULL: estas corridas sí saben lo que gastaron (nada).
    costoUsd: 0,
    ...(estado === 'ok' ? { tareasHechas: 1, tareasTotal: 1 } : { tareasHechas: 0, tareasTotal: 1 }),
    resumen,
    ...(extra?.error ? { error: extra.error } : {}),
  });
}

/** El cierre que llevan TODAS las piezas de este departamento. La frase de la
 *  casa, puesta donde se lee: aquí nadie manda ni firma nada. */
const PIE_TAP_DE_JAVIER = 'Nadie escribió a nadie desde aquí: esto es una preparación y mandarla —o firmarla— es el tap de una persona.';

/** Redacta el resultado común de «la pieza ya estaba». */
function yaEstaba(agente: AgenteLeads, que: string): ResultadoLeads {
  logger.info('leads.ya_existia', { agente });
  return { resultado: 'corrio', piezas: 0, motivo: `${que} ya está en la bandeja`, costoUsd: 0 };
}

/** Filas que una ventana de prospectos lee como máximo. Muy por encima del
 *  censo real (decenas de miles de filas, la enorme mayoría del censo del
 *  DENUE); si se llena, la pieza lo DICE en vez de callar lo que no cupo. */
export const TOPE_PROSPECTOS = 5_000;

/** Los estados del embudo que cuentan como VIVOS para estos agentes. El
 *  dominio de `prospecto.estado` (0181) mezcla dos vocabularios —el original
 *  en español y el del CRM importado en inglés— y los dos siguen en la base:
 *  ignorar uno dejaría medio pipeline invisible. */
export const ESTADOS_CERRADOS: readonly string[] = ['cerrado', 'won', 'perdido', 'lost', 'cancelled'];

/** Ids por consulta en un `.in(...)`.
 *
 *  ESTO NO ES UNA MICRO-OPTIMIZACIÓN, ES UN LÍMITE DE PROTOCOLO. PostgREST
 *  recibe el filtro por la QUERY STRING de un GET, y un `in.(…)` con los 5 000
 *  ids del tope de arriba son ~185 KB de URL: el proxy contesta 414 y la
 *  consulta ni llega a Postgres. Con el censo real (decenas de miles de filas)
 *  ese camino se rompe SIEMPRE, no de vez en cuando — y el agente que lo
 *  sufriera fallaría entero por una lista de correos.
 *
 *  200 deja la URL en unos 8 KB, muy por debajo de cualquier límite razonable,
 *  y 25 vueltas de 200 sobre tablas satélite pequeñas cuestan milisegundos. */
export const IDS_POR_LOTE = 200;

/** Corre `leer` por lotes de ids y junta las filas. LANZA en cuanto un lote
 *  falla: media lista es peor que ninguna — un mapa a medias haría que los
 *  prospectos del lote que no llegó se reportaran como «sin correos» o «sin
 *  tocar», que son afirmaciones, no huecos. */
async function porLotes<T>(ids: string[], leer: (lote: string[]) => Promise<T[]>): Promise<T[]> {
  const salida: T[] = [];
  for (let i = 0; i < ids.length; i += IDS_POR_LOTE) {
    salida.push(...await leer(ids.slice(i, i + IDS_POR_LOTE)));
  }
  return salida;
}

// ═══════════════════════════════════════════════════════════════════════════
// 1 · SCORER — la señal que EXISTE, o el «no alcanza» dicho con todas sus
// letras.
//
// EL PUNTO ENTERO DE ESTE AGENTE ES NO PUNTUAR CUANDO NO PUEDE. La base ya
// tiene dos columnas DERIVADAS —`similitud_icp_pct` y `necesidad_pct`, 0140/
// 0143— calculadas por Postgres sobre el mismo puñado de campos. Ese cálculo
// tiene un defecto que solo se ve desde afuera: `least(100, 0 + 0 + 0 + 0)` es
// CERO, y un cero se lee como «malísimo prospecto» cuando lo que de verdad
// pasó es que no sabemos NADA de la empresa. Las dos lecturas mandan al
// vendedor a lugares opuestos.
//
// Así que este agente no re-calcula esas fórmulas: cuenta cuántas SEÑALES
// constan, y solo si constan al menos `MIN_SENALES` reporta el puntaje
// derivado como lo que es. Bajo el piso, el puntaje sale `null` y la ficha
// dice qué falta averiguar — que es una tarea, no un descarte.
// ═══════════════════════════════════════════════════════════════════════════

export interface SenalesProspecto {
  id: string;
  empresa: string;
  /** Tamaño de flota. `null` = no se encontró (0140), jamás 0. */
  numUnidades: number | null;
  /** El rango que el propio prospecto declaró en /getdemo (0137). */
  unidades: string | null;
  sitio: string | null;
  sitioWeb: string | null;
  sitioVerificado: boolean;
  scian: string | null;
  vacante: string | null;
  estado: string;
  /** Correos hallados por el investigador (0217). Es un conteo MEDIDO. */
  correos: number;
  /** Los DERIVADOS de la base (0140/0143). Se citan, no se recalculan. */
  similitudPct: number | null;
  necesidadPct: number | null;
}

/** Señales mínimas para que el puntaje derivado signifique algo. Tres de las
 *  cinco: por debajo, `similitud_icp_pct` sería un número armado con puros
 *  ceros por ausencia y no por medición. */
export const MIN_SENALES = 3;

export interface Puntaje {
  id: string;
  empresa: string;
  /** Cuántas de las cinco señales declaradas constan de verdad. */
  senales: number;
  /** Cuáles constan, por nombre — sin esto el conteo es un número mudo. */
  cuales: string[];
  /** Qué falta averiguar. Es la tarea que el parte deja. */
  faltan: string[];
  /** El puntaje derivado de la base. `null` cuando las señales no alcanzan:
   *  «no se sabe» no se guarda igual que «es cero» (estándar §2). */
  puntoPct: number | null;
  /** Por qué sale `null`, cuando sale `null`. */
  motivoInsuficiente: string | null;
}

/** Puntúa UN prospecto. PURO — sin base de datos, para poder probarlo. */
export function puntuar(p: SenalesProspecto): Puntaje {
  const cuales: string[] = [];
  const faltan: string[] = [];
  const anota = (hay: boolean, nombre: string, comoSeConsigue: string) => {
    if (hay) cuales.push(nombre);
    else faltan.push(`${nombre} — ${comoSeConsigue}`);
  };
  anota(p.numUnidades !== null || p.unidades !== null, 'tamaño de flota',
    'lo trae el formulario de /getdemo o lo encuentra el investigador en el sitio de la empresa');
  anota(Boolean(p.sitio?.trim() || p.sitioWeb?.trim()), 'sitio web',
    'sin sitio no hay qué investigar: el investigador (0217) no tiene por dónde entrar');
  anota(p.correos > 0, 'correos hallados',
    'los encuentra el investigador leyendo el sitio; sin uno, la campaña no tiene a quién escribirle');
  anota(Boolean(p.vacante?.trim()), 'vacante publicada',
    'es la señal del censo: el dolor nombrado por la propia empresa');
  anota(Boolean(p.scian?.trim()), 'giro (SCIAN)',
    'lo trae el censo del DENUE; sin él no se sabe si es autotransporte');

  const senales = cuales.length;
  if (senales < MIN_SENALES) {
    return {
      id: p.id, empresa: p.empresa, senales, cuales, faltan, puntoPct: null,
      motivoInsuficiente: `SEÑAL INSUFICIENTE: constan ${numero(senales)} de las 5 señales declaradas y el piso son ${numero(MIN_SENALES)}. El puntaje de la base saldría de sumar ceros por AUSENCIA, no por medición — y un 0 se lee como «mal prospecto» cuando lo que pasa es que no sabemos nada de esta empresa. No se le pone número.`,
    };
  }
  // Con señales suficientes se CITA el derivado de la base, no se recalcula:
  // la fórmula vive en la 0140/0143 como columna generada y duplicarla aquí
  // garantizaría que un día divergieran sin que nadie se enterara.
  if (p.similitudPct === null) {
    return {
      id: p.id, empresa: p.empresa, senales, cuales, faltan, puntoPct: null,
      motivoInsuficiente: 'las señales alcanzan, pero la columna derivada `similitud_icp_pct` vino NULL — Postgres la calcula siempre, así que un NULL aquí significa que la consulta no la trajo, no que valga cero. Sin ella no se afirma un puntaje.',
    };
  }
  return {
    id: p.id, empresa: p.empresa, senales, cuales, faltan,
    puntoPct: p.similitudPct, motivoInsuficiente: null,
  };
}

/** El cuerpo del parte del scorer. PURO. */
export function armarParteScorer(
  puntajes: Puntaje[], dia: string, truncado: boolean,
): string {
  const conPunto = puntajes.filter((p) => p.puntoPct !== null)
    .sort((a, b) => (b.puntoPct ?? 0) - (a.puntoPct ?? 0) || a.empresa.localeCompare(b.empresa));
  const sinPunto = puntajes.filter((p) => p.puntoPct === null);

  const l: string[] = [`SCORER — la señal de los prospectos vivos al ${dia}`, ''];
  if (puntajes.length === 0) {
    l.push('NI UN SOLO PROSPECTO VIVO en la consulta.');
    l.push('Eso NO es «el embudo está en cero»: la tabla contestó y vino vacía, y las dos lecturas son «no hay prospectos sin cerrar» y «el filtro de esta consulta no alcanzó ninguna fila». Las dos son noticia y ninguna es un puntaje.');
    l.push('');
    l.push(PIE_TAP_DE_JAVIER);
    return l.join('\n');
  }

  l.push(`Prospectos vivos leídos: ${numero(puntajes.length)}. Con señal suficiente (≥ ${numero(MIN_SENALES)} de 5): ${numero(conPunto.length)}. Con señal INSUFICIENTE: ${numero(sinPunto.length)}.`);
  l.push('');
  if (conPunto.length === 0) {
    l.push('NINGUNO ALCANZA EL PISO DE SEÑAL. No hay lista que ordenar y no se va a fabricar una: puntuar sobre ausencias produciría un ranking de qué tan poco investigamos, no de qué tan bueno es el prospecto.');
  } else {
    l.push('CON SEÑAL SUFICIENTE (el % es `similitud_icp_pct`, la columna DERIVADA que Postgres calcula — no la recalcula este agente):');
    for (const p of conPunto.slice(0, 20)) {
      l.push(`  · ${p.empresa} — ${numero(p.puntoPct as number)}% · ${numero(p.senales)}/5 señales: ${p.cuales.join(', ')}`);
      if (p.faltan.length > 0) l.push(`     falta por averiguar: ${p.faltan.map((f) => f.split(' — ')[0]).join(', ')}`);
    }
    if (conPunto.length > 20) l.push(`  … y ${numero(conPunto.length - 20)} más con señal suficiente, no listados aquí.`);
  }

  l.push('');
  if (sinPunto.length === 0) {
    l.push('SIN NINGUNO POR DEBAJO DEL PISO: todos los vivos tienen al menos tres señales. Es un resultado medido, no un hueco.');
  } else {
    l.push('SEÑAL INSUFICIENTE — ESTOS NO LLEVAN NÚMERO, Y ES A PROPÓSITO:');
    for (const p of sinPunto.slice(0, 15)) {
      l.push(`  · ${p.empresa} — ${numero(p.senales)}/5 señales${p.cuales.length > 0 ? ` (${p.cuales.join(', ')})` : ' (ninguna)'}`);
      for (const f of p.faltan) l.push(`     falta: ${f}`);
    }
    if (sinPunto.length > 15) l.push(`  … y ${numero(sinPunto.length - 15)} más con señal insuficiente, no listados aquí.`);
    l.push('');
    l.push('QUÉ HACER CON ESTOS: no descartarlos. Un prospecto sin señal no es un mal prospecto, es uno que nadie investigó — y el investigador (`enriquecedor`, 0217) es justo el agente que llena estos huecos cuando el prospecto tiene sitio web. Los que ni sitio tienen son los que necesitan una persona.');
  }

  if (truncado) {
    l.push('');
    l.push(`CONSULTA TRUNCADA A ${numero(TOPE_PROSPECTOS)} FILAS: hay más prospectos vivos de los que este parte alcanzó a leer. Todo lo de arriba se afirma sobre los leídos; los conteos son un PISO, no el total.`);
  }
  l.push('');
  l.push('DE DÓNDE SALE CADA COSA: `prospecto` (num_unidades, unidades, sitio, sitio_web, scian, vacante y los derivados similitud_icp_pct / necesidad_pct de la 0140/0143) y el conteo de `prospecto_correo` por prospecto. Ni una señal se infiere: lo que no consta se lista como falta.');
  l.push(PIE_TAP_DE_JAVIER);
  return l.join('\n');
}

/** Los prospectos vivos con sus señales. LANZA ante error: puntuar sobre una
 *  tabla ciega afirmaría «no hay señal» donde lo que hubo fue un fallo. */
async function leerSenales(): Promise<{ filas: SenalesProspecto[]; truncado: boolean }> {
  const { data, error, count } = await acotada(supabaseAdmin()
    .from('prospecto')
    // `count: 'exact'` y no `length === tope`: PostgREST recorta a `max_rows`
    // sin avisar, así que comparar el largo contra el `.limit()` no detecta
    // nada (la lección ESC-8, ya aprendida en backoffice.ts).
    .select('id, empresa, num_unidades, unidades, sitio, sitio_web, sitio_verificado, scian, vacante, estado, similitud_icp_pct, necesidad_pct', { count: 'exact' })
    .is('duplicado_de', null)
    .not('estado', 'in', `(${ESTADOS_CERRADOS.join(',')})`)
    .order('created_at', { ascending: false })
    .limit(TOPE_PROSPECTOS), 'leads.scorer.prospectos');
  if (error) throw new Error(`leerSenales: ${error.message}`);
  const crudas = (data ?? []) as Array<Record<string, unknown>>;
  const truncado = typeof count === 'number' ? count > crudas.length : crudas.length >= TOPE_PROSPECTOS;

  const ids = crudas.map((f) => String(f.id));
  const correosPorProspecto = await contarCorreos(ids);

  return {
    filas: crudas.map((f): SenalesProspecto => ({
      id: String(f.id),
      empresa: String(f.empresa),
      numUnidades: f.num_unidades === null || f.num_unidades === undefined ? null : Number(f.num_unidades),
      unidades: (f.unidades as string | null) ?? null,
      sitio: (f.sitio as string | null) ?? null,
      sitioWeb: (f.sitio_web as string | null) ?? null,
      sitioVerificado: f.sitio_verificado === true,
      scian: (f.scian as string | null) ?? null,
      vacante: (f.vacante as string | null) ?? null,
      estado: String(f.estado),
      correos: correosPorProspecto.get(String(f.id)) ?? 0,
      similitudPct: f.similitud_icp_pct === null || f.similitud_icp_pct === undefined ? null : Number(f.similitud_icp_pct),
      necesidadPct: f.necesidad_pct === null || f.necesidad_pct === undefined ? null : Number(f.necesidad_pct),
    })),
    truncado,
  };
}

/** Correos hallados por prospecto. LANZA ante error: un mapa vacío por fallo
 *  se leería como «ningún prospecto tiene correo», que es una afirmación. */
async function contarCorreos(ids: string[]): Promise<Map<string, number>> {
  const mapa = new Map<string, number>();
  const filas = await porLotes(ids, async (lote) => {
    const { data, error } = await acotada(supabaseAdmin()
      .from('prospecto_correo')
      .select('prospecto_id')
      .in('prospecto_id', lote)
      .limit(IDS_POR_LOTE * 20), 'leads.scorer.correos');
    if (error) throw new Error(`contarCorreos: ${error.message}`);
    return (data ?? []) as Array<{ prospecto_id: string }>;
  });
  for (const f of filas) mapa.set(f.prospecto_id, (mapa.get(f.prospecto_id) ?? 0) + 1);
  return mapa;
}

async function correrScorer(disparo: DisparoCorrida, hoy: string): Promise<ResultadoLeads> {
  const inicio = new Date();
  const agente = 'scorer';
  const lunes = lunesDe(hoy);
  const titulo = `Scorer — semana del ${lunes}`;
  try {
    if (await piezaExistente(agente, titulo)) {
      await anotarCorrida(agente, inicio, 'ok', disparo, { pieza: 'ya_existia', titulo });
      return yaEstaba(agente, 'el parte de señal de esta semana');
    }
    const { filas, truncado } = await leerSenales();
    const puntajes = filas.map(puntuar);
    const cuerpo = armarParteScorer(puntajes, hoy, truncado);
    const res = await encolarPiezaLeads(agente, 'score_prospectos', titulo, cuerpo, {
      semana: lunes,
      leidos: filas.length,
      con_senal: puntajes.filter((p) => p.puntoPct !== null).length,
      insuficientes: puntajes.filter((p) => p.puntoPct === null).length,
      truncado,
      consultas: ['prospecto (vivos, con derivados 0140/0143)', 'prospecto_correo (conteo por prospecto)'],
    });
    await anotarCorrida(agente, inicio, 'ok', disparo, { pieza: res, leidos: filas.length, truncado });
    return { resultado: 'corrio', piezas: res === 'encolada' ? 1 : 0, motivo: res === 'ya_existia' ? 'otra corrida ganó la semana' : undefined, costoUsd: 0 };
  } catch (e) {
    await anotarCorrida(agente, inicio, 'fallo', disparo, { titulo }, {
      error: `No se pudo armar el parte de señal: ${e instanceof Error ? e.message : String(e)}`.slice(0, 500),
    });
    throw e;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 2 · DOSSIER — la ficha de una página, con la raya entre lo verificado y lo
// que solo se supone.
//
// El catálogo (0125) lo define así: «la ficha de una página para el vendedor».
// Lo que este motor agrega al blueprint es la raya: cada línea de la ficha
// dice de dónde salió y si alguien la comprobó. `prospecto_persona` (0138) ya
// guarda `origen` y `confianza`, y tiene un CHECK que impide que un dato
// `inferido` se declare de confianza `alta` — este agente respeta esa
// distinción en el texto en vez de aplanarla.
//
// NO ESCRIBE `prospecto_dossier`: ver la regla 2 de la cabecera. Lo LEE.
// ═══════════════════════════════════════════════════════════════════════════

export interface PersonaFicha {
  nombre: string;
  puesto: string | null;
  correo: string | null;
  telefono: string | null;
  origen: string;
  confianza: string;
  evidencia: string | null;
}

export interface DatosFicha {
  id: string;
  empresa: string;
  ciudad: string | null;
  estado: string;
  vacante: string | null;
  numUnidades: number | null;
  unidades: string | null;
  sitio: string | null;
  sitioVerificado: boolean;
  historiaProspecto: string | null;
  /** Del dossier del investigador (0217). Todo `null` = nunca se investigó. */
  dossier: {
    historia: string | null;
    empleados: string | null;
    flotilla: string | null;
    telefonos: unknown;
    fuentes: string[];
    investigadoEn: string | null;
  } | null;
  personas: PersonaFicha[];
  correos: string[];
}

/** Un dato de la ficha, con su procedencia. `null` en `valor` es «no consta» y
 *  se imprime así — jamás se rellena con un guion que parezca un dato. */
function linea(etiqueta: string, valor: string | null, fuente: string): string {
  if (valor === null || valor.trim() === '') {
    return `  · ${etiqueta}: NO CONSTA (${fuente})`;
  }
  return `  · ${etiqueta}: ${valor.trim()}  [${fuente}]`;
}

/** El cuerpo de la ficha. PURO. */
export function armarFicha(d: DatosFicha, dia: string): string {
  const l: string[] = [
    `DOSSIER — ${d.empresa} (ficha al ${dia})`,
    '',
    'LO QUE CONSTA EN LA BASE, con su procedencia entre corchetes:',
    linea('Ciudad', d.ciudad, 'prospecto.ciudad'),
    linea('Etapa del embudo', d.estado, 'prospecto.estado'),
    linea('Vacante publicada (la señal del censo)', d.vacante, 'prospecto.vacante'),
    linea('Tamaño de flota (unidades)', d.numUnidades === null ? null : numero(d.numUnidades), 'prospecto.num_unidades — del sitio o de prensa; NULL = no se encontró, jamás cero'),
    linea('Rango de flota declarado por la empresa', d.unidades, 'prospecto.unidades — del select de /getdemo'),
    linea('Sitio', d.sitio, d.sitioVerificado ? 'prospecto.sitio — VERIFICADO' : 'prospecto.sitio — NO VERIFICADO: nadie ha comprobado que sea de esta empresa'),
    linea('Historia (captura manual)', d.historiaProspecto, 'prospecto.historia'),
    '',
  ];

  if (d.dossier === null) {
    l.push('INVESTIGACIÓN: ESTA EMPRESA NUNCA SE INVESTIGÓ.');
    l.push('No hay fila en `prospecto_dossier`. Eso no significa «no se encontró nada»: significa que el investigador (`enriquecedor`, 0217) todavía no le tocó turno, o que no pudo entrar porque el prospecto no tiene sitio web capturado. La ficha se queda con lo de arriba y ni una línea más — inventar una historia de empresa es exactamente lo que este producto no hace.');
  } else {
    const inv = d.dossier.investigadoEn ? fechaMx(d.dossier.investigadoEn) : 'sin fecha';
    l.push(`INVESTIGACIÓN (prospecto_dossier, investigado el ${inv}):`);
    l.push(linea('Historia', d.dossier.historia, 'dossier.historia'));
    l.push(linea('Empleados', d.dossier.empleados, 'dossier.empleados'));
    l.push(linea('Flotilla', d.dossier.flotilla, 'dossier.flotilla'));
    if (d.dossier.fuentes.length === 0) {
      l.push('  · Fuentes leídas: NINGUNA REGISTRADA. Un dossier sin lista de fuentes no dice de dónde salió nada: lo de arriba se lee como no verificado.');
    } else {
      l.push(`  · Fuentes leídas (${numero(d.dossier.fuentes.length)}): ${d.dossier.fuentes.slice(0, 8).join(' · ')}${d.dossier.fuentes.length > 8 ? ' …' : ''}`);
    }
  }

  l.push('');
  if (d.personas.length === 0) {
    l.push('CONTACTOS: NINGUNA PERSONA CAPTURADA en `prospecto_persona`. No se propone a quién escribirle porque no hay a quién: conseguir el nombre es el siguiente paso, y lo hace una persona o el investigador.');
  } else {
    l.push('CONTACTOS CAPTURADOS (origen y confianza son columnas de la base, no una opinión de este agente):');
    for (const p of d.personas) {
      const verificado = p.origen === 'inferido'
        ? 'INFERIDO — NO VERIFICADO: el correo se dedujo de un patrón, nadie lo comprobó'
        : `origen ${p.origen}`;
      l.push(`  · ${p.nombre}${p.puesto ? ` — ${p.puesto}` : ''} · confianza ${p.confianza} · ${verificado}`);
      l.push(`     correo: ${p.correo ?? 'NO CONSTA'} · teléfono: ${p.telefono ?? 'NO CONSTA'}`);
      if (p.evidencia) l.push(`     evidencia: ${p.evidencia}`);
    }
  }

  l.push('');
  if (d.correos.length === 0) {
    l.push('CORREOS HALLADOS POR EL INVESTIGADOR: ninguno en `prospecto_correo`.');
  } else {
    l.push(`CORREOS HALLADOS POR EL INVESTIGADOR (prospecto_correo, ${numero(d.correos.length)}): ${d.correos.join(' · ')}`);
  }

  l.push('');
  l.push('LO QUE ESTA FICHA NO DICE Y NO VA A DECIR: facturación, utilidad, quién es su competencia o cuánto gastan en diésel. Nada de eso está en la base y estimarlo sería inventarlo. Si el vendedor lo necesita, lo pregunta en la llamada — y entonces sí se captura.');
  l.push(PIE_TAP_DE_JAVIER);
  return l.join('\n');
}

/** El prospecto al que le toca ficha: el vivo más avanzado del embudo que
 *  todavía no la tiene. LANZA ante error. `null` = no hay candidato. */
async function candidatoFicha(venceEn?: number): Promise<{ datos: DatosFicha | null; sinTurno: boolean }> {
  const { data, error } = await acotada(supabaseAdmin()
    .from('prospecto')
    .select('id, empresa, ciudad, estado, vacante, num_unidades, unidades, sitio, sitio_verificado, historia')
    .is('duplicado_de', null)
    .in('estado', ['demo', 'appointment', 'negociacion', 'proposal', 'pilot'])
    .order('created_at', { ascending: true })
    .limit(50), 'leads.dossier.candidatos');
  if (error) throw new Error(`candidatoFicha: ${error.message}`);
  const filas = (data ?? []) as Array<Record<string, unknown>>;
  if (filas.length === 0) return { datos: null, sinTurno: false };

  // El primero SIN ficha en la bandeja. Se pregunta por título determinista,
  // que es la misma clave que arbitra el índice único de la 0235 — UNA ida a
  // la base POR EMPRESA, y por eso el reloj se consulta en cada vuelta: con 50
  // candidatos ya fichados, BUSCAR cuesta más que fabricar, y ese costo se lo
  // estaría comiendo al agente que viene detrás en la pasada.
  for (const f of filas) {
    if (relojAgotado(venceEn)) return { datos: null, sinTurno: true };
    const id = String(f.id);
    const empresa = String(f.empresa);
    if (await piezaExistente('dossier', tituloFicha(empresa))) continue;
    const [dossier, personas, correos] = await Promise.all([
      leerDossier(id), leerPersonas(id), leerCorreos(id),
    ]);
    return { sinTurno: false, datos: {
      id, empresa,
      ciudad: (f.ciudad as string | null) ?? null,
      estado: String(f.estado),
      vacante: (f.vacante as string | null) ?? null,
      numUnidades: f.num_unidades === null || f.num_unidades === undefined ? null : Number(f.num_unidades),
      unidades: (f.unidades as string | null) ?? null,
      sitio: (f.sitio as string | null) ?? null,
      sitioVerificado: f.sitio_verificado === true,
      historiaProspecto: (f.historia as string | null) ?? null,
      dossier, personas, correos,
    } };
  }
  return { datos: null, sinTurno: false };
}

/** El título es determinista POR EMPRESA y no por periodo: una ficha se
 *  rehace cuando alguien la pide, no cada semana — y el índice único impide
 *  que dos corridas fabriquen la misma dos veces. */
export function tituloFicha(empresa: string): string {
  return `Dossier — ${empresa.trim().slice(0, 150)}`;
}

async function leerDossier(prospectoId: string): Promise<DatosFicha['dossier']> {
  const { data, error } = await acotada(supabaseAdmin()
    .from('prospecto_dossier')
    .select('historia, empleados, flotilla, telefonos, fuentes, investigado_en')
    .eq('prospecto_id', prospectoId)
    .maybeSingle(), 'leads.dossier.investigacion');
  if (error) throw new Error(`leerDossier: ${error.message}`);
  if (!data) return null;
  const f = data as Record<string, unknown>;
  return {
    historia: (f.historia as string | null) ?? null,
    empleados: (f.empleados as string | null) ?? null,
    flotilla: (f.flotilla as string | null) ?? null,
    telefonos: f.telefonos ?? null,
    fuentes: Array.isArray(f.fuentes) ? (f.fuentes as unknown[]).map(String) : [],
    investigadoEn: (f.investigado_en as string | null) ?? null,
  };
}

/** El orden de la confianza declarada. NO se ordena en SQL: `confianza` es
 *  texto y `order by` lo pondría alfabético — alta, BAJA, media—, que es
 *  justo al revés en el medio. Se ordena aquí, por el peso que la palabra
 *  significa. */
const PESO_CONFIANZA: Record<string, number> = { alta: 0, media: 1, baja: 2 };

async function leerPersonas(prospectoId: string): Promise<PersonaFicha[]> {
  const { data, error } = await acotada(supabaseAdmin()
    .from('prospecto_persona')
    .select('nombre, puesto, correo, telefono, origen, confianza, evidencia')
    .eq('prospecto_id', prospectoId)
    .limit(50), 'leads.dossier.personas');
  if (error) throw new Error(`leerPersonas: ${error.message}`);
  return ((data ?? []) as Array<Record<string, unknown>>).map((f) => ({
    nombre: String(f.nombre),
    puesto: (f.puesto as string | null) ?? null,
    correo: (f.correo as string | null) ?? null,
    telefono: (f.telefono as string | null) ?? null,
    origen: String(f.origen),
    confianza: String(f.confianza),
    evidencia: (f.evidencia as string | null) ?? null,
  })).sort((a, b) =>
    (PESO_CONFIANZA[a.confianza] ?? 9) - (PESO_CONFIANZA[b.confianza] ?? 9)
    || a.nombre.localeCompare(b.nombre));
}

async function leerCorreos(prospectoId: string): Promise<string[]> {
  const { data, error } = await acotada(supabaseAdmin()
    .from('prospecto_correo')
    .select('correo')
    .eq('prospecto_id', prospectoId)
    .limit(50), 'leads.dossier.correos');
  if (error) throw new Error(`leerCorreos: ${error.message}`);
  return ((data ?? []) as Array<{ correo: string }>).map((f) => f.correo);
}

async function correrDossier(disparo: DisparoCorrida, hoy: string, venceEn?: number): Promise<ResultadoLeads> {
  const inicio = new Date();
  const agente = 'dossier';
  try {
    const { datos: d, sinTurno } = await candidatoFicha(venceEn);
    if (d === null) {
      await anotarCorrida(agente, inicio, 'ok', disparo, { pieza: sinTurno ? 'sin_turno' : 'sin_candidato' });
      // «No alcancé a mirar» y «no había a quién» son dos resultados distintos
      // y se dicen distinto: el primero vuelve en la próxima pasada, el segundo
      // es el estado normal. Colapsarlos haría que una vuelta cortada por reloj
      // se leyera como una semana sin trabajo.
      return sinTurno
        ? {
            resultado: 'corrio', piezas: 0, costoUsd: 0, sinTurno: true,
            motivo: 'el reloj de la vuelta se agotó buscando candidato — quedaron empresas sin mirar; le toca en la próxima pasada',
          }
        : {
            resultado: 'corrio', piezas: 0, costoUsd: 0,
            motivo: 'ningún prospecto en demo/propuesta/piloto sin ficha en la bandeja — no es un fallo, es que no hay a quién fichar',
          };
    }
    const res = await encolarPiezaLeads(agente, 'ficha_prospecto', tituloFicha(d.empresa), armarFicha(d, hoy), {
      prospecto: d.id,
      con_investigacion: d.dossier !== null,
      personas: d.personas.length,
      correos: d.correos.length,
      consultas: ['prospecto', 'prospecto_dossier', 'prospecto_persona', 'prospecto_correo'],
    }, d.id);
    await anotarCorrida(agente, inicio, 'ok', disparo, { pieza: res, prospecto: d.id });
    return { resultado: 'corrio', piezas: res === 'encolada' ? 1 : 0, motivo: res === 'ya_existia' ? 'otra corrida ganó la ficha' : undefined, costoUsd: 0 };
  } catch (e) {
    await anotarCorrida(agente, inicio, 'fallo', disparo, {}, {
      error: `No se pudo armar la ficha: ${e instanceof Error ? e.message : String(e)}`.slice(0, 500),
    });
    throw e;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 3 · VIGÍA — los que ya se tocaron y piden volver.
//
// Tres señales, y las tres salen de `prospecto_contacto` (0118), que guarda
// cada salida y cada respuesta con su fecha:
//
//   · CONTESTÓ — hay una fila `direccion='respuesta'` posterior a la última
//     `salida`. Es la señal más fuerte que existe y la que más se enfría: un
//     prospecto que contestó y al que nadie le volvió en tres días es un lead
//     quemado por dentro de la casa.
//   · SE VENCIÓ EL PLAZO — pasaron más de `DIAS_PLAZO` desde la última salida
//     sin una sola respuesta.
//   · NUNCA SE LE TOCÓ — está en una etapa que implica contacto (contactado,
//     demo, negociación) y NO tiene una sola fila de contacto. Eso no es «hace
//     mucho»: es una contradicción entre la etapa y el historial, y se dice
//     como tal.
//
// LO QUE ESTE AGENTE NO HACE: no devuelve el lead al pool, no cambia la etapa
// y no manda el seguimiento. El SDR (0217) es quien redacta el seguimiento y
// el enviador quien lo manda, los dos por la cola. Este solo levanta la mano.
// ═══════════════════════════════════════════════════════════════════════════

/** Días desde la última salida sin respuesta a partir de los cuales el vigía
 *  levanta la mano. Diez días: la cadencia declarada de la campaña es 0/2/5/10
 *  (0118), así que a los diez el ciclo ya se agotó entero. */
export const DIAS_PLAZO = 10;

/** Días desde una respuesta SIN contestarle a partir de los cuales el aviso
 *  pasa de recordatorio a urgencia. Dos: el prospecto contestó, la ventana de
 *  atención es corta. */
export const DIAS_RESPUESTA_FRIA = 2;

export type SenalVigia = 'contesto' | 'plazo_vencido' | 'etapa_sin_historial';

export interface FilaVigia {
  id: string;
  empresa: string;
  estado: string;
  /** Última salida (Likida escribió). `null` = nunca se le escribió. */
  ultimaSalida: string | null;
  /** Última respuesta del prospecto. `null` = nunca contestó. */
  ultimaRespuesta: string | null;
}

export interface AvisoVigia {
  id: string;
  empresa: string;
  estado: string;
  senal: SenalVigia;
  /** Días de la señal. `null` cuando la señal es «nunca se le tocó» — ahí no
   *  hay días que contar, y un 0 diría «hoy», que es falso. */
  dias: number | null;
  /** La frase que el vendedor lee. */
  que: string;
}

/** Los avisos, PUROS sobre las filas ya leídas. Orden determinista: primero
 *  los que contestaron (por más frío), luego los del plazo, luego las
 *  contradicciones — y dentro de cada grupo por empresa. */
export function avisosDelVigia(filas: FilaVigia[], dia: string): AvisoVigia[] {
  const avisos: AvisoVigia[] = [];
  for (const f of filas) {
    const dSalida = diasDesde(f.ultimaSalida, dia);
    const dRespuesta = diasDesde(f.ultimaRespuesta, dia);

    // CONTESTÓ: hay respuesta y es POSTERIOR a la última salida (o no hubo
    // salida posterior). Comparar instantes y no solo «existe respuesta»: si
    // ya se le volvió a escribir después de contestar, la pelota es de ellos.
    const contestoDespues = f.ultimaRespuesta !== null
      && (f.ultimaSalida === null || Date.parse(f.ultimaRespuesta) > Date.parse(f.ultimaSalida));
    if (contestoDespues) {
      avisos.push({
        id: f.id, empresa: f.empresa, estado: f.estado, senal: 'contesto', dias: dRespuesta,
        que: dRespuesta !== null && dRespuesta >= DIAS_RESPUESTA_FRIA
          ? `CONTESTÓ hace ${numero(dRespuesta)} día(s) y nadie le ha vuelto. Es la señal más fuerte del embudo y la que más rápido se enfría.`
          : 'CONTESTÓ y todavía no se le vuelve. La pelota es nuestra.',
      });
      continue;
    }
    if (f.ultimaSalida === null) {
      // Etapa que implica contacto, historial vacío. NO se lee como «lleva
      // mucho sin toque»: se lee como que la etapa y el historial se
      // contradicen, y eso lo arregla una persona, no una cadencia.
      avisos.push({
        id: f.id, empresa: f.empresa, estado: f.estado, senal: 'etapa_sin_historial', dias: null,
        que: `Está en etapa \`${f.estado}\` y NO tiene una sola fila en \`prospecto_contacto\`. No es «lleva mucho sin toque» —es que la etapa afirma un contacto que el historial no registra—. O alguien lo movió a mano sin anotar, o el toque se hizo por fuera del sistema.`,
      });
      continue;
    }
    if (dSalida !== null && dSalida >= DIAS_PLAZO) {
      avisos.push({
        id: f.id, empresa: f.empresa, estado: f.estado, senal: 'plazo_vencido', dias: dSalida,
        que: `Se le escribió hace ${numero(dSalida)} día(s) y no ha contestado. La cadencia declarada de la campaña es 0/2/5/10 días: a los ${numero(DIAS_PLAZO)} el ciclo ya se agotó entero.`,
      });
    }
  }
  const peso: Record<SenalVigia, number> = { contesto: 0, plazo_vencido: 1, etapa_sin_historial: 2 };
  return avisos.sort((a, b) =>
    peso[a.senal] - peso[b.senal] || (b.dias ?? -1) - (a.dias ?? -1) || a.empresa.localeCompare(b.empresa));
}

/** El cuerpo del parte del vigía. PURO. */
export function armarParteVigia(avisos: AvisoVigia[], vigilados: number, dia: string, truncado: boolean): string {
  const l: string[] = [`VIGÍA — los prospectos tocados que piden volver (al ${dia})`, ''];
  l.push(`Prospectos vigilados (etapa que implica contacto, sin cerrar): ${numero(vigilados)}.`);
  l.push('');
  if (vigilados === 0) {
    l.push('NI UNO SOLO EN VIGILANCIA. La consulta contestó y vino vacía: o no hay prospectos en etapa de contacto, o todos están cerrados. No es un cero medido de actividad, es que no hay a quién vigilar.');
    l.push('');
    l.push(PIE_TAP_DE_JAVIER);
    return l.join('\n');
  }
  if (avisos.length === 0) {
    l.push('NINGUNA SEÑAL HOY: ninguno contestó sin respuesta nuestra, a ninguno se le venció el plazo y ninguno tiene la etapa peleada con su historial. Es un resultado medido, no un hueco.');
  } else {
    const porSenal = (s: SenalVigia) => avisos.filter((a) => a.senal === s);
    const bloque = (s: SenalVigia, titulo: string) => {
      const xs = porSenal(s);
      if (xs.length === 0) return;
      l.push(`${titulo} (${numero(xs.length)}):`);
      for (const a of xs.slice(0, 25)) {
        l.push(`  · ${a.empresa} [etapa: ${a.estado}] — ${a.que}`);
      }
      if (xs.length > 25) l.push(`  … y ${numero(xs.length - 25)} más, no listados aquí.`);
      l.push('');
    };
    bloque('contesto', 'CONTESTARON Y LA PELOTA ES NUESTRA');
    bloque('plazo_vencido', 'PLAZO VENCIDO — se les escribió y no contestaron');
    bloque('etapa_sin_historial', 'LA ETAPA Y EL HISTORIAL NO CUADRAN');
  }
  if (truncado) {
    l.push(`CONSULTA TRUNCADA A ${numero(TOPE_PROSPECTOS)} FILAS: hay más prospectos en vigilancia de los que este parte alcanzó a leer. Los conteos son un PISO.`);
    l.push('');
  }
  l.push('CÓMO SE MIDE: `prospecto_contacto` (0118) guarda cada salida y cada respuesta con su fecha; «nunca» y «hace mucho» se guardan distinto y se leen distinto. Este agente NO devuelve leads al pool, no cambia etapas y no manda seguimientos: el seguimiento lo redacta el SDR (0217) y lo manda el enviador, los dos por esta misma bandeja.');
  l.push(PIE_TAP_DE_JAVIER);
  return l.join('\n');
}

/** Los vigilados con sus dos fechas. LANZA ante error. */
async function leerVigilancia(): Promise<{ filas: FilaVigia[]; truncado: boolean }> {
  const { data, error, count } = await acotada(supabaseAdmin()
    .from('prospecto')
    .select('id, empresa, estado', { count: 'exact' })
    .is('duplicado_de', null)
    .in('estado', ['contactado', 'demo', 'appointment', 'rescheduled', 'negociacion', 'proposal', 'pilot'])
    .order('created_at', { ascending: false })
    .limit(TOPE_PROSPECTOS), 'leads.vigia.prospectos');
  if (error) throw new Error(`leerVigilancia: ${error.message}`);
  const crudas = (data ?? []) as Array<Record<string, unknown>>;
  const truncado = typeof count === 'number' ? count > crudas.length : crudas.length >= TOPE_PROSPECTOS;
  const ids = crudas.map((f) => String(f.id));

  const historial = await leerHistorial(ids);
  return {
    filas: crudas.map((f): FilaVigia => {
      const h = historial.get(String(f.id));
      return {
        id: String(f.id), empresa: String(f.empresa), estado: String(f.estado),
        ultimaSalida: h?.salida ?? null,
        ultimaRespuesta: h?.respuesta ?? null,
      };
    }),
    truncado,
  };
}

/** Última salida y última respuesta por prospecto. LANZA ante error: un mapa
 *  vacío por fallo pondría a TODOS en «nunca se le tocó», que es una
 *  afirmación fuerte y falsa. */
async function leerHistorial(ids: string[]): Promise<Map<string, { salida: string | null; respuesta: string | null }>> {
  const mapa = new Map<string, { salida: string | null; respuesta: string | null }>();
  const filas = await porLotes(ids, async (lote) => {
    const { data, error } = await acotada(supabaseAdmin()
      .from('prospecto_contacto')
      .select('prospecto_id, direccion, ocurrio_en')
      .in('prospecto_id', lote)
      .order('ocurrio_en', { ascending: false })
      .limit(IDS_POR_LOTE * 20), 'leads.vigia.historial');
    if (error) throw new Error(`leerHistorial: ${error.message}`);
    return (data ?? []) as Array<{ prospecto_id: string; direccion: string; ocurrio_en: string }>;
  });
  // Cada lote viene descendente, así que la PRIMERA fila que se ve de cada
  // (prospecto, dirección) es la última que ocurrió. El orden se compara igual
  // por si un lote llegara desordenado: quedarse con la más nueva es la
  // decisión, no confiar en el orden de llegada.
  for (const f of filas) {
    const actual = mapa.get(f.prospecto_id) ?? { salida: null, respuesta: null };
    const campo = f.direccion === 'salida' ? 'salida' : f.direccion === 'respuesta' ? 'respuesta' : null;
    if (campo !== null && (actual[campo] === null || f.ocurrio_en > (actual[campo] as string))) {
      actual[campo] = f.ocurrio_en;
    }
    mapa.set(f.prospecto_id, actual);
  }
  return mapa;
}

async function correrVigia(disparo: DisparoCorrida, hoy: string): Promise<ResultadoLeads> {
  const inicio = new Date();
  const agente = 'vigia';
  const titulo = `Vigía de leads — ${hoy}`;
  try {
    if (await piezaExistente(agente, titulo)) {
      await anotarCorrida(agente, inicio, 'ok', disparo, { pieza: 'ya_existia', titulo });
      return yaEstaba(agente, 'el parte del vigía de hoy');
    }
    const { filas, truncado } = await leerVigilancia();
    const avisos = avisosDelVigia(filas, hoy);
    const res = await encolarPiezaLeads(agente, 'vigilancia_leads', titulo, armarParteVigia(avisos, filas.length, hoy, truncado), {
      dia: hoy,
      vigilados: filas.length,
      avisos: avisos.length,
      contestaron: avisos.filter((a) => a.senal === 'contesto').length,
      plazo_vencido: avisos.filter((a) => a.senal === 'plazo_vencido').length,
      sin_historial: avisos.filter((a) => a.senal === 'etapa_sin_historial').length,
      truncado,
      consultas: ['prospecto (etapas de contacto)', 'prospecto_contacto (última salida y última respuesta)'],
    });
    await anotarCorrida(agente, inicio, 'ok', disparo, { pieza: res, vigilados: filas.length, avisos: avisos.length });
    return { resultado: 'corrio', piezas: res === 'encolada' ? 1 : 0, motivo: res === 'ya_existia' ? 'otra corrida ganó el día' : undefined, costoUsd: 0 };
  } catch (e) {
    await anotarCorrida(agente, inicio, 'fallo', disparo, { titulo }, {
      error: `No se pudo armar el parte del vigía: ${e instanceof Error ? e.message : String(e)}`.slice(0, 500),
    });
    throw e;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 4 · DEMO PREP — el brief de la demo agendada.
//
// «Agendada» aquí es la etapa del embudo (`demo`, `appointment`,
// `rescheduled`), y NO una fecha de calendario: Likida no tiene tabla de
// citas, y afirmar «la demo es el jueves a las 10» leyendo una etapa sería
// inventar la hora. El brief lo dice en su propio cuerpo.
//
// LOS NÚMEROS DEL PROSPECTO QUE SÍ EXISTEN son dos, y los dos vienen con su
// letra chica: `num_unidades` (medido si alguien lo capturó) y
// `viajes_mes_estimado` (columna GENERADA de la 0140: unidades × 18, un
// supuesto de sector, no una medición). El brief los separa; mezclarlos sería
// enseñarle al vendedor un dato inventado con cara de dato.
// ═══════════════════════════════════════════════════════════════════════════

export interface DatosDemo {
  id: string;
  empresa: string;
  ciudad: string | null;
  estado: string;
  vacante: string | null;
  urgencia: string | null;
  numUnidades: number | null;
  unidades: string | null;
  viajesMesEstimado: number | null;
  necesidadPct: number | null;
  historia: string | null;
  vendedor: string | null;
  personas: PersonaFicha[];
  /** Los toques ya registrados, del más nuevo al más viejo. */
  toques: Array<{ canal: string; resumen: string | null; ocurrioEn: string }>;
}

/** El cuerpo del brief. PURO. */
export function armarBriefDemo(d: DatosDemo, dia: string): string {
  const l: string[] = [
    `DEMO PREP — ${d.empresa} (brief al ${dia})`,
    '',
    `ETAPA: \`${d.estado}\`. OJO: eso es la etapa del embudo, NO una cita. Likida no tiene tabla de calendario, así que este brief NO sabe el día ni la hora de la demo y no los va a suponer. Quien la agendó tiene la fecha.`,
    '',
    'QUIÉN ES:',
    linea('Ciudad', d.ciudad, 'prospecto.ciudad'),
    linea('Vendedor asignado', d.vendedor, 'prospecto.vendedor_id → app_user'),
    linea('Historia', d.historia, 'prospecto.historia'),
    '',
    'QUÉ LE DUELE (según lo que la propia empresa declaró):',
    linea('Vacante publicada', d.vacante, 'prospecto.vacante — es el dolor nombrado por ellos, no una hipótesis nuestra'),
    linea('Urgencia declarada', d.urgencia, 'prospecto.urgencia — del select de /getdemo'),
    linea('Índice de necesidad', d.necesidadPct === null ? null : `${numero(d.necesidadPct)}%`, 'prospecto.necesidad_pct — columna DERIVADA (0143): vacante de liquidación/cuadre +50, flota ≥ 20 +25'),
    '',
    'SUS NÚMEROS — LOS MEDIDOS Y LOS SUPUESTOS, SEPARADOS:',
  ];
  if (d.numUnidades === null && d.unidades === null) {
    l.push('  · Tamaño de flota: NO CONSTA. Ni `num_unidades` (investigación) ni `unidades` (lo que ellos declararon en /getdemo). En la llamada es la PRIMERA pregunta: sin flota no hay cómo dimensionar nada, y este brief no la va a estimar.');
  } else {
    if (d.numUnidades !== null) l.push(`  · Unidades (medido): ${numero(d.numUnidades)}  [prospecto.num_unidades, del sitio o de prensa]`);
    if (d.unidades !== null) l.push(`  · Rango que ELLOS declararon: ${d.unidades}  [prospecto.unidades, del select de /getdemo]`);
  }
  if (d.viajesMesEstimado === null) {
    l.push('  · Viajes al mes: NO SE PUEDE ESTIMAR — la estimación de la base encadena sobre el tamaño de flota, y sin flota no se encadena sobre un supuesto (0140).');
  } else {
    l.push(`  · Viajes al mes: ${numero(d.viajesMesEstimado)} — ESTIMADO, NO MEDIDO. Es \`viajes_mes_estimado\` (0140) = unidades × 18 viajes/unidad/mes, un supuesto de sector. Si se dice en la llamada, se dice como supuesto y se pregunta el real.`);
  }

  l.push('');
  if (d.personas.length === 0) {
    l.push('CON QUIÉN SE HABLA: NINGUNA PERSONA CAPTURADA en `prospecto_persona`. Antes de la demo hay que saber quién entra a la llamada y qué puesto tiene: no es lo mismo el que firma el cheque que el que sufre el cuadre.');
  } else {
    l.push('CON QUIÉN SE HABLA (de `prospecto_persona`, con la confianza que la base declara):');
    for (const p of d.personas.slice(0, 8)) {
      l.push(`  · ${p.nombre}${p.puesto ? ` — ${p.puesto}` : ' — SIN PUESTO CAPTURADO'} · confianza ${p.confianza} · origen ${p.origen}${p.origen === 'inferido' ? ' (INFERIDO, no verificado)' : ''}`);
    }
  }

  l.push('');
  if (d.toques.length === 0) {
    l.push('QUÉ SE LE HA DICHO: NADA REGISTRADO en `prospecto_toque`. Si alguien ya habló con ellos, el resumen no está en el sistema — entrar a la demo sin saber qué se prometió es la forma más rápida de contradecirse.');
  } else {
    l.push('QUÉ SE LE HA DICHO (últimos toques registrados, del más nuevo al más viejo):');
    for (const t of d.toques.slice(0, 6)) {
      l.push(`  · ${fechaMx(t.ocurrioEn)} · ${t.canal} — ${t.resumen?.trim() || 'SIN RESUMEN CAPTURADO'}`);
    }
  }

  l.push('');
  l.push('LO QUE ESTE BRIEF NO TRAE: su facturación, su margen, cuánto pagan hoy por administrar liquidaciones y qué herramienta usan. Nada de eso está en la base. Son las preguntas de la llamada, no huecos que este agente vaya a rellenar.');
  l.push(PIE_TAP_DE_JAVIER);
  return l.join('\n');
}

/** El título es determinista por empresa: un brief por demo, y el índice
 *  único de la 0235 impide el duplicado entre dos pasadas. */
export function tituloBrief(empresa: string): string {
  return `Demo prep — ${empresa.trim().slice(0, 150)}`;
}

async function candidatoDemo(venceEn?: number): Promise<{ datos: DatosDemo | null; sinTurno: boolean }> {
  const { data, error } = await acotada(supabaseAdmin()
    .from('prospecto')
    .select('id, empresa, ciudad, estado, vacante, urgencia, num_unidades, unidades, viajes_mes_estimado, necesidad_pct, historia, vendedor:vendedor_id(nombre)')
    .is('duplicado_de', null)
    .in('estado', ['demo', 'appointment', 'rescheduled'])
    .order('updated_at', { ascending: false })
    .limit(50), 'leads.demo_prep.candidatos');
  if (error) throw new Error(`candidatoDemo: ${error.message}`);
  const filas = (data ?? []) as Array<Record<string, unknown>>;
  for (const f of filas) {
    // Mismo motivo que en `candidatoFicha`: buscar cuesta una consulta por
    // empresa, y el reloj de la vuelta manda sobre la búsqueda igual que sobre
    // el despacho.
    if (relojAgotado(venceEn)) return { datos: null, sinTurno: true };
    const empresa = String(f.empresa);
    if (await piezaExistente('demo_prep', tituloBrief(empresa))) continue;
    const id = String(f.id);
    const [personas, toques] = await Promise.all([leerPersonas(id), leerToques(id)]);
    const vend = f.vendedor as { nombre?: string } | null;
    return { sinTurno: false, datos: {
      id, empresa,
      ciudad: (f.ciudad as string | null) ?? null,
      estado: String(f.estado),
      vacante: (f.vacante as string | null) ?? null,
      urgencia: (f.urgencia as string | null) ?? null,
      numUnidades: f.num_unidades === null || f.num_unidades === undefined ? null : Number(f.num_unidades),
      unidades: (f.unidades as string | null) ?? null,
      viajesMesEstimado: f.viajes_mes_estimado === null || f.viajes_mes_estimado === undefined ? null : Number(f.viajes_mes_estimado),
      necesidadPct: f.necesidad_pct === null || f.necesidad_pct === undefined ? null : Number(f.necesidad_pct),
      historia: (f.historia as string | null) ?? null,
      vendedor: vend?.nombre?.trim() || null,
      personas, toques,
    } };
  }
  return { datos: null, sinTurno: false };
}

async function leerToques(prospectoId: string): Promise<DatosDemo['toques']> {
  const { data, error } = await acotada(supabaseAdmin()
    .from('prospecto_toque')
    .select('canal, resumen, creado_en')
    .eq('prospecto_id', prospectoId)
    .order('creado_en', { ascending: false })
    .limit(20), 'leads.demo_prep.toques');
  if (error) throw new Error(`leerToques: ${error.message}`);
  return ((data ?? []) as Array<Record<string, unknown>>).map((f) => ({
    canal: String(f.canal),
    resumen: (f.resumen as string | null) ?? null,
    ocurrioEn: String(f.creado_en),
  }));
}

async function correrDemoPrep(disparo: DisparoCorrida, hoy: string, venceEn?: number): Promise<ResultadoLeads> {
  const inicio = new Date();
  const agente = 'demo_prep';
  try {
    const { datos: d, sinTurno } = await candidatoDemo(venceEn);
    if (d === null) {
      await anotarCorrida(agente, inicio, 'ok', disparo, { pieza: sinTurno ? 'sin_turno' : 'sin_candidato' });
      // «No alcancé a mirar» y «no había a quién» son dos resultados distintos
      // y se dicen distinto: el primero vuelve en la próxima pasada, el segundo
      // es el estado normal. Colapsarlos haría que una vuelta cortada por reloj
      // se leyera como una semana sin trabajo.
      return sinTurno
        ? {
            resultado: 'corrio', piezas: 0, costoUsd: 0, sinTurno: true,
            motivo: 'el reloj de la vuelta se agotó buscando candidato — quedaron empresas sin mirar; le toca en la próxima pasada',
          }
        : {
            resultado: 'corrio', piezas: 0, costoUsd: 0,
            motivo: 'ninguna demo en etapa agendada sin brief en la bandeja — no es un fallo, es que no hay demo que preparar',
          };
    }
    const res = await encolarPiezaLeads(agente, 'brief_demo', tituloBrief(d.empresa), armarBriefDemo(d, hoy), {
      prospecto: d.id,
      etapa: d.estado,
      con_flota: d.numUnidades !== null || d.unidades !== null,
      personas: d.personas.length,
      toques: d.toques.length,
      consultas: ['prospecto (con derivados 0140/0143)', 'prospecto_persona', 'prospecto_toque'],
    }, d.id);
    await anotarCorrida(agente, inicio, 'ok', disparo, { pieza: res, prospecto: d.id });
    return { resultado: 'corrio', piezas: res === 'encolada' ? 1 : 0, motivo: res === 'ya_existia' ? 'otra corrida ganó el brief' : undefined, costoUsd: 0 };
  } catch (e) {
    await anotarCorrida(agente, inicio, 'fallo', disparo, {}, {
      error: `No se pudo armar el brief de demo: ${e instanceof Error ? e.message : String(e)}`.slice(0, 500),
    });
    throw e;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 5 · PROPUESTAS — el borrador con el precio que EXISTE, o sin precio.
//
// LA REGLA DE ESTE AGENTE ES UNA SOLA, Y ES LA DE LA 0052: `plan.precio_mensual`
// puede ser NULL, y hoy los tres planes sembrados (demo, flota, empresa)
// llegaron a la base SIN precio a propósito — el comentario de esa migración lo
// dice con todas sus letras: «un precio de ejemplo termina en una propuesta».
//
// Pues esta ES la propuesta. Si el precio no está declarado, el borrador sale
// SIN CIFRA, con el hueco marcado y con la instrucción de quién lo llena. No
// se toma el precio de un plan parecido, no se promedia, no se pone «desde
// $X». Un número inventado en un documento comercial es la clase de dato que
// después alguien cita en una llamada.
// ═══════════════════════════════════════════════════════════════════════════

export interface PlanPropuesta {
  clave: string;
  nombre: string;
  /** `null` = SIN PRECIO DECLARADO. No es gratis y no es cero. */
  precioMensual: number | null;
  moneda: string;
  limiteViajesMes: number | null;
  limiteOperadores: number | null;
}

export interface DatosPropuesta {
  id: string;
  empresa: string;
  estado: string;
  numUnidades: number | null;
  unidades: string | null;
  viajesMesEstimado: number | null;
  vendedor: string | null;
  planes: PlanPropuesta[];
}

/** El cuerpo del borrador. PURO. */
export function armarPropuesta(d: DatosPropuesta, dia: string): string {
  const conPrecio = d.planes.filter((p) => p.precioMensual !== null);
  const sinPrecio = d.planes.filter((p) => p.precioMensual === null);

  const l: string[] = [
    `PROPUESTA (BORRADOR) — ${d.empresa}, al ${dia}`,
    '',
    `Etapa del prospecto: \`${d.estado}\`. Vendedor: ${d.vendedor ?? 'SIN ASIGNAR'}.`,
    '',
    'EL PRICING, TAL COMO ESTÁ DECLARADO EN LA BASE:',
  ];

  if (d.planes.length === 0) {
    l.push('  NO HAY UN SOLO PLAN ACTIVO en la tabla `plan`. Este borrador no puede proponer nada que cobrar, y no va a inventar un esquema: el catálogo comercial lo declara una persona.');
  } else {
    for (const p of d.planes) {
      const limites = [
        p.limiteViajesMes === null ? 'viajes/mes: SIN LÍMITE' : `viajes/mes: hasta ${numero(p.limiteViajesMes)}`,
        p.limiteOperadores === null ? 'operadores: SIN LÍMITE' : `operadores: hasta ${numero(p.limiteOperadores)}`,
      ].join(' · ');
      if (p.precioMensual === null) {
        l.push(`  · ${p.nombre} (${p.clave}) — PRECIO NO DECLARADO EN LA BASE (plan.precio_mensual es NULL). ${limites}`);
      } else {
        l.push(`  · ${p.nombre} (${p.clave}) — ${mxn(p.precioMensual)} ${p.moneda}/mes. ${limites}`);
      }
    }
  }

  l.push('');
  if (conPrecio.length === 0) {
    l.push('⚠️ ESTE BORRADOR VA SIN PRECIO, Y ES A PROPÓSITO.');
    l.push(`Los ${numero(d.planes.length)} plan(es) activos tienen \`precio_mensual\` en NULL. NULL no es cero y no es «gratis»: es «nadie ha declarado cuánto cuesta». La migración 0052 los sembró así con una razón escrita en su cabecera —«un precio de ejemplo termina en una propuesta»— y ésta es exactamente la propuesta de la que hablaba.`);
    l.push('QUIÉN LO LLENA: una persona captura el precio en `plan.precio_mensual` (o el precio de Stripe queda ligado en `plan_price`) y este agente lo cita solo. Mientras tanto, mandar este documento con una cifra sería mandar una cifra que nadie autorizó.');
  } else {
    l.push(`PLANES CON PRECIO DECLARADO: ${numero(conPrecio.length)} de ${numero(d.planes.length)}.`);
    if (sinPrecio.length > 0) {
      l.push(`Los otros ${numero(sinPrecio.length)} (${sinPrecio.map((p) => p.clave).join(', ')}) van SIN cifra en este documento: su \`precio_mensual\` es NULL y no se rellena con el de otro plan.`);
    }
  }

  l.push('');
  l.push('EL DIMENSIONAMIENTO DE ESTA EMPRESA:');
  if (d.numUnidades === null && d.unidades === null) {
    l.push('  · Tamaño de flota: NO CONSTA. Sin flota no se puede recomendar plan, porque los límites de los planes son por viajes y por operadores. La recomendación queda ABIERTA hasta que alguien pregunte y capture.');
  } else {
    if (d.numUnidades !== null) l.push(`  · Unidades: ${numero(d.numUnidades)} [prospecto.num_unidades]`);
    if (d.unidades !== null) l.push(`  · Rango declarado por la empresa: ${d.unidades} [prospecto.unidades]`);
  }
  if (d.viajesMesEstimado === null) {
    l.push('  · Viajes al mes: NO ESTIMABLE sin el tamaño de flota — y comparar contra el límite de un plan con un número inventado propondría el plan equivocado.');
  } else {
    l.push(`  · Viajes al mes: ${numero(d.viajesMesEstimado)} — ESTIMADO (unidades × 18, supuesto de sector de la 0140), no medido. Contra los límites de plan sirve como orden de magnitud, no como compromiso.`);
    const encajan = d.planes.filter((p) => p.limiteViajesMes === null || p.limiteViajesMes >= (d.viajesMesEstimado as number));
    l.push(encajan.length === 0
      ? '  · NINGÚN PLAN DECLARADO cubre ese volumen estimado: hace falta una conversación de plan a la medida, no un plan de catálogo.'
      : `  · Planes cuyo límite de viajes cubre ese estimado: ${encajan.map((p) => p.clave).join(', ')}.`);
  }

  l.push('');
  l.push('LO QUE ESTE BORRADOR NO AFIRMA: ni descuentos, ni plazos de contrato, ni condiciones de pago, ni ROI. Nada de eso está declarado en la base. Y no dice «clientes reales»: ninguna empresa ha firmado todavía, y la única frase honesta es «en pláticas con transportistas».');
  l.push('Fuentes: `plan` (catálogo comercial vigente, 0052) · `prospecto` con sus derivados (0140/0143).');
  l.push(PIE_TAP_DE_JAVIER);
  return l.join('\n');
}

export function tituloPropuesta(empresa: string): string {
  return `Propuesta — ${empresa.trim().slice(0, 150)}`;
}

/** El catálogo comercial vigente. LANZA ante error: proponer sobre una tabla
 *  ciega afirmaría «no hay planes». */
async function leerPlanes(): Promise<PlanPropuesta[]> {
  const { data, error } = await acotada(supabaseAdmin()
    .from('plan')
    .select('clave, nombre, precio_mensual, moneda, limite_viajes_mes, limite_operadores')
    .eq('activo', true)
    .order('orden', { ascending: true })
    .limit(50), 'leads.propuestas.planes');
  if (error) throw new Error(`leerPlanes: ${error.message}`);
  return ((data ?? []) as Array<Record<string, unknown>>).map((f) => ({
    clave: String(f.clave),
    nombre: String(f.nombre),
    // NULL se preserva como NULL. `Number(null)` es 0 y aquí un 0 sería un
    // precio de cero pesos en un documento comercial.
    precioMensual: f.precio_mensual === null || f.precio_mensual === undefined ? null : Number(f.precio_mensual),
    moneda: String(f.moneda ?? 'MXN'),
    limiteViajesMes: f.limite_viajes_mes === null || f.limite_viajes_mes === undefined ? null : Number(f.limite_viajes_mes),
    limiteOperadores: f.limite_operadores === null || f.limite_operadores === undefined ? null : Number(f.limite_operadores),
  }));
}

async function candidatoPropuesta(venceEn?: number): Promise<{ datos: DatosPropuesta | null; sinTurno: boolean }> {
  const { data, error } = await acotada(supabaseAdmin()
    .from('prospecto')
    .select('id, empresa, estado, num_unidades, unidades, viajes_mes_estimado, vendedor:vendedor_id(nombre)')
    .is('duplicado_de', null)
    .in('estado', ['negociacion', 'proposal'])
    .order('updated_at', { ascending: false })
    .limit(50), 'leads.propuestas.candidatos');
  if (error) throw new Error(`candidatoPropuesta: ${error.message}`);
  const filas = (data ?? []) as Array<Record<string, unknown>>;
  if (filas.length === 0) return { datos: null, sinTurno: false };
  const planes = await leerPlanes();
  for (const f of filas) {
    // Mismo motivo que en los otros dos buscadores: una consulta por empresa.
    if (relojAgotado(venceEn)) return { datos: null, sinTurno: true };
    const empresa = String(f.empresa);
    if (await piezaExistente('propuestas', tituloPropuesta(empresa))) continue;
    const vend = f.vendedor as { nombre?: string } | null;
    return { sinTurno: false, datos: {
      id: String(f.id), empresa, estado: String(f.estado),
      numUnidades: f.num_unidades === null || f.num_unidades === undefined ? null : Number(f.num_unidades),
      unidades: (f.unidades as string | null) ?? null,
      viajesMesEstimado: f.viajes_mes_estimado === null || f.viajes_mes_estimado === undefined ? null : Number(f.viajes_mes_estimado),
      vendedor: vend?.nombre?.trim() || null,
      planes,
    } };
  }
  return { datos: null, sinTurno: false };
}

async function correrPropuestas(disparo: DisparoCorrida, hoy: string, venceEn?: number): Promise<ResultadoLeads> {
  const inicio = new Date();
  const agente = 'propuestas';
  try {
    const { datos: d, sinTurno } = await candidatoPropuesta(venceEn);
    if (d === null) {
      await anotarCorrida(agente, inicio, 'ok', disparo, { pieza: sinTurno ? 'sin_turno' : 'sin_candidato' });
      // «No alcancé a mirar» y «no había a quién» son dos resultados distintos
      // y se dicen distinto: el primero vuelve en la próxima pasada, el segundo
      // es el estado normal. Colapsarlos haría que una vuelta cortada por reloj
      // se leyera como una semana sin trabajo.
      return sinTurno
        ? {
            resultado: 'corrio', piezas: 0, costoUsd: 0, sinTurno: true,
            motivo: 'el reloj de la vuelta se agotó buscando candidato — quedaron empresas sin mirar; le toca en la próxima pasada',
          }
        : {
            resultado: 'corrio', piezas: 0, costoUsd: 0,
            motivo: 'ningún prospecto en negociación sin borrador en la bandeja — no es un fallo, es que no hay trato que documentar',
          };
    }
    const res = await encolarPiezaLeads(agente, 'propuesta_comercial', tituloPropuesta(d.empresa), armarPropuesta(d, hoy), {
      prospecto: d.id,
      planes: d.planes.length,
      planes_con_precio: d.planes.filter((p) => p.precioMensual !== null).length,
      consultas: ['prospecto (negociación)', 'plan (catálogo activo)'],
    }, d.id);
    await anotarCorrida(agente, inicio, 'ok', disparo, { pieza: res, prospecto: d.id, planes_con_precio: d.planes.filter((p) => p.precioMensual !== null).length });
    return { resultado: 'corrio', piezas: res === 'encolada' ? 1 : 0, motivo: res === 'ya_existia' ? 'otra corrida ganó la propuesta' : undefined, costoUsd: 0 };
  } catch (e) {
    await anotarCorrida(agente, inicio, 'fallo', disparo, {}, {
      error: `No se pudo armar la propuesta: ${e instanceof Error ? e.message : String(e)}`.slice(0, 500),
    });
    throw e;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 6 · CAZADOR — el encargo de caza, no la caza.
//
// LO QUE ESTE AGENTE NO PUEDE HACER, Y LO DICE. El blueprint (0125) lo definía
// como «reactiva el scraper del censo»: ese scraper es un repo aparte
// (censo-liquidacion) que corre fuera de este servidor. Aquí, en la función de
// Vercel, no hay web, no hay DENUE y no hay bolsa de trabajo — así que este
// motor NO PUEDE traer empresas nuevas del mundo, y no va a fabricarlas.
// Insertar en `prospecto` una empresa que este servidor se imaginó sería
// exactamente la cifra inventada que la casa prohíbe, con el agravante de que
// después alguien le escribiría.
//
// LO QUE SÍ PUEDE, Y ES ÚTIL: mirar lo que YA está en la base y decir dónde
// cazar. Tres cosas, las tres medidas:
//
//   · EL PERFIL QUE CONVIERTE — el giro (SCIAN), la ciudad y el tamaño de
//     flota de los prospectos que de verdad AVANZARON (demo en adelante),
//     contra el perfil de los que se perdieron. Si no hay suficientes cerrados
//     para que el perfil signifique algo, se dice: un perfil sacado de dos
//     casos es una superstición.
//   · LAS CELDAS SIN TRABAJAR — combinaciones (giro × ciudad) que existen en
//     el censo capturado y donde NADIE ha tocado a nadie.
//   · LOS YA CAPTURADOS QUE NADIE TOCÓ — empresas que llevan meses en la base,
//     en estado `nuevo`, sin una sola fila de contacto. Cazar afuera mientras
//     hay cientos adentro sin tocar es el error caro.
// ═══════════════════════════════════════════════════════════════════════════

/** Prospectos que tienen que haber AVANZADO para que el perfil signifique
 *  algo. Cinco: por debajo, «el perfil que convierte» sería el retrato de dos
 *  anécdotas. */
export const MIN_AVANZADOS_PARA_PERFIL = 5;

export interface FilaCaza {
  id: string;
  empresa: string;
  estado: string;
  scian: string | null;
  ciudad: string | null;
  numUnidades: number | null;
  creadoEn: string;
  /** ¿Tiene al menos una fila en `prospecto_contacto`? MEDIDO. */
  tocado: boolean;
}

export interface Celda { scian: string; ciudad: string; total: number; tocados: number }

export interface Perfil {
  /** `null` cuando no hay suficientes avanzados: el perfil no se afirma. */
  scianes: Array<{ scian: string; n: number }> | null;
  ciudades: Array<{ ciudad: string; n: number }> | null;
  /** Mediana de unidades de los avanzados que SÍ tienen flota capturada.
   *  `null` si ninguno la tiene — no se promedia sobre ausencias. */
  medianaUnidades: number | null;
  /** Cuántos avanzados hay en total, y cuántos con flota capturada. */
  avanzados: number;
  avanzadosConFlota: number;
  motivoSinPerfil: string | null;
}

/** Las etapas que cuentan como AVANZADO para el perfil: de demo en adelante,
 *  en los dos vocabularios que conviven en el dominio de `estado` (0181). */
export const ETAPAS_AVANZADAS: readonly string[] = ['demo', 'appointment', 'pilot', 'proposal', 'negociacion', 'cerrado', 'won'];

/** Lo mínimo que el perfil necesita de una fila. Se declara aparte de
 *  `FilaCaza` a propósito: el perfil se calcula sobre una consulta PROPIA de
 *  los avanzados —no sobre la ventana truncada del censo— y esa consulta no
 *  tiene por qué traer la marca de `tocado`, que solo sirve para las celdas. */
export type FilaPerfil = Pick<FilaCaza, 'estado' | 'scian' | 'ciudad' | 'numUnidades'>;

/** El perfil de lo que convierte. PURO. */
export function perfilQueConvierte(filas: FilaPerfil[]): Perfil {
  const avanzados = filas.filter((f) => ETAPAS_AVANZADAS.includes(f.estado));
  const conFlota = avanzados.filter((f) => f.numUnidades !== null);
  if (avanzados.length < MIN_AVANZADOS_PARA_PERFIL) {
    return {
      scianes: null, ciudades: null, medianaUnidades: null,
      avanzados: avanzados.length, avanzadosConFlota: conFlota.length,
      motivoSinPerfil: `SIN PERFIL: solo ${numero(avanzados.length)} prospecto(s) han pasado de demo, y el piso declarado son ${numero(MIN_AVANZADOS_PARA_PERFIL)}. Un «perfil que convierte» sacado de menos casos no es un patrón, es una anécdota con porcentajes.`,
    };
  }
  const contar = (clave: (f: FilaPerfil) => string | null) => {
    const m = new Map<string, number>();
    for (const f of avanzados) {
      const k = clave(f)?.trim();
      if (!k) continue;
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return [...m.entries()].map(([k, n]) => ({ k, n }))
      .sort((a, b) => b.n - a.n || a.k.localeCompare(b.k));
  };
  const nums = conFlota.map((f) => f.numUnidades as number).sort((a, b) => a - b);
  // Mediana y no promedio: una flota de 800 entre cinco de 20 movería el
  // promedio a un tamaño que ningún prospecto real tiene.
  const mediana = nums.length === 0 ? null
    : nums.length % 2 === 1 ? nums[(nums.length - 1) / 2]
    : Math.round((nums[nums.length / 2 - 1] + nums[nums.length / 2]) / 2);

  return {
    scianes: contar((f) => f.scian).map(({ k, n }) => ({ scian: k, n })),
    ciudades: contar((f) => f.ciudad).map(({ k, n }) => ({ ciudad: k, n })),
    medianaUnidades: mediana,
    avanzados: avanzados.length, avanzadosConFlota: conFlota.length,
    motivoSinPerfil: null,
  };
}

/** Las celdas (giro × ciudad) donde nadie ha tocado a nadie. PURO. Ordenadas
 *  por tamaño descendente: la celda grande sin tocar es la oportunidad. */
export function celdasSinTrabajar(filas: FilaCaza[]): Celda[] {
  const m = new Map<string, Celda>();
  for (const f of filas) {
    const scian = f.scian?.trim();
    const ciudad = f.ciudad?.trim();
    if (!scian || !ciudad) continue;
    const k = `${scian}|${ciudad}`;
    const c = m.get(k) ?? { scian, ciudad, total: 0, tocados: 0 };
    c.total += 1;
    if (f.tocado) c.tocados += 1;
    m.set(k, c);
  }
  return [...m.values()].filter((c) => c.tocados === 0)
    .sort((a, b) => b.total - a.total || a.scian.localeCompare(b.scian) || a.ciudad.localeCompare(b.ciudad));
}

/** Los nuevos que nadie tocó, del más viejo al más nuevo — el que lleva más
 *  esperando primero. PURO. */
export function nuevosSinTocar(filas: FilaCaza[]): FilaCaza[] {
  return filas.filter((f) => f.estado === 'nuevo' && !f.tocado)
    .sort((a, b) => a.creadoEn.localeCompare(b.creadoEn));
}

/** El cuerpo del encargo. PURO. */
export function armarEncargoCaza(
  perfil: Perfil, celdas: Celda[], sinTocar: FilaCaza[], leidos: number, dia: string, truncado: boolean,
): string {
  const l: string[] = [
    `CAZADOR — el encargo de caza de la semana del ${dia}`,
    '',
    'DE ENTRADA, LO QUE ESTE AGENTE NO HIZO: no buscó una sola empresa en internet y no dio de alta ni un prospecto. Este servidor no navega la web y no tiene el censo del DENUE enfrente; el scraper del censo vive en otro repo y corre fuera de aquí. Un agente que inventara empresas para llenar el embudo produciría filas a las que después alguien les escribiría — y ese correo iría a una dirección que nadie verificó.',
    'LO QUE SÍ HIZO: mirar las ' + numero(leidos) + ' fila(s) que YA están en `prospecto` y decir dónde cazar.',
    '',
    '1 · EL PERFIL QUE CONVIERTE',
  ];
  if (perfil.motivoSinPerfil !== null) {
    l.push(`  ${perfil.motivoSinPerfil}`);
    l.push('  Consecuencia práctica: hoy NO hay evidencia para estrechar la caza a un giro o a una ciudad. Cualquiera que diga lo contrario está leyendo ruido.');
  } else {
    l.push(`  Sobre ${numero(perfil.avanzados)} prospecto(s) que pasaron de demo:`);
    l.push(`  · Giros (SCIAN): ${(perfil.scianes ?? []).slice(0, 5).map((s) => `${s.scian} (${numero(s.n)})`).join(' · ') || 'NINGUNO CAPTURADO — los avanzados no traen scian'}`);
    l.push(`  · Ciudades: ${(perfil.ciudades ?? []).slice(0, 5).map((c) => `${c.ciudad} (${numero(c.n)})`).join(' · ') || 'NINGUNA CAPTURADA'}`);
    l.push(perfil.medianaUnidades === null
      ? `  · Tamaño de flota: NO SE PUEDE DECIR. Ninguno de los ${numero(perfil.avanzados)} avanzados tiene \`num_unidades\` capturado, y una mediana sobre cero datos no existe.`
      : `  · Tamaño de flota (MEDIANA, no promedio — una flota enorme no mueve la mediana): ${numero(perfil.medianaUnidades)} unidades, sobre ${numero(perfil.avanzadosConFlota)} de ${numero(perfil.avanzados)} avanzados con flota capturada.`);
  }

  l.push('');
  l.push('2 · CELDAS (GIRO × CIUDAD) DONDE NADIE HA TOCADO A NADIE');
  if (celdas.length === 0) {
    l.push('  NINGUNA. O todas las celdas con giro y ciudad capturados tienen al menos un toque, o no hay filas con las dos columnas llenas. Las dos lecturas son distintas y este parte no puede distinguirlas sin más columnas.');
  } else {
    for (const c of celdas.slice(0, 15)) {
      l.push(`  · SCIAN ${c.scian} × ${c.ciudad} — ${numero(c.total)} empresa(s) capturada(s), CERO tocadas.`);
    }
    if (celdas.length > 15) l.push(`  … y ${numero(celdas.length - 15)} celda(s) más sin trabajar.`);
  }

  l.push('');
  l.push('3 · LOS QUE YA ESTÁN AQUÍ Y NADIE TOCÓ');
  if (sinTocar.length === 0) {
    l.push('  NINGUNO en estado `nuevo` sin un solo contacto registrado. El pool de entrada está trabajado.');
  } else {
    l.push(`  ${numero(sinTocar.length)} empresa(s) en estado \`nuevo\` SIN una sola fila en \`prospecto_contacto\`, del que lleva más esperando al más reciente:`);
    for (const f of sinTocar.slice(0, 15)) {
      l.push(`  · ${f.empresa}${f.ciudad ? ` — ${f.ciudad}` : ''} · capturada el ${fechaMx(f.creadoEn)}`);
    }
    if (sinTocar.length > 15) l.push(`  … y ${numero(sinTocar.length - 15)} más.`);
    l.push('');
    l.push('  LA CONCLUSIÓN QUE ESTE PARTE SÍ AFIRMA: cazar afuera mientras hay este número adentro sin tocar es gastar en la parte cara del embudo teniendo llena la barata. El Redactor (0122) ya fabrica el primer correo de los que están en `nuevo`; si no lo está haciendo, el cuello está en la bandeja o en su interruptor, no en la falta de prospectos.');
  }

  if (truncado) {
    l.push('');
    l.push(`CONSULTA TRUNCADA A ${numero(TOPE_PROSPECTOS)} FILAS: el censo tiene más filas de las que este encargo alcanzó a leer. Los conteos de las secciones 2 y 3 son un PISO, no el total. El PERFIL de la sección 1 NO está afectado: sale de su propia consulta sobre los prospectos avanzados, que son pocos por definición y caben enteros — un perfil armado sobre las filas más viejas del censo retrataría al censo, no a lo que convierte.`);
  }
  l.push('');
  l.push('Fuentes: `prospecto` (censo capturado, sin duplicados) · `prospecto_contacto` (si tiene al menos un toque). Ninguna empresa de este documento salió de fuera de la base.');
  l.push(PIE_TAP_DE_JAVIER);
  return l.join('\n');
}

/** El censo capturado con su marca de tocado. LANZA ante error. */
async function leerCaza(): Promise<{ filas: FilaCaza[]; truncado: boolean }> {
  const { data, error, count } = await acotada(supabaseAdmin()
    .from('prospecto')
    .select('id, empresa, estado, scian, ciudad, num_unidades, created_at', { count: 'exact' })
    .is('duplicado_de', null)
    .order('created_at', { ascending: true })
    .limit(TOPE_PROSPECTOS), 'leads.cazador.censo');
  if (error) throw new Error(`leerCaza: ${error.message}`);
  const crudas = (data ?? []) as Array<Record<string, unknown>>;
  const truncado = typeof count === 'number' ? count > crudas.length : crudas.length >= TOPE_PROSPECTOS;
  const ids = crudas.map((f) => String(f.id));
  const tocados = await idsTocados(ids);
  return {
    filas: crudas.map((f): FilaCaza => ({
      id: String(f.id),
      empresa: String(f.empresa),
      estado: String(f.estado),
      scian: (f.scian as string | null) ?? null,
      ciudad: (f.ciudad as string | null) ?? null,
      numUnidades: f.num_unidades === null || f.num_unidades === undefined ? null : Number(f.num_unidades),
      creadoEn: String(f.created_at),
      tocado: tocados.has(String(f.id)),
    })),
    truncado,
  };
}

/** Los prospectos que YA avanzaron, en su propia consulta y SIN truncar.
 *
 *  POR QUÉ NO SALEN DE LA VENTANA DEL CENSO: el censo son decenas de miles de
 *  filas y la ventana lee las `TOPE_PROSPECTOS` más viejas. Si el perfil se
 *  calculara sobre esa ventana, un prospecto que llegó a demo el mes pasado
 *  quedaría fuera y el «perfil que convierte» retrataría al censo importado, no
 *  a lo que convierte. Los avanzados son pocos por definición —es la parte
 *  angosta del embudo— así que caben enteros en una consulta propia y el perfil
 *  nunca se afirma sobre una muestra sesgada. LANZA ante error. */
async function leerAvanzados(): Promise<FilaPerfil[]> {
  const { data, error } = await acotada(supabaseAdmin()
    .from('prospecto')
    .select('estado, scian, ciudad, num_unidades')
    .is('duplicado_de', null)
    .in('estado', [...ETAPAS_AVANZADAS])
    .limit(TOPE_PROSPECTOS), 'leads.cazador.avanzados');
  if (error) throw new Error(`leerAvanzados: ${error.message}`);
  return ((data ?? []) as Array<Record<string, unknown>>).map((f) => ({
    estado: String(f.estado),
    scian: (f.scian as string | null) ?? null,
    ciudad: (f.ciudad as string | null) ?? null,
    numUnidades: f.num_unidades === null || f.num_unidades === undefined ? null : Number(f.num_unidades),
  }));
}

/** Quiénes tienen al menos un contacto. LANZA ante error: un set vacío por
 *  fallo pintaría el censo entero como «sin tocar» y mandaría a rehacer
 *  trabajo ya hecho. */
async function idsTocados(ids: string[]): Promise<Set<string>> {
  const s = new Set<string>();
  const filas = await porLotes(ids, async (lote) => {
    const { data, error } = await acotada(supabaseAdmin()
      .from('prospecto_contacto')
      .select('prospecto_id')
      .in('prospecto_id', lote)
      .limit(IDS_POR_LOTE * 20), 'leads.cazador.tocados');
    if (error) throw new Error(`idsTocados: ${error.message}`);
    return (data ?? []) as Array<{ prospecto_id: string }>;
  });
  for (const f of filas) s.add(f.prospecto_id);
  return s;
}

async function correrCazador(disparo: DisparoCorrida, hoy: string): Promise<ResultadoLeads> {
  const inicio = new Date();
  const agente = 'cazador';
  const lunes = lunesDe(hoy);
  const titulo = `Cazador — semana del ${lunes}`;
  try {
    if (await piezaExistente(agente, titulo)) {
      await anotarCorrida(agente, inicio, 'ok', disparo, { pieza: 'ya_existia', titulo });
      return yaEstaba(agente, 'el encargo de caza de esta semana');
    }
    const [{ filas, truncado }, avanzados] = await Promise.all([leerCaza(), leerAvanzados()]);
    // El perfil sale de SU consulta, no de la ventana del censo: ver
    // `leerAvanzados`. Las celdas y los nuevos sin tocar sí salen de la
    // ventana, y por eso el cuerpo declara el truncamiento.
    const perfil = perfilQueConvierte(avanzados);
    const celdas = celdasSinTrabajar(filas);
    const sinTocar = nuevosSinTocar(filas);
    const res = await encolarPiezaLeads(agente, 'encargo_caza', titulo, armarEncargoCaza(perfil, celdas, sinTocar, filas.length, lunes, truncado), {
      semana: lunes,
      leidos: filas.length,
      avanzados: perfil.avanzados,
      con_perfil: perfil.motivoSinPerfil === null,
      celdas_sin_trabajar: celdas.length,
      nuevos_sin_tocar: sinTocar.length,
      truncado,
      consultas: ['prospecto (censo sin duplicados)', 'prospecto_contacto (marca de tocado)'],
    });
    await anotarCorrida(agente, inicio, 'ok', disparo, { pieza: res, leidos: filas.length, celdas: celdas.length, sin_tocar: sinTocar.length });
    return { resultado: 'corrio', piezas: res === 'encolada' ? 1 : 0, motivo: res === 'ya_existia' ? 'otra corrida ganó la semana' : undefined, costoUsd: 0 };
  } catch (e) {
    await anotarCorrida(agente, inicio, 'fallo', disparo, { titulo }, {
      error: `No se pudo armar el encargo de caza: ${e instanceof Error ? e.message : String(e)}`.slice(0, 500),
    });
    throw e;
  }
}

// ── El despacho que el runner llama ────────────────────────────────────────

/** UNA corrida de un agente de leads. Los seis son deterministas y ninguno
 *  arrastra un cliente de modelo: no hay import dinámico que hacer aquí. */
export async function correrAgenteLeads(
  id: AgenteLeads,
  disparo: DisparoCorrida = 'cron',
  hoy: string = hoyMx(),
  /** El vencimiento de la vuelta del runner (0123 + #152). Solo lo miran los
   *  tres que BUSCAN candidato una empresa a la vez; los otros tres hacen sus
   *  lecturas de una y no tienen dónde cortar sin dejar el parte a medias —
   *  medio parte de señal es peor que ninguno. */
  venceEn?: number,
): Promise<ResultadoLeads> {
  logger.info('leads.corrida', { agente: id, disparo });
  switch (id) {
    case 'scorer': return correrScorer(disparo, hoy);
    case 'dossier': return correrDossier(disparo, hoy, venceEn);
    case 'vigia': return correrVigia(disparo, hoy);
    case 'demo_prep': return correrDemoPrep(disparo, hoy, venceEn);
    case 'propuestas': return correrPropuestas(disparo, hoy, venceEn);
    case 'cazador': return correrCazador(disparo, hoy);
  }
}
