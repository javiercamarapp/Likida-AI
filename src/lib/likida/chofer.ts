// ═══════════════════════════════════════════════════════════════════════════
// LO QUE EL CHOFER VE DE SÍ MISMO — la capa de datos de /chofer.
//
// El chofer ya vive en WhatsApp: manda fotos, pregunta "¿cuánto llevo?" y
// recibe su liquidación. Esta sección no lo reemplaza — le da la pantalla que
// un chat no puede dar: el saldo COMPLETO de un vistazo, la lista de sus
// comprobantes con el estado de cada uno, y su historial. Llega por un enlace
// desde el mismo WhatsApp; no hay nada que instalar.
//
// ── LA REGLA QUE GOBIERNA ESTE ARCHIVO ───────────────────────────────────
//
// Al chofer se le está diciendo cuánto va a cobrar. Una cifra inventada aquí
// no es un bug de UI: es un reclamo con su patrón. Por eso:
//
//   · Sin anticipo registrado NO se calcula "cuánto te falta" — se devuelve
//     `null` y la pantalla dice qué falta. Es la misma decisión que ya tomó
//     `armarRespuesta` en consulta_chofer.ts para el WhatsApp, y las dos
//     superficies tienen que decir lo mismo.
//   · No existe tarifa por viaje, sueldo ni nómina en el esquema (busca
//     `tarifa`/`sueldo` en supabase/migrations: no están). Por lo tanto NO hay
//     "cuánto vas a ganar" ni "estimado del periodo". Prometerle a un chofer
//     un pago que sale de la nada es el peor error que este producto puede
//     cometer.
//   · Toda consulta FALLA CERRADO: supabase-js reporta el error por valor, y
//     sin comprobarlo una base caída se lee como "no tienes nada". El chofer
//     leería "$0 comprobado" habiendo mandado veinte tickets.
//
// ── POR QUÉ DOS CLIENTES DE SUPABASE, Y CUÁL VA DÓNDE ────────────────────
//
// Lecturas de viaje/gasto/liquidacion → `supabaseServer()`: la RLS de la 0045
// (`operador_ve_su_viaje`, `operador_ve_sus_gastos`,
// `operador_ve_sus_liquidaciones`) ya deja al chofer viendo SOLO lo suyo. Y
// aun así cada consulta repite `.eq('tenant_id')` y `.eq('operador_id')` a
// mano: las dos capas tienen que fallar a la vez para que un chofer vea el
// viaje de otro. `chofer.test.ts` lo comprueba leyendo este archivo.
//
// `supabaseAdmin()` (salta RLS) solo donde el chofer no tiene policy y el
// dato es suyo de todas formas:
//   · `unidad` — la 0047 se la niega al operador a propósito (vería las placas
//     de TODA la flota). Aquí se lee UNA unidad: la del viaje que ya se
//     verificó que es suyo, y solo su número económico.
//   · Storage — el bucket es privado; se firman ligas de vida corta.
//   · El UPDATE de aceptación — la 0045 le da al chofer SELECT, no UPDATE.
//     El filtro por `operador_id` va explícito en el update, no en la UI.
// ═══════════════════════════════════════════════════════════════════════════

import { supabaseServer } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { round2 } from '@/lib/formato';
import { estadoDelViaje, type EstadoViaje } from './consulta_chofer';
import { ligaComprobante } from './intake/almacen';

// ═══════════════════════════════════════════════════════════════════════════
// PARTE PURA — se prueba sin base (chofer.test.ts).
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Debajo de esto, el motor manda el comprobante a revisión.
 *
 * EL MISMO NÚMERO QUE `estadoDelViaje` (consulta_chofer.ts:185), que es quien
 * cuenta cuántos van "en revisión". Si aquí se moviera, la pantalla marcaría
 * dos tickets como mal leídos mientras el contador de arriba dice tres — y el
 * chofer no sabría cuál de las dos cifras es la que su oficina va a usar.
 * `chofer.test.ts` falla si los dos umbrales se separan.
 */
export const UMBRAL_OCR_DUDOSO = 0.7;

/**
 * `revisar` = la foto se leyó mal y conviene reenviarla MIENTRAS sigue en ruta.
 *
 * Confianza nula NO es "mal leído": es que no pasó por OCR (un CFDI llega por
 * XML, con sus cifras ya escritas). Marcarlo en rojo mandaría al chofer a
 * retomar una foto que nadie necesita.
 */
export type EstadoComprobante = 'registrado' | 'revisar';

