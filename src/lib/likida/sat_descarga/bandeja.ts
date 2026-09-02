// ═══════════════════════════════════════════════════════════════════════════
// LA BANDEJA DE CONCILIACIÓN: LAS FILAS, NO EL CONTEO (0243).
//
// La pantalla de descarga enseñaba cinco cifras y una tarjeta que decía
// «Esperan que tú decidas». No había lista, así que no había forma de saber
// CUÁLES esperan ni de decidir nada. Esto trae las filas.
//
// ─────────────────────────────────────────────────────────────────────────
// SE PAGINA EN LA BASE, NO EN JAVASCRIPT.
//
// La propia 0231 dice que el modo web service trae hasta 200,000 CFDI POR
// PETICIÓN. Traer todo y cortar con `.slice()` es exactamente el hallazgo
// c7-27 —los conteos que se hacían sobre 20,000 filas traídas a mano y salían
// falsos sin decirlo— con otra cara. Aquí:
//
//   · `.range()` pide SOLO la página (una petición, un rango de filas);
//   · `count: 'exact'` trae el total MEDIDO en la misma llamada, no estimado;
//   · `.order()` es explícito y con desempate por `id`, porque un `.limit()`
//     sin orden estable hace que la página 2 repita o se salte filas cuando
//     dos comprobantes comparten fecha (hallazgo c7-4);
//   · y el orden que se pide es EXACTAMENTE el del índice
//     `sat_cfdi_descargado_bandeja_idx` (0243).
//
// Y cuando la lista no alcanza a llegar hasta el final, LO DICE: hay un tope
// de páginas, y una lista truncada que no se declara truncada es una lista
// inventada.
// ═══════════════════════════════════════════════════════════════════════════

import { supabaseAdmin } from '@/lib/supabase/admin';
import { acotada } from '@/lib/likida/presupuesto';
import { logger } from '@/lib/logger';

/** Los cuatro estatus del CHECK `sat_cfdi_descargado_estatus_dominio` (0231). */
export const ESTATUS_CFDI = ['ambiguo', 'disponible', 'casado', 'ignorado'] as const;
export type EstatusCfdi = (typeof ESTATUS_CFDI)[number];

export function esEstatusCfdi(v: unknown): v is EstatusCfdi {
  return typeof v === 'string' && (ESTATUS_CFDI as readonly string[]).includes(v);
}

/** Filas por página. 25 es lo que ya usan los registros del panel
 *  (`paginar-registro.ts`), y una bandeja de decisión se lee, no se hojea. */
export const POR_PAGINA = 25;

/**
 * Hasta qué página llega esta lista.
 *
 * `.range()` sobre un desplazamiento profundo obliga a Postgres a contar y
 * tirar todas las filas anteriores: la página 4,000 de una flota con 200,000
 * comprobantes no es una página, es un timeout. En vez de fingir que existe,
 * la lista se corta aquí Y LA PANTALLA LO DECLARA con el total exacto al lado,
 * para que nadie confunda «hasta aquí llega la lista» con «esto es todo lo que
 * hay». El camino para lo que queda es filtrar por estatus o resolver lo de
 * arriba: la cola de trabajo se vacía por el frente, no por el final.
 */
export const PAGINA_MAX = 200;

/** Cuántos ids de gasto se resuelven en vivo por página. 25 filas × varios
 *  candidatos cada una cabe de sobra; el tope existe para que una fila con
 *  `candidatos` corrupto no arme una petición inmanejable. */
const MAX_CANDIDATOS_VIVOS = 300;

/**
 * Cuántos renglones de expediente (`sat_cfdi_resolucion`) se traen de una
 * vez para TODA la página (D-1, auditoría E.28).
 *
 * DELIBERADAMENTE menor al `max_rows` de PostgREST (1,000, `config.toml`):
 * así el tope que se alcanza es SIEMPRE el nuestro —explícito, con su propia
 * bandera— y nunca el recorte silencioso del proveedor. 25 comprobantes por
 * página con un expediente típico de un puñado de actos cabe de sobra en 500;
 * si algún día no cabe, `PaginaBandeja.historialTruncado` lo dice.
 */
const MAX_ACTOS_HISTORIAL = 500;

