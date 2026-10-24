// ═══════════════════════════════════════════════════════════════════════════
// LOS LECTORES DETERMINISTAS — la mitad que de verdad vigila.
//
// Una función por plantilla del catálogo. Cada una recibe el tenant y los
// parámetros YA validados, consulta la base, y devuelve los disparos con la
// evidencia de la fila que los provocó. Cero modelo, cero prosa generada: el
// aviso cita `folio`, `monto` y fechas que salieron de una consulta.
//
// TRES REGLAS QUE NO SE ROMPEN AQUÍ:
//
//  1. FAIL-CLOSED. Un error de lectura LANZA. Sin esto, una base con hipo se
//     leería como "no hay nada que avisar" y el dueño creería que su regla
//     está viva mientras el vigilante está ciego — el modo de falla que
//     `exigir()` documenta desde julio.
//  2. NULL ≠ 0. Una unidad sin póliza capturada NO está en regla: está sin
//     verificar, y eso se avisa diciendo exactamente eso. Un viaje sin hito
//     de llegada no tiene "cero horas de estadía": no tiene reloj, y no
//     dispara.
//  3. VENTANA DE ARRANQUE. Las plantillas que miran EVENTOS (un comprobante
//     que entró, un viaje que salió) solo miran los recientes. Una regla
//     declarada hoy no puede vomitar el histórico completo de la flota en un
//     WhatsApp: vigila de aquí en adelante, y la pantalla lo dice. Las que
//     miran ESTADO (un papel que vence, una factura sin cobrar, una
//     incidencia abierta) sí ven lo que hoy está mal, porque eso sigue mal.
// ═══════════════════════════════════════════════════════════════════════════
import { supabaseAdmin } from '@/lib/supabase/admin';
import { acotada } from '../presupuesto';
import { hoyMx } from '@/lib/formato';
import { mxn, usd } from '@/lib/formato';
import {
  type PlantillaId, type ParamsDe, type ObjetoVigilado,
  ROTULO_DOCUMENTO, ROTULO_CONCEPTO, DOCUMENTOS_UNIDAD,
} from './catalogo';

/** Un disparo: la fila que cumplió la regla, con su sello y su cita. */
export interface Disparo {
  objeto: ObjetoVigilado;
  objetoId: string;
  /**
   * El discriminador del CICLO, el mismo truco de la 0202: mientras la clave
   * no cambie, la regla avisa una sola vez sobre ese objeto. Cuando el ciclo
   * es nuevo —el papel se renovó con otra fecha, el chofer pasó de 2 a 3
   * viajes, empezó otra estadía— la clave cambia y vuelve a avisar.
   * Cadena vacía = el objeto mismo es el ciclo (un gasto solo entra una vez).
   */
  clave: string;
  /** La línea que va en el WhatsApp. Cifras MEDIDAS, jamás redactadas. */
  evidencia: string;
}

/** Cuánto hacia atrás miran las plantillas de EVENTO. Dos días cubre de sobra
 *  el hueco de una corrida horaria que falló y no reabre el histórico. */
export const VENTANA_EVENTO_MS = 48 * 3_600_000;

/** Piso duro de las plantillas de ESTADO: un año. Lo mismo que hace
 *  `avisarVencimientos` (c2-7) — sin piso, las filas viejas se comen el corte
 *  y lo NUEVO queda fuera sin que nadie lo declare. */
const PISO_DIAS = 366;

/** Tope de filas por consulta de los lectores que miran EVENTOS acotados por
 *  ventana. PostgREST recorta a 1,000 EN SILENCIO: pedir menos que eso deja el
 *  corte del lado de este archivo, donde se puede leer.
 *  OJO (A37-S56-04): el vigilante NO avisa si se rebasa — no existe señal de
 *  truncamiento. Por eso los lectores cuyo resultado se rompe con un recorte
 *  (conteo por chofer, viajes sin comprobante, suma del costo de IA) NO usan
 *  este tope: leen COMPLETO con `leerPaginado`. */
export const TOPE_CANDIDATOS = 400;