export function estadoComprobante(ocrConfianza: number | null | undefined): EstadoComprobante {
  if (ocrConfianza === null || ocrConfianza === undefined) return 'registrado';
  const n = Number(ocrConfianza);
  if (!Number.isFinite(n)) return 'registrado';
  return n < UMBRAL_OCR_DUDOSO ? 'revisar' : 'registrado';
}

export interface ResumenLiquidacion {
  anticipo: number;
  comprobado: number;
  comprobantes: number;
  /** Fotos que se leyeron mal; el chofer todavía puede reenviarlas. */
  enRevision: number;
  /**
   * Cuánto le falta comprobar. `null` = NO SE PUEDE SABER porque el viaje no
   * trae anticipo registrado — no es cero, y pintarlo como cero convertiría un
   * dato que nadie capturó en la afirmación "ya no debes nada".
   */
  falta: number | null;
  /** Lo comprobado POR ENCIMA del anticipo. `null` por el mismo motivo. */
  excedente: number | null;
  /**
   * Comprobado / anticipo, SIN topar. `null` sin anticipo.
   * Puede pasar de 1: eso es información, no un error de dibujo.
   */
  avance: number | null;
  /** Qué decirle. Una sola frase, la misma que diría el WhatsApp. */
  leyenda: string;
}

/**
 * El saldo del viaje, listo para pintar.
 *
 * Recibe el `EstadoViaje` que ya calcula `estadoDelViaje` — no se vuelve a
 * sumar nada aquí. Si esta pantalla sumara por su cuenta, el panel y el
 * WhatsApp podrían contestar distinto a la misma pregunta el mismo día.
 */
export function resumenLiquidacion(e: EstadoViaje): ResumenLiquidacion {
  const anticipo = round2(Number(e.anticipo) || 0);
  const comprobado = round2(Number(e.comprobado) || 0);
  const base = {
    anticipo,
    comprobado,
    comprobantes: e.comprobantes,
    enRevision: e.enRevision,
  };

  // ANTICIPO 0 ES AMBIGUO, y la ambigüedad se dice en voz alta: puede ser "no
  // le dieron nada" o "nadie lo capturó". Ninguna de las dos se afirma.
  if (anticipo <= 0) {
    return {
      ...base,
      falta: null,
      excedente: null,
      avance: null,
      leyenda: 'Este viaje no tiene anticipo registrado, así que no se puede decir cuánto te falta por comprobar. Eso lo captura tu oficina.',
    };
  }

  const resto = round2(anticipo - comprobado);
  const falta = resto > 0 ? resto : 0;
  const excedente = resto < 0 ? round2(-resto) : 0;

  return {
    ...base,
    falta,
    excedente,
    avance: comprobado / anticipo,
    leyenda:
      falta > 0
        ? 'Te falta comprobar esta cantidad. Manda las fotos por WhatsApp mientras sigues en ruta.'
        : excedente > 0
          ? 'Comprobaste más que el anticipo. Tu oficina revisa la diferencia al cerrar.'
          : 'Vas justo con el anticipo.',
  };
}

/**
 * Cómo se lee la diferencia de una liquidación YA CERRADA, en palabras.
 *
 * `liquidacion.diferencia` es `+ a favor de la empresa / − a favor del
 * operador` (0001_init.sql). Se dice ASÍ y no como "te deben" ni "debes": que
 * una diferencia exista no autoriza un descuento de nómina —el art. 110 fr. I
 * de la LFT exige acuerdo con el trabajador, ver `laboral/pagadero.ts`— y
 * ponerle al chofer un "debes $3,288" en la pantalla sería adelantar un
 * veredicto que ni el motor emite.
 */
export function leerDiferencia(diferencia: number): { texto: string; tono: 'ok' | 'warn' | 'neutral' } {
  const d = round2(Number(diferencia) || 0);
  if (d > 0) return { texto: 'A favor de la empresa', tono: 'warn' };
  if (d < 0) return { texto: 'A favor del operador', tono: 'ok' };
  return { texto: 'Sin diferencia', tono: 'neutral' };
}

/** Qué se le enseña al chofer del estatus de su viaje. */
export function etiquetaEstatusViaje(estatus: string): string {
  const m: Record<string, string> = {
    abierto: 'En ruta',
    en_cuadre: 'En cuadre',
    liquidado: 'Liquidado',
  };
  // Un estatus desconocido se pinta crudo, nunca traducido a lo que parezca.
  return m[estatus] ?? estatus;
}

// ═══════════════════════════════════════════════════════════════════════════
// PARTE CON BASE — todo scoped a (tenantId, operadorId) de la SESIÓN.
// ═══════════════════════════════════════════════════════════════════════════