/** Un gasto que el motor ofreció como candidato de un cruce ambiguo. */
export interface CandidatoVista {
  gastoId: string;
  /** Lo que el motor ANOTÓ el día del cruce (la foto de `candidatos`). */
  montoOfrecido: number | null;
  fechaOfrecida: string | null;
  conceptoOfrecido: string | null;
  /**
   * `true` = el gasto sigue ahí; `false` = ya no existe (se borró el viaje);
   * `null` = NO SE PUDO LEER. Los tres son distintos y la pantalla los pinta
   * distinto: ofrecer un botón «elegir éste» sobre un gasto que no se pudo
   * comprobar sería afirmar que existe.
   */
  vive: boolean | null;
  montoHoy: number | null;
  fechaHoy: string | null;
  conceptoHoy: string | null;
  /** `true` = ese gasto YA tiene comprobante (llegó por otro camino), así que
   *  elegirlo no va a poder ligarse. `null` = no se pudo leer. */
  yaTieneCfdi: boolean | null;
}

/** Un renglón del expediente: qué se decidió sobre este comprobante. */
export interface ActoResolucion {
  acto: 'ligado' | 'ignorado' | 'revertido' | 'degradado';
  gastoId: string | null;
  estatusAntes: string;
  estatusDespues: string;
  motivo: string | null;
  /** `null` SOLO en `degradado`: ahí no decidió una persona, sino la base. */
  actorEmail: string | null;
  creadoEn: string;
}

export interface FilaBandeja {
  id: string;
  cfdiUuid: string;
  rfcEmisor: string | null;
  rfcReceptor: string | null;
  /** `null` = el CFDI no traía total legible. No es 0. */
  total: number | null;
  fecha: string | null;
  tipoComprobante: string | null;
  estatus: EstatusCfdi;
  gastoId: string | null;
  /** Por qué quedó así, si el motor lo dijo (`candidatos.motivo`). */
  motivo: string | null;
  candidatos: CandidatoVista[];
  /** Quién lo resolvió A MANO. `null` = lo decidió el cruce automático. */
  resueltoPorEmail: string | null;
  resueltoEn: string | null;
  bajadoEn: string;
  /** El expediente completo de este comprobante, del más nuevo al más viejo. */
  historial: ActoResolucion[];
}

export interface PaginaBandeja {
  filas: FilaBandeja[];
  estatus: EstatusCfdi;
  pagina: number;
  porPagina: number;
  /** Total EXACTO de comprobantes en ese estatus. `null` = no se pudo contar,
   *  y la pantalla lo dice en vez de pintar 0. */
  total: number | null;
  /** La última página que esta lista alcanza a servir. */
  paginaMax: number;
  /** `true` cuando hay comprobantes MÁS ALLÁ de `paginaMax`: la lista está
   *  truncada y se declara truncada. */
  truncada: boolean;
  /** `true` si alguna lectura secundaria (candidatos vivos, expediente) falló:
   *  las filas están, pero lo que cuelga de ellas puede faltar. */
  incompleta: boolean;
  /** Total EXACTO de renglones de expediente (`sat_cfdi_resolucion`) para los
   *  comprobantes de ESTA página, medido con `count: 'exact'` en la misma
   *  consulta que trae `hidratarHistorial` (D-1, auditoría E.28). `null` = no
   *  se pudo medir — no es «sin historial». Compárese con la suma de
   *  `filas[].historial.length`, que es lo que de verdad se trajo. */
  historialTotal: number | null;
  /** `true` cuando el expediente combinado de esta página rebasa el tope que
   *  se trae de una vez (`MAX_ACTOS_HISTORIAL`): hay actos que no se están
   *  enseñando en ninguna fila. Antes de la 0243+D-1 esto lo recortaba
   *  PostgREST en silencio a 1,000 (`max_rows`, config.toml) sin encender
   *  ninguna bandera; ahora el tope es explícito y menor, y esto se declara
   *  en vez de fingir que se trajo todo. */
  historialTruncado: boolean;
  /** El mensaje de la falla cuando la consulta PRINCIPAL no respondió. `null`
   *  no es «no hay comprobantes»: `filas` vacío con `error` puesto es «no se
   *  pudo preguntar», y eso jamás se pinta como bandeja limpia. */
  error: string | null;
}

/** Lee un entero de searchParams, acotado. Un valor basura cae al mínimo. */
export function paginaPedida(valor: string | undefined): number {
  const n = Number.parseInt((valor ?? '').trim(), 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, PAGINA_MAX);
}

