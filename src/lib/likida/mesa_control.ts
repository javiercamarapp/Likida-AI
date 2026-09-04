import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { acotada } from './presupuesto';
import { traerTodo, conteo } from './pg';
import { anotarEventoIncidencia, cerrarCoordinacionesDeIncidencia, TIPOS_ASISTENCIA } from './asistencia_wa';
import { NIVEL_MAXIMO } from './asistencia_escalamiento';

// ═══════════════════════════════════════════════════════════════════════════
// LA MESA DE CONTROL (Capa F del agente de ayuda en ruta).
//
// El principio del blueprint: el agente ESCRIBE el expediente y propone; la
// mesa de control DECIDE cuando hay que decidir. Este módulo es la lectura de
// las incidencias vivas y las tres intervenciones humanas — nada aquí manda
// WhatsApp ni marca teléfonos: quien está en la mesa ya tiene la pantalla
// enfrente y el teléfono en la mano.
//
// Por qué las intervenciones se apoyan en columnas que YA existen:
//  · "Tomar el control" ES el reconocimiento (`reconocida_en/por`, 0198): la
//    misma marca que el botón `asi_ok:` del jefe en WhatsApp. Reconocer
//    detiene el escalamiento automático (el cron filtra `reconocida_en is
//    null`) — que es exactamente lo que "tomar el control" significa. Una
//    segunda columna "controlada_por" diría lo mismo dos veces y las dos
//    marcas podrían contradecirse.
//  · "Resolver" es el estado de la 0047 (`resuelta` + `resuelta_en`), con la
//    NOTA OBLIGATORIA en la bitácora: un expediente que se cierra sin decir
//    por qué no es defendible ante la aseguradora después.
//  · "Reescalar" sube `nivel_escalado` a mano y es MONÓTONO como el claim del
//    cron: bajar el nivel re-armaría el reloj y el cron repetiría avisos ya
//    mandados. Subirlo no manda ningún WhatsApp — la mesa está viendo la
//    pantalla; lo que queda es la decisión en el expediente y que el cron ya
//    no repita los niveles saltados.
//
// Toda intervención deja su fila en `incidencia_evento` con el usuario: el
// expediente completo (quién supo qué y cuándo) es la auditoría de la capa.
// ═══════════════════════════════════════════════════════════════════════════

export interface IncidenciaMesa {
  id: string;
  tipo: string;
  prioridad: string;
  estado: string;
  nivelEscalado: number;
  abiertaEn: string;
  descripcion: string | null;
  hayLesionados: boolean | null;
  reconocidaEn: string | null;
  reconocidaPor: string | null;
  reconocidaPorNombre: string | null;
  operadorNombre: string | null;
  unidadRotulo: string | null;
  viajeFolio: string | null;
  /** true = la abrió la cámara y el chofer NO ha escrito nada en el
   *  expediente — el rótulo "detectada por la cámara; el chofer no ha
   *  reportado" sale de aquí. */
  soloCamara: boolean;
  eventos: EventoMesa[];
}

export interface EventoMesa {
  tipo: string;
  detalle: Record<string, unknown> | null;
  creadoEn: string;
}

/** Los eventos que prueban que el CHOFER habló en este expediente. Si solo
 *  hay detecciones de cámara y avisos del sistema, el chofer sigue callado —
 *  y la mesa debe verlo dicho, no inferirlo. */
const EVENTOS_DEL_CHOFER = new Set(['abierta', 'mensaje_adicional', 'reconocida_chofer']);

const ORDEN_PRIORIDAD: Record<string, number> = { critica: 0, alta: 1, media: 2, baja: 3 };

/**
 * Las incidencias de asistencia NO resueltas, con sus rótulos y su timeline
 * completo. Lanza ante error de base: la mesa con datos a medias invita a
 * decidir sobre lo que no se ve (el patrón `leyoOk` de la página lo convierte
 * en el aviso honesto).
 */
