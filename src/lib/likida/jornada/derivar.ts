import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { inicioDiaMx, finDiaMx } from '@/lib/formato';
import { acotada } from '../presupuesto';
import { asegurarDiaJornada, asentarMarca, diaMxDe } from './repo';

// ═══════════════════════════════════════════════════════════════════════════
// EL DERIVADOR — convertir lo que Likida YA sabe en marcas con origen.
//
// La flota tiene hitos de viaje y posiciones de GPS desde hace meses. Lo que no
// tenía es un registro de jornada. Este motor cierra esa distancia SIN inventar
// una hora: cada marca que asienta lleva `procedencia` y `origen_ref`, o sea el
// hecho exacto del que se dedujo, y el resto del sistema la trata como lo que
// es — una observación, no una declaración del operador.
//
// ── LO QUE DERIVA, Y LO QUE SE NIEGA A DERIVAR ───────────────────────────
//
//   · `viaje.aceptado_en` → inicio_jornada. Aceptar un viaje por WhatsApp ES un
//     acto de trabajo con hora exacta. Se deriva.
//   · Primera y última posición GPS del día → inicio y fin de jornada. Prueban
//     que la unidad se movió; son una COTA INFERIOR de la jornada real.
//   · `llegada_en` / `descarga_en` / `regreso_en` → NADA. «Ya llegué» no es
//     «empecé a trabajar»: el chofer manejó horas antes de llegar. Derivar el
//     inicio de un hito de llegada acortaría la jornada registrada, y una
//     jornada acortada por el sistema es un documento que favorece al patrón
//     con una hora que nadie declaró. Es exactamente lo que no se hace.
//
// ── POR QUÉ UNA MARCA DERIVADA NO PUEDE DAR CARTA LIMPIA ─────────────────
//
// Una cota inferior sirve para probar el exceso y NO para descartarlo: si con
// la primera posición del GPS ya salen trece horas, la jornada real fue de
// trece o más. Pero si salen nueve, la real pudo ser de catorce. Por eso
// `riesgo.ts` NUNCA emite `sin_senal_de_exceso` sobre un día con puntas
// derivadas — devuelve `dato_insuficiente`. La derivación levanta banderas;
// nunca las baja.
//
// ── Y POR QUÉ LA DECLARACIÓN LE GANA SIN UN SOLO `if` ────────────────────
//
// El índice `jornada_asiento_marca_unica` (0241) admite UN inicio y UN fin
// vivos por día. Si el operador ya declaró el suyo, el insert derivado rebota
// con 23505 y `asentarMarca` devuelve `ya_estaba`. La precedencia es una
// restricción de la base, no una comparación en este archivo.
// ═══════════════════════════════════════════════════════════════════════════

/** Cuántos días hacia atrás barre una corrida. Los hitos y las posiciones no
 *  cambian retroactivamente; tres días cubren un fin de semana con el cron
 *  caído sin volver a recorrer el mes entero cada hora. */
export const DIAS_QUE_BARRE = 3;

/** Tope de viajes que una corrida toma. El reloj corta antes que esto en una
 *  flota grande; el tope existe para que la CONSULTA tampoco crezca sin
 *  límite. */
export const TOPE_VIAJES_POR_CORRIDA = 400;

/**
 * El margen que la derivación deja libre del `maxDuration` del cron para lo
 * que corre después en la misma invocación. Mismo criterio que
 * `PLAZO_ESCALACION_MS` de `escalar_viaje.ts`.
 */
export const PLAZO_DERIVACION_MS = 45_000;

export interface ResultadoDerivacion {
  /** Pares (operador, día) que la corrida se propuso revisar. */
  revisados: number;
  asentados: number;
  yaEstaban: number;
  fallos: string[];
  /** Pares que el reloj de la corrida dejó SIN intentar. No se pierden: nada
   *  se les marcó y la corrida siguiente los encabeza. */
  cortadosPorReloj: number;
  /** Días con unidad asignada y CERO posiciones de GPS. Se cuenta y se dice:
   *  «no hubo de dónde derivar» no es lo mismo que «no había jornada». */
  diasSinGps: number;
  /**
   * `true` si la ventana trajo tantos viajes como el tope y NO cupo entera.
   *
   * SE DICE PORQUE SI NO, EL CRON MIENTE EN VERDE. La lista sale ordenada por
   * `aceptado_en` ascendente, así que una ventana que rebasa el tope devuelve
   * SIEMPRE los mismos viajes más viejos —ya asentados, todos `ya_estaba`— y
   * los recientes no se derivan nunca. Sin este campo el latido saldría `ok`,
   * con cero fallos y cero cortes por reloj, mientras el registro de jornada de
   * los últimos días se queda vacío: exactamente el modo de falla silenciosa
   * que `leerJornadas` ya cierra con su `truncada`.
   */
  listaTruncada: boolean;
}