export interface ViajeChofer {
  id: string;
  folio: string | null;
  origen: string | null;
  destino: string | null;
  anticipo: number;
  fechaInicio: string | null;
  estatus: string;
  /** Marcas de la 0058. `aceptadoEn` null = todavía no lo confirma. */
  avisadoEn: string | null;
  aceptadoEn: string | null;
  unidadId: string | null;
}

const CAMPOS_VIAJE =
  'id, folio, origen, destino, anticipo, fecha_inicio, estatus, avisado_en, aceptado_en, unidad_id';

function mapearViaje(v: Record<string, unknown>): ViajeChofer {
  return {
    id: v.id as string,
    folio: (v.folio as string) ?? null,
    origen: (v.origen as string) ?? null,
    destino: (v.destino as string) ?? null,
    anticipo: Number(v.anticipo ?? 0),
    fechaInicio: (v.fecha_inicio as string) ?? null,
    estatus: (v.estatus as string) ?? 'abierto',
    avisadoEn: (v.avisado_en as string) ?? null,
    aceptadoEn: (v.aceptado_en as string) ?? null,
    unidadId: (v.unidad_id as string) ?? null,
  };
}

/**
 * El viaje que trae ahora mismo, o `null` si no trae ninguno.
 *
 * `abierto` y `en_cuadre` son los dos estatus vivos, y la 0029 garantiza A LO
 * MÁS uno por operador (índice único parcial) — el `limit(1)` no está
 * escogiendo entre varios, está leyendo el único que puede haber.
 */
export async function viajeEnCurso(tenantId: string, operadorId: string): Promise<ViajeChofer | null> {
  const sb = await supabaseServer();
  const { data, error } = await sb
    .from('viaje')
    .select(CAMPOS_VIAJE)
    .eq('tenant_id', tenantId)
    .eq('operador_id', operadorId)
    .in('estatus', ['abierto', 'en_cuadre'])
    .order('created_at', { ascending: false })
    .limit(1);

  if (error) throw new Error(`viajeEnCurso: ${error.message}`);
  const fila = (data ?? [])[0];
  return fila ? mapearViaje(fila as Record<string, unknown>) : null;
}

/**
 * El número económico de la unidad del viaje ("C2-08"), o `null`.
 *
 * Recibe el VIAJE, no un `unidadId` suelto, y no es cosmético: el viaje ya
 * viene de una consulta scoped a este operador, así que el tipo es la prueba
 * de que la unidad que se está leyendo es la del camión que él trae. Con un
 * uuid suelto por parámetro, esta función serviría para leer cualquier unidad
 * de la flota.
 */
export async function unidadDelViaje(tenantId: string, viaje: ViajeChofer): Promise<string | null> {
  if (!viaje.unidadId) return null;
  const { data, error } = await supabaseAdmin()
    .from('unidad')
    .select('numero_economico')
    .eq('tenant_id', tenantId)
    .eq('id', viaje.unidadId)
    .maybeSingle();

  // NO se lanza: quedarse sin el número de la unidad no puede tumbar la
  // pantalla que le dice al chofer cuánto lleva comprobado. La ausencia se
  // pinta como "sin unidad", que es lo mismo que dice el panel de despacho
  // cuando el viaje entró por WhatsApp (0047: `unidad_id` nullable a propósito).
  if (error) {
    logger.warn('chofer.unidad_ilegible', { viaje: viaje.id, err: error.message });
    return null;
  }
  return (data?.numero_economico as string) ?? null;
}

/** El saldo del viaje que trae, reusando el mismo cálculo que el WhatsApp. */
export async function resumenDelViaje(
  tenantId: string,
  viaje: ViajeChofer,
): Promise<ResumenLiquidacion | null> {
  const estado = await estadoDelViaje(tenantId, viaje.id);
  return estado ? resumenLiquidacion(estado) : null;
}

export interface ComprobanteChofer {
  id: string;
  concepto: string;
  monto: number;
  fecha: string | null;
  estado: EstadoComprobante;
  /** Liga firmada de vida corta a SU propia foto, o `null` si no se guardó. */
  foto: string | null;
}

/** Cuántos comprobantes se listan de un viaje. Un viaje real trae decenas. */
const TOPE_COMPROBANTES = 60;