export async function listarMesaAsistencia(tenantId: string): Promise<IncidenciaMesa[]> {
  const admin = supabaseAdmin();
  // AUDITORÍA 25, MEDIO (REND-A7, REINCIDENTE): ordenaba solo por
  // `abierta_en` (empata entre incidencias abiertas en el mismo instante) y
  // no pedía `conteo()`. Sin `count`, `traerTodo` cae a la prueba de la
  // página vacía — la que un salto de filas por un empate satisface igual—,
  // así que una incidencia podía quedar fuera sin que nada lo dijera.
  const filas = await traerTodo<Record<string, unknown>>(
    (desde, hasta) => admin
      .from('incidencia')
      .select('id, tipo, prioridad, estado, nivel_escalado, abierta_en, descripcion, hay_lesionados, reconocida_en, reconocida_por, operador_id, unidad_id, viaje_id', conteo(desde))
      .eq('tenant_id', tenantId)
      .in('tipo', [...TIPOS_ASISTENCIA])
      .neq('estado', 'resuelta')
      .order('abierta_en', { ascending: true })
      .order('id', { ascending: true })
      .range(desde, hasta),
    'mesa.incidencias',
  );
  if (filas.length === 0) return [];

  const ids = filas.map((f) => f.id as string);

  // Rótulos en tandas (una consulta por tabla, no por incidencia). Cada uno
  // best-effort declarado: un rótulo ilegible sale como null y la pantalla
  // dice "sin dato" — un rótulo caído no puede tumbar la mesa entera.
  const [operadores, unidades, viajes, usuarios] = await Promise.all([
    rotulos(tenantId, 'operador', 'id, nombre', filas.map((f) => f.operador_id as string | null)),
    rotulos(tenantId, 'unidad', 'id, numero_economico, placas', filas.map((f) => f.unidad_id as string | null)),
    rotulos(tenantId, 'viaje', 'id, folio', filas.map((f) => f.viaje_id as string | null)),
    rotulos(tenantId, 'app_user', 'id, nombre', filas.map((f) => f.reconocida_por as string | null)),
  ]);

  // El timeline de TODAS las abiertas en una sola pasada — las incidencias
  // vivas de asistencia son pocas por definición (una por chofer, 0201; una
  // por unidad sin chofer, 0206), así que la consulta es corta.
  // AUDITORÍA 25, MEDIO (REND-A7, REINCIDENTE): mismo defecto que arriba —
  // ordenaba solo por `created_at` (empata entre eventos del mismo instante)
  // y no pedía `conteo()`.
  const eventos = await traerTodo<Record<string, unknown>>(
    (desde, hasta) => admin
      .from('incidencia_evento')
      .select('id, incidencia_id, tipo, detalle, created_at', conteo(desde))
      .eq('tenant_id', tenantId)
      .in('incidencia_id', ids)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(desde, hasta),
    'mesa.eventos',
  );
  const porIncidencia = new Map<string, EventoMesa[]>();
  for (const e of eventos) {
    const lista = porIncidencia.get(e.incidencia_id as string) ?? [];
    lista.push({
      tipo: e.tipo as string,
      detalle: (e.detalle as Record<string, unknown> | null) ?? null,
      creadoEn: e.created_at as string,
    });
    porIncidencia.set(e.incidencia_id as string, lista);
  }

  const resultado: IncidenciaMesa[] = filas.map((f) => {
    const evs = porIncidencia.get(f.id as string) ?? [];
    const nacioPorCamara = evs.some((e) => e.tipo === 'abierta_por_camara');
    const choferHablo = evs.some((e) => EVENTOS_DEL_CHOFER.has(e.tipo));
    const unidad = unidades.get(f.unidad_id as string);
    return {
      id: f.id as string,
      tipo: f.tipo as string,
      prioridad: f.prioridad as string,
      estado: f.estado as string,
      nivelEscalado: Number(f.nivel_escalado ?? 0),
      abiertaEn: f.abierta_en as string,
      descripcion: (f.descripcion as string) ?? null,
      hayLesionados: (f.hay_lesionados as boolean | null) ?? null,
      reconocidaEn: (f.reconocida_en as string) ?? null,
      reconocidaPor: (f.reconocida_por as string) ?? null,
      reconocidaPorNombre: usuarios.get(f.reconocida_por as string)?.nombre ?? null,
      operadorNombre: operadores.get(f.operador_id as string)?.nombre ?? null,
      unidadRotulo: unidad
        ? `${unidad.numero_economico ?? '(sin número)'}${unidad.placas ? ` · ${unidad.placas}` : ''}`
        : null,
      viajeFolio: viajes.get(f.viaje_id as string)?.folio ?? null,
      soloCamara: nacioPorCamara && !choferHablo,
      eventos: evs,
    };
  });

  // Severidad primero (crítica arriba), y dentro de la misma severidad la más
  // VIEJA arriba — el reloj que más lleva corriendo es el que más urge.
  resultado.sort((a, b) => {
    const pa = ORDEN_PRIORIDAD[a.prioridad] ?? 9;
    const pb = ORDEN_PRIORIDAD[b.prioridad] ?? 9;
    if (pa !== pb) return pa - pb;
    return Date.parse(a.abiertaEn) - Date.parse(b.abiertaEn);
  });
  return resultado;
}