interface Trabajo {
  tenantId: string;
  operadorId: string;
  unidadId: string | null;
  dia: string;
  /** El instante de `aceptado_en` si cae en este día. */
  aceptadoEn: string | null;
  viajeId: string;
}

/**
 * Arma la lista de trabajo: un renglón por (operador, día) tocado por un viaje
 * de la ventana.
 *
 * Se lee de `viaje` y no de `jornada_dia` a propósito: el expediente todavía no
 * existe — crearlo es justo lo que este motor hace. Y se ancla siempre por
 * `tenant_id` de la propia fila, nunca por un id que venga de fuera.
 */
async function listaDeTrabajo(
  desde: string,
  hasta: string,
): Promise<{ trabajos: Trabajo[]; truncada: boolean; error: string | null }> {
  const { data, error } = await acotada(
    supabaseAdmin().from('viaje')
      .select('id, tenant_id, operador_id, unidad_id, aceptado_en, fecha_inicio')
      .not('aceptado_en', 'is', null)
      .gte('aceptado_en', inicioDiaMx(desde))
      .lte('aceptado_en', finDiaMx(hasta))
      .order('aceptado_en', { ascending: true })
      .limit(TOPE_VIAJES_POR_CORRIDA),
    'jornada.derivar.viajes',
  );
  if (error) return { trabajos: [], truncada: false, error: error.message };

  type Fila = {
    id: string; tenant_id: string; operador_id: string;
    unidad_id: string | null; aceptado_en: string;
  };
  const filas = (data ?? []) as unknown as Fila[];
  // Tocar el tope significa que la ventana NO cupo. Se mide sobre los viajes
  // crudos, antes de deduplicar por (operador, día): es la consulta la que se
  // recortó, no la lista de trabajo.
  const truncada = filas.length >= TOPE_VIAJES_POR_CORRIDA;
  const vistos = new Set<string>();
  const trabajos: Trabajo[] = [];
  for (const f of filas) {
    const dia = diaMxDe(new Date(f.aceptado_en));
    const llave = `${f.tenant_id}|${f.operador_id}|${dia}`;
    if (vistos.has(llave)) continue;   // un operador tiene un expediente por día
    vistos.add(llave);
    trabajos.push({
      tenantId: String(f.tenant_id),
      operadorId: String(f.operador_id),
      unidadId: f.unidad_id ? String(f.unidad_id) : null,
      dia,
      aceptadoEn: f.aceptado_en,
      viajeId: String(f.id),
    });
  }
  return { trabajos, truncada, error: null };
}

/** La primera y la última posición de una unidad en un día de México. */
async function extremosGps(
  tenantId: string,
  unidadId: string,
  dia: string,
): Promise<{ primera: string | null; ultima: string | null; error: string | null }> {
  const admin = supabaseAdmin();
  const desde = inicioDiaMx(dia);
  const hasta = finDiaMx(dia);
  const base = () => admin.from('posicion').select('medida_en')
    .eq('tenant_id', tenantId).eq('unidad_id', unidadId)
    .gte('medida_en', desde).lte('medida_en', hasta);

  const pri = await acotada(base().order('medida_en', { ascending: true }).limit(1).maybeSingle(), 'jornada.gps.primera');
  if (pri.error) return { primera: null, ultima: null, error: pri.error.message };
  const ult = await acotada(base().order('medida_en', { ascending: false }).limit(1).maybeSingle(), 'jornada.gps.ultima');
  if (ult.error) return { primera: null, ultima: null, error: ult.error.message };

  return {
    primera: pri.data ? String((pri.data as { medida_en: string }).medida_en) : null,
    ultima: ult.data ? String((ult.data as { medida_en: string }).medida_en) : null,
    error: null,
  };
}

/**
 * Corre la derivación sobre la ventana.
 *
 * ── EL RELOJ (patrón del PR #152 / ESC-3) ────────────────────────────────
 *
 * `venceEn` es el `Date.now()` a partir del cual la corrida deja de tomar
 * trabajo NUEVO. El corte va ANTES de tocar un par (operador, día), nunca a
 * medias: lo que no alcanzó queda intacto y la corrida siguiente lo encabeza.
 *
 * Y LO DICE. `cortadosPorReloj` viaja en el resultado y el cron lo pone en la
 * respuesta HTTP, no solo en el log. El runner de producción ya murió mudo dos
 * veces por un motor que se quedaba sin turno sin que nadie se enterara: una
 * corrida que no termina su trabajo y contesta 200 es un cron verde que miente.
 */