const PAGINA_LECTURA = 1_000;
/** 30 páginas = 30,000 filas; más que eso LANZA (fail-closed) en vez de medir de menos. */
const MAX_PAGINAS_LECTURA = 30;
/** Ids por tanda en un `.in()`: 50 uuid ≈ 1.9 KB de URL (A37-S56-03). */
const IDS_POR_TANDA = 50;

type RespLectura<T> = { data: T[] | null; error: { message: string } | null };

/**
 * Lee TODAS las filas de una consulta ordenada, por páginas de 1,000 con
 * `range`. La consulta debe traer un orden TOTAL (termina en `id`). Una fila
 * repetida por un desplazamiento entre páginas se descarta por `id` si la fila
 * lo trae; superar `MAX_PAGINAS_LECTURA` LANZA.
 */
async function leerPaginado<T extends { id?: string }>(
  construir: (desde: number, hasta: number) => PromiseLike<RespLectura<T>>,
  etiqueta: string,
): Promise<T[]> {
  const out: T[] = [];
  const vistos = new Set<string>();
  for (let pagina = 0; pagina < MAX_PAGINAS_LECTURA; pagina++) {
    const desde = pagina * PAGINA_LECTURA;
    const lote = exigirLectura(await acotada(construir(desde, desde + PAGINA_LECTURA - 1), `reglas.${etiqueta}`), etiqueta);
    for (const f of lote) {
      if (f.id !== undefined) { if (vistos.has(f.id)) continue; vistos.add(f.id); }
      out.push(f);
    }
    if (lote.length < PAGINA_LECTURA) return out;
  }
  throw new Error(`reglas.${etiqueta}: más de ${MAX_PAGINAS_LECTURA * PAGINA_LECTURA} filas; lectura incompleta`);
}

function iso(fecha: Date): string {
  return fecha.toISOString();
}

/** `YYYY-MM-DD` a N días de `hoy` (positivo = futuro). A mediodía UTC para
 *  esquivar husos, el mismo truco que `diasEntreIso`. */
function diaRelativo(hoy: string, dias: number): string {
  return new Date(Date.parse(`${hoy}T12:00:00Z`) + dias * 86_400_000).toISOString().slice(0, 10);
}

/** Horas entre dos instantes, con un decimal. */
export function horasEntre(desde: string, hasta: number): number {
  return Math.round(((hasta - Date.parse(desde)) / 3_600_000) * 10) / 10;
}

function exigirLectura<T>(r: { data: T[] | null; error: { message: string } | null }, etiqueta: string): T[] {
  if (r.error) throw new Error(`reglas.${etiqueta}: ${r.error.message}`);
  return r.data ?? [];
}

// ── 1. Unidad que sale con un papel vencido o sin capturar ─────────────────

/** La columna de `unidad` donde vive cada papel. */
const COLUMNA_UNIDAD: Record<(typeof DOCUMENTOS_UNIDAD)[number], string> = {
  poliza: 'poliza_vence',
  permiso_sict: 'permiso_sict_vence',
  verificacion: 'verificacion_vence',
};