/** Lookup en tanda por ids (nulls y repetidos filtrados). Best-effort: ante
 *  error devuelve el mapa vacío y lo loguea — los rótulos no tumban la mesa. */
async function rotulos(
  tenantId: string, tabla: string, columnas: string, ids: Array<string | null>,
): Promise<Map<string, Record<string, string | null>>> {
  const unicos = [...new Set(ids.filter((x): x is string => Boolean(x)))];
  const mapa = new Map<string, Record<string, string | null>>();
  if (unicos.length === 0) return mapa;
  try {
    const { data, error } = await acotada(supabaseAdmin()
      .from(tabla).select(columnas)
      .eq('tenant_id', tenantId)
      .in('id', unicos), `mesa.rotulos_${tabla}`);
    if (error) throw new Error(error.message);
    for (const f of (data ?? []) as unknown as Array<Record<string, string | null>>) {
      mapa.set(f.id as string, f);
    }
  } catch (e) {
    logger.warn('mesa.rotulos_ilegibles', { tabla, err: e instanceof Error ? e.message : String(e) });
  }
  return mapa;
}

// ── Las intervenciones ─────────────────────────────────────────────────────

export type ResultadoMesa = { ok: string } | { error: string };

/**
 * Tomar el control = RECONOCER la incidencia desde la mesa. El UPDATE
 * condicional sobre `reconocida_en is null` hace que dos personas dándole
 * clic a la vez terminen con exactamente un dueño — el perdedor recibe el
 * nombre de quien ganó, no un error mudo. Reconocer detiene el escalamiento
 * automático (el cron filtra por esa columna): a partir de aquí las
 * decisiones son de la mesa.
 */
export async function tomarControlMesa(
  tenantId: string, incidenciaId: string, userId: string,
): Promise<ResultadoMesa> {
  const { data, error } = await acotada(supabaseAdmin()
    .from('incidencia')
    .update({
      reconocida_en: new Date().toISOString(),
      reconocida_por: userId,
      estado: 'en_proceso',
      responsable: userId,
    })
    .eq('id', incidenciaId)
    .eq('tenant_id', tenantId)
    .is('reconocida_en', null)
    .neq('estado', 'resuelta')
    .select('id'), 'mesa.tomarControl');
  if (error) return { error: `No pude tomar el control: ${error.message}` };
  if ((data ?? []).length === 0) {
    // O ya la tiene alguien, o ya se resolvió — se dice cuál.
    const quien = await quienLaTiene(tenantId, incidenciaId);
    return { error: quien };
  }
  await anotarEventoIncidencia(tenantId, incidenciaId, 'control_tomado', { por: userId, desde: 'mesa' });
  return { ok: 'La incidencia es tuya: el escalamiento automático se detuvo y quedó registrado en el expediente.' };
}