/** Los candidatos que el motor anotó, de la columna `candidatos jsonb`.
 *
 *  La forma que escribe el ciclo es `{"candidatos":[{gastoId,monto,fecha,
 *  concepto}]}` (ciclo.ts) y para un `disponible` es `{"motivo":"…"}`. Se lee
 *  a la defensiva y se DESCARTA lo que no tenga forma de candidato en vez de
 *  adivinar: un candidato sin `gastoId` no es un gasto al que se pueda ligar
 *  nada, y ofrecerlo en pantalla sería ofrecer un botón que no puede funcionar.
 */
export function candidatosAnotados(valor: unknown): Array<{
  gastoId: string; monto: number | null; fecha: string | null; concepto: string | null;
}> {
  if (valor === null || typeof valor !== 'object' || Array.isArray(valor)) return [];
  const lista = (valor as Record<string, unknown>).candidatos;
  if (!Array.isArray(lista)) return [];
  const salida: Array<{ gastoId: string; monto: number | null; fecha: string | null; concepto: string | null }> = [];
  for (const c of lista) {
    if (c === null || typeof c !== 'object' || Array.isArray(c)) continue;
    const o = c as Record<string, unknown>;
    const id = typeof o.gastoId === 'string' ? o.gastoId : null;
    if (id === null || id === '') continue;
    salida.push({
      gastoId: id,
      monto: typeof o.monto === 'number' && Number.isFinite(o.monto) ? o.monto : null,
      fecha: typeof o.fecha === 'string' && o.fecha !== '' ? o.fecha : null,
      concepto: typeof o.concepto === 'string' && o.concepto !== '' ? o.concepto : null,
    });
  }
  return salida;
}

/** El `motivo` que el motor (o el trigger de la 0236) dejó escrito. */
export function motivoAnotado(valor: unknown): string | null {
  if (valor === null || typeof valor !== 'object' || Array.isArray(valor)) return null;
  const m = (valor as Record<string, unknown>).motivo;
  return typeof m === 'string' && m.trim() !== '' ? m : null;
}

const COLUMNAS =
  'id, cfdi_uuid, rfc_emisor, rfc_receptor, total, fecha, tipo_comprobante, '
  + 'estatus, gasto_id, candidatos, resuelto_por_email, resuelto_en, created_at';

/**
 * Una página de la bandeja, de un solo estatus.
 *
 * SE PIDE UN ESTATUS A LA VEZ y no «todos» porque los cuatro son colas de
 * trabajo distintas: 'ambiguo' es «elige cuál», 'disponible' es «nadie reportó
 * este gasto», 'casado' es la memoria de lo que ya cerró y 'ignorado' el
 * archivo. Mezclarlos daría una lista sin acción común, que es la lista que
 * nadie abre dos veces.
 */