async function unidadSinPapel(
  tenantId: string, p: ParamsDe<'unidad_sin_papel_vigente_al_despachar'>, ahora: Date,
): Promise<Disparo[]> {
  const hoy = hoyMx(ahora);
  const desde = diaRelativo(hoy, -7);   // despachos recientes: la ventana de evento, en días
  const columna = COLUMNA_UNIDAD[p.documento];
  // Los tres papeles se piden SIEMPRE, aunque la regla mire uno: un `select`
  // armado por interpolación no se puede tipar (PostgREST parsea la cadena en
  // el tipo) y el ahorro serían tres columnas `date` de la misma fila.
  const filas = exigirLectura(await acotada(supabaseAdmin()
    .from('viaje')
    .select('id, folio, fecha_inicio, unidad:unidad_id(id, numero_economico, poliza_vence, permiso_sict_vence, verificacion_vence)')
    .eq('tenant_id', tenantId)
    .neq('estatus', 'liquidado')
    .not('unidad_id', 'is', null)
    .gte('fecha_inicio', desde)
    .order('fecha_inicio', { ascending: false })
    .limit(TOPE_CANDIDATOS), 'reglas.papel_al_despachar'), 'papel_al_despachar') as unknown as Array<{
      id: string; folio: string | null; fecha_inicio: string | null;
      unidad: ({ id: string; numero_economico: string | null } & Record<string, unknown>) | null;
    }>;

  const papel = ROTULO_DOCUMENTO[p.documento];
  const out: Disparo[] = [];
  for (const v of filas) {
    if (!v.unidad) continue;
    const vence = v.unidad[columna];
    const economico = v.unidad.numero_economico || 'sin económico';
    const folio = v.folio || `viaje ${v.id.slice(0, 8)}`;
    // La referencia es la fecha de INICIO del viaje, no hoy: lo que importa es
    // si el papel estaba vigente cuando la unidad salió.
    const referencia = v.fecha_inicio ? String(v.fecha_inicio).slice(0, 10) : hoy;

    if (vence === null || vence === undefined) {
      out.push({
        objeto: 'viaje', objetoId: v.id, clave: 'sin_captura',
        evidencia: `${folio}: la unidad ${economico} salió el ${referencia} y NADIE le ha capturado la ${papel}. No es que esté en regla — es que no se sabe.`,
      });
      continue;
    }
    const fecha = String(vence).slice(0, 10);
    if (fecha < referencia) {
      out.push({
        objeto: 'viaje', objetoId: v.id, clave: fecha,
        evidencia: `${folio}: la unidad ${economico} salió el ${referencia} con la ${papel} vencida desde el ${fecha}.`,
      });
    }
  }
  return out;
}

// ── 2 y 3. Comprobantes por arriba de un tope ──────────────────────────────

async function gastosSobreTope(
  tenantId: string, ahora: Date,
  filtro: { concepto?: string; sinCfdi?: true; monto: number },
): Promise<Disparo[]> {
  const desde = iso(new Date(ahora.getTime() - VENTANA_EVENTO_MS));
  let q = supabaseAdmin()
    .from('gasto')
    .select('id, viaje_id, concepto, monto, fecha, folio, cfdi_uuid')
    .eq('tenant_id', tenantId)
    .gt('monto', filtro.monto)
    .gte('created_at', desde);
  if (filtro.concepto) q = q.eq('concepto', filtro.concepto);
  if (filtro.sinCfdi) q = q.is('cfdi_uuid', null);
  const filas = exigirLectura(await acotada(q
    .order('created_at', { ascending: false })
    .limit(TOPE_CANDIDATOS), 'reglas.gasto_tope'), 'gasto_tope') as Array<{
      id: string; viaje_id: string; concepto: string; monto: number | string;
      fecha: string | null; folio: string | null;
    }>;

  return filas.map((g) => {
    const monto = Number(g.monto);
    const rotulo = ROTULO_CONCEPTO[g.concepto as keyof typeof ROTULO_CONCEPTO] ?? g.concepto;
    const cuando = g.fecha ? ` del ${String(g.fecha).slice(0, 10)}` : '';
    const folio = g.folio ? ` (folio ${g.folio})` : '';
    return {
      objeto: 'gasto' as const, objetoId: g.id, clave: '',
      evidencia: filtro.sinCfdi
        ? `Comprobante SIN CFDI de ${mxn(monto)}${cuando}${folio}, concepto ${rotulo}, en el viaje ${g.viaje_id.slice(0, 8)}. Ese no se deduce.`
        : `${mxn(monto)} de ${rotulo}${cuando}${folio}, en el viaje ${g.viaje_id.slice(0, 8)} — arriba de tu tope de ${mxn(filtro.monto)}.`,
    };
  });
}

// ── 4. Chofer con N viajes sin liquidar ────────────────────────────────────