async function quienLaTiene(tenantId: string, incidenciaId: string): Promise<string> {
  try {
    const { data } = await acotada(supabaseAdmin()
      .from('incidencia').select('estado, reconocida_por')
      .eq('id', incidenciaId).eq('tenant_id', tenantId)
      .limit(1), 'mesa.quienLaTiene');
    const f = (data ?? [])[0];
    if (!f) return 'Esa incidencia ya no existe.';
    if (f.estado === 'resuelta') return 'Esa incidencia ya se resolvió — recarga la mesa.';
    if (f.reconocida_por) {
      const { data: u } = await acotada(supabaseAdmin()
        .from('app_user').select('nombre').eq('id', f.reconocida_por).eq('tenant_id', tenantId)
        .limit(1), 'mesa.nombreDuenio');
      const nombre = ((u ?? [])[0]?.nombre as string) ?? null;
      return nombre ? `Ya la está atendiendo ${nombre}.` : 'Ya la está atendiendo alguien más.';
    }
    return 'Ya la reconoció alguien más — recarga la mesa.';
  } catch {
    return 'Ya la tomó alguien más o cambió de estado — recarga la mesa.';
  }
}

/**
 * Resolver CON NOTA — la nota no es adorno: es lo que el expediente va a
 * decir para siempre sobre cómo terminó esto. Sin nota, no hay cierre. El
 * UPDATE condicional `neq estado resuelta` hace el cierre atómico: dos
 * personas resolviendo a la vez producen exactamente una nota de cierre.
 */
export async function resolverDesdeMesa(
  tenantId: string, incidenciaId: string, userId: string, nota: string,
): Promise<ResultadoMesa> {
  const limpia = nota.replace(/\s+/g, ' ').trim();
  if (limpia.length < 5) {
    return { error: 'La nota de cierre es obligatoria: di cómo terminó (quién atendió, con qué resultado).' };
  }
  // La NOTA va ANTES del cierre (c4-8): si la bitácora no la pudo escribir,
  // la incidencia NO se cierra — "cerrada con su nota" tiene que ser verdad
  // literal, no best-effort disfrazado. El costo de este orden es que un
  // cierre que pierda la carrera deje una nota extra en el expediente — una
  // nota de más es citable; una incidencia "resuelta" sin cómo, no.
  const anotado = await anotarEventoIncidencia(tenantId, incidenciaId, 'resuelta_desde_mesa', {
    por: userId, nota: limpia.slice(0, 500),
  });
  if (anotado === 'fallo') {
    return { error: 'No pude escribir la nota en el expediente — la incidencia sigue abierta. Inténtalo de nuevo.' };
  }
  const { data, error } = await acotada(supabaseAdmin()
    .from('incidencia')
    .update({ estado: 'resuelta', resuelta_en: new Date().toISOString() })
    .eq('id', incidenciaId)
    .eq('tenant_id', tenantId)
    .neq('estado', 'resuelta')
    .select('id'), 'mesa.resolver');
  if (error) return { error: `Tu nota quedó en el expediente, pero el cierre no se aplicó: ${error.message}. Inténtalo de nuevo.` };
  if ((data ?? []).length === 0) return { error: 'Esa incidencia ya estaba resuelta — recarga la mesa.' };
  // Y sus coordinaciones de proveedor (0213) se cierran con ella (c4-2): una
  // gestión viva de una emergencia muerta bloquea al mismo gruero para la
  // siguiente y le reenvía sus mensajes al jefe para siempre.
  await cerrarCoordinacionesDeIncidencia(tenantId, incidenciaId, 'resuelta_desde_mesa');
  return { ok: 'Incidencia cerrada con su nota en el expediente.' };
}