export async function leerBandeja(
  tenantId: string,
  estatus: EstatusCfdi,
  pagina: number,
): Promise<PaginaBandeja> {
  const pag = Math.max(1, Math.min(Math.trunc(pagina) || 1, PAGINA_MAX));
  const desde = (pag - 1) * POR_PAGINA;
  const vacia: PaginaBandeja = {
    filas: [], estatus, pagina: pag, porPagina: POR_PAGINA, total: null,
    paginaMax: PAGINA_MAX, truncada: false, incompleta: false,
    historialTotal: null, historialTruncado: false, error: null,
  };

  let crudas: Array<Record<string, unknown>> = [];
  let total: number | null = null;
  try {
    // El `count: 'exact'` viaja EN LA MISMA petición que las filas: un conteo
    // aparte podría medir un instante distinto del que se está pintando.
    const { data, error, count } = await acotada(supabaseAdmin()
      .from('sat_cfdi_descargado')
      .select(COLUMNAS, { count: 'exact' })
      .eq('tenant_id', tenantId)
      .eq('estatus', estatus)
      // El orden del índice `sat_cfdi_descargado_bandeja_idx` (0243), con
      // desempate por id: sin él la paginación no es reproducible.
      .order('fecha', { ascending: false, nullsFirst: false })
      .order('id', { ascending: false })
      .range(desde, desde + POR_PAGINA - 1), 'sat_descarga.bandeja');
    if (error) throw new Error(error.message);
    crudas = (data ?? []) as unknown as Array<Record<string, unknown>>;
    // `count` en null NO es cero: es «la base no lo dijo».
    total = typeof count === 'number' ? count : null;
  } catch (e) {
    const detalle = e instanceof Error ? e.message : String(e);
    logger.warn('sat_descarga.bandeja_no_leida', { tenantId, estatus, err: detalle });
    return { ...vacia, error: detalle };
  }

  const filas: FilaBandeja[] = crudas.map((f) => ({
    id: f.id as string,
    cfdiUuid: f.cfdi_uuid as string,
    rfcEmisor: (f.rfc_emisor as string) || null,
    rfcReceptor: (f.rfc_receptor as string) || null,
    total: f.total === null || f.total === undefined ? null : Number(f.total),
    fecha: (f.fecha as string) || null,
    tipoComprobante: (f.tipo_comprobante as string) || null,
    estatus: f.estatus as EstatusCfdi,
    gastoId: (f.gasto_id as string) || null,
    motivo: motivoAnotado(f.candidatos),
    candidatos: candidatosAnotados(f.candidatos).map((c) => ({
      gastoId: c.gastoId,
      montoOfrecido: c.monto,
      fechaOfrecida: c.fecha,
      conceptoOfrecido: c.concepto,
      vive: null, montoHoy: null, fechaHoy: null, conceptoHoy: null, yaTieneCfdi: null,
    })),
    resueltoPorEmail: (f.resuelto_por_email as string) || null,
    resueltoEn: (f.resuelto_en as string) || null,
    bajadoEn: f.created_at as string,
    historial: [],
  }));

  let incompleta = false;
  let historialTotal: number | null = null;
  let historialTruncado = false;
  if (filas.length > 0) {
    // Las dos lecturas que COLGABAN de las filas van en paralelo y cada una
    // cae por su lado: que el expediente no se pueda leer no puede esconder
    // los candidatos, ni al revés.
    const [okVivos, historial] = await Promise.all([
      hidratarCandidatos(tenantId, filas),
      hidratarHistorial(tenantId, filas),
    ]);
    incompleta = !okVivos || !historial.ok;
    historialTotal = historial.total;
    // Lo que de verdad se trajo, sumado de las filas — nunca de un `.length`
    // sobre la respuesta cruda, que el `.limit()` ya recortó.
    const historialMostrado = filas.reduce((acc, f) => acc + f.historial.length, 0);
    historialTruncado = historialTotal !== null && historialTotal > historialMostrado;
  }

  const truncada = total !== null && total > PAGINA_MAX * POR_PAGINA;
  return { ...vacia, filas, total, truncada, incompleta, historialTotal, historialTruncado };
}

/**
 * Trae el estado DE HOY de cada gasto candidato.
 *
 * `candidatos` es una FOTO del día del cruce: el gasto pudo cambiar de monto,
 * pudo recibir su comprobante por otro camino o pudo desaparecer con su viaje.
 * Enseñar solo la foto haría que el contralor eligiera un gasto que ya no
 * acepta comprobante y se llevara un rechazo sin explicación. Se enseñan las
 * dos cosas: lo que el motor ofreció y lo que hay ahora.
 *
 * Devuelve `false` si la lectura falló — y entonces cada candidato se queda
 * con `vive: null`, que la pantalla pinta como «no se pudo comprobar», jamás
 * como «no existe».
 */
async function hidratarCandidatos(tenantId: string, filas: FilaBandeja[]): Promise<boolean> {
  const ids = [...new Set(filas.flatMap((f) => f.candidatos.map((c) => c.gastoId)))];
  if (ids.length === 0) return true;
  if (ids.length > MAX_CANDIDATOS_VIVOS) {
    logger.warn('sat_descarga.bandeja_candidatos_desbordados', { tenantId, candidatos: ids.length });
    return false;
  }
  try {
    // `.in()` con una lista EXPLÍCITA de ids: la respuesta es completa por
    // construcción, no recortada — por eso aquí no hace falta `.limit()` (y
    // por eso tampoco haría falta un `.order()` que lo acompañara).
    const { data, error } = await acotada(supabaseAdmin()
      .from('gasto')
      .select('id, monto, fecha, concepto, cfdi_uuid')
      .eq('tenant_id', tenantId)
      .in('id', ids), 'sat_descarga.bandeja_candidatos');
    if (error) throw new Error(error.message);
    const vivos = new Map<string, Record<string, unknown>>(
      ((data ?? []) as Array<Record<string, unknown>>).map((g) => [g.id as string, g]));
    for (const f of filas) {
      for (const c of f.candidatos) {
        const g = vivos.get(c.gastoId);
        if (g === undefined) { c.vive = false; continue; }
        c.vive = true;
        c.montoHoy = g.monto === null || g.monto === undefined ? null : Number(g.monto);
        c.fechaHoy = (g.fecha as string) || null;
        c.conceptoHoy = (g.concepto as string) || null;
        c.yaTieneCfdi = Boolean(g.cfdi_uuid);
      }
    }
    return true;
  } catch (e) {
    logger.warn('sat_descarga.bandeja_candidatos_no_leidos', {
      tenantId, err: e instanceof Error ? e.message : String(e),
    });
    return false;
  }
}