async function choferConViajes(
  tenantId: string, p: ParamsDe<'chofer_con_viajes_sin_liquidar'>,
): Promise<Disparo[]> {
  // A37-S56-04: se leen TODOS los viajes sin liquidar. Con un tope de 400 por
  // `created_at` ascendente, el operador cuyos viajes son todos recientes no
  // entraba a la lectura y su regla jamás disparaba.
  const filas = await leerPaginado<{
    id: string; folio: string | null; operador_id: string; operador: { nombre?: string } | null;
  }>((desde, hasta) => supabaseAdmin()
    .from('viaje')
    .select('id, folio, operador_id, operador:operador_id(nombre)')
    .eq('tenant_id', tenantId)
    .in('estatus', ['abierto', 'en_cuadre'])
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .range(desde, hasta) as unknown as PromiseLike<RespLectura<{
      id: string; folio: string | null; operador_id: string; operador: { nombre?: string } | null;
    }>>, 'viajes_sin_liquidar');

  const porOperador = new Map<string, { nombre: string; folios: string[]; idsAscenso: string[] }>();
  for (const v of filas) {
    const previo = porOperador.get(v.operador_id)
      ?? { nombre: v.operador?.nombre?.trim() || 'un chofer', folios: [], idsAscenso: [] };
    previo.folios.push(v.folio || v.id.slice(0, 8));
    // `filas` ya viene ordenada por created_at ascendente (ver el `.order`
    // arriba), así que idsAscenso[0] es SIEMPRE el viaje más viejo sin
    // liquidar de este operador.
    previo.idsAscenso.push(v.id);
    porOperador.set(v.operador_id, previo);
  }

  const out: Disparo[] = [];
  for (const [operadorId, { nombre, folios, idsAscenso }] of porOperador) {
    if (folios.length < p.n) continue;
    out.push({
      objeto: 'operador', objetoId: operadorId,
      // HALLAZGO 21-oct-2026: el conteo SOLO no basta como ciclo. El sello de
      // `regla_disparo` es PERMANENTE (sin TTL ni purga para esta tabla —
      // `purgarAvisosViejos` solo opera sobre `regla_aviso`), así que un
      // chofer que llega a 3 (sella clave='3'), baja a 2 (se liquida uno) y
      // vuelve a subir a 3 con un viaje DISTINTO repite el mismo conteo: el
      // sello ya existente lo lee como "ya avisado" y el problema —genuino,
      // con viajes distintos— nunca se vuelve a avisar.
      //
      // Fix: el ciclo es (conteo, viaje más viejo sin liquidar), no solo el
      // conteo. El viaje más viejo SÍ cambia cuando la racha se rompe y se
      // vuelve a acumular (la liquidación resuelve primero los viajes más
      // viejos — orden FIFO del propio query), y se mantiene igual mientras
      // la racha sigue siendo la MISMA (caso de control: 3 viajes que no
      // cambian no deben volver a avisar). No se rastrea estado nuevo: el id
      // ya viene en la fila que el lector ya trae.
      clave: `${folios.length}:${idsAscenso[0]}`,
      evidencia: `${nombre} lleva ${folios.length} viajes sin liquidar: ${folios.slice(0, 8).join(', ')}${folios.length > 8 ? '…' : ''}.`,
    });
  }
  return out;
}

// ── 5. Papel por vencer con la anticipación que el dueño eligió ────────────

