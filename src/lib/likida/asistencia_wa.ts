import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { acotada } from './presupuesto';
import { strip_accents } from './cuadre/util';
import { crearIncidencia } from './operacion';
import { telefonoJefeDe } from './contactos';
import type { RolOficina } from './contactos';
import { sendText, sendButtons } from '@/lib/meta/client';
import { puedeAsignar } from '@/lib/auth/permisos';

// ═══════════════════════════════════════════════════════════════════════════
// ASISTENCIA EN CARRETERA Y SINIESTROS (0198, Fase 4 — núcleo).
//
// No es un conversador: es un DESPACHADOR. Su métrica es el tiempo hasta que
// un humano competente esté hablando con el chofer; un mensaje que no acorta
// ese reloj sobra. Por eso el orden es inamovible: (1) abrir la incidencia y
// su evento, (2) avisar al jefe SÍNCRONO en este mismo turno, (3) nada más.
// El modelo no participa en esta oleada — con COSTO_AGENTE_MS=15s el caso
// normal de un webhook cargado es que NO haya presupuesto para el modelo, así
// que el camino determinista tiene que estar completo por sí solo, no ser el
// plan B.
//
// ── LA ASIMETRÍA SE INVIERTE RESPECTO A TALACHA ────────────────────────────
// En talacha el falso positivo es barato (una incidencia de más que un humano
// descarta) y por eso su lista puede ser ancha. Aquí el caro es el NEGATIVO:
// un "chocamos" que siga su camino al agente de liquidación es una emergencia
// tratada como charla. Por eso: SIN tope de largo (quien describe un choque
// escribe largo; talacha corta a 220 y los hitos a 40), la pregunta NO
// descarta ("¿qué hago? choqué" es ROJO), y palabras ambiguas como "robo"
// entran a la lista — el costo de disparar de más es un aviso que el jefe
// descarta; el de disparar de menos, un chofer solo en la carretera.
//
// ── EL MODO MUDO (violencia activa) ────────────────────────────────────────
// En un asalto/secuestro/retén, el mejor producto es el que se calla: un bot
// escribiendo es un teléfono que vibra en la mano de alguien a quien están
// asaltando. UN solo mensaje corto y neutro, y silencio — y al jefe se le
// advierte "no le marques hasta saber que está seguro". Lesionados NO activa
// el modo mudo: un chofer con un herido necesita saber que alguien viene.
// ═══════════════════════════════════════════════════════════════════════════