/**
 * Los comprobantes de SU viaje, con el estado de lectura de cada uno.
 *
 * ── LA FOTO SÍ SE ENSEÑA AQUÍ, Y ES EL CASO CONTRARIO AL DE LA AUDITORÍA 9 ──
 *
 * En el panel del contralor la foto del ticket NO se enseña
 * (`dashboard/foto_no_expuesta.test.ts`): el aviso de privacidad le promete al
 * operador que un dato sensible que salga por accidente en su ticket "no se usa
 * para nada", y un botón "Ver foto" en la pantalla de su patrón convertía esa
 * promesa en falsa.
 *
 * Aquí el que mira es el TITULAR de esos datos mirando los suyos —derecho de
 * acceso, LFPDPPP art. 22— y es además quien tomó la foto. Enseñársela no es
 * una divulgación nueva; es lo que le permite ver que el ticket que mandó llegó
 * y se leyó bien. La liga se firma con TTL corto y el bucket sigue privado.
 */
export async function misComprobantes(
  tenantId: string,
  viaje: ViajeChofer,
): Promise<ComprobanteChofer[]> {
  const sb = await supabaseServer();
  const { data, error } = await sb
    .from('gasto')
    .select('id, concepto, monto, fecha, ocr_confianza, imagen_url, created_at')
    .eq('tenant_id', tenantId)
    .eq('viaje_id', viaje.id)
    .order('created_at', { ascending: false })
    .limit(TOPE_COMPROBANTES);

  if (error) throw new Error(`misComprobantes: ${error.message}`);

  const filas = (data ?? []) as Array<Record<string, unknown>>;
  return Promise.all(
    filas.map(async (g) => ({
      id: g.id as string,
      concepto: (g.concepto as string) ?? 'otro',
      monto: Number(g.monto ?? 0),
      fecha: (g.fecha as string) ?? null,
      estado: estadoComprobante(g.ocr_confianza as number | null),
      foto: g.imagen_url ? ((await ligaComprobante(g.imagen_url as string, 600)) ?? null) : null,
    })),
  );
}

export interface LiquidacionChofer {
  comprobado: number;
  anticipo: number;
  diferencia: number;
  estatus: string;
  /** Liga firmada al PDF, o `null` si esa liquidación no tiene papel. */
  pdf: string | null;
}

export interface ViajeHistorial extends ViajeChofer {
  liquidacion: LiquidacionChofer | null;
}

/** Cuántos viajes se listan. La pantalla lo dice cuando topa. */
export const TOPE_HISTORIAL = 20;

/**
 * Sus viajes, del más reciente al más viejo, con la liquidación que cerró.
 *
 * La liquidación viene EMBEBIDA en la misma consulta: con la sesión del chofer,
 * PostgREST aplica `operador_ve_sus_liquidaciones` (0045) también al recurso
 * embebido, así que no hay forma de que se cuele la de otro. `viaje` es 1:1 con
 * `liquidacion` en la práctica, pero PostgREST devuelve la relación como
 * arreglo o como objeto según cómo infiera la cardinalidad — se normalizan los
 * dos casos porque de esa diferencia ya dependió una pantalla en blanco.
 *
 * ── EL FK VA NOMBRADO, Y SIN ESO LA CONSULTA NO CORRE ────────────────────
 *
 * La 0028 le puso a `liquidacion` una SEGUNDA llave foránea hacia `viaje`
 * —la compuesta `(viaje_id, tenant_id)`, para que no se pueda colgar una
 * liquidación de un viaje de otra flota—, así que hoy hay dos caminos entre
 * las dos tablas y PostgREST se niega a elegir: `liquidacion(...)` a secas
 * devuelve PGRST201 "Could not embed because more than one relationship was
 * found". Comprobado contra la base real el 4-ago-2026: sin nombrar el FK, 0
 * filas y error; nombrándolo, las 5 del operador de prueba.
 */
export async function misViajes(tenantId: string, operadorId: string): Promise<ViajeHistorial[]> {
  const sb = await supabaseServer();
  const { data, error } = await sb
    .from('viaje')
    .select(
      `${CAMPOS_VIAJE}, liquidacion!liquidacion_viaje_id_fkey(total_comprobado, total_anticipo, diferencia, estatus, pdf_url)`,
    )
    .eq('tenant_id', tenantId)
    .eq('operador_id', operadorId)
    .order('created_at', { ascending: false })
    .limit(TOPE_HISTORIAL);

  if (error) throw new Error(`misViajes: ${error.message}`);

  const filas = (data ?? []) as Array<Record<string, unknown>>;
  return Promise.all(
    filas.map(async (v) => {
      const cruda = v.liquidacion;
      const liq = (Array.isArray(cruda) ? cruda[0] : cruda) as Record<string, unknown> | null | undefined;
      return {
        ...mapearViaje(v),
        liquidacion: liq
          ? {
              comprobado: Number(liq.total_comprobado ?? 0),
              anticipo: Number(liq.total_anticipo ?? 0),
              diferencia: Number(liq.diferencia ?? 0),
              estatus: (liq.estatus as string) ?? 'cuadrada',
              pdf: liq.pdf_url ? await ligaPdf(liq.pdf_url as string) : null,
            }
          : null,
      };
    }),
  );
}