async function documentoPorVencer(
  tenantId: string, p: ParamsDe<'documento_por_vencer'>, ahora: Date,
): Promise<Disparo[]> {
  const hoy = hoyMx(ahora);
  const horizonte = diaRelativo(hoy, p.dias);
  const piso = diaRelativo(hoy, -PISO_DIAS);
  const papel = ROTULO_DOCUMENTO[p.documento];

  if (p.documento === 'licencia') {
    const filas = exigirLectura(await acotada(supabaseAdmin()
      .from('operador')
      .select('id, nombre, licencia_vence')
      .eq('tenant_id', tenantId)
      .eq('activo', true)
      .gte('licencia_vence', piso)
      .lte('licencia_vence', horizonte)
      .order('licencia_vence', { ascending: true })
      .limit(TOPE_CANDIDATOS), 'reglas.licencia_por_vencer'), 'licencia_por_vencer') as Array<{
        id: string; nombre: string | null; licencia_vence: string | null;
      }>;
    return filas
      .filter((o) => typeof o.licencia_vence === 'string' && o.licencia_vence)
      .map((o) => {
        const vence = String(o.licencia_vence).slice(0, 10);
        return {
          objeto: 'operador' as const, objetoId: o.id, clave: vence,
          evidencia: vence < hoy
            ? `La ${papel} de ${o.nombre || 'un operador'} VENCIÓ el ${vence}.`
            : `La ${papel} de ${o.nombre || 'un operador'} vence el ${vence}.`,
        };
      });
  }

  const columna = COLUMNA_UNIDAD[p.documento];
  const filas = exigirLectura(await acotada(supabaseAdmin()
    .from('unidad')
    .select('id, numero_economico, poliza_vence, permiso_sict_vence, verificacion_vence')
    .eq('tenant_id', tenantId)
    .eq('activo', true)
    .gte(columna, piso)
    .lte(columna, horizonte)
    .order(columna, { ascending: true })
    .limit(TOPE_CANDIDATOS), 'reglas.papel_por_vencer'), 'papel_por_vencer') as unknown as Array<Record<string, unknown>>;

  return filas
    .filter((u) => typeof u[columna] === 'string' && u[columna])
    .map((u) => {
      const vence = String(u[columna]).slice(0, 10);
      const economico = (u.numero_economico as string) || 'sin económico';
      return {
        objeto: 'unidad' as const, objetoId: u.id as string, clave: vence,
        evidencia: vence < hoy
          ? `La ${papel} de la unidad ${economico} VENCIÓ el ${vence}.`
          : `La ${papel} de la unidad ${economico} vence el ${vence}.`,
      };
    });
}

// ── 6. Factura emitida que lleva mucho sin cobrarse ────────────────────────

async function facturaSinCobrar(
  tenantId: string, p: ParamsDe<'factura_sin_cobrar_mas_de'>, ahora: Date,
): Promise<Disparo[]> {
  const hoy = hoyMx(ahora);
  const corte = diaRelativo(hoy, -p.dias);
  const piso = diaRelativo(hoy, -(p.dias + PISO_DIAS));
  // 'emitida' y no "distinta de pagada": un borrador todavía no se cobra y una
  // cancelada ya no se va a cobrar. Decir "sin cobrar" de cualquiera de las
  // dos sería un rótulo falso.
  const filas = exigirLectura(await acotada(supabaseAdmin()
    .from('factura_emitida')
    .select('id, folio, serie, fecha, total, cliente:cliente_id(nombre)')
    .eq('tenant_id', tenantId)
    .eq('estatus', 'emitida')
    .lte('fecha', corte)
    .gte('fecha', piso)
    .order('fecha', { ascending: true })
    .limit(TOPE_CANDIDATOS), 'reglas.factura_sin_cobrar'), 'factura_sin_cobrar') as Array<{
      id: string; folio: string | null; serie: string | null; fecha: string;
      total: number | string; cliente: { nombre?: string } | null;
    }>;

  return filas.map((f) => {
    const dias = Math.round((Date.parse(`${hoy}T12:00:00Z`) - Date.parse(`${String(f.fecha).slice(0, 10)}T12:00:00Z`)) / 86_400_000);
    const nombre = f.cliente?.nombre?.trim() || 'un cliente';
    const folio = [f.serie, f.folio].filter(Boolean).join('-') || f.id.slice(0, 8);
    return {
      objeto: 'factura' as const, objetoId: f.id, clave: '',
      evidencia: `Factura ${folio} de ${nombre}, ${mxn(Number(f.total))}, emitida el ${String(f.fecha).slice(0, 10)}: ${dias} días sin cobrarse.`,
    };
  });
}

// ── 7. Estadía por arriba de N horas ───────────────────────────────────────