export async function derivarJornadas(args: {
  ahora?: Date;
  venceEn?: number;
  dias?: number;
} = {}): Promise<ResultadoDerivacion> {
  const ahora = args.ahora ?? new Date();
  const dias = args.dias ?? DIAS_QUE_BARRE;
  const hasta = diaMxDe(ahora);
  const desde = diaMxDe(new Date(ahora.getTime() - (dias - 1) * 86_400_000));

  const r: ResultadoDerivacion = {
    revisados: 0, asentados: 0, yaEstaban: 0, fallos: [], cortadosPorReloj: 0,
    diasSinGps: 0, listaTruncada: false,
  };

  const { trabajos, truncada, error } = await listaDeTrabajo(desde, hasta);
  if (error) {
    // Fallar cerrado y DECIRLO: sin la lista de trabajo no hay nada que
    // derivar, y devolver un resultado en ceros se leería como «no había nada
    // que hacer». Lanza para que el cron pinte rojo.
    throw new Error(`derivarJornadas: no se pudo leer la lista de trabajo: ${error}`);
  }
  r.revisados = trabajos.length;
  r.listaTruncada = truncada;
  if (truncada) {
    // WARN, no info: es una corrida que NO barrió su ventana. El cron la pinta
    // `parcial` para que no salga verde una pasada que dejó días sin derivar.
    logger.warn('jornada.derivar.lista_truncada', {
      tope: TOPE_VIAJES_POR_CORRIDA, desde, hasta,
    });
  }

  let intentados = 0;
  for (const t of trabajos) {
    if (args.venceEn !== undefined && Date.now() >= args.venceEn) {
      r.cortadosPorReloj = trabajos.length - intentados;
      logger.warn('jornada.derivar.corte_por_reloj', { pendientes: r.cortadosPorReloj, desde, hasta });
      break;
    }
    intentados++;

    const expediente = await asegurarDiaJornada(t.tenantId, t.operadorId, t.dia);
    if ('error' in expediente) {
      r.fallos.push(`expediente ${t.operadorId}/${t.dia}: ${expediente.error}`);
      continue;
    }
    const jornadaId = expediente.id;

    // ── (a) El inicio derivado del hito de aceptación del viaje ───────────
    if (t.aceptadoEn) {
      const res = await asentarMarca({
        jornadaId,
        tenantId: t.tenantId,
        tipo: 'inicio_jornada',
        momento: new Date(t.aceptadoEn),
        procedencia: 'hito_viaje',
        origenRef: `viaje:${t.viajeId}:aceptado_en`,
        viajeId: t.viajeId,
        unidadId: t.unidadId,
        detalle: { hecho: 'el operador aceptó el viaje por WhatsApp', cota: 'inferior' },
      });
      contar(r, res, `inicio hito ${t.viajeId}`);
    }

    // ── (b) Los extremos del GPS de la unidad ─────────────────────────────
    if (!t.unidadId) continue;
    const gps = await extremosGps(t.tenantId, t.unidadId, t.dia);
    if (gps.error) {
      r.fallos.push(`gps ${t.unidadId}/${t.dia}: ${gps.error}`);
      continue;
    }
    if (gps.primera === null) {
      // Se CUENTA. Que no haya posiciones no significa que no hubo jornada:
      // significa que no hubo de dónde derivarla, y el panel lo dice.
      r.diasSinGps++;
      continue;
    }

    const res1 = await asentarMarca({
      jornadaId,
      tenantId: t.tenantId,
      tipo: 'inicio_jornada',
      momento: new Date(gps.primera),
      procedencia: 'gps',
      origenRef: `gps:${t.unidadId}:${t.dia}:primera`,
      unidadId: t.unidadId,
      viajeId: t.viajeId,
      detalle: { hecho: 'primera posición de la unidad ese día', cota: 'inferior' },
    });
    contar(r, res1, `inicio gps ${t.unidadId}/${t.dia}`);

    if (gps.ultima !== null && gps.ultima !== gps.primera) {
      const res2 = await asentarMarca({
        jornadaId,
        tenantId: t.tenantId,
        tipo: 'fin_jornada',
        momento: new Date(gps.ultima),
        procedencia: 'gps',
        origenRef: `gps:${t.unidadId}:${t.dia}:ultima`,
        unidadId: t.unidadId,
        viajeId: t.viajeId,
        detalle: { hecho: 'última posición de la unidad ese día', cota: 'inferior' },
      });
      contar(r, res2, `fin gps ${t.unidadId}/${t.dia}`);
    }
  }

  return r;
}

function contar(r: ResultadoDerivacion, res: 'asentado' | 'ya_estaba' | 'fallo', etiqueta: string): void {
  if (res === 'asentado') r.asentados++;
  else if (res === 'ya_estaba') r.yaEstaban++;
  else r.fallos.push(etiqueta);
}