/**
 * Reescalar a mano — MONÓTONO como el claim del cron (`lt` en la condición):
 * subir el nivel registra la decisión y evita que el cron repita los niveles
 * saltados; bajarlo re-armaría el reloj y duplicaría avisos ya mandados, así
 * que no existe. No manda ningún WhatsApp: quien reescala está EN la mesa.
 */
export async function reescalarDesdeMesa(
  tenantId: string, incidenciaId: string, userId: string, nivel: number,
): Promise<ResultadoMesa> {
  if (!Number.isInteger(nivel) || nivel < 1 || nivel > NIVEL_MAXIMO) {
    return { error: `El nivel debe ser un entero entre 1 y ${NIVEL_MAXIMO}.` };
  }
  const { data, error } = await acotada(supabaseAdmin()
    .from('incidencia')
    .update({ nivel_escalado: nivel })
    .eq('id', incidenciaId)
    .eq('tenant_id', tenantId)
    .lt('nivel_escalado', nivel)
    .neq('estado', 'resuelta')
    .select('id'), 'mesa.reescalar');
  if (error) return { error: `No pude reescalar: ${error.message}` };
  if ((data ?? []).length === 0) {
    return { error: 'La incidencia ya está en ese nivel o más arriba (el nivel solo sube), o ya se resolvió.' };
  }
  await anotarEventoIncidencia(tenantId, incidenciaId, 'reescalada_manual', { por: userId, nivel, desde: 'mesa' });
  return { ok: `Nivel de escalamiento subido a ${nivel} y registrado en el expediente.` };
}

/** Rótulos en español de los eventos del timeline — lo que la mesa lee, no la
 *  clave interna. Un tipo no mapeado sale con su clave cruda: mejor la clave
 *  visible que un evento invisible. */
export const ROTULO_EVENTO: Record<string, string> = {
  abierta: 'El chofer reportó y se abrió el expediente',
  abierta_por_camara: 'La cámara de la unidad detectó el evento y abrió el expediente',
  deteccion_camara: 'Detección adicional de la cámara',
  aviso_jefe_enviado: 'Aviso enviado al jefe por WhatsApp',
  aviso_jefe_fallido: 'El aviso al jefe NO salió',
  aviso_diferido: 'Aviso diferido a la ventana horaria de la flota',
  reconocida: 'Reconocida desde WhatsApp (botón «Ya lo atiendo»)',
  mensaje_adicional: 'Mensaje del chofer agregado al expediente',
  escalada: 'Escalada automáticamente al siguiente nivel',
  aviso_escalada_fallido: 'La escalada corrió pero su aviso NO salió',
  resuelta_por_antiguedad: 'Cerrada por antigüedad (>72 h) al llegar un reporte nuevo',
  control_tomado: 'La mesa de control tomó la incidencia',
  resuelta_desde_mesa: 'Cerrada desde la mesa de control (con nota)',
  reescalada_manual: 'Nivel de escalamiento subido a mano desde la mesa',
  ubicacion_anclada: 'El chofer compartió su ubicación y quedó en el expediente',
  coordinacion_autorizada: 'El jefe autorizó contactar a un proveedor',
  contacto_enviado: 'Mensaje enviado al proveedor',
  contacto_pendiente_plantilla: 'El mensaje al proveedor quedó preparado (falta la plantilla de Meta)',
  cotizacion_recibida: 'El proveedor respondió con su cotización',
  cotizacion_confirmada: 'El jefe confirmó la cotización del proveedor',
  cotizacion_descartada: 'El jefe descartó la cotización del proveedor',
  chofer_avisado_proveedor: 'Al chofer se le avisó que el proveedor va en camino',
  proveedor_mensaje: 'Mensaje del proveedor agregado al expediente',
  coordinacion_cerrada: 'La gestión con el proveedor se cerró al resolver la incidencia',
};