/**
 * El expediente de los comprobantes de esta página (0243).
 *
 * ACOTADA EXPLÍCITAMENTE (D-1, auditoría E.28) — igual que su vecina
 * `hidratarCandidatos` acota por `MAX_CANDIDATOS_VIVOS`, esta acota por
 * `MAX_ACTOS_HISTORIAL`. Antes no llevaba `.limit()`: PostgREST recortaba en
 * silencio a `max_rows` (1,000, `supabase/config.toml`) sin encender ninguna
 * bandera de truncamiento — si el expediente combinado de los 25
 * comprobantes de una página superaba eso, algunas filas se pintaban
 * incompletas sin que nadie lo notara. El `count: 'exact'` viaja en la MISMA
 * consulta (mismo patrón que `leerBandeja`, arriba) para que el llamador
 * sepa la M verdadera y pueda decir «mostrando N de M» en vez de fingir que
 * trajo todo. El `.order()` ya llevaba desempate por `id` — eso no cambia.
 */
async function hidratarHistorial(
  tenantId: string,
  filas: FilaBandeja[],
): Promise<{ ok: boolean; total: number | null }> {
  const ids = filas.map((f) => f.id);
  try {
    const { data, error, count } = await acotada(supabaseAdmin()
      .from('sat_cfdi_resolucion')
      .select('cfdi_id, acto, gasto_id, estatus_antes, estatus_despues, motivo, actor_email, creado_en', { count: 'exact' })
      .eq('tenant_id', tenantId)
      .in('cfdi_id', ids)
      .order('creado_en', { ascending: false })
      .order('id', { ascending: false })
      .limit(MAX_ACTOS_HISTORIAL), 'sat_descarga.bandeja_historial');
    if (error) throw new Error(error.message);
    const porCfdi = new Map<string, ActoResolucion[]>();
    for (const r of (data ?? []) as Array<Record<string, unknown>>) {
      const lista = porCfdi.get(r.cfdi_id as string) ?? [];
      lista.push({
        acto: r.acto as ActoResolucion['acto'],
        gastoId: (r.gasto_id as string) || null,
        estatusAntes: r.estatus_antes as string,
        estatusDespues: r.estatus_despues as string,
        motivo: (r.motivo as string) || null,
        actorEmail: (r.actor_email as string) || null,
        creadoEn: r.creado_en as string,
      });
      porCfdi.set(r.cfdi_id as string, lista);
    }
    for (const f of filas) f.historial = porCfdi.get(f.id) ?? [];
    // `count` en null NO es cero: es «la base no lo dijo» (mismo criterio
    // que el `total` de `leerBandeja`).
    return { ok: true, total: typeof count === 'number' ? count : null };
  } catch (e) {
    logger.warn('sat_descarga.bandeja_historial_no_leido', {
      tenantId, err: e instanceof Error ? e.message : String(e),
    });
    return { ok: false, total: null };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// EL BUSCADOR DE GASTOS — para ligar un 'disponible' a mano.
//
// UN BUSCADOR, NO UNA LISTA DE TODO. Una flota mediana tiene decenas de miles
// de gastos: pintarlos todos en un `<select>` no es una interfaz, es una forma
// de que alguien elija el renglón equivocado. Se busca por lo que el contralor
// TIENE DELANTE cuando mira el comprobante —el importe y la fecha del CFDI— y
// se ofrece solo lo que puede recibir comprobante.
// ═══════════════════════════════════════════════════════════════════════════

export interface GastoCandidatoBusqueda {
  id: string;
  monto: number;
  fecha: string | null;
  concepto: string;
  rfcEmisor: string | null;
  folio: string | null;
}

export interface ResultadoBusquedaGastos {
  gastos: GastoCandidatoBusqueda[];
  /** `true` cuando había MÁS de los que caben: se dice, no se esconde. */
  truncada: boolean;
  error: string | null;
}

/** Cuántos gastos se ofrecen. Más de 20 en una lista de elegir-uno es ruido. */
export const MAX_BUSQUEDA_GASTOS = 20;

/** Tolerancia por defecto del importe, en pesos. El total del CFDI y el del
 *  ticket pueden diferir por redondeo de centavos, no por más. */
export const TOLERANCIA_IMPORTE = 1;

/**
 * Los gastos SIN comprobante que podrían corresponder a este CFDI.
 *
 * Todos los filtros son opcionales y ACUMULATIVOS. Sin ninguno devuelve los
 * más recientes sin comprobante — que es una respuesta honesta a «no sé por
 * dónde empezar», no una lista de todo.
 *
 * `.limit()` SIEMPRE CON `.order()`: una lista recortada sin orden estable es
 * una muestra arbitraria, y una muestra arbitraria presentada como «los
 * candidatos» es una cifra inventada (hallazgo c7-4).
 */
export async function buscarGastosParaLigar(
  tenantId: string,
  filtros: { importe?: number | null; desde?: string | null; hasta?: string | null; texto?: string | null } = {},
): Promise<ResultadoBusquedaGastos> {
  try {
    let q = supabaseAdmin()
      .from('gasto')
      .select('id, monto, fecha, concepto, rfc_emisor, folio')
      .eq('tenant_id', tenantId)
      // El fondo son los gastos que TODAVÍA no tienen comprobante: ofrecer uno
      // que ya lo tiene sería ofrecer un botón que la guardia optimista de
      // `ligar` va a rechazar de todas formas.
      .is('cfdi_uuid', null);

    if (typeof filtros.importe === 'number' && Number.isFinite(filtros.importe)) {
      q = q.gte('monto', filtros.importe - TOLERANCIA_IMPORTE)
           .lte('monto', filtros.importe + TOLERANCIA_IMPORTE);
    }
    if (filtros.desde) q = q.gte('fecha', filtros.desde);
    if (filtros.hasta) q = q.lte('fecha', filtros.hasta);
    if (filtros.texto && filtros.texto.trim() !== '') {
      const t = filtros.texto.trim();
      // `concepto` es un dominio cerrado (diesel/caseta/…), así que el texto
      // libre solo tiene sentido contra el folio y el RFC del emisor — que es
      // justo lo que se lee del ticket que está sobre la mesa.
      const seguro = t.replace(/[%,()]/g, ' ').slice(0, 60);
      q = q.or(`folio.ilike.%${seguro}%,rfc_emisor.ilike.%${seguro}%`);
    }

    // Se pide UNO DE MÁS para saber si había más sin tener que contar la tabla.
    const { data, error } = await acotada(
      q.order('fecha', { ascending: false, nullsFirst: false })
       .order('id', { ascending: false })
       .limit(MAX_BUSQUEDA_GASTOS + 1),
      'sat_descarga.buscar_gastos');
    if (error) throw new Error(error.message);
    const crudos = (data ?? []) as Array<Record<string, unknown>>;
    const truncada = crudos.length > MAX_BUSQUEDA_GASTOS;
    return {
      gastos: crudos.slice(0, MAX_BUSQUEDA_GASTOS).map((g) => ({
        id: g.id as string,
        monto: Number(g.monto),
        fecha: (g.fecha as string) || null,
        concepto: g.concepto as string,
        rfcEmisor: (g.rfc_emisor as string) || null,
        folio: (g.folio as string) || null,
      })),
      truncada,
      error: null,
    };
  } catch (e) {
    const detalle = e instanceof Error ? e.message : String(e);
    logger.warn('sat_descarga.buscar_gastos_fallo', { tenantId, err: detalle });
    // Lista vacía CON error: la pantalla dice «no se pudo buscar», nunca
    // «no hay ningún gasto que corresponda» — que es la conclusión
    // tranquilizadora que haría que nadie volviera a mirar.
    return { gastos: [], truncada: false, error: detalle };
  }
}