/**
 * Liga firmada al PDF de la liquidación.
 *
 * NO se usa `/api/export/pdf/[id]`: esa ruta autoriza con `getSessionTenant()`
 * a secas —cualquier usuario del tenant, incluido un chofer, con cualquier id
 * de liquidación— y enlazarla desde aquí sería enseñarle al operador la puerta
 * por la que se bajan las liquidaciones de sus compañeros. Aquí la ruta del
 * objeto sale de una fila que la RLS del propio chofer ya filtró.
 *
 * Diez minutos, no una hora: es una liga a un documento con nombres, montos y
 * RFC; lo que se comparta de un teléfono a otro caduca pronto.
 */
async function ligaPdf(ruta: string): Promise<string | null> {
  try {
    const { data, error } = await supabaseAdmin().storage
      .from('liquidaciones')
      .createSignedUrl(ruta, 600);
    if (error) {
      logger.warn('chofer.pdf_no_firmado', { err: error.message });
      return null;
    }
    return data?.signedUrl ?? null;
  } catch (e) {
    logger.warn('chofer.pdf_error', { err: e instanceof Error ? e.message : String(e) });
    return null;
  }
}

export type ResultadoAceptar = 'aceptado' | 'ya_estaba' | 'no_es_tuyo' | 'error';

/**
 * Deja constancia de que el chofer aceptó el viaje, desde el panel.
 *
 * ── POR QUÉ NO SE REUSA `marcarAceptado` ─────────────────────────────────
 *
 * `confirmar_viaje.ts` filtra por `(id, tenant_id)` y nada más — le basta,
 * porque ahí el viaje ya lo eligió `viajesPorConfirmar` a partir del teléfono
 * de quien escribió. Aquí el `viajeId` viaja en un formulario del navegador,
 * así que sin `.eq('operador_id')` un chofer podría marcar como aceptado el
 * viaje de un compañero con solo cambiar un uuid: la escalación de las 5 h
 * dejaría de avisarle al jefe que ESE otro chofer nunca contestó.
 *
 * ── EL AVISO QUE FALTABA ─────────────────────────────────────────────────
 *
 * `viaje_aceptado_requiere_aviso` (0058) prohíbe aceptar lo que no se avisó, y
 * un viaje capturado desde el panel de despacho puede no tener `avisado_en`. Se
 * marca junto con la aceptación porque en ese momento ES verdad: la pantalla
 * que el chofer está mirando es el aviso. No se toca si ya venía puesta — esa
 * hora mide cuánto tardó en contestar y reescribirla la borraría.
 */
export async function aceptarViaje(
  tenantId: string,
  operadorId: string,
  viajeId: string,
): Promise<ResultadoAceptar> {
  const admin = supabaseAdmin();

  const previo = await admin
    .from('viaje')
    .select('id, avisado_en, aceptado_en')
    .eq('tenant_id', tenantId)
    .eq('operador_id', operadorId)
    .eq('id', viajeId)
    .maybeSingle();

  if (previo.error) {
    logger.error('chofer.aceptar_lectura', { viaje: viajeId, err: previo.error.message });
    return 'error';
  }
  // Ni suyo ni existente se contestan IGUAL: distinguirlos le diría a quien
  // teclea uuids cuáles existen en la flota.
  if (!previo.data) return 'no_es_tuyo';
  if (previo.data.aceptado_en) return 'ya_estaba';

  const ahora = new Date().toISOString();
  const { data, error } = await admin
    .from('viaje')
    .update(previo.data.avisado_en ? { aceptado_en: ahora } : { aceptado_en: ahora, avisado_en: ahora })
    .eq('tenant_id', tenantId)
    .eq('operador_id', operadorId)
    .eq('id', viajeId)
    .is('aceptado_en', null)
    .select('id');

  if (error) {
    logger.error('chofer.aceptar_escritura', { viaje: viajeId, err: error.message });
    return 'error';
  }
  if ((data ?? []).length === 0) return 'ya_estaba';
  logger.info('chofer.viaje_aceptado_en_panel', { viaje: viajeId });
  return 'aceptado';
}