async function estadiaMayorA(
  tenantId: string, p: ParamsDe<'estadia_mayor_a'>, ahora: Date,
): Promise<Disparo[]> {
  // Piso de 30 días: una llegada sin descarga de hace medio año no es una
  // estadía en curso, es un hito que nadie cerró — y eso se ve en el panel,
  // no en un WhatsApp cada hora.
  const piso = iso(new Date(ahora.getTime() - 30 * 86_400_000));
  const filas = exigirLectura(await acotada(supabaseAdmin()
    .from('viaje')
    .select('id, folio, llegada_en, descarga_en, unidad:unidad_id(numero_economico)')
    .eq('tenant_id', tenantId)
    .not('llegada_en', 'is', null)
    .gte('llegada_en', piso)
    .order('llegada_en', { ascending: false })
    .limit(TOPE_CANDIDATOS), 'reglas.estadia'), 'estadia') as Array<{
      id: string; folio: string | null; llegada_en: string; descarga_en: string | null;
      unidad: { numero_economico?: string } | null;
    }>;

  const out: Disparo[] = [];
  for (const v of filas) {
    // El reloj corre hasta la descarga; si no hay descarga, corre hasta ahora.
    // Sin `llegada_en` no habría reloj — y esas filas ni llegan aquí.
    const hasta = v.descarga_en ? Date.parse(v.descarga_en) : ahora.getTime();
    const horas = horasEntre(v.llegada_en, hasta);
    if (!(horas > p.horas)) continue;
    const economico = v.unidad?.numero_economico?.trim();
    const quien = economico ? `la unidad ${economico}` : 'la unidad';
    const folio = v.folio || v.id.slice(0, 8);
    out.push({
      objeto: 'viaje', objetoId: v.id,
      // Un episodio nuevo = otra llegada. La llegada en la clave es lo que
      // hace que el segundo viaje al mismo cliente vuelva a avisar.
      clave: v.llegada_en,
      evidencia: v.descarga_en
        ? `${folio}: ${quien} estuvo ${horas} h en el cliente antes de que se sellara la descarga (llegó ${v.llegada_en.slice(0, 16).replace('T', ' ')}).`
        : `${folio}: ${quien} lleva ${horas} h en el cliente y la descarga sigue sin sellarse (llegó ${v.llegada_en.slice(0, 16).replace('T', ' ')}).`,
    });
  }
  return out;
}

// ── 8. Incidencia abierta más de N horas ───────────────────────────────────

async function incidenciaAbierta(
  tenantId: string, p: ParamsDe<'incidencia_abierta_mas_de'>, ahora: Date,
): Promise<Disparo[]> {
  const corte = iso(new Date(ahora.getTime() - p.horas * 3_600_000));
  const piso = iso(new Date(ahora.getTime() - 90 * 86_400_000));
  const filas = exigirLectura(await acotada(supabaseAdmin()
    .from('incidencia')
    .select('id, tipo, estado, descripcion, abierta_en')
    .eq('tenant_id', tenantId)
    .neq('estado', 'resuelta')
    .lte('abierta_en', corte)
    .gte('abierta_en', piso)
    .order('abierta_en', { ascending: true })
    .limit(TOPE_CANDIDATOS), 'reglas.incidencia_abierta'), 'incidencia_abierta') as Array<{
      id: string; tipo: string; estado: string; descripcion: string | null; abierta_en: string;
    }>;

  return filas.map((i) => ({
    objeto: 'incidencia' as const, objetoId: i.id, clave: '',
    evidencia: `Incidencia de ${i.tipo} abierta desde el ${i.abierta_en.slice(0, 16).replace('T', ' ')} (${horasEntre(i.abierta_en, ahora.getTime())} h), sigue en «${i.estado}»${i.descripcion ? `: ${i.descripcion.slice(0, 120)}` : ''}.`,
  }));
}

/**
 * Cuáles de estos viajes tienen AL MENOS un gasto. A37-S56-03: antes una sola
 * consulta con hasta 400 uuid en la URL y `.limit(1_000)` sin orden; con ~10
 * gastos por viaje, PostgREST cortaba y los viajes cuyos gastos quedaron fuera
 * salían como «CERO comprobantes», sellados para siempre. Ahora va por tandas
 * de `IDS_POR_TANDA`; si una tanda vuelve LLENA (pudo cortarse), se parte a la
 * mitad hasta que cada mitad cabe, o queda un solo viaje (una fila basta).
 */
