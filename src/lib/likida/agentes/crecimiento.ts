// ═══════════════════════════════════════════════════════════════════════════
// CRECIMIENTO (0230) — los diez que quedaban en 'disenado' del departamento
// que lleva la marca hacia AFUERA. Nueve viven aquí; el décimo
// (`contenido_fiscal`, el único que gasta modelo) vive en `contenido.ts`, por
// la misma razón por la que `atencion_faq` se separó de `exito.ts`: el módulo
// del LLM arrastra el cliente del modelo y el corpus, y el runner lo carga
// por import dinámico solo cuando de verdad le toca.
//
//   · lead_magnet      — el embudo REAL de la calculadora pública.
//   · seo_distribucion — auditoría de lo que EXISTE (sitemap, títulos, slugs).
//   · guiones          — el guion semanal de video, con banco de hooks.
//   · noticias_mercado — carrusel del mercado, con fuente POR DATO.
//   · promos_diarias   — la promo del día de un beneficio REAL del producto.
//   · visuales         — el ENCARGO de la pieza gráfica (brief + prompt).
//   · video_demo       — el ENCARGO del video que se manda antes de la llamada.
//   · video_marketing  — el ENCARGO del reel/short para el gremio.
//   · alianzas         — el siguiente toque a gremios y aliados objetivo.
//
// ── LA REGLA QUE GOBIERNA A LOS DIEZ ──────────────────────────────────────
//
// NINGUNO PUBLICA, MANDA NI SUBE NADA. Los diez fabrican una pieza y la dejan
// en `cola_aprobacion`. Publicar es el tap de Javier, siempre — la misma
// frase que MARCA.md §6 ya tenía escrita para las rutinas locales, ahora con
// dientes: este módulo no importa un solo canal de salida.
//
// ── LAS OTRAS CINCO REGLAS ────────────────────────────────────────────────
//
//  1. CERO LLM AQUÍ. Las nueve de este archivo son deterministas de punta a
//     punta: las reglas calculan Y redactan con plantilla fija. El techo de
//     dinero se declara igual (candado 3 del runner lo exige) y el runner lo
//     mide contra el gasto REAL, así que el día que alguna redacte con modelo
//     el freno ya está puesto.
//  2. NULL ≠ 0. Un embudo sin filas NO es un embudo de cero: es «o nadie
//     visitó, o el pulso del sitio no está reportando». Las dos posibilidades
//     se nombran y la tasa de conversión sale NULL, jamás 0%.
//  3. NADA SE INVENTA. Ni una cifra, ni una noticia, ni un contacto. Lo que
//     este servidor puede citar es lo que tiene enfrente: el corpus verificado
//     de `normas/`, los artículos publicados de `/blog`, el motor de la
//     calculadora y las filas que la base sí devolvió. Cuando eso no alcanza,
//     la pieza lo DICE y nombra al motor que sí puede (las rutinas locales).
//  4. NO HAY PIPELINE DE RENDER EN EL SERVIDOR. `visuales`, `video_demo` y
//     `video_marketing` NO generan imagen ni video: producen el ENCARGO
//     estructurado (brief, copy, referencias de marca, prompt listo). Los
//     modelos de imagen y video de MARCA.md §5 viven en el flujo local de
//     Javier con Higgsfield; el runner de Vercel no tiene acceso a ellos y la
//     pieza lo declara en su propio cuerpo.
//  5. IDEMPOTENCIA POR CONSTRAINT. Título determinista por periodo contra el
//     índice único parcial `cola_pieza_crecimiento_por_periodo` (0230), no un
//     `if` (estándar §7). Dos pasadas del runner que compitan por el mismo
//     periodo las resuelve la base: gana exactamente una.
//
// ── LAS RUTINAS LOCALES SIGUEN VÁLIDAS ────────────────────────────────────
//
// `guiones`, `noticias_mercado` y `promos_diarias` YA corren hoy como rutinas
// en la Mac de Javier (`guiones-semanal` lunes 08:00, `noticias-diaria` 09:00,
// `promos-diaria` 10:00 — MARCA.md §6). Esas rutinas tienen lo que este
// servidor NO tiene: whisper local sobre los videos de referencia, acceso a
// la web para buscar noticias del mercado, y el pipeline de imagen. LO QUE SE
// CONSTRUYE AQUÍ NO LAS REEMPLAZA: es el piso que corre solo, con lo que el
// producto sí puede citar, para que la bandeja nunca dependa de que la Mac
// esté prendida. LAS RUTINAS LOCALES SIGUEN SIENDO VÁLIDAS HASTA QUE JAVIER
// LAS APAGUE, y cada pieza de estos tres lo dice en su cuerpo para que el que
// la lea sepa que hay dos motores y cuál produjo qué.
// ═══════════════════════════════════════════════════════════════════════════
import { supabaseAdmin } from '@/lib/supabase/admin';
import { acotada } from '../presupuesto';
import { hoyMx, numero, inicioDiaMx, fechaMx, mxn, porcentaje } from '@/lib/formato';
import { appUrl } from '@/lib/env';
import { ARTICULOS, type Articulo } from '../marketing/articulos';
import { calcularEstimacion, CUOTA_DOF } from '../marketing/calculadora';
import { NORMAS } from '../normas/indice';
import { encolarPieza } from './cola';
import { registrarCorrida, type DisparoCorrida } from './corridas';
import { logger } from '@/lib/logger';

export const AGENTES_CRECIMIENTO = [
  'contenido_fiscal', 'lead_magnet', 'seo_distribucion',
  'guiones', 'noticias_mercado', 'promos_diarias',
  'visuales', 'video_demo', 'video_marketing', 'alianzas',
] as const;
export type AgenteCrecimiento = (typeof AGENTES_CRECIMIENTO)[number];

export function esAgenteCrecimiento(id: string): id is AgenteCrecimiento {
  return (AGENTES_CRECIMIENTO as readonly string[]).includes(id);
}

/** Lo que una corrida de crecimiento le reporta al runner. Misma forma que la
 *  de éxito del cliente (0218): `resultado` distingue «no tocaba» de «corrió y
 *  no fabricó», que en un cron cada 4 horas no es lo mismo. */
export interface ResultadoCrecimiento {
  resultado: 'corrio' | 'saltado';
  /** Piezas que ENTRARON a la bandeja en esta corrida (0 o 1). */
  piezas: number;
  /** Por qué no se fabricó, cuando piezas = 0 y no es un fallo. */
  motivo?: string;
  /**
   * Gasto de modelo MEDIDO. $0 en las nueve deterministas de este archivo —
   * un cero que sí se midió, porque no llamaron a ningún modelo.
   *
   * `null` = NO SE PUDO MEDIR, que no es cero (regla 2). AUDITORÍA CICLO 7,
   * c7-11: cuando el proveedor omite `usage`, `generateResponse` devuelve
   * `{ cost: 0, noMedido: true }` y aquí se anotaba ese 0 como si fuera una
   * cifra. Ese 0 llegaba a `agente_corrida.costo_usd`, que es exactamente la
   * columna con la que el runner compara el techo de $1/día de
   * `contenido_fiscal`: el agente redactaba, gastaba de verdad, anotaba $0, y
   * el techo NUNCA cortaba.
   */
  costoUsd: number | null;
}

// ── Aritmética de fechas (el día de México lo da `hoyMx`) ──────────────────
//
// Se redefine aquí en vez de importarse de `backoffice.ts` por lo mismo que
// aquel la redefinió: ese módulo arrastra los lectores legales y de talento, y
// el runner lo carga por import dinámico justo para no pagarlo. Cuatro líneas
// de aritmética no justifican arrastrar el árbol entero.

/** El lunes de la semana de `dia` ('YYYY-MM-DD'). Anclado a mediodía UTC: el
 *  propio cálculo del día de la semana no puede cruzar de fecha. */