/** El mismo aplanado que talacha/hitos: reconocer, no extraer. */
function limpiar(texto: string): string {
  return strip_accents(texto.toLowerCase())
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Alternancia EXPLÍCITA, no raíz con comodín: `choc\w*` atraparía "chocolate".
// Cada palabra nueva = una línea en la lista y un caso en el test.
const VIOLENCIA =
  /\b(asalto|asaltaron|asaltando|robaron|robo|secuestro|secuestraron|balacera|disparos|disparan|reten)\b/;
const LESIONADOS =
  /\b(lesionado|lesionados|herido|heridos|sangre|muerto|muertos)\b/;
const SINIESTRO =
  /\b(choque|choques|chocamos|choco|chocaron|volcadura|volcamos|volco|atropelle|atropellamos|atropello|incendio|fuego|derrame)\b|\bse (esta )?quema(ndo)?\b/;
const VIA_BLOQUEADA = /\b(bloqueo|bloqueada|bloqueado)\b/;
const EMERGENCIA_SUELTA = /\b911\b/;
const AMBAR =
  /\b(varado|varados|varada)\b|\bno (arranca|enciende|prende)\b|\bse salio del camino\b|\bse me fue el freno\b|\bsin frenos\b|\bhumo\b|\bse (sobre)?calento\b/;

export type NivelAsistencia = 'rojo' | 'ambar';

export interface Asistencia {
  nivel: NivelAsistencia;
  /** Violencia activa: un solo mensaje neutro y silencio. */
  modoMudo: boolean;
}

/**
 * ¿El mensaje es una emergencia de carretera? `null` = no lo es y sigue su
 * camino (talacha, hitos, agente). ROJO gana sobre talacha EN EL ENRUTAMIENTO
 * (el check de asistencia corre antes), no aquí: este reconocedor solo dice
 * qué es, no qué le gana a qué.
 */
export function interpretarAsistencia(texto: string | undefined): Asistencia | null {
  if (typeof texto !== 'string' || !texto.trim()) return null;
  const t = limpiar(texto);
  if (VIOLENCIA.test(t)) return { nivel: 'rojo', modoMudo: true };
  if (LESIONADOS.test(t) || SINIESTRO.test(t) || VIA_BLOQUEADA.test(t) || EMERGENCIA_SUELTA.test(t)) {
    return { nivel: 'rojo', modoMudo: false };
  }
  if (AMBAR.test(t)) return { nivel: 'ambar', modoMudo: false };
  return null;
}

/** Los tipos que este circuito abre — el filtro de "¿ya hay una abierta?". */
export const TIPOS_ASISTENCIA = ['siniestro', 'robo', 'emergencia_medica', 'varado', 'bloqueo'] as const;
export type TipoAsistencia = typeof TIPOS_ASISTENCIA[number];

/**
 * El tipo de incidencia sale del texto, con precedencia fija: violencia >
 * lesionados/médico > siniestro > vía bloqueada. "Nos asaltaron y hay un
 * herido" abre `robo` (la violencia manda el protocolo) y `hay_lesionados`
 * viaja aparte como columna.
 */
export function tipoDeAsistencia(texto: string, nivel: NivelAsistencia): TipoAsistencia {
  const t = limpiar(texto);
  if (nivel === 'ambar') return 'varado';
  if (VIOLENCIA.test(t)) return 'robo';
  if (SINIESTRO.test(t)) return 'siniestro';
  if (LESIONADOS.test(t) || EMERGENCIA_SUELTA.test(t)) return 'emergencia_medica';
  if (VIA_BLOQUEADA.test(t)) return 'bloqueo';
  // Inalcanzable si `nivel` vino de interpretarAsistencia; el fallback dice
  // la verdad más conservadora en severidad.
  return 'siniestro';
}

/** `true` SOLO si el texto lo dice; si no, NULL (no preguntado). JAMÁS false:
 *  un false es un parte médico que solo el chofer puede dar. */
export function lesionadosSegunTexto(texto: string): true | null {
  return LESIONADOS.test(limpiar(texto)) ? true : null;
}

// ── La bitácora por incidencia (0198) — best-effort, con idempotencia ──────

/**
 * Anota un evento. `duplicado` = ese mismo wa_message_id ya estaba (el índice
 * único parcial de la 0198): el webhook reentregó y NO hay que repetir nada.
 * Un evento que no se pudo anotar no detiene el circuito — la bitácora sirve
 * al post-mortem; el aviso al jefe sirve al chofer. Se loguea y se sigue.
 */
export async function anotarEventoIncidencia(
  tenantId: string,
  incidenciaId: string,
  tipo: string,
  detalle?: Record<string, unknown>,
  waMessageId?: string | null,
): Promise<'anotado' | 'duplicado' | 'fallo'> {
  try {
    const { error } = await acotada(supabaseAdmin().from('incidencia_evento').insert({
      tenant_id: tenantId,
      incidencia_id: incidenciaId,
      tipo,
      detalle: detalle ?? null,
      wa_message_id: waMessageId ?? null,
    }), 'asistencia.evento');
    if (!error) return 'anotado';
    if (/duplicate key|incidencia_evento_wa_unico/i.test(error.message)) return 'duplicado';
    logger.warn('asistencia.evento_no_anotado', { incidencia: incidenciaId, tipo, err: error.message });
    return 'fallo';
  } catch (e) {
    logger.warn('asistencia.evento_no_anotado', { incidencia: incidenciaId, tipo, err: e instanceof Error ? e.message : String(e) });
    return 'fallo';
  }
}

// ── El lado del CHOFER ─────────────────────────────────────────────────────

interface AbiertaExistente {
  id: string;
  tipo: string;
}

/**
 * La incidencia de asistencia ABIERTA de este chofer, si la hay. Por viaje
 * cuando lo hay; por operador cuando no (0198 añadió `operador_id` justo para
 * esto: sin él, dos choferes sin viaje compartirían "la abierta" de la flota
 * y el segundo accidente no avisaría a nadie). Lanza ante error de base:
 * crear a ciegas duplicaría el 🚨 al jefe.
 */
async function abiertaDelChofer(
  tenantId: string, viajeId: string | null, operadorId: string | null,
): Promise<AbiertaExistente | null> {
  let q = supabaseAdmin()
    .from('incidencia')
    .select('id, tipo')
    .eq('tenant_id', tenantId)
    .in('tipo', [...TIPOS_ASISTENCIA])
    .neq('estado', 'resuelta')
    .order('abierta_en', { ascending: false })
    .limit(1);
  if (viajeId) q = q.eq('viaje_id', viajeId);
  else if (operadorId) q = q.eq('operador_id', operadorId).is('viaje_id', null);
  else return null; // sin viaje NI operador no hay a quién atarla — el llamador no debería llegar aquí
  const { data, error } = await acotada(q, 'asistencia.abiertaDelChofer');
  if (error) throw new Error(`asistencia.abiertaDelChofer: ${error.message}`);
  const f = (data ?? [])[0];
  return f ? { id: f.id as string, tipo: f.tipo as string } : null;
}

/** Rótulos del aviso. Best-effort declarado: si la lectura falla, "tu chofer"
 *  — detener un 🚨 por un rótulo dejaría la emergencia sin jefe. */
async function etiquetasAviso(tenantId: string, viajeId: string | null, operadorId: string | null): Promise<{ chofer: string; folio: string | null }> {
  try {
    const admin = supabaseAdmin();
    const [rOp, rViaje] = await Promise.all([
      operadorId
        ? admin.from('operador').select('nombre').eq('id', operadorId).eq('tenant_id', tenantId).maybeSingle()
        : Promise.resolve({ data: null }),
      viajeId
        ? admin.from('viaje').select('folio').eq('id', viajeId).eq('tenant_id', tenantId).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    return {
      chofer: (rOp.data?.nombre as string) || 'Tu chofer',
      folio: (rViaje.data?.folio as string) || null,
    };
  } catch (e) {
    logger.warn('asistencia.etiquetas_ilegibles', { viaje: viajeId, err: e instanceof Error ? e.message : String(e) });
    return { chofer: 'Tu chofer', folio: null };
  }
}

const ROTULO_TIPO: Record<TipoAsistencia, string> = {
  siniestro: 'un SINIESTRO',
  robo: 'un ROBO / violencia',
  emergencia_medica: 'una EMERGENCIA MÉDICA',
  varado: 'que está varado',
  bloqueo: 'un bloqueo en la vía',
};

/**
 * El 🚨 al jefe, con botón de "Ya lo atiendo". `true` solo si Meta lo aceptó
 * — el llamador le dice al chofer la VERDAD de si su jefe ya lo sabe.
 *
 * ROJO ignora la ventana horaria SIEMPRE. Ámbar hoy también avisa inmediato:
 * la ventana con aviso diferido (`notificar_desde`) llega con el escalamiento
 * de la Fase 5 — hasta entonces, es preferible despertar al jefe por un
 * varado que callarse uno.
 */
async function avisarAlJefe(args: {
  tenantId: string;
  incidenciaId: string;
  tipo: TipoAsistencia;
  nivel: NivelAsistencia;
  modoMudo: boolean;
  hayLesionados: true | null;
  chofer: string;
  folio: string | null;
  descripcion: string;
}): Promise<boolean> {
  let telefono: string | null = null;
  try {
    telefono = await telefonoJefeDe(args.tenantId);
  } catch (e) {
    logger.error('asistencia.jefe_ilegible', { tenant: args.tenantId, err: e instanceof Error ? e.message : String(e) });
    return false;
  }
  if (!telefono) {
    logger.warn('asistencia.sin_jefe', { tenant: args.tenantId, incidencia: args.incidenciaId });
    return false;
  }
  const desc = args.descripcion.replace(/\s+/g, ' ').trim().slice(0, 220);
  const encabezado = args.nivel === 'rojo' ? '🚨' : '⚠️';
  const cuerpo =
    `${encabezado} ${args.chofer} reporta ${ROTULO_TIPO[args.tipo]}${args.folio ? ` en el viaje ${args.folio}` : ''}:\n` +
    `«${desc}»\n` +
    (args.hayLesionados === true ? '\n⛑️ Menciona LESIONADOS.\n' : '') +
    (args.modoMudo
      ? '\n⚠️ Puede ser violencia EN CURSO: NO le marques ni le escribas hasta saber que está seguro — un teléfono sonando lo puede poner en riesgo. Nosotros tampoco le vamos a escribir más.\n'
      : '') +
    `\nMárcale en cuanto puedas${args.modoMudo ? ' a un tercero cercano (base, otro chofer de la zona), no a él' : ''} y aprieta el botón para que sepamos que ya lo estás atendiendo.`;
  const enviado = await sendButtons(telefono, cuerpo, [
    { id: `asi_ok:${args.incidenciaId}`, titulo: 'Ya lo atiendo' },
  ]);
  return Boolean(enviado);
}

/** Un solo mensaje corto y neutro. Nada de instrucciones, nada de preguntas:
 *  el chofer en violencia activa no debe recibir más vibraciones nuestras. */
const RESPUESTA_MUDA = 'Recibido. Tu jefe ya lo sabe.';

export interface ResultadoAsistencia {
  /** Lo que se le contesta al chofer. */
  respuesta: string;
  /** `true` cuando el circuito atendió el mensaje (el llamador hace return). */
  atendida: boolean;
}

/**
 * El turno de una emergencia del CHOFER. Quien llama ya decidió que el
 * mensaje es asistencia (`interpretarAsistencia`).
 *
 * UNA incidencia de asistencia abierta por chofer: el segundo mensaje de la
 * misma emergencia se anota como evento (con su wa_message_id — el índice
 * único absorbe la reentrega del webhook) y NO duplica el 🚨 al jefe.
 */
export async function atenderAsistenciaChofer(args: {
  tenantId: string;
  viajeId: string | null;
  operadorId: string;
  texto: string;
  asistencia: Asistencia;
  waMessageId?: string | null;
}): Promise<ResultadoAsistencia> {
  const { asistencia } = args;
  const tipo = tipoDeAsistencia(args.texto, asistencia.nivel);
  const hayLesionados = lesionadosSegunTexto(args.texto);

  let abierta: AbiertaExistente | null;
  try {
    abierta = await abiertaDelChofer(args.tenantId, args.viajeId, args.operadorId);
  } catch (e) {
    logger.error('asistencia.abierta_ilegible', { operador: args.operadorId, err: e instanceof Error ? e.message : String(e) });
    // Fallar cerrado en la VERDAD, no en la atención: no se sabe si el jefe ya
    // tiene el aviso, así que no se afirma ni se duplica — se le da al chofer
    // la salida que no depende de nosotros.
    return {
      atendida: true,
      respuesta: asistencia.modoMudo
        ? RESPUESTA_MUDA
        : 'No pude registrar tu reporte ahorita 😕 — márcale DIRECTO a tu jefe, no esperes este chat. Si puedes, mándame el reporte de nuevo en un momento.',
    };
  }

  if (abierta) {
    const anotado = await anotarEventoIncidencia(args.tenantId, abierta.id, 'mensaje_adicional', { texto: args.texto.slice(0, 500) }, args.waMessageId);
    logger.info('asistencia.mensaje_adicional', { incidencia: abierta.id, anotado });
    return {
      atendida: true,
      respuesta: asistencia.modoMudo
        ? RESPUESTA_MUDA
        : 'Sigo aquí y tu jefe ya tiene tu reporte 🚨 — le acabo de anotar este mensaje también. Si algo cambia (lesionados, ubicación), escríbelo y se lo paso.',
    };
  }

  let incidenciaId: string;
  try {
    incidenciaId = await crearIncidencia(args.tenantId, {
      viajeId: args.viajeId,
      operadorId: args.operadorId,
      tipo,
      prioridad: asistencia.nivel === 'rojo' ? 'critica' : 'alta',
      descripcion: args.texto.slice(0, 500),
      hayLesionados,
    });
  } catch (e) {
    logger.error('asistencia.crear_fallo', { operador: args.operadorId, err: e instanceof Error ? e.message : String(e) });
    return {
      atendida: true,
      respuesta: asistencia.modoMudo
        ? RESPUESTA_MUDA
        : 'No pude registrar tu reporte ahorita 😕 — márcale DIRECTO a tu jefe, no esperes este chat.',
    };
  }

  await anotarEventoIncidencia(args.tenantId, incidenciaId, 'abierta', {
    nivel: asistencia.nivel, tipo, hayLesionados, modoMudo: asistencia.modoMudo,
  }, args.waMessageId);

  const etiquetas = await etiquetasAviso(args.tenantId, args.viajeId, args.operadorId);
  const avisado = await avisarAlJefe({
    tenantId: args.tenantId,
    incidenciaId,
    tipo,
    nivel: asistencia.nivel,
    modoMudo: asistencia.modoMudo,
    hayLesionados,
    chofer: etiquetas.chofer,
    folio: etiquetas.folio,
    descripcion: args.texto,
  });
  await anotarEventoIncidencia(args.tenantId, incidenciaId, avisado ? 'aviso_jefe_enviado' : 'aviso_jefe_fallido');
  logger.info('asistencia.abierta', { incidencia: incidenciaId, tipo, nivel: asistencia.nivel, avisado, lesionados: hayLesionados });

  if (asistencia.modoMudo) {
    // La verdad de si el jefe recibió NO se le detalla al chofer en violencia
    // activa: más texto es más vibración. Si el aviso falló, el post-mortem lo
    // tiene en la bitácora y el escalamiento (Fase 5) lo reintenta.
    return { atendida: true, respuesta: RESPUESTA_MUDA };
  }
  if (!avisado) {
    return {
      atendida: true,
      respuesta: 'Registré tu emergencia 🚨 pero NO pude avisarle a tu jefe por WhatsApp — márcale DIRECTO ahora mismo. El reporte queda guardado.',
    };
  }
  return {
    atendida: true,
    respuesta: asistencia.nivel === 'rojo'
      ? 'Tu jefe ya tiene tu reporte 🚨 y le pedimos atenderlo YA. Si hay lesionados marca al 911 primero. Mándame tu ubicación (el clip 📎 → Ubicación) para pasársela también.'
      : 'Anotado ⚠️ — le avisé a tu jefe que estás varado para que te resuelvan. Mándame tu ubicación (el clip 📎 → Ubicación) y se la paso.',
  };
}

// ── El lado del JEFE: "Ya lo atiendo" ──────────────────────────────────────

export interface CuentaReconoce {
  tenantId: string | null;
  rol: RolOficina;
  userId: string;
}

function leerBotonAsistencia(texto: string): string | null {
  const m = /^asi_ok:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(texto.trim());
  return m ? m[1] : null;
}

/**
 * El botón del jefe. `null` = no es de este circuito. La firma es atómica
 * (`where reconocida_en is null`): dos jefes o dos taps, gana exactamente uno
 * y el segundo recibe la verdad. Al chofer se le avisa "ya lo están
 * atendiendo" — SALVO en robo/violencia: ahí el silencio sigue mandando.
 */
export async function atenderReconocimientoAsistencia(
  cuenta: CuentaReconoce,
  texto: string,
  ahora: Date = new Date(),
): Promise<string | null> {
  if (!texto?.trim()) return null;
  const incidenciaId = leerBotonAsistencia(texto);
  if (!incidenciaId) return null;

  if (!cuenta.tenantId) return 'Esa emergencia no es de una flota tuya.';
  if (!puedeAsignar(cuenta.rol)) {
    return 'Tu rol no atiende emergencias de camino — eso le toca al dueño o al jefe de tráfico.';
  }

  const { data, error } = await acotada(supabaseAdmin()
    .from('incidencia')
    .update({ reconocida_en: ahora.toISOString(), reconocida_por: cuenta.userId })
    .eq('id', incidenciaId)
    .eq('tenant_id', cuenta.tenantId)   // tenant del LOOKUP, jamás del texto
    .is('reconocida_en', null)
    .select('id, tipo, viaje_id, operador_id'), 'asistencia.reconocer');
  if (error) {
    logger.error('asistencia.reconocer_fallo', { incidencia: incidenciaId, err: error.message });
    return 'No pude registrar que ya lo atiendes — inténtalo de nuevo en un momento.';
  }
  const fila = (data ?? [])[0] as { id: string; tipo: string; viaje_id: string | null; operador_id: string | null } | undefined;
  if (!fila) {
    const { data: existente, error: errLee } = await acotada(supabaseAdmin()
      .from('incidencia').select('reconocida_en')
      .eq('id', incidenciaId).eq('tenant_id', cuenta.tenantId)
      .maybeSingle(), 'asistencia.releer');
    if (errLee) return 'No pude registrar que ya lo atiendes — inténtalo de nuevo en un momento.';
    if (!existente) return 'No encontré esa emergencia en tu flota.';
    return existente.reconocida_en
      ? 'Alguien de tu equipo ya la está atendiendo — no cambié nada.'
      : 'Esa emergencia ya no se puede marcar desde aquí — revísala en el panel.';
  }

  await anotarEventoIncidencia(cuenta.tenantId, fila.id, 'reconocida', { por: cuenta.userId });

  // En robo/violencia el chofer NO recibe nada: el modo mudo no termina
  // cuando el jefe aprieta un botón — termina cuando el chofer está seguro.
  if (fila.tipo === 'robo') {
    logger.info('asistencia.reconocida', { incidencia: fila.id, por: cuenta.userId, avisadoChofer: false });
    return 'Anotado: la estás atendiendo. Al chofer NO le escribimos nada (puede seguir en riesgo) — coordina por fuera y márcale solo cuando sepas que está seguro.';
  }

  let avisado = false;
  try {
    const admin = supabaseAdmin();
    let operadorId = fila.operador_id;
    if (!operadorId && fila.viaje_id) {
      const { data: v } = await admin.from('viaje').select('operador_id')
        .eq('id', fila.viaje_id).eq('tenant_id', cuenta.tenantId).maybeSingle();
      operadorId = (v?.operador_id as string) ?? null;
    }
    if (operadorId) {
      const { data: op } = await admin.from('operador').select('telefono')
        .eq('id', operadorId).eq('tenant_id', cuenta.tenantId).maybeSingle();
      if (op?.telefono) {
        avisado = Boolean(await sendText(op.telefono as string, 'Tu jefe ya está atendiendo tu emergencia 🚨 — ayuda en camino. Sigue aquí por cualquier cambio.'));
      }
    }
  } catch (e) {
    logger.warn('asistencia.chofer_no_avisado', { incidencia: fila.id, err: e instanceof Error ? e.message : String(e) });
  }
  logger.info('asistencia.reconocida', { incidencia: fila.id, por: cuenta.userId, avisadoChofer: avisado });
  return avisado
    ? 'Anotado: la estás atendiendo ✅ — ya le avisé al chofer que vas.'
    : 'Anotado: la estás atendiendo ✅, pero NO le pude avisar al chofer por WhatsApp — márcale tú.';
}

// ── El lado de la OFICINA: el dueño que reporta sin ser chofer ─────────────

/**
 * Un ROJO escrito desde una cuenta de OFICINA (punto D del plano): el dueño
 * que choca sin viaje abierto. Sin esto, el analista le contesta como si
 * fuera una pregunta de negocio. Aquí NO se "avisa al jefe" — el que reporta
 * ES la oficina; lo que se necesita es que quede REGISTRADO (incidencia +
 * bitácora, visible en el panel) y una respuesta de emergencia, no de
 * negocio. La incidencia queda sin viaje ni operador: es del tenant.
 */
export async function atenderAsistenciaOficina(
  cuenta: CuentaReconoce,
  texto: string,
  asistencia: Asistencia,
  waMessageId?: string | null,
): Promise<string | null> {
  if (asistencia.nivel !== 'rojo') return null;   // ámbar de oficina no es de este circuito
  if (!cuenta.tenantId) return null;              // superadmin sin flota: nada que registrar

  const tipo = tipoDeAsistencia(texto, 'rojo');
  const hayLesionados = lesionadosSegunTexto(texto);

  // La "abierta de oficina": sin viaje ni operador. Un segundo mensaje de la
  // misma emergencia se anota como evento, no duplica la incidencia.
  let abiertaId: string | null = null;
  try {
    const { data, error } = await acotada(supabaseAdmin()
      .from('incidencia').select('id')
      .eq('tenant_id', cuenta.tenantId)
      .in('tipo', [...TIPOS_ASISTENCIA])
      .neq('estado', 'resuelta')
      .is('viaje_id', null).is('operador_id', null)
      .order('abierta_en', { ascending: false })
      .limit(1), 'asistencia.abiertaOficina');
    if (error) throw new Error(error.message);
    abiertaId = ((data ?? [])[0]?.id as string) ?? null;
  } catch (e) {
    logger.error('asistencia.oficina_abierta_ilegible', { tenant: cuenta.tenantId, err: e instanceof Error ? e.message : String(e) });
    return 'No pude registrar la emergencia ahorita 😕. Si hay lesionados marca 911 primero; el registro se puede hacer en el panel.';
  }

  if (abiertaId) {
    await anotarEventoIncidencia(cuenta.tenantId, abiertaId, 'mensaje_adicional', { texto: texto.slice(0, 500), de: 'oficina' }, waMessageId);
    return 'Anotado en la emergencia ya registrada 🚨 — el detalle queda en el panel.';
  }

  try {
    const incidenciaId = await crearIncidencia(cuenta.tenantId, {
      tipo,
      prioridad: 'critica',
      descripcion: texto.slice(0, 500),
      hayLesionados,
    });
    await anotarEventoIncidencia(cuenta.tenantId, incidenciaId, 'abierta', { nivel: 'rojo', tipo, de: 'oficina' }, waMessageId);
    logger.info('asistencia.oficina_abierta', { incidencia: incidenciaId, tipo, por: cuenta.userId });
  } catch (e) {
    logger.error('asistencia.oficina_crear_fallo', { tenant: cuenta.tenantId, err: e instanceof Error ? e.message : String(e) });
    return 'No pude registrar la emergencia ahorita 😕. Si hay lesionados marca 911 primero; el registro se puede hacer en el panel.';
  }
  return `Registrado como ${ROTULO_TIPO[tipo]} con prioridad crítica 🚨 — ya está en el panel de incidencias. Si hay lesionados marca 911 primero; el 800 de tu aseguradora está en tu póliza.`;
}