async function viajesConGasto(tenantId: string, ids: string[]): Promise<Set<string>> {
  const tienen = new Set<string>();
  const pendientes: string[][] = [];
  for (let i = 0; i < ids.length; i += IDS_POR_TANDA) pendientes.push(ids.slice(i, i + IDS_POR_TANDA));
  while (pendientes.length > 0) {
    const tanda = pendientes.pop() as string[];
    const filas = exigirLectura(await acotada(supabaseAdmin()
      .from('gasto')
      .select('id, viaje_id')
      .eq('tenant_id', tenantId)
      .in('viaje_id', tanda)
      .order('id', { ascending: true })
      .limit(PAGINA_LECTURA), 'reglas.viajes_con_gasto'), 'viajes_con_gasto') as Array<{ id: string; viaje_id: string }>;
    for (const g of filas) tienen.add(g.viaje_id);
    // Llena = pudo cortarse: los viajes de la tanda que aún no se vieron podrían
    // tener gastos fuera de la lectura. Se reparten en mitades.
    if (filas.length >= PAGINA_LECTURA) {
      const faltan = tanda.filter((id) => !tienen.has(id));
      if (faltan.length > 0) {
        const mitad = Math.ceil(faltan.length / 2);
        pendientes.push(faltan.slice(0, mitad));
        if (faltan.length > mitad) pendientes.push(faltan.slice(mitad));
      }
    }
  }
  return tienen;
}

// ── 9. Viaje abierto y viejo, sin un solo comprobante ──────────────────────

async function viajeSinComprobantes(
  tenantId: string, p: ParamsDe<'viaje_abierto_sin_comprobantes_mas_de'>, ahora: Date,
): Promise<Disparo[]> {
  const hoy = hoyMx(ahora);
  const corte = diaRelativo(hoy, -p.dias);
  const piso = diaRelativo(hoy, -90);
  type FilaViaje = {
    id: string; folio: string | null; fecha_inicio: string; anticipo: number | string;
    operador: { nombre?: string } | null;
  };
  // A37-S56-04: TODOS los candidatos, no los 400 más viejos: los ya avisados
  // (sellados) seguían ocupando plaza y los casos nuevos no llegaban al aviso.
  const filas = await leerPaginado<FilaViaje>((desde, hasta) => supabaseAdmin()
    .from('viaje')
    .select('id, folio, fecha_inicio, anticipo, operador:operador_id(nombre)')
    .eq('tenant_id', tenantId)
    .eq('estatus', 'abierto')
    .lte('fecha_inicio', corte)
    .gte('fecha_inicio', piso)
    .order('fecha_inicio', { ascending: true })
    .order('id', { ascending: true })
    .range(desde, hasta) as unknown as PromiseLike<RespLectura<FilaViaje>>, 'viaje_sin_comprobantes');
  if (filas.length === 0) return [];

  // Qué viajes SÍ tienen comprobante (A37-S56-03): por tandas de ids chicas.
  const tienen = await viajesConGasto(tenantId, filas.map((v) => v.id));

  return filas.filter((v) => !tienen.has(v.id)).map((v) => {
    const dias = Math.round((Date.parse(`${hoy}T12:00:00Z`) - Date.parse(`${String(v.fecha_inicio).slice(0, 10)}T12:00:00Z`)) / 86_400_000);
    const quien = v.operador?.nombre?.trim() || 'el chofer';
    return {
      objeto: 'viaje' as const, objetoId: v.id, clave: '',
      evidencia: `${v.folio || v.id.slice(0, 8)}: abierto desde el ${String(v.fecha_inicio).slice(0, 10)} (${dias} días) con ${mxn(Number(v.anticipo))} de anticipo y CERO comprobantes de ${quien}.`,
    };
  });
}

// ── 10. Costo de IA del día (solo Likida) ──────────────────────────────────