export function lunesDe(dia: string): string {
  const d = new Date(`${dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

/** `dia` desplazado `n` días (n negativo = hacia atrás). */
export function masDias(dia: string, n: number): string {
  const d = new Date(`${dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Días calendario entre dos fechas ISO 'YYYY-MM-DD' (b − a). */
export function diasEntre(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
}

// ── La pieza hacia la bandeja, con su idempotencia por constraint ──────────

/** ¿Ya existe la pieza de este periodo (cualquier estado)? LANZA si no se
 *  puede saber: sin poder verificar, no se fabrica (fail closed). */
export async function piezaExistente(agente: AgenteCrecimiento, titulo: string): Promise<boolean> {
  const { count, error } = await acotada(supabaseAdmin()
    .from('cola_aprobacion')
    .select('id', { count: 'exact', head: true })
    .eq('agente', agente)
    .eq('titulo', titulo), 'crecimiento.pieza_existente');
  if (error) throw new Error(`piezaExistente(${agente}): ${error.message}`);
  if (typeof count !== 'number') throw new Error(`piezaExistente(${agente}): PostgREST no devolvió el conteo — no se afirma un 0 que nadie midió.`);
  return count > 0;
}

/** Encola la pieza. El índice único parcial de la 0230 es el árbitro real: si
 *  otra corrida ganó la carrera del mismo periodo, el duplicado rebota y se
 *  trata como «ya existía», no como fallo. */
export async function encolarPiezaCrecimiento(
  agente: AgenteCrecimiento, tipo: string, titulo: string, cuerpo: string,
  fuentes: Record<string, unknown>,
): Promise<'encolada' | 'ya_existia'> {
  try {
    await encolarPieza({ tipo, prioridad: 'normal', agente, titulo, cuerpo, fuentes });
    return 'encolada';
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('duplicate key') || msg.includes('cola_pieza_crecimiento_por_periodo')) return 'ya_existia';
    throw e;
  }
}

/** Registra la corrida — `registrarCorrida` jamás lanza (contrato 0102).
 *  Todas van con tenant NULL: un borrador de artículo o un encargo de video
 *  no son de ninguna flota. */
export async function anotarCorrida(
  agente: AgenteCrecimiento, inicio: Date, estado: 'ok' | 'fallo', disparo: DisparoCorrida,
  resumen: Record<string, unknown>,
  /** `costoUsd` OMITIDO y `costoUsd: null` son cosas distintas y aquí se
   *  distinguen: omitirlo es «esta corrida no llamó a ningún modelo» (0
   *  medido, que es la verdad de las nueve deterministas), y `null` es «llamó
   *  y NO se pudo medir cuánto gastó» (c7-11). Un `?? 0` los aplastaba en el
   *  mismo cero, y ese cero dejaba ciego al único techo de gasto de los diez. */
  extra?: { costoUsd?: number | null; error?: string },
): Promise<void> {
  await registrarCorrida(null, agente, {
    inicio, fin: new Date(), estado, disparo,
    costoUsd: extra === undefined || !('costoUsd' in extra) ? 0 : extra.costoUsd,
    ...(estado === 'ok' ? { tareasHechas: 1, tareasTotal: 1 } : { tareasHechas: 0, tareasTotal: 1 }),
    resumen,
    ...(extra?.error ? { error: extra.error } : {}),
  });
}

/** El cierre que llevan TODAS las piezas de este departamento. Es la frase que
 *  la casa ya usaba en MARCA.md §6, puesta donde se lee. */
const PIE_TAP_DE_JAVIER = 'Nadie publicó nada desde aquí: esto es una propuesta y publicarla es el tap de Javier.';

/** El pie de los tres que además tienen rutina local viva. */
const PIE_RUTINA_LOCAL = (rutina: string, queTiene: string) =>
  `LA RUTINA LOCAL SIGUE VÁLIDA: \`${rutina}\` en la Mac de Javier ${queTiene}. Esta pieza es el piso que corre solo con lo que el servidor SÍ puede citar; no reemplaza a la rutina y no la apaga. Cuando Javier apague la rutina, esta se queda sola.`;

/** Redacta el resultado común de «la pieza ya estaba». */
function yaEstaba(agente: AgenteCrecimiento, que: string): ResultadoCrecimiento {
  logger.info('crecimiento.ya_existia', { agente });
  return { resultado: 'corrio', piezas: 0, motivo: `${que} ya está en la bandeja`, costoUsd: 0 };
}

// ═══════════════════════════════════════════════════════════════════════════
// 1 · LEAD MAGNET — el embudo REAL de la calculadora pública.
//
// Lee `sitio_evento` (0223) de la semana CERRADA y reporta lo que de verdad
// pasó: vistas y conversiones por día, por página. La semana cerrada y no la
// que va corriendo, por lo mismo que el vigilante de calidad: un embudo a
// medio semana produce conclusiones que se desmienten solas el jueves.
//
// LO QUE ESTE AGENTE NO HACE: no toca la calculadora. Propone mejoras
// CONCRETAS con el texto listo, y quien las mete al código es una persona con
// un PR — el mismo circuito que los artículos.
// ═══════════════════════════════════════════════════════════════════════════

/** Filas de `sitio_evento` que una ventana lee. Muy por encima de la escala
 *  real; si se llena, el parte lo DICE en vez de callar lo que no cupo. */
export const TOPE_EVENTOS_SITIO = 20_000;

export interface FilaEmbudo {
  pagina: string;
  evento: 'pageview' | 'conversion';
  dia: string;
}

export interface EmbudoPagina {
  pagina: string;
  vistas: number;
  conversiones: number;
  /** `null` cuando NO hay vistas: una tasa sobre cero no es 0%, es indefinida.
   *  Redondeada a un decimal. */
  tasaPct: number | null;
}

/** El embudo por página, PURO. Ordenado por vistas descendente y, en empate,
 *  por nombre — determinista para que la misma semana produzca el mismo texto. */
export function armarEmbudo(filas: FilaEmbudo[]): EmbudoPagina[] {
  const acc = new Map<string, { vistas: number; conversiones: number }>();
  for (const f of filas) {
    const a = acc.get(f.pagina) ?? { vistas: 0, conversiones: 0 };
    if (f.evento === 'pageview') a.vistas += 1;
    else a.conversiones += 1;
    acc.set(f.pagina, a);
  }
  return [...acc.entries()]
    .map(([pagina, a]) => ({
      pagina,
      vistas: a.vistas,
      conversiones: a.conversiones,
      tasaPct: a.vistas > 0 ? Math.round((a.conversiones / a.vistas) * 1000) / 10 : null,
    }))
    .sort((x, y) => y.vistas - x.vistas || x.pagina.localeCompare(y.pagina));
}

export interface Propuesta {
  clave: string;
  /** Qué se propone, en una línea. */
  que: string;
  /** El texto LISTO para pegar, cuando la propuesta es de copy. `null` cuando
   *  la propuesta no es un texto sino una decisión. */
  copy: string | null;
  /** Qué dato del embudo la disparó — sin esto es una opinión. */
  porque: string;
}

/** Vistas mínimas para que una tasa de conversión signifique algo. Bajo el
 *  piso, la tasa se reporta pero NO dispara propuesta: con 3 visitas, 0
 *  conversiones no es un problema de copy, es falta de tráfico. */
export const MIN_VISTAS_PARA_TASA = 30;

/**
 * Las propuestas, PURAS sobre el embudo ya leído. Cada una trae su disparador
 * — una propuesta sin el dato que la motiva es una lluvia de ideas, y de esas
 * ya hay bastantes. Deterministas y en orden fijo.
 */
export function proponerMejoras(embudo: EmbudoPagina[], articulos: number): Propuesta[] {
  const props: Propuesta[] = [];
  const calc = embudo.find((e) => e.pagina === 'calculadora') ?? null;
  const blog = embudo.filter((e) => e.pagina === 'blog' || e.pagina.startsWith('blog:'));
  const vistasBlog = blog.reduce((s, e) => s + e.vistas, 0);

  if (calc === null || calc.vistas === 0) {
    props.push({
      clave: 'sin_trafico_calculadora',
      que: 'Antes de tocar el copy: la calculadora no registró una sola vista en la ventana. El cuello no es la conversión, es que nadie llega.',
      copy: null,
      porque: calc === null
        ? 'no hay NINGUNA fila de la página `calculadora` en la ventana. Ojo: eso puede ser «nadie entró» o «el pulso del sitio no reportó» — el pageview lo manda el navegador y un bloqueador lo tumba sin avisar.'
        : `la página \`calculadora\` registró ${numero(calc.conversiones)} conversión(es) y 0 vistas, que es contradictorio: el pulso de vistas no está llegando aunque la captura sí.`,
    });
  } else if (calc.tasaPct !== null && calc.vistas >= MIN_VISTAS_PARA_TASA && calc.conversiones === 0) {
    props.push({
      clave: 'trafico_sin_conversion',
      que: 'Hay tráfico y cero capturas: el resultado ya se enseña antes de pedir el contacto (regla anti-abandono), así que lo que falta es el MOTIVO para dejarlo. Proponer una línea de intercambio explícita arriba del formulario.',
      copy: 'Te mandamos esta misma estimación por correo, con los supuestos que usamos y las condiciones que tu contador va a pedir. Sin llamada de ventas si no la pides.',
      porque: `${numero(calc.vistas)} vista(s) y 0 conversiones en la ventana (tasa 0.0%, por encima del piso declarado de ${numero(MIN_VISTAS_PARA_TASA)} vistas).`,
    });
  }

  if (vistasBlog > 0 && (calc === null || calc.vistas === 0)) {
    props.push({
      clave: 'blog_sin_puente',
      que: 'El blog trae lectores que no llegan a la calculadora: falta un puente explícito al pie de cada artículo (hoy el enlace vive en la prosa de algunos, no como cierre de todos).',
      copy: 'Si quieres dimensionar cuánto es en tu flota, la calculadora de esta página usa las mismas reglas del motor y te enseña los supuestos.',
      porque: `${numero(vistasBlog)} vista(s) en /blog y ${calc === null ? 'ninguna fila' : '0 vistas'} en /calculadora en la misma ventana.`,
    });
  }

  if (articulos < 6) {
    props.push({
      clave: 'poca_superficie',
      que: `El lead magnet depende de la superficie que lo alimenta: hoy hay ${numero(articulos)} artículo(s) publicados. El agente de contenido fiscal ya propone el siguiente tema del corpus que falta cubrir.`,
      copy: null,
      porque: `se cuentan ${numero(articulos)} artículos en la colección tipada de /blog, contra la meta declarada de 6 en este parte.`,
    });
  }

  return props;
}

/** El cuerpo del parte del lead magnet. PURO. */
export function armarParteLeadMagnet(
  embudo: EmbudoPagina[], props: Propuesta[], desde: string, hasta: string,
  totalFilas: number, truncado: boolean,
): string {
  const l: string[] = [
    `LEAD MAGNET — el embudo de la semana del ${desde} (ventana cerrada: ${desde} a ${hasta})`,
    '',
  ];
  if (embudo.length === 0) {
    l.push('NI UNA SOLA FILA en `sitio_evento` en la ventana.');
    l.push('Eso NO se lee como «cero visitas»: la tabla contestó y vino vacía, y las dos lecturas posibles son «nadie entró al sitio» y «el pulso del sitio no está reportando» (el pageview lo manda el navegador; un bloqueador o un despliegue roto lo tumban sin avisar). Las dos son noticia y ninguna es un cero medido.');
    l.push('La tasa de conversión de esta semana es INDEFINIDA, no 0%.');
  } else {
    l.push('EL EMBUDO MEDIDO (una fila por página; la tasa es conversiones ÷ vistas):');
    for (const e of embudo) {
      const tasa = e.tasaPct === null
        ? 'tasa: SIN VISTAS, indefinida (no es 0%)'
        : `tasa: ${porcentaje(e.tasaPct, 1)}`;
      l.push(`  · ${e.pagina} — ${numero(e.vistas)} vista(s) · ${numero(e.conversiones)} conversión(es) · ${tasa}`);
    }
    l.push('');
    l.push(`Total de eventos leídos en la ventana: ${numero(totalFilas)}.`);
  }
  if (truncado) {
    l.push('');
    l.push(`VENTANA TRUNCADA A ${numero(TOPE_EVENTOS_SITIO)} EVENTOS: la semana tuvo más de los que este parte alcanzó a leer. Todo lo de arriba se afirma sobre los leídos; las cifras son un PISO, no el total.`);
  }
  l.push('');
  if (props.length === 0) {
    l.push('SIN PROPUESTAS ESTA SEMANA: ninguna de las condiciones declaradas se cumplió. Es un resultado, no un hueco.');
  } else {
    l.push('LO QUE SE PROPONE (cada una con el dato que la disparó):');
    for (const p of props) {
      l.push('');
      l.push(`  [${p.clave}] ${p.que}`);
      l.push(`     por qué: ${p.porque}`);
      if (p.copy !== null) l.push(`     texto listo: «${p.copy}»`);
    }
  }
  l.push('');
  l.push('CÓMO SE MIDE Y QUÉ NO SE MIDE: `sitio_evento` (0223) guarda página + evento + fecha, y NADA del visitante (ni IP, ni user-agent, ni cookies — minimización LFPDPPP). Eso significa que este parte NO puede decir visitantes únicos, ni de dónde llegaron, ni si el mismo navegador entró diez veces: cuenta EVENTOS. Cualquier lectura de «usuarios» sobre estas cifras sería inventada.');
  l.push('Fuentes: sitio_evento (ventana cerrada) · la colección tipada de artículos de /blog.');
  l.push(PIE_TAP_DE_JAVIER);
  return l.join('\n');
}

/** Los eventos de la ventana. LANZA si no se pueden leer: un embudo sobre una
 *  tabla ciega afirmaría «nadie visitó». */
async function leerEventos(desdeIso: string, hastaIso: string): Promise<{ filas: FilaEmbudo[]; truncado: boolean }> {
  const { data, error, count } = await acotada(supabaseAdmin()
    .from('sitio_evento')
    // `count: 'exact'` y no `length === tope`: PostgREST recorta a `max_rows`
    // sin avisar, así que comparar el largo contra el `.limit()` no detecta
    // nada (la lección ESC-8, ya aprendida en backoffice.ts).
    .select('pagina, evento, created_at', { count: 'exact' })
    .gte('created_at', desdeIso)
    .lt('created_at', hastaIso)
    .order('created_at', { ascending: false })
    .limit(TOPE_EVENTOS_SITIO), 'crecimiento.embudo');
  if (error) throw new Error(`leerEventos: ${error.message}`);
  const crudas = (data ?? []) as Array<Record<string, unknown>>;
  const truncado = typeof count === 'number' ? count > crudas.length : crudas.length >= TOPE_EVENTOS_SITIO;
  return {
    filas: crudas.map((f) => ({
      pagina: String(f.pagina),
      evento: f.evento === 'conversion' ? 'conversion' : 'pageview',
      dia: String(f.created_at).slice(0, 10),
    })),
    truncado,
  };
}

async function correrLeadMagnet(disparo: DisparoCorrida, hoy: string): Promise<ResultadoCrecimiento> {
  const inicio = new Date();
  const agente = 'lead_magnet';
  const lunes = lunesDe(hoy);
  const desde = masDias(lunes, -7);
  const titulo = `Lead magnet — semana del ${desde}`;
  try {
    if (await piezaExistente(agente, titulo)) {
      await anotarCorrida(agente, inicio, 'ok', disparo, { pieza: 'ya_existia', titulo });
      return yaEstaba(agente, 'el parte del embudo de la semana cerrada');
    }
    const { filas, truncado } = await leerEventos(inicioDiaMx(desde), inicioDiaMx(lunes));
    const embudo = armarEmbudo(filas);
    const props = proponerMejoras(embudo, ARTICULOS.length);
    const cuerpo = armarParteLeadMagnet(embudo, props, desde, masDias(lunes, -1), filas.length, truncado);
    const res = await encolarPiezaCrecimiento(agente, 'embudo_lead_magnet', titulo, cuerpo, {
      ventana: { desde, hasta: lunes },
      embudo: embudo.map((e) => ({ pagina: e.pagina, vistas: e.vistas, conversiones: e.conversiones, tasa_pct: e.tasaPct })),
      propuestas: props.map((p) => p.clave),
      truncado,
      consultas: ['sitio_evento (ventana cerrada)'],
    });
    await anotarCorrida(agente, inicio, 'ok', disparo, { pieza: res, paginas: embudo.length, eventos: filas.length, propuestas: props.length });
    return { resultado: 'corrio', piezas: res === 'encolada' ? 1 : 0, motivo: res === 'ya_existia' ? 'otra corrida ganó el periodo' : undefined, costoUsd: 0 };
  } catch (e) {
    await anotarCorrida(agente, inicio, 'fallo', disparo, { titulo }, {
      error: `No se pudo armar el parte del embudo: ${e instanceof Error ? e.message : String(e)}`.slice(0, 500),
    });
    throw e;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 2 · SEO Y DISTRIBUCIÓN — auditoría de lo que EXISTE, no de lo que se sueña.
//
// Este agente NO habla de «posicionamiento». No tiene Search Console, no tiene
// rankings, no tiene volumen de búsqueda y no va a fingir ninguno de los tres:
// afirmar una posición sin la consola sería la clase de cifra inventada que
// esta casa prohíbe. Lo que SÍ puede auditar es el artefacto real que se sirve
// hoy: el sitemap (derivado de la misma colección que el índice del blog), el
// título y la meta-descripción de cada artículo, la forma del slug y si la
// pieza cierra con el puente a la calculadora.
// ═══════════════════════════════════════════════════════════════════════════

/** Convenciones DECLARADAS (no medidas): lo que los buscadores suelen recortar
 *  en el resultado. Se nombran como convención en el parte para que nadie las
 *  lea como una medición del producto. */
export const MAX_TITULO_SERP = 60;
export const MIN_META = 110;
export const MAX_META = 160;

export type CodigoSeo = 'S1' | 'S2' | 'S3' | 'S4' | 'S5';

export interface HallazgoSeo {
  codigo: CodigoSeo;
  slug: string;
  detalle: string;
  /** Qué hacer, concreto. `null` cuando lo que toca es una decisión humana. */
  accion: string | null;
}

/** El texto plano de un artículo — el mismo criterio que la prueba editorial. */
export function textoDeArticulo(a: Articulo): string {
  const cuerpos = a.bloques.map((b) => {
    switch (b.t) {
      case 'p': case 'h2': return b.texto;
      case 'ul': return b.items.join(' ');
      case 'cita': return `${b.texto} ${b.fuente}`;
    }
  });
  return [a.titulo, a.resumen, ...cuerpos].join(' ');
}

/**
 * La auditoría, PURA sobre la colección publicada. El título que se audita es
 * el que de verdad sale al `<title>` (`generateMetadata` le pega " — Likida"),
 * no el título suelto: auditar el otro mediría algo que nadie ve.
 */
export function auditarSeo(articulos: readonly Articulo[]): HallazgoSeo[] {
  const h: HallazgoSeo[] = [];
  const vistos = new Set<string>();
  for (const a of articulos) {
    const titleReal = `${a.titulo} — Likida`;
    if (titleReal.length > MAX_TITULO_SERP) {
      h.push({
        codigo: 'S1', slug: a.slug,
        detalle: `el <title> que se sirve mide ${numero(titleReal.length)} caracteres («${a.titulo}» más el sufijo « — Likida»), sobre la convención declarada de ${numero(MAX_TITULO_SERP)}.`,
        accion: `Reescribir el titular a ${numero(MAX_TITULO_SERP - ' — Likida'.length)} caracteres o menos sin perder la afirmación. Lo escribe una persona: recortar un titular fiscal a ciegas es como se pierde la condición que lo hace verdadero.`,
      });
    }
    const meta = a.resumen.trim();
    if (meta.length < MIN_META || meta.length > MAX_META) {
      h.push({
        codigo: 'S2', slug: a.slug,
        detalle: `la meta-descripción (el \`resumen\`) mide ${numero(meta.length)} caracteres, fuera de la convención declarada de ${numero(MIN_META)} a ${numero(MAX_META)}.`,
        accion: meta.length < MIN_META
          ? 'Ampliar el resumen con la CONDICIÓN de la norma que la pieza explica: es lo que distingue este resultado de los de un facturador genérico.'
          : 'Recortar el resumen a la primera afirmación completa; lo que sobra ya está en el cuerpo.',
      });
    }
    // Kebab-case verificado LINEALMENTE, no con `+(?:-…+)*`: el ratchet de
    // lint veta los grupos opcionales cuantificados por ReDoS, y aquí ni
    // siquiera hacen falta — «sin guion al inicio, al final ni doblado» es la
    // misma regla en tres comprobaciones que no retroceden.
    const kebab = /^[a-z0-9-]+$/.test(a.slug)
      && !a.slug.startsWith('-') && !a.slug.endsWith('-') && !a.slug.includes('--');
    if (!kebab || a.slug.length > 60) {
      h.push({
        codigo: 'S3', slug: a.slug,
        detalle: `el slug no cumple la forma kebab-case de hasta 60 caracteres (mide ${numero(a.slug.length)}).`,
        accion: 'Corregir el slug ANTES de que la URL se comparta: cambiarlo después rompe los enlaces que ya circulan.',
      });
    }
    if (vistos.has(a.slug)) {
      h.push({ codigo: 'S4', slug: a.slug, detalle: 'el slug está repetido en la colección: dos artículos compiten por la misma URL.', accion: 'Renombrar uno de los dos. La colección es la fuente del sitemap y del índice: un duplicado los rompe a los dos.' });
    }
    vistos.add(a.slug);
    if (!/calculadora/i.test(textoDeArticulo(a))) {
      h.push({
        codigo: 'S5', slug: a.slug,
        detalle: 'la pieza no menciona la calculadora: el lector no tiene puente a la única página del sitio que captura.',
        accion: 'Cerrar con el puente: «Si quieres dimensionar cuánto es en tu flota, la calculadora de esta página usa las mismas reglas del motor y te enseña los supuestos.»',
      });
    }
  }
  return h;
}

/** El parte de SEO. PURO. */
export function armarParteSeo(articulos: readonly Articulo[], hallazgos: HallazgoSeo[], lunes: string): string {
  const base = appUrl();
  const l: string[] = [
    `SEO Y DISTRIBUCIÓN — auditoría de lo publicado, semana del ${lunes}`,
    '',
    `Superficie auditada: ${numero(articulos.length)} artículo(s) más /blog y /calculadora, que son las ${numero(articulos.length + 2)} URLs del sitemap.`,
    '',
    'LO QUE ESTE PARTE NO DICE, A PROPÓSITO: nada de posiciones, rankings, volumen de búsqueda ni «oportunidades de keyword». Likida no tiene Search Console conectado ni ninguna fuente de datos de buscador, y una posición afirmada sin consola es una cifra inventada. Este parte audita el ARTEFACTO que sí se sirve: títulos, metas, slugs, sitemap y enlaces internos.',
    'Tampoco dice tiempos de build: el runner corre en la función, no en el pipeline, y no tiene forma de leerlos.',
    '',
    'EL SITEMAP: se deriva de la MISMA colección tipada que pinta el índice del blog (`src/app/sitemap.ts` importa `ARTICULOS`), así que no puede divergir del contenido publicado. Eso no es una opinión de este parte: es una propiedad del código, y por eso este agente no revisa «URLs faltantes en el sitemap» — no pueden faltar.',
    `  · ${base}/calculadora · ${base}/blog`,
    ...articulos.map((a) => `  · ${base}/blog/${a.slug}`),
    '',
  ];
  if (hallazgos.length === 0) {
    l.push('SIN HALLAZGOS: los títulos, metas, slugs y puentes internos de todas las piezas caen dentro de las convenciones declaradas.');
  } else {
    l.push(`HALLAZGOS (${numero(hallazgos.length)}):`);
    for (const x of hallazgos) {
      l.push('');
      l.push(`  [${x.codigo}] ${x.slug} — ${x.detalle}`);
      if (x.accion !== null) l.push(`     acción: ${x.accion}`);
    }
  }
  l.push('');
  l.push(`Las convenciones son DECLARADAS, no medidas: ${numero(MAX_TITULO_SERP)} caracteres de <title> y ${numero(MIN_META)} a ${numero(MAX_META)} de meta-descripción son lo que los buscadores suelen recortar. Ninguna sale de un experimento de Likida, y el parte no finge lo contrario.`);
  l.push('Fuentes: la colección tipada de artículos (marketing/articulos.ts) · src/app/sitemap.ts · la metadata que sirve /blog/[slug].');
  l.push(PIE_TAP_DE_JAVIER);
  return l.join('\n');
}

async function correrSeoDistribucion(disparo: DisparoCorrida, hoy: string): Promise<ResultadoCrecimiento> {
  const inicio = new Date();
  const agente = 'seo_distribucion';
  const lunes = lunesDe(hoy);
  const titulo = `SEO — semana del ${lunes}`;
  try {
    if (await piezaExistente(agente, titulo)) {
      await anotarCorrida(agente, inicio, 'ok', disparo, { pieza: 'ya_existia', titulo });
      return yaEstaba(agente, 'la auditoría de SEO de esta semana');
    }
    const hallazgos = auditarSeo(ARTICULOS);
    const cuerpo = armarParteSeo(ARTICULOS, hallazgos, lunes);
    const res = await encolarPiezaCrecimiento(agente, 'auditoria_seo', titulo, cuerpo, {
      semana: lunes,
      articulos: ARTICULOS.map((a) => a.slug),
      hallazgos: hallazgos.map((x) => ({ codigo: x.codigo, slug: x.slug })),
      consultas: ['marketing/articulos.ts (colección publicada)', 'src/app/sitemap.ts'],
    });
    await anotarCorrida(agente, inicio, 'ok', disparo, { pieza: res, hallazgos: hallazgos.length, articulos: ARTICULOS.length });
    return { resultado: 'corrio', piezas: res === 'encolada' ? 1 : 0, motivo: res === 'ya_existia' ? 'otra corrida ganó el periodo' : undefined, costoUsd: 0 };
  } catch (e) {
    await anotarCorrida(agente, inicio, 'fallo', disparo, { titulo }, {
      error: `No se pudo armar la auditoría de SEO: ${e instanceof Error ? e.message : String(e)}`.slice(0, 500),
    });
    throw e;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// LOS BENEFICIOS VERIFICADOS — el sustrato de `promos_diarias` y `visuales`.
//
// «Un beneficio REAL verificado contra el código, jamás inventado» no puede
// ser una lista de frases bonitas en una constante: eso es exactamente un
// invento con formato de dato. Cada beneficio de abajo declara qué símbolo del
// producto lo sostiene, y su respaldo se MIDE en la corrida ejecutando el
// motor real de la calculadora. Si algún día alguien cambia el factor del
// peaje, la promo del día cambia con él o se cae — no se queda mintiendo.
// ═══════════════════════════════════════════════════════════════════════════

export interface BeneficioVerificado {
  clave: string;
  titulo: string;
  /** La afirmación en una línea, lista para un canal. */
  copy: string;
  /** De dónde sale la verdad: el símbolo del producto y el valor MEDIDO hoy. */
  respaldo: { simbolo: string; medido: string };
  /** Las fichas del corpus que lo fundamentan (citas legibles). */
  fundamento: string[];
}

/**
 * Los beneficios que el producto puede afirmar HOY, cada uno con su respaldo
 * medido corriendo el motor real. PURA (recibe el día; no toca red ni base).
 *
 * La sonda usa cifras REDONDAS a propósito (1,000 litros; $11,600 de casetas):
 * no son una afirmación sobre ninguna flota, son la entrada de una medición
 * cuyo resultado sí es una propiedad del motor. El parte lo dice.
 */
export function beneficiosVerificados(hoy: string): BeneficioVerificado[] {
  const LITROS_SONDA = 1_000;
  const CASETAS_SONDA = 11_600; // subtotal redondo de $10,000 al quitarle el IVA
  const sonda = calcularEstimacion({
    litrosDieselMes: LITROS_SONDA, gastoDieselMesMxn: null, precioLitro: null,
    gastoCasetasMesMxn: CASETAS_SONDA, unidades: null, hoy,
  });
  const vacia = calcularEstimacion({
    litrosDieselMes: null, gastoDieselMesMxn: null, precioLitro: null,
    gastoCasetasMesMxn: null, unidades: null, hoy,
  });

  const b: BeneficioVerificado[] = [];

  if ('estimuloMesMxn' in sonda.peaje) {
    const factor = sonda.peaje.estimuloMesMxn / sonda.peaje.subtotalEstimadoMes;
    b.push({
      clave: 'peaje_50',
      titulo: 'El 50% de tus casetas, conciliado',
      copy: 'El 50% del peaje de la Red Nacional de Autopistas de Cuota es acreditable. Lo que tumba el estímulo no es la caseta: es la bitácora. Likida arma la bitácora conciliada.',
      respaldo: {
        simbolo: 'marketing/calculadora.ts → calcularEstimacion().peaje',
        // c7-34 (regla 10): `mxn()` y `porcentaje()`, no `$` + `numero()` ni
        // `toFixed`. Esta línea NO se queda en la bandeja: `copyPorCanal` la
        // pega tal cual en el texto de LinkedIn, así que un formato divergente
        // sale a la calle con la marca encima.
        medido: `con ${mxn(CASETAS_SONDA)} de casetas el motor devuelve ${mxn(sonda.peaje.subtotalEstimadoMes)} de subtotal y ${mxn(sonda.peaje.estimuloMesMxn)} de estímulo, o sea un factor de ${porcentaje(factor * 100, 0)}`,
      },
      fundamento: ['LIF 2026 art. 20 apartado A', 'RMF 2026 regla 9.1.8'],
    });
  }

  if ('litrosMes' in sonda.diesel) {
    const d = sonda.diesel;
    b.push({
      clave: 'diesel_litros',
      titulo: 'El diésel se entrega en litros, no en pesos',
      copy: 'El estímulo del diésel se calcula con la cuota semanal del DOF por tus litros. Likida entrega el dato que no cambia: cuántos litros son elegibles. La cifra en pesos la construye tu contador con la cuota de la semana en que cargaste.',
      respaldo: {
        simbolo: 'marketing/calculadora.ts → calcularEstimacion().diesel',
        medido: d.estimacionMesMxn === null
          ? `con ${numero(LITROS_SONDA)} litros el motor devuelve ${numero(d.litrosMes)} litros y NINGUNA cifra en pesos: la cuota registrada (${CUOTA_DOF.registradaEl}) ya venció y el candado la retiró sola`
          : `con ${numero(LITROS_SONDA)} litros el motor devuelve ${numero(d.litrosMes)} litros y la estimación en pesos SIEMPRE fechada con la cuota del ${d.cuota.registradaEl}`,
      },
      fundamento: ['LIF 2026 art. 20 apartado A', 'Criterio sobre la cuota DISMINUIDA del DOF'],
    });
  }

  const acumulable = sonda.advertencias.find((a) => a.toLowerCase().includes('acumulable')) ?? null;
  if (acumulable !== null) {
    b.push({
      clave: 'acumulable_a_la_vista',
      titulo: 'El estímulo es ingreso acumulable, y lo decimos primero',
      copy: 'El estímulo es ingreso acumulable: tu neto real es el estímulo por uno menos tu tasa de ISR. Es la línea que las propuestas comerciales esconden en un pie de página y que en Likida sale con el resultado.',
      respaldo: {
        simbolo: 'marketing/calculadora.ts → advertencias',
        medido: `el resultado del motor SIEMPRE trae la advertencia «${acumulable.slice(0, 80)}…», no como tooltip`,
      },
      fundamento: ['LIF 2026 art. 20 apartado A (el estímulo acumula)'],
    });
  }

  if (sonda.supuestos.length > 0) {
    b.push({
      clave: 'supuestos_declarados',
      titulo: 'Ningún número sin su supuesto en la misma línea',
      copy: 'Cada cifra que te enseñamos viaja con el supuesto que la produjo y con el dato que puedes cambiar. Un número sin supuesto es un número que tu contador va a desinflar enfrente de ti.',
      respaldo: {
        simbolo: 'marketing/calculadora.ts → supuestos',
        medido: `la sonda de esta corrida devolvió ${numero(sonda.supuestos.length)} supuesto(s) declarado(s) junto a las cifras`,
      },
      fundamento: ['Regla de honestidad del lead magnet (seis candados)'],
    });
  }

  const faltaDicha = 'faltante' in vacia.diesel && 'faltante' in vacia.peaje;
  if (faltaDicha) {
    b.push({
      clave: 'lo_que_falta_se_dice',
      titulo: 'Si falta un dato, te decimos cuál',
      copy: 'Sin tus litros no estimamos el bloque del diésel, y lo decimos. Preferimos un hueco nombrado a un cero de encuadre: un cero que nadie midió es la mentira más barata de un tablero.',
      respaldo: {
        simbolo: 'marketing/calculadora.ts → bloques `faltante`',
        medido: 'con la entrada vacía el motor devuelve los dos bloques con su motivo de ausencia y el total en NULL, no en 0',
      },
      fundamento: ['Regla de la casa: null ≠ 0'],
    });
  }

  const afirmables = Object.values(NORMAS).filter((n) => n.estado !== 'sin_verificar').length;
  b.push({
    clave: 'corpus_citable',
    titulo: 'Cada afirmación fiscal, con su ficha',
    copy: 'Lo que Likida afirma sobre el SAT sale de un corpus de fichas verificadas contra fuente primaria, y cada respuesta cita la suya. Lo que el corpus no cubre, se dice que no se cubre.',
    respaldo: {
      simbolo: 'normas/indice.ts → NORMAS',
      medido: `${numero(afirmables)} de ${numero(Object.keys(NORMAS).length)} fichas del corpus están verificadas y son afirmables hoy`,
    },
    fundamento: ['normas/README.md (escala de jerarquía y estados de verificación)'],
  });

  return b;
}

/** El beneficio que toca hoy: rotación DETERMINISTA por día, para que dos
 *  pasadas del mismo día produzcan la misma promo y el índice único haga su
 *  trabajo. Devuelve `null` si no hay ni un beneficio verificable — que sería
 *  la noticia, no un motivo para inventar uno. */
export function beneficioDelDia(beneficios: BeneficioVerificado[], dia: string): BeneficioVerificado | null {
  if (beneficios.length === 0) return null;
  // Días desde una época fija: el módulo rota sin depender del calendario.
  const n = Math.abs(diasEntre('2026-01-01', dia));
  return beneficios[n % beneficios.length];
}

// ═══════════════════════════════════════════════════════════════════════════
// 3 · PROMOS DIARIAS — un beneficio REAL del producto, al día.
// ═══════════════════════════════════════════════════════════════════════════

/** El copy por canal (MARCA.md §6: LinkedIn + Instagram + TikTok). Es la MISMA
 *  afirmación en tres largos — no tres afirmaciones distintas: partir el
 *  mensaje por canal es cómo una de las tres versiones acaba diciendo algo que
 *  el producto no hace. PURA. */
export function copyPorCanal(b: BeneficioVerificado): Array<{ canal: string; texto: string }> {
  return [
    {
      canal: 'LinkedIn',
      texto: [
        b.copy,
        '',
        `Cómo lo sostenemos: ${b.respaldo.medido}.`,
        `Fundamento: ${b.fundamento.join(' · ')}.`,
        'Likida entrega el dato y la bitácora; quien acredita es tu contador.',
      ].join('\n'),
    },
    { canal: 'Instagram', texto: `${b.titulo}.\n\n${b.copy}\n\nFundamento: ${b.fundamento[0]}.` },
    { canal: 'TikTok', texto: `${b.titulo}. ${b.copy.split('. ')[0]}.` },
  ];
}

/** El cuerpo de la promo del día. PURO. */
export function armarPromoDiaria(b: BeneficioVerificado, dia: string): string {
  const l: string[] = [
    `PROMO DEL DÍA — ${fechaMx(dia)}`,
    '',
    `Beneficio en rotación: ${b.titulo} (clave \`${b.clave}\`).`,
    '',
    'POR QUÉ ESTE BENEFICIO SE PUEDE AFIRMAR (no es una frase de folleto):',
    `  · símbolo del producto: ${b.respaldo.simbolo}`,
    `  · medido en ESTA corrida: ${b.respaldo.medido}`,
    `  · fundamento: ${b.fundamento.join(' · ')}`,
    '',
    'COPY POR CANAL:',
  ];
  for (const c of copyPorCanal(b)) {
    l.push('');
    l.push(`── ${c.canal} ──`);
    l.push(c.texto);
  }
  l.push('');
  l.push('LO QUE FALTA Y NO LO PONE ESTE AGENTE: la pieza gráfica. El logo se COMPONE encima del archivo oficial, jamás se genera con un modelo (MARCA.md §4), y este servidor no tiene pipeline de imagen. El encargo visual lo prepara el agente `visuales`.');
  l.push(PIE_RUTINA_LOCAL('promos-diaria (10:00)', 'compone el logo y arma la pieza gráfica completa'));
  l.push(PIE_TAP_DE_JAVIER);
  return l.join('\n');
}

async function correrPromosDiarias(disparo: DisparoCorrida, hoy: string): Promise<ResultadoCrecimiento> {
  const inicio = new Date();
  const agente = 'promos_diarias';
  const titulo = `Promo del día — ${hoy}`;
  try {
    if (await piezaExistente(agente, titulo)) {
      await anotarCorrida(agente, inicio, 'ok', disparo, { pieza: 'ya_existia', titulo });
      return yaEstaba(agente, 'la promo de hoy');
    }
    const beneficios = beneficiosVerificados(hoy);
    const b = beneficioDelDia(beneficios, hoy);
    if (b === null) {
      // Ni un beneficio verificable contra el motor. NO se inventa uno: la
      // corrida queda anotada y la bandeja no recibe una promo vacía.
      await anotarCorrida(agente, inicio, 'ok', disparo, { pieza: 'ninguna', motivo: 'sin beneficios verificables' });
      return { resultado: 'corrio', piezas: 0, motivo: 'ningún beneficio del catálogo pudo verificarse contra el motor hoy — no se fabrica una promo sin respaldo medido', costoUsd: 0 };
    }
    const res = await encolarPiezaCrecimiento(agente, 'promo_diaria', titulo, armarPromoDiaria(b, hoy), {
      dia: hoy, beneficio: b.clave,
      respaldo: b.respaldo, fundamento: b.fundamento,
      verificables: beneficios.map((x) => x.clave),
      consultas: ['marketing/calculadora.ts (motor real, sonda)', 'normas/indice.ts'],
    });
    await anotarCorrida(agente, inicio, 'ok', disparo, { pieza: res, beneficio: b.clave, verificables: beneficios.length });
    return { resultado: 'corrio', piezas: res === 'encolada' ? 1 : 0, motivo: res === 'ya_existia' ? 'otra corrida ganó el día' : undefined, costoUsd: 0 };
  } catch (e) {
    await anotarCorrida(agente, inicio, 'fallo', disparo, { titulo }, {
      error: `No se pudo armar la promo del día: ${e instanceof Error ? e.message : String(e)}`.slice(0, 500),
    });
    throw e;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 4 · GUIONES — el guion semanal de video, con banco de hooks.
//
// El banco de hooks de Javier (`banco-de-hooks.md`) lo destila la rutina local
// con whisper sobre los videos de referencia que él sube. Este servidor no
// tiene ni los videos ni whisper, así que NO finge tener ese banco: el banco
// que usa son las FORMAS de arranque ya probadas de los artículos publicados,
// que sí están en el repo y cada una cita de cuál salió.
// ═══════════════════════════════════════════════════════════════════════════

export interface FormaDeHook {
  clave: string;
  /** La estructura, con la ranura que el guion llena. */
  forma: string;
  /** De qué artículo publicado se destiló — sin esto sería un hook inventado. */
  origen: string;
}

/** Las tres formas destiladas de los arranques que ya están publicados. Son
 *  ESTRUCTURAS, no afirmaciones: la afirmación la pone el artículo de la
 *  semana. Cada una nombra su origen. */
export const FORMAS_DE_HOOK: readonly FormaDeHook[] = [
  {
    clave: 'pregunta_del_gremio',
    forma: 'La pregunta llega igual en todas las flotas: «{pregunta}». Y la respuesta honesta empieza por un dato, no por una corazonada.',
    origen: 'carta-porte-quien-si-quien-no',
  },
  {
    clave: 'trampa_aritmetica',
    forma: 'Hay una trampa aritmética en {tema} que infla propuestas comerciales todos los días.',
    origen: 'ieps-diesel-litros-no-pesos',
  },
  {
    clave: 'lo_que_nadie_arma',
    forma: '{afirmacion}. Lo que casi nadie arma es {requisito}, y eso es lo que tumba el estímulo.',
    origen: 'peajes-50-por-ciento-bitacora',
  },
];

/** El artículo de la semana: rotación determinista, para que dos pasadas del
 *  mismo lunes produzcan el mismo guion. */
export function articuloDeLaSemana(articulos: readonly Articulo[], lunes: string): Articulo | null {
  if (articulos.length === 0) return null;
  const n = Math.abs(diasEntre('2026-01-05', lunes)) / 7; // 2026-01-05 fue lunes
  return articulos[Math.floor(n) % articulos.length];
}

/** Los primeros `n` párrafos de un artículo — la materia de las escenas. */
function parrafosDe(a: Articulo, n: number): string[] {
  return a.bloques
    .flatMap((b) => (b.t === 'p' ? [b.texto] : b.t === 'ul' ? b.items : []))
    .slice(0, n);
}

/** El guion semanal. PURO. */
export function armarGuionSemanal(a: Articulo, hook: FormaDeHook, lunes: string): string {
  const escenas = parrafosDe(a, 4);
  const l: string[] = [
    `GUION SEMANAL — semana del ${lunes}`,
    '',
    `Tema: ${a.titulo}`,
    `Fundamento de la pieza (va citado en pantalla): ${a.fundamento.join(' · ')}`,
    '',
    `HOOK (3 segundos, forma \`${hook.clave}\` destilada del artículo publicado «${hook.origen}»):`,
    `  ${a.bloques.find((b) => b.t === 'p')?.texto.split('. ')[0] ?? a.titulo}.`,
    `  Estructura de referencia: ${hook.forma}`,
    '',
    'ESCENAS (narración para ElevenLabs con la voz de Javier — NUNCA la voz del modelo, MARCA.md §5):',
  ];
  escenas.forEach((texto, i) => {
    l.push('');
    l.push(`  Escena ${i + 1}`);
    l.push(`    narración: ${texto}`);
    l.push('    en pantalla: la cifra o la condición de esta línea, con su fuente al pie.');
  });
  l.push('');
  l.push('CIERRE:');
  l.push('  narración: Likida entrega el dato y la bitácora; quien acredita es tu contador.');
  l.push(`  en pantalla: ${appUrl()}/calculadora`);
  l.push('');
  l.push('LO QUE SIGUE EN LA CADENA (MARCA.md §6): con este guion aprobado se hacen los character sheets y los lugares sheets (gpt_image_2, skill sequence-sheet), luego las sequence sheets, y la animación arranca SOLO cuando Javier aprueba sequence por sequence. Aprobar una sequence ES autorizar el gasto de animarla.');
  l.push('');
  l.push('DE DÓNDE SALE ESTE GUION, PARA QUE NADIE SE CONFUNDA: de un artículo YA publicado y verificado de /blog. Este servidor no tiene los videos de referencia de Javier ni whisper, así que no destiló ni un hook nuevo: las formas de arranque de arriba son las de los artículos del repo, con su origen citado.');
  l.push(PIE_RUTINA_LOCAL('guiones-semanal (lunes 08:00)', 'transcribe los videos de referencia con whisper y alimenta el banco-de-hooks.md de verdad'));
  l.push(PIE_TAP_DE_JAVIER);
  return l.join('\n');
}

async function correrGuiones(disparo: DisparoCorrida, hoy: string): Promise<ResultadoCrecimiento> {
  const inicio = new Date();
  const agente = 'guiones';
  const lunes = lunesDe(hoy);
  const titulo = `Guion semanal — semana del ${lunes}`;
  try {
    if (await piezaExistente(agente, titulo)) {
      await anotarCorrida(agente, inicio, 'ok', disparo, { pieza: 'ya_existia', titulo });
      return yaEstaba(agente, 'el guion de esta semana');
    }
    const a = articuloDeLaSemana(ARTICULOS, lunes);
    if (a === null) {
      await anotarCorrida(agente, inicio, 'ok', disparo, { pieza: 'ninguna', motivo: 'sin artículos publicados' });
      return { resultado: 'corrio', piezas: 0, motivo: 'no hay un solo artículo publicado del cual destilar el guion — sin material verificado no se escribe uno inventado', costoUsd: 0 };
    }
    const hook = FORMAS_DE_HOOK[Math.abs(diasEntre('2026-01-05', lunes)) % FORMAS_DE_HOOK.length];
    const res = await encolarPiezaCrecimiento(agente, 'guion_video', titulo, armarGuionSemanal(a, hook, lunes), {
      semana: lunes, articulo: a.slug, hook: hook.clave, fundamento: a.fundamento,
      consultas: ['marketing/articulos.ts (colección publicada)'],
    });
    await anotarCorrida(agente, inicio, 'ok', disparo, { pieza: res, articulo: a.slug, hook: hook.clave });
    return { resultado: 'corrio', piezas: res === 'encolada' ? 1 : 0, motivo: res === 'ya_existia' ? 'otra corrida ganó la semana' : undefined, costoUsd: 0 };
  } catch (e) {
    await anotarCorrida(agente, inicio, 'fallo', disparo, { titulo }, {
      error: `No se pudo armar el guion semanal: ${e instanceof Error ? e.message : String(e)}`.slice(0, 500),
    });
    throw e;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 5 · NOTICIAS DEL MERCADO — carrusel con fuente POR DATO.
//
// El blueprint pide «investiga a diario el mercado». Este servidor NO tiene
// acceso a la web: no puede investigar nada, y fingirlo produciría justo la
// pieza que la casa prohíbe — una noticia inventada con formato de noticia.
//
// Lo que SÍ tiene enfrente es el corpus normativo verificado, que es donde de
// verdad ocurre la noticia que le importa a una flota: qué cambió y desde
// cuándo es exigible. Cada slide del carrusel cita SU ficha, con su jerarquía
// y su estado de verificación. Y por eso es SEMANAL y no diario: el corpus
// cambia cuando `experto_fiscal` asienta una ficha nueva, no todos los días —
// un carrusel diario de las mismas fichas sería spam en la bandeja de Javier.
// ═══════════════════════════════════════════════════════════════════════════

/** Cuánto hacia atrás se considera «del mercado de hoy». Un año: una norma
 *  exigible desde enero sigue siendo la noticia del gremio en agosto, porque
 *  la mitad de las flotas todavía no la aplica. */
export const VENTANA_NOTICIAS_DIAS = 365;
/** Slides mínimos para que un carrusel sea un carrusel. */
export const MIN_SLIDES = 2;

export interface SlideNoticia {
  normaId: string;
  cita: string;
  titulo: string;
  exigibleDesde: string;
  jerarquia: number;
  vinculante: boolean;
}

/** Los slides, PUROS sobre el índice de normas. Solo fichas AFIRMABLES (una
 *  `sin_verificar` existe y está declarada, pero el producto no la afirma) y
 *  solo con `exigibleDesde` dentro de la ventana: sin fecha no hay noticia. */
export function slidesDelMercado(hoy: string, ventanaDias = VENTANA_NOTICIAS_DIAS): SlideNoticia[] {
  const salida: SlideNoticia[] = [];
  for (const n of Object.values(NORMAS)) {
    if (n.estado === 'sin_verificar') continue;
    const desde = n.exigibleDesde ?? null;
    if (desde === null) continue;
    const d = diasEntre(desde, hoy);
    if (d < 0 || d > ventanaDias) continue;
    salida.push({
      normaId: n.id,
      cita: n.citas.find((c) => !/^[a-z][a-zA-Z0-9]*$/.test(c)) ?? n.instrumento ?? n.id,
      titulo: n.titulo ?? n.instrumento ?? n.id,
      exigibleDesde: desde,
      jerarquia: n.jerarquia,
      vinculante: n.jerarquia <= 4,
    });
  }
  // Lo más reciente primero; empates por id — determinista.
  return salida.sort((a, b) => b.exigibleDesde.localeCompare(a.exigibleDesde) || a.normaId.localeCompare(b.normaId));
}

/** El carrusel. PURO. */
export function armarCarruselNoticias(slides: SlideNoticia[], lunes: string, hoy: string): string {
  const l: string[] = [
    `NOTICIAS DEL MERCADO — carrusel de la semana del ${lunes}`,
    '',
  ];
  if (slides.length < MIN_SLIDES) {
    l.push(`SIN CARRUSEL ESTA SEMANA: el corpus verificado no tiene ${numero(MIN_SLIDES)} fichas con fecha de exigibilidad dentro de los últimos ${numero(VENTANA_NOTICIAS_DIAS)} días (se encontraron ${numero(slides.length)}).`);
    l.push('NO se fabrica un carrusel con noticias inventadas para llenar el hueco. Un carrusel de mercado sin fuente por dato es exactamente la pieza que quema la credibilidad que este blog está construyendo.');
    l.push('Si esta semana SÍ hubo movimiento en el mercado, lo trae la rutina local, que sí tiene acceso a la web.');
  } else {
    l.push('Un slide por dato, y cada dato con SU fuente. Ninguna afirmación sale de aquí sin ficha:');
    slides.forEach((s, i) => {
      l.push('');
      l.push(`  Slide ${i + 1} — ${s.titulo}`);
      l.push(`    fuente: ${s.cita} (ficha \`${s.normaId}\` del corpus verificado)`);
      l.push(`    exigible desde: ${s.exigibleDesde}`);
      l.push(`    peso: nivel ${numero(s.jerarquia)} — ${s.vinculante ? 'OBLIGA' : 'orienta, NO obliga'}`);
    });
    l.push('');
    l.push('  Slide de cierre');
    l.push('    Likida entrega el dato y la bitácora; quien acredita es tu contador.');
    l.push(`    ${appUrl()}/blog`);
  }
  l.push('');
  l.push(`QUÉ MIRÓ ESTE AGENTE Y QUÉ NO: miró el corpus normativo verificado de Likida (fichas con fuente primaria) buscando lo exigible en los últimos ${numero(VENTANA_NOTICIAS_DIAS)} días al ${hoy}. NO miró la web, ni prensa del gremio, ni movimientos de la competencia: este servidor no tiene acceso a internet y no va a fingir una investigación que no hizo.`);
  l.push('Fuentes: normas/indice.ts (solo fichas afirmables, con fecha de exigibilidad).');
  l.push(PIE_RUTINA_LOCAL('noticias-diaria (09:00)', 'sí navega la web y cubre prensa del gremio, competencia y tecnología'));
  l.push(PIE_TAP_DE_JAVIER);
  return l.join('\n');
}

async function correrNoticiasMercado(disparo: DisparoCorrida, hoy: string): Promise<ResultadoCrecimiento> {
  const inicio = new Date();
  const agente = 'noticias_mercado';
  const lunes = lunesDe(hoy);
  const titulo = `Noticias del mercado — semana del ${lunes}`;
  try {
    if (await piezaExistente(agente, titulo)) {
      await anotarCorrida(agente, inicio, 'ok', disparo, { pieza: 'ya_existia', titulo });
      return yaEstaba(agente, 'el carrusel de esta semana');
    }
    const slides = slidesDelMercado(hoy);
    const res = await encolarPiezaCrecimiento(agente, 'carrusel_noticias', titulo, armarCarruselNoticias(slides, lunes, hoy), {
      semana: lunes, slides: slides.map((s) => s.normaId), ventana_dias: VENTANA_NOTICIAS_DIAS,
      suficientes: slides.length >= MIN_SLIDES,
      consultas: ['normas/indice.ts (fichas afirmables con fecha de exigibilidad)'],
    });
    await anotarCorrida(agente, inicio, 'ok', disparo, { pieza: res, slides: slides.length });
    return { resultado: 'corrio', piezas: res === 'encolada' ? 1 : 0, motivo: res === 'ya_existia' ? 'otra corrida ganó la semana' : undefined, costoUsd: 0 };
  } catch (e) {
    await anotarCorrida(agente, inicio, 'fallo', disparo, { titulo }, {
      error: `No se pudo armar el carrusel de noticias: ${e instanceof Error ? e.message : String(e)}`.slice(0, 500),
    });
    throw e;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 6 · VISUALES / VIDEO DEMO / VIDEO MARKETING — el ENCARGO, no la pieza.
//
// LOS TRES DECLARAN LO MISMO EN SU CUERPO: este servidor NO genera imagen ni
// video. Los modelos de MARCA.md §5 (nano_banana_2, gpt_image_2, seedance,
// ElevenLabs) viven en el flujo local de Javier con Higgsfield; el runner de
// Vercel no tiene ni las llaves ni el pipeline, y una pieza que dijera «aquí
// está tu imagen» estaría mintiendo. Lo que producen es el ENCARGO completo:
// brief, copy verificado, referencias de marca del sistema de diseño y el
// prompt listo para pegar en la skill que sí ejecuta.
// ═══════════════════════════════════════════════════════════════════════════

/** El bloque de marca que llevan los tres encargos. Sale de MARCA.md §2.3/§4 y
 *  de DESIGN.md; se escribe aquí porque el runner no lee archivos del repo en
 *  tiempo de ejecución, y una referencia de marca por memoria es la clase de
 *  dato que se desincroniza. Cambiar la marca es cambiar esta constante en el
 *  mismo PR — eso es lo que la mantiene honesta. */
const REFERENCIAS_DE_MARCA: readonly string[] = [
  'Paleta ESTILO PAPEL (MARCA.md §2.3): crema papel #EDE4D3 al ~60% del cuadro · azul marino #2A3F5F estructura y texto al ~25% · naranja ladrillo #E24A1B SOLO acento, nunca más del 15% · verde dinero #4E9A3E SOLO en cifras recuperadas · azul Likida #0B5FFF solo logo, links y botón.',
  'Semántica del color: naranja = el mundo del viaje (carretera, chaleco, cono, ticket); azul = el mundo del dinero (estructura, fiscal, cierre, marca).',
  'El papel es TÉCNICA, no otra marca: recorte, textura, halftone, sombra dura.',
  'EL LOGO SE PEGA, NO SE GENERA (MARCA.md §4): se deja el espacio vacío y se compone `public/images/logo.png` encima. Cualquier variante inventada del ícono está RETIRADA.',
  'Tipografía y cifras (MARCA.md §3): display peso 600 con letter-spacing -0.01em, labels en MAYÚSCULAS 11px con tracking, y toda cifra en tabular-nums con formato es-MX.',
  'Voz honesto-fiscal (MARCA.md §1): cifra real con fuente, o decir qué falta. PROHIBIDAS: "ahorra hasta 90%", "IA revolucionaria", "cientos de flotas confían" (Likida no tiene clientes), "el efectivo nunca es deducible".',
  'Papel abre, producto cierra: la capa de PRUEBA es la UI real, nunca al revés.',
];

/** El pie que declara la frontera del render. Los tres lo llevan. */
const SIN_PIPELINE_DE_RENDER = [
  'ESTE AGENTE NO GENERÓ NINGUNA IMAGEN NI NINGÚN VIDEO, Y NO PUEDE.',
  'No hay pipeline de render en el servidor: los modelos de MARCA.md §5 (nano_banana_2, gpt_image_2, seedance_2_0, Soul ID) corren por Higgsfield en el flujo local de Javier, y la narración es SIEMPRE ElevenLabs con su voz, nunca la del modelo. Esta pieza es el ENCARGO listo para ejecutarse ahí.',
  'Antes de generar: el copy va COMPLETO y con acentos, y se verifica letra por letra DESPUÉS (el glifo `LIKİDA` con İ turca salió de un prompt bien escrito). Si la pieza lleva cifras, la aritmética tiene que cerrar.',
].join('\n');

/** Encabeza el bloque de marca de un encargo. */
function bloqueDeMarca(): string[] {
  return ['REFERENCIAS DE MARCA (obligatorias, MARCA.md + DESIGN.md):', ...REFERENCIAS_DE_MARCA.map((r) => `  · ${r}`)];
}

/** El encargo de la pieza gráfica. PURO. */
export function armarEncargoVisual(b: BeneficioVerificado, lunes: string): string {
  const l: string[] = [
    `ENCARGO VISUAL — semana del ${lunes}`,
    '',
    `Pieza: ${b.titulo}`,
    `Formato: 1080x1350 (feed, el que más rinde) y 1080x1920 (story/reel, zona segura 14% arriba y 20% abajo).`,
    'Modelo recomendado (MARCA.md §5): `nano_banana_2` si la pieza va SIN texto quemado (generaciones ilimitadas, costo cero). Si el copy va quemado en la imagen, `gpt_image_2` con quality "low" y 1k, y se sube la calidad SOLO en la pieza ya aprobada.',
    '',
    'COPY DE LA PIEZA (verificado contra el producto, no redactado de memoria):',
    `  titular: ${b.titulo}`,
    `  cuerpo: ${b.copy}`,
    `  respaldo medido en esta corrida: ${b.respaldo.medido}`,
    `  fundamento al pie: ${b.fundamento.join(' · ')}`,
    '',
    ...bloqueDeMarca(),
    '',
    'PROMPT LISTO (pegar en la skill `likida-post`):',
    `  Composición estilo papel recortado sobre crema #EDE4D3. Escena del mundo del viaje en naranja ladrillo #E24A1B como acento menor (máximo 15% del cuadro): ${b.titulo.toLowerCase()}. Estructura y tipografía en azul marino #2A3F5F. Textura de papel, halftone suave, sombra dura de recorte. DEJAR un espacio rectangular VACÍO en la esquina inferior derecha para componer el logo oficial encima; NO dibujar ningún logo. Sin personas identificables salvo que se indique. Sin texto en la imagen si se usa nano_banana_2.`,
    '',
    SIN_PIPELINE_DE_RENDER,
    'Toda pieza deja rastro en bitacora-visuales.md (fecha, slug, modelo, créditos, quién aprobó, canal).',
    PIE_TAP_DE_JAVIER,
  ];
  return l.join('\n');
}

/** El encargo del video de demo. PURO. */
export function armarEncargoVideoDemo(b: BeneficioVerificado, lunes: string): string {
  const l: string[] = [
    `ENCARGO DE VIDEO DEMO — semana del ${lunes}`,
    '',
    'Para qué es: el video que se manda ANTES de la llamada. Su trabajo no es impresionar, es que el contralor llegue a la llamada sabiendo qué hace el producto.',
    `Eje de esta semana: ${b.titulo}`,
    '',
    'GUION DE 45 SEGUNDOS (narración ElevenLabs con la voz de Javier):',
    `  0:00-0:03 hook: ${b.copy.split('. ')[0]}.`,
    `  0:03-0:20 el problema, con la condición que casi nadie cumple: ${b.copy}`,
    `  0:20-0:38 la PRUEBA: captura de la UI real haciendo el trabajo. Papel abre, producto cierra (MARCA.md §2.3) — esta parte NO se ilustra, se graba de la pantalla.`,
    '  0:38-0:45 cierre: Likida entrega el dato y la bitácora; quien acredita es tu contador.',
    '',
    `Respaldo del eje (medido en esta corrida): ${b.respaldo.medido}`,
    `Fundamento en pantalla: ${b.fundamento.join(' · ')}`,
    '',
    'CADENA (MARCA.md §6, seis etapas): guion → character sheets → lugares sheets → sequence sheets → ANIMACIÓN (aquí vive el gate de Javier: autoriza sequence por sequence, y aprobar una sequence ES autorizar el gasto de animarla) → ensamblaje.',
    'Motor de animación: `seedance_2_0` en std + 480p con audio (el upscale va SOLO al corte final: se ahorra en píxeles, NO en modo).',
    '',
    ...bloqueDeMarca(),
    '',
    SIN_PIPELINE_DE_RENDER,
    PIE_TAP_DE_JAVIER,
  ];
  return l.join('\n');
}

/** El encargo del reel de marketing. PURO. */
export function armarEncargoVideoMarketing(a: Articulo, lunes: string): string {
  const escenas = parrafosDe(a, 3);
  const l: string[] = [
    `ENCARGO DE REEL PARA EL GREMIO — semana del ${lunes}`,
    '',
    `Pieza de origen: el artículo publicado «${a.titulo}» (${appUrl()}/blog/${a.slug}).`,
    `Fundamento que va citado en pantalla: ${a.fundamento.join(' · ')}`,
    'Formato: 1080x1920, zona segura 14% arriba y 20% abajo. Canales: LinkedIn, Instagram y TikTok.',
    '',
    'ESTRUCTURA (30 segundos):',
    `  hook (3 s): ${a.resumen.split('. ')[0]}.`,
  ];
  escenas.forEach((texto, i) => {
    l.push(`  beat ${i + 1}: ${texto.split('. ').slice(0, 2).join('. ')}.`);
  });
  l.push(`  cierre: el artículo completo en ${appUrl()}/blog/${a.slug}`);
  l.push('');
  l.push('Motor (MARCA.md §5-6): sheets en `gpt_image_2` con la skill `sequence-sheet`, animación en `seedance_2_0` std/480p, narración SIEMPRE ElevenLabs. El gate de Javier vive en la animación, sequence por sequence.');
  l.push('');
  l.push(...bloqueDeMarca());
  l.push('');
  l.push('POR QUÉ SALE DE UN ARTÍCULO PUBLICADO Y NO DE UNA IDEA NUEVA: el artículo ya pasó las reglas editoriales de la casa en CI (sin "clientes reales", sin "hasta un X%", sin guiones largos, con fundamento citado). Un reel destilado de él hereda esa verificación; uno inventado desde cero no hereda nada.');
  l.push('');
  l.push(SIN_PIPELINE_DE_RENDER);
  l.push(PIE_TAP_DE_JAVIER);
  return l.join('\n');
}

async function correrEncargoVisual(disparo: DisparoCorrida, hoy: string): Promise<ResultadoCrecimiento> {
  const inicio = new Date();
  const agente = 'visuales';
  const lunes = lunesDe(hoy);
  const titulo = `Encargo visual — semana del ${lunes}`;
  try {
    if (await piezaExistente(agente, titulo)) {
      await anotarCorrida(agente, inicio, 'ok', disparo, { pieza: 'ya_existia', titulo });
      return yaEstaba(agente, 'el encargo visual de esta semana');
    }
    const b = beneficioDelDia(beneficiosVerificados(hoy), lunes);
    if (b === null) {
      await anotarCorrida(agente, inicio, 'ok', disparo, { pieza: 'ninguna', motivo: 'sin beneficios verificables' });
      return { resultado: 'corrio', piezas: 0, motivo: 'ningún beneficio pudo verificarse contra el motor — no se encarga una pieza gráfica sobre una afirmación sin respaldo', costoUsd: 0 };
    }
    const res = await encolarPiezaCrecimiento(agente, 'encargo_visual', titulo, armarEncargoVisual(b, lunes), {
      semana: lunes, beneficio: b.clave, respaldo: b.respaldo,
      genera_imagen: false,
      consultas: ['marketing/calculadora.ts (motor real, sonda)', 'MARCA.md §2-§5', 'DESIGN.md'],
    });
    await anotarCorrida(agente, inicio, 'ok', disparo, { pieza: res, beneficio: b.clave });
    return { resultado: 'corrio', piezas: res === 'encolada' ? 1 : 0, motivo: res === 'ya_existia' ? 'otra corrida ganó la semana' : undefined, costoUsd: 0 };
  } catch (e) {
    await anotarCorrida(agente, inicio, 'fallo', disparo, { titulo }, {
      error: `No se pudo armar el encargo visual: ${e instanceof Error ? e.message : String(e)}`.slice(0, 500),
    });
    throw e;
  }
}

async function correrVideoDemo(disparo: DisparoCorrida, hoy: string): Promise<ResultadoCrecimiento> {
  const inicio = new Date();
  const agente = 'video_demo';
  const lunes = lunesDe(hoy);
  const titulo = `Encargo de video demo — semana del ${lunes}`;
  try {
    if (await piezaExistente(agente, titulo)) {
      await anotarCorrida(agente, inicio, 'ok', disparo, { pieza: 'ya_existia', titulo });
      return yaEstaba(agente, 'el encargo del video demo de esta semana');
    }
    const b = beneficioDelDia(beneficiosVerificados(hoy), masDias(lunes, 1));
    if (b === null) {
      await anotarCorrida(agente, inicio, 'ok', disparo, { pieza: 'ninguna', motivo: 'sin beneficios verificables' });
      return { resultado: 'corrio', piezas: 0, motivo: 'ningún beneficio pudo verificarse contra el motor — no se encarga un demo sobre una afirmación sin respaldo', costoUsd: 0 };
    }
    const res = await encolarPiezaCrecimiento(agente, 'encargo_video_demo', titulo, armarEncargoVideoDemo(b, lunes), {
      semana: lunes, beneficio: b.clave, respaldo: b.respaldo,
      genera_video: false,
      consultas: ['marketing/calculadora.ts (motor real, sonda)', 'MARCA.md §5-§6'],
    });
    await anotarCorrida(agente, inicio, 'ok', disparo, { pieza: res, beneficio: b.clave });
    return { resultado: 'corrio', piezas: res === 'encolada' ? 1 : 0, motivo: res === 'ya_existia' ? 'otra corrida ganó la semana' : undefined, costoUsd: 0 };
  } catch (e) {
    await anotarCorrida(agente, inicio, 'fallo', disparo, { titulo }, {
      error: `No se pudo armar el encargo del video demo: ${e instanceof Error ? e.message : String(e)}`.slice(0, 500),
    });
    throw e;
  }
}

async function correrVideoMarketing(disparo: DisparoCorrida, hoy: string): Promise<ResultadoCrecimiento> {
  const inicio = new Date();
  const agente = 'video_marketing';
  const lunes = lunesDe(hoy);
  const titulo = `Encargo de reel — semana del ${lunes}`;
  try {
    if (await piezaExistente(agente, titulo)) {
      await anotarCorrida(agente, inicio, 'ok', disparo, { pieza: 'ya_existia', titulo });
      return yaEstaba(agente, 'el encargo del reel de esta semana');
    }
    // El reel toma el artículo SIGUIENTE al del guion de la semana: si los dos
    // tomaran el mismo, la bandeja recibiría dos encargos del mismo tema el
    // mismo lunes y uno de los dos sobraría.
    const a = articuloDeLaSemana(ARTICULOS, masDias(lunes, 7));
    if (a === null) {
      await anotarCorrida(agente, inicio, 'ok', disparo, { pieza: 'ninguna', motivo: 'sin artículos publicados' });
      return { resultado: 'corrio', piezas: 0, motivo: 'no hay artículos publicados de los cuales destilar el reel — un reel inventado no hereda ninguna verificación', costoUsd: 0 };
    }
    const res = await encolarPiezaCrecimiento(agente, 'encargo_video_marketing', titulo, armarEncargoVideoMarketing(a, lunes), {
      semana: lunes, articulo: a.slug, fundamento: a.fundamento,
      genera_video: false,
      consultas: ['marketing/articulos.ts (colección publicada)', 'MARCA.md §5-§6'],
    });
    await anotarCorrida(agente, inicio, 'ok', disparo, { pieza: res, articulo: a.slug });
    return { resultado: 'corrio', piezas: res === 'encolada' ? 1 : 0, motivo: res === 'ya_existia' ? 'otra corrida ganó la semana' : undefined, costoUsd: 0 };
  } catch (e) {
    await anotarCorrida(agente, inicio, 'fallo', disparo, { titulo }, {
      error: `No se pudo armar el encargo del reel: ${e instanceof Error ? e.message : String(e)}`.slice(0, 500),
    });
    throw e;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 7 · ALIANZAS Y GREMIO — el siguiente toque, con lo que el sistema YA sabe.
//
// LO QUE ESTE AGENTE NO HACE, Y ES LA MITAD DE SU DISEÑO: no inventa un
// contacto. Ni un nombre, ni un correo, ni un teléfono, ni «el director de
// afiliación de CANACAR». Los aliados objetivo viven en `aliado_objetivo`
// (0230), declarados por una persona y sembrados SIN datos de contacto; si un
// aliado no tiene contacto capturado, el parte dice «sin contacto capturado» y
// el siguiente paso es conseguirlo, no fingirlo.
//
// El MATERIAL del acercamiento sí sale de datos reales: los prospectos ya
// capturados en el censo, agregados por ciudad. Eso es lo que Likida puede
// llevarle a un gremio sin inventar nada.
// ═══════════════════════════════════════════════════════════════════════════

/** Aliados que una corrida lee. La lista es declarativa y corta por diseño. */
export const TOPE_ALIADOS = 200;
/** Prospectos que se agregan para el material del toque. */
export const TOPE_PROSPECTOS_MAPA = 5_000;
/** Ciudades que se enseñan en el parte. */
export const TOP_CIUDADES = 5;

export interface AliadoObjetivo {
  id: string;
  nombre: string;
  tipo: string;
  estado: string;
  /** `null` = nunca se le tocó. NO es «hace mucho»: es que no consta. */
  ultimoToqueEn: string | null;
  /** `null` = sin contacto capturado. Jamás se rellena. */
  contactoNota: string | null;
  notas: string | null;
}

export interface MapaCiudades {
  /** Prospectos vivos leídos (no duplicados). */
  total: number;
  /** Cuántos NO traen ciudad capturada — se dice, no se reparte. */
  sinCiudad: number;
  /**
   * El ranking de plazas.
   *
   *  · `[…]` = el top REAL, contado sobre el censo entero.
   *  · `[]`  = no hay ni una ciudad capturada. Es un hecho medido.
   *  · `null` = NO SE PUEDE AFIRMAR UN RANKING, y el parte lo dice en vez de
   *    publicar uno. Los tres valores son distintos y el parte los distingue.
   *
   * AUDITORÍA CICLO 7, c7-4 (crítico): esto era `Array<…>` a secas y se
   * calculaba sobre una rebanada arbitraria de 5,000 de 33,071 prospectos.
   * Nuevo Laredo, Manzanillo y Puebla —tres de las cinco plazas reales—
   * desaparecían del parte, y entraban tres que no lo eran. La línea «LECTURA
   * TRUNCADA … las cifras de arriba son un PISO» era cierta para el total y
   * FALSA para el orden: un ranking derivado de una muestra arbitraria no es
   * el piso de nada, es otro ranking.
   */
  top: Array<{ ciudad: string; n: number }> | null;
  truncado: boolean;
}

/**
 * El mapa por ciudad, PURO sobre las filas ya leídas.
 *
 * SOLO se usa en el camino de respaldo (ver `leerMapaCiudades`): el camino
 * normal cuenta en la base. Y por eso lo primero que hace es lo más
 * importante: si la lectura vino TRUNCADA, el ranking se declara imposible
 * (`top: null`) en vez de devolver el orden de la rebanada. Contar sobre
 * 5,000 de 33,071 filas tomadas en orden físico produce un orden que se
 * parece a un dato y no lo es.
 */
export function armarMapaCiudades(filas: Array<{ ciudad: string | null }>, truncado: boolean): MapaCiudades {
  const acc = new Map<string, number>();
  let sinCiudad = 0;
  for (const f of filas) {
    const c = (f.ciudad ?? '').trim();
    if (!c) { sinCiudad += 1; continue; }
    acc.set(c, (acc.get(c) ?? 0) + 1);
  }
  const top = truncado ? null : [...acc.entries()]
    .map(([ciudad, n]) => ({ ciudad, n }))
    .sort((a, b) => b.n - a.n || a.ciudad.localeCompare(b.ciudad))
    .slice(0, TOP_CIUDADES);
  return { total: filas.length, sinCiudad, top, truncado };
}

/** A quién le toca el siguiente toque: el que lleva más tiempo sin uno (los
 *  que NUNCA se tocaron van primero), y solo entre los que siguen abiertos.
 *  PURA y determinista — empates por id. */
export function siguienteToque(aliados: AliadoObjetivo[]): AliadoObjetivo | null {
  const vivos = aliados.filter((a) => a.estado !== 'descartado' && a.estado !== 'aliado');
  if (vivos.length === 0) return null;
  return [...vivos].sort((x, y) => {
    if (x.ultimoToqueEn === null && y.ultimoToqueEn !== null) return -1;
    if (y.ultimoToqueEn === null && x.ultimoToqueEn !== null) return 1;
    if (x.ultimoToqueEn !== null && y.ultimoToqueEn !== null) {
      const c = x.ultimoToqueEn.localeCompare(y.ultimoToqueEn);
      if (c !== 0) return c;
    }
    return x.id.localeCompare(y.id);
  })[0];
}

/** El parte de alianzas. PURO. */
export function armarParteAlianzas(
  aliados: AliadoObjetivo[], toque: AliadoObjetivo | null, mapa: MapaCiudades, lunes: string,
): string {
  const l: string[] = [
    `ALIANZAS Y GREMIO — semana del ${lunes}`,
    '',
  ];
  if (aliados.length === 0) {
    l.push('LA LISTA DE ALIADOS OBJETIVO ESTÁ VACÍA. La tabla contestó y no trajo filas: o nadie ha declarado un aliado, o se borraron. Este agente NO inventa uno para llenar el parte.');
  } else {
    l.push(`LISTA DE ALIADOS OBJETIVO (${numero(aliados.length)}):`);
    for (const a of aliados) {
      const toqueTxt = a.ultimoToqueEn === null ? 'NUNCA SE LE HA TOCADO (no consta ningún acercamiento)' : `último toque: ${a.ultimoToqueEn}`;
      const contacto = a.contactoNota === null ? 'SIN CONTACTO CAPTURADO' : a.contactoNota;
      l.push(`  · ${a.nombre} [${a.tipo}] — estado: ${a.estado} · ${toqueTxt} · contacto: ${contacto}`);
    }
  }
  l.push('');
  if (toque === null) {
    l.push('SIN SIGUIENTE TOQUE PROPUESTO: no queda ningún aliado objetivo abierto (todos están descartados o ya son aliados). Que la lista se acabe es una decisión de negocio, no un hueco que este agente rellene.');
  } else {
    l.push(`EL SIGUIENTE TOQUE: ${toque.nombre}`);
    l.push(`  por qué le toca: ${toque.ultimoToqueEn === null ? 'no consta un solo acercamiento previo — es el que lleva más tiempo sin tocarse por definición' : `es el toque más viejo de la lista (${toque.ultimoToqueEn})`}.`);
    l.push(`  a quién: ${toque.contactoNota ?? 'SIN CONTACTO CAPTURADO. El primer paso es conseguir el contacto por el directorio público del gremio. Este agente NO inventa un nombre ni un correo, y nadie debería escribirle a un contacto que salió de una máquina.'}`);
    if (toque.notas) l.push(`  contexto declarado: ${toque.notas}`);
    l.push('');
    l.push('  QUÉ LLEVARLE (lo que Likida SÍ puede sostener hoy, sin adornos):');
    l.push('    · Una calculadora pública de recuperación fiscal que entrega litros elegibles y el 50% de peaje con sus condiciones y supuestos a la vista, sin pedir datos para ver el resultado.');
    l.push('    · Un corpus de fichas normativas verificadas contra fuente primaria, con la jerarquía y el estado de verificación de cada una.');
    l.push('    · Contenido fiscal para el gremio, con fundamento citado por pieza.');
    l.push('    · La verdad de la tracción: Likida está en pláticas con transportistas como Grupo GAL y Transportes Innovativos. NINGUNA empresa ha firmado, y decirlo así es lo que hace creíble todo lo anterior.');
    l.push('');
    l.push('  EL MAPA QUE YA TENEMOS CAPTURADO (material real del acercamiento):');
    l.push(`    · ${numero(mapa.total)} prospecto(s) vivos en el directorio del censo.`);
    if (mapa.sinCiudad > 0) {
      l.push(`    · ${numero(mapa.sinCiudad)} de ellos NO traen ciudad capturada. No se reparten entre las demás: un prospecto sin ciudad no vive en ninguna.`);
    }
    if (mapa.top === null) {
      // c7-4: lo que va aquí NO es un ranking peor, es la ausencia de ranking
      // dicha entera. El total sí se afirma (viene de un `count` exacto); el
      // orden no, porque salió de una rebanada arbitraria del censo.
      l.push(`    · NO SE PUBLICA UN RANKING DE PLAZAS: la lectura se truncó a ${numero(TOPE_PROSPECTOS_MAPA)} prospectos de los ${numero(mapa.total)} vivos, y un orden sacado de una rebanada arbitraria del censo NO es el top real ni un piso de él. El conteo por plaza se hace en la base y esta corrida no lo pudo hacer, así que este agente prefiere no decir nada a decir un orden que no puede sostener.`);
    } else if (mapa.top.length === 0) {
      l.push('    · Ni una sola ciudad capturada: el mapa por plaza no se puede armar todavía.');
    } else {
      l.push(`    · Plazas con más prospectos capturados: ${mapa.top.map((c) => `${c.ciudad} (${numero(c.n)})`).join(' · ')}. Es el top REAL: contado sobre el censo entero en la base, no sobre una muestra.`);
    }
  }
  l.push('');
  l.push('LO QUE ESTE AGENTE NO HIZO: no buscó contactos, no consultó directorios externos, no le escribió a nadie y no propuso un nombre propio que no estuviera ya capturado. Los aliados objetivo los declara una persona en `aliado_objetivo`; este agente los lee, ordena el turno y prepara el material.');
  l.push('Fuentes: aliado_objetivo (lista declarada) · prospecto (directorio ya capturado, agregado por ciudad).');
  l.push(PIE_TAP_DE_JAVIER);
  return l.join('\n');
}

/** Los aliados objetivo. LANZA si no se pueden leer: un parte de alianzas
 *  sobre una tabla ciega diría «no hay a quién tocar». */
async function leerAliados(): Promise<AliadoObjetivo[]> {
  const { data, error } = await acotada(supabaseAdmin()
    .from('aliado_objetivo')
    .select('id, nombre, tipo, estado, ultimo_toque_en, contacto_nota, notas')
    .order('id')
    .limit(TOPE_ALIADOS), 'crecimiento.aliados');
  if (error) throw new Error(`leerAliados: ${error.message}`);
  return ((data ?? []) as Array<Record<string, unknown>>).map((f) => ({
    id: String(f.id),
    nombre: String(f.nombre),
    tipo: String(f.tipo),
    estado: String(f.estado),
    ultimoToqueEn: (f.ultimo_toque_en as string | null) ?? null,
    contactoNota: (f.contacto_nota as string | null) ?? null,
    notas: (f.notas as string | null) ?? null,
  }));
}

/**
 * El directorio ya capturado, agregado por ciudad. LANZA ante error.
 *
 * SE CUENTA EN LA BASE, no en JS. AUDITORÍA CICLO 7, c7-4 (crítico): esto
 * traía 5,000 filas de `prospecto` SIN `order` y contaba las ciudades sobre
 * esa rebanada. Con 33,071 prospectos vivos en producción eso es el 15% del
 * censo, contiguo por orden de importación, y el «top-5» que salía al parte no
 * tenía nada que ver con el real:
 *
 *   parte : Tijuana 159 · Aguascalientes 142 · Guadalajara 110 · Apodaca 86 · Mexicali 77
 *   real  : Tijuana 928 · Nuevo Laredo 689 · Manzanillo 629 · Guadalajara 561 · Puebla 537
 *
 * Un `.order()` no lo arreglaba —ordenar una muestra sesgada da una muestra
 * sesgada ordenada—, así que la agregación se mudó a `prospecto_mapa_ciudades`
 * (mig. 0238), que cuenta las 33,071 y devuelve total, sin-ciudad y top-N sobre
 * la MISMA foto.
 *
 * EL CAMINO DE RESPALDO, y por qué no es un fail-open: si la función todavía no
 * existe en esta base (un despliegue que se adelantó a su migración), se cae al
 * lector viejo — pero declarando `truncado`, con lo que `armarMapaCiudades`
 * devuelve `top: null` y el parte dice que NO puede publicar un ranking. O sea
 * que el respaldo degrada a «no lo sé», nunca a «aquí está un ranking». Y
 * cualquier otro error de base sigue LANZANDO: un parte de alianzas sobre una
 * tabla ciega diría cifras de un censo que no leyó.
 */
async function leerMapaCiudades(): Promise<MapaCiudades> {
  const { data, error } = await acotada(
    supabaseAdmin().rpc('prospecto_mapa_ciudades', { p_top: TOP_CIUDADES }),
    'crecimiento.mapa_ciudades',
  );
  if (error) {
    // 42883 = `undefined_function` de Postgres; PGRST202 = PostgREST no la
    // encontró en su caché de esquema. Son las DOS formas en que se manifiesta
    // «la 0238 todavía no está aplicada aquí», y ninguna otra.
    const codigo = String((error as { code?: unknown }).code ?? '');
    if (codigo !== '42883' && codigo !== 'PGRST202') {
      throw new Error(`leerMapaCiudades: ${error.message}`);
    }
    logger.warn('crecimiento.mapa_ciudades_sin_rpc', { err: error.message.slice(0, 160) });
    return await leerMapaCiudadesTruncado();
  }
  const m = (data ?? {}) as { total?: unknown; sin_ciudad?: unknown; top?: unknown };
  const total = Number(m.total ?? NaN);
  const sinCiudad = Number(m.sin_ciudad ?? NaN);
  if (!Number.isFinite(total) || !Number.isFinite(sinCiudad) || !Array.isArray(m.top)) {
    // La función contestó algo que no es su contrato. No se rellena con ceros:
    // «no se pudo medir» no es «no hay prospectos».
    throw new Error('leerMapaCiudades: `prospecto_mapa_ciudades` no devolvió el objeto esperado — no se afirma un censo que nadie contó.');
  }
  return {
    total,
    sinCiudad,
    top: (m.top as Array<{ ciudad?: unknown; n?: unknown }>).map((c) => ({ ciudad: String(c.ciudad), n: Number(c.n) })),
    truncado: false,
  };
}

/** El lector viejo, degradado a propósito: trae el conteo exacto (que sí se
 *  puede afirmar) y marca `truncado`, lo que APAGA el ranking. Solo se usa
 *  cuando la RPC de la 0238 no está en esta base. */
async function leerMapaCiudadesTruncado(): Promise<MapaCiudades> {
  const { data, error, count } = await acotada(supabaseAdmin()
    .from('prospecto')
    .select('ciudad', { count: 'exact' })
    .is('duplicado_de', null)
    .neq('estado', 'perdido')
    .limit(TOPE_PROSPECTOS_MAPA), 'crecimiento.mapa_ciudades_respaldo');
  if (error) throw new Error(`leerMapaCiudades: ${error.message}`);
  const filas = (data ?? []) as Array<{ ciudad: string | null }>;
  const total = typeof count === 'number' ? count : filas.length;
  const truncado = typeof count === 'number' ? count > filas.length : filas.length >= TOPE_PROSPECTOS_MAPA;
  // El TOTAL sí se puede afirmar: viene de un `count: 'exact'` sobre el censo
  // entero. Lo que no se puede afirmar es el ORDEN, y de eso se encarga
  // `truncado`.
  return { ...armarMapaCiudades(filas, truncado), total };
}

async function correrAlianzas(disparo: DisparoCorrida, hoy: string): Promise<ResultadoCrecimiento> {
  const inicio = new Date();
  const agente = 'alianzas';
  const lunes = lunesDe(hoy);
  const titulo = `Alianzas — semana del ${lunes}`;
  try {
    if (await piezaExistente(agente, titulo)) {
      await anotarCorrida(agente, inicio, 'ok', disparo, { pieza: 'ya_existia', titulo });
      return yaEstaba(agente, 'el parte de alianzas de esta semana');
    }
    const [aliados, mapa] = await Promise.all([leerAliados(), leerMapaCiudades()]);
    const toque = siguienteToque(aliados);
    const res = await encolarPiezaCrecimiento(agente, 'toque_alianza', titulo, armarParteAlianzas(aliados, toque, mapa, lunes), {
      semana: lunes,
      aliados: aliados.map((a) => a.id),
      siguiente_toque: toque?.id ?? null,
      con_contacto: toque?.contactoNota !== null && toque?.contactoNota !== undefined,
      prospectos_leidos: mapa.total, truncado: mapa.truncado,
      // Queda ESCRITO en la pieza si el ranking se publicó o no: quien la lea
      // dentro de un año tiene que poder distinguir «esta semana no había
      // ciudades» de «esta semana no se pudo contar el censo» (c7-4).
      ranking_publicado: mapa.top !== null,
      consultas: ['aliado_objetivo', 'prospecto_mapa_ciudades (conteo por ciudad en la base, mig. 0238)'],
    });
    await anotarCorrida(agente, inicio, 'ok', disparo, { pieza: res, aliados: aliados.length, toque: toque?.id ?? null });
    return { resultado: 'corrio', piezas: res === 'encolada' ? 1 : 0, motivo: res === 'ya_existia' ? 'otra corrida ganó la semana' : undefined, costoUsd: 0 };
  } catch (e) {
    await anotarCorrida(agente, inicio, 'fallo', disparo, { titulo }, {
      error: `No se pudo armar el parte de alianzas: ${e instanceof Error ? e.message : String(e)}`.slice(0, 500),
    });
    throw e;
  }
}

// ── El despacho que el runner llama ────────────────────────────────────────

/**
 * UNA corrida de un agente de crecimiento. `contenido_fiscal` se delega por
 * import DINÁMICO: es el único que arrastra el cliente del modelo y el corpus
 * de normas, y las otras nueve pasadas del runner no tienen por qué pagarlo.
 */
export async function correrAgenteCrecimiento(
  id: AgenteCrecimiento,
  disparo: DisparoCorrida = 'cron',
  hoy: string = hoyMx(),
): Promise<ResultadoCrecimiento> {
  logger.info('crecimiento.corrida', { agente: id, disparo });
  switch (id) {
    case 'lead_magnet': return correrLeadMagnet(disparo, hoy);
    case 'seo_distribucion': return correrSeoDistribucion(disparo, hoy);
    case 'guiones': return correrGuiones(disparo, hoy);
    case 'noticias_mercado': return correrNoticiasMercado(disparo, hoy);
    case 'promos_diarias': return correrPromosDiarias(disparo, hoy);
    case 'visuales': return correrEncargoVisual(disparo, hoy);
    case 'video_demo': return correrVideoDemo(disparo, hoy);
    case 'video_marketing': return correrVideoMarketing(disparo, hoy);
    case 'alianzas': return correrAlianzas(disparo, hoy);
    case 'contenido_fiscal': {
      const { correrContenidoFiscal } = await import('./contenido');
      return correrContenidoFiscal(disparo, hoy);
    }
  }
}