async function costoIaDelDia(
  tenantId: string, p: ParamsDe<'costo_ia_dia_mayor_a'>, ahora: Date,
): Promise<Disparo[]> {
  const dia = hoyMx(ahora);
  // El mismo corte de día de México que usa la RPC del presupuesto (0193): si
  // el techo y la medición partieran el día en horas distintas, el aviso
  // saldría o no según el huso, que es la peor clase de intermitencia.
  const inicio = new Date(`${dia}T00:00:00-06:00`).toISOString();
  // A37-S56-04: se suman TODAS las llamadas del día; con `.limit(1_000)` el
  // total se subestimaba en cuanto había más de mil llamadas.
  type FilaCosto = { id: string; costo_usd: number | string | null; fase: string };
  const filas = await leerPaginado<FilaCosto>((desde, hasta) => supabaseAdmin()
    .from('llm_costo')
    .select('id, costo_usd, fase')
    .eq('tenant_id', tenantId)
    .gte('created_at', inicio)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .range(desde, hasta) as unknown as PromiseLike<RespLectura<FilaCosto>>, 'costo_ia');

  const total = filas.reduce((s, f) => s + Number(f.costo_usd ?? 0), 0);
  if (!(total > p.usd)) return [];
  const porFase = new Map<string, number>();
  for (const f of filas) porFase.set(f.fase, (porFase.get(f.fase) ?? 0) + Number(f.costo_usd ?? 0));
  // Las fases que costaron CERO no entran al reparto: una fila con
  // `costo_usd` nulo es una llamada cuyo costo no se registró, y pintarla
  // como "chat US$0.00" la haría pasar por medición.
  const desglose = [...porFase.entries()]
    .filter(([, monto]) => monto > 0)
    .sort((a, b) => b[1] - a[1]).slice(0, 4)
    .map(([fase, monto]) => `${fase} ${usd(monto)}`).join(' · ');
  return [{
    objeto: 'tenant', objetoId: tenantId,
    // El día en la clave: un techo rebasado avisa UNA vez por día, no una vez
    // por hora hasta que cambie la fecha.
    clave: dia,
    evidencia: `El costo de IA del ${dia} va en ${usd(total)}, arriba del techo de ${usd(p.usd)}. Reparto: ${desglose || 'sin fases registradas'} (${filas.length} llamadas).`,
  }];
}

// ── El despachador ─────────────────────────────────────────────────────────

/**
 * Corre UNA plantilla contra UN tenant. Es el único punto por donde una regla
 * se convierte en consulta; el `switch` es exhaustivo por tipo, así que una
 * plantilla nueva en el catálogo no compila hasta que tiene lector.
 */
export async function evaluar(
  plantilla: PlantillaId,
  params: unknown,
  tenantId: string,
  ahora: Date = new Date(),
): Promise<Disparo[]> {
  switch (plantilla) {
    case 'unidad_sin_papel_vigente_al_despachar':
      return unidadSinPapel(tenantId, params as ParamsDe<'unidad_sin_papel_vigente_al_despachar'>, ahora);
    case 'gasto_de_concepto_mayor_a': {
      const p = params as ParamsDe<'gasto_de_concepto_mayor_a'>;
      return gastosSobreTope(tenantId, ahora, { concepto: p.concepto, monto: p.monto });
    }
    case 'gasto_sin_cfdi_mayor_a': {
      const p = params as ParamsDe<'gasto_sin_cfdi_mayor_a'>;
      return gastosSobreTope(tenantId, ahora, { sinCfdi: true, monto: p.monto });
    }
    case 'chofer_con_viajes_sin_liquidar':
      return choferConViajes(tenantId, params as ParamsDe<'chofer_con_viajes_sin_liquidar'>);
    case 'documento_por_vencer':
      return documentoPorVencer(tenantId, params as ParamsDe<'documento_por_vencer'>, ahora);
    case 'factura_sin_cobrar_mas_de':
      return facturaSinCobrar(tenantId, params as ParamsDe<'factura_sin_cobrar_mas_de'>, ahora);
    case 'estadia_mayor_a':
      return estadiaMayorA(tenantId, params as ParamsDe<'estadia_mayor_a'>, ahora);
    case 'incidencia_abierta_mas_de':
      return incidenciaAbierta(tenantId, params as ParamsDe<'incidencia_abierta_mas_de'>, ahora);
    case 'viaje_abierto_sin_comprobantes_mas_de':
      return viajeSinComprobantes(tenantId, params as ParamsDe<'viaje_abierto_sin_comprobantes_mas_de'>, ahora);
    case 'costo_ia_dia_mayor_a':
      return costoIaDelDia(tenantId, params as ParamsDe<'costo_ia_dia_mayor_a'>, ahora);
  }
}
