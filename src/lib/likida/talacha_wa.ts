import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { acotada } from './presupuesto';
import { strip_accents } from './cuadre/util';
import { crearIncidencia } from './operacion';
import { telefonoJefeDe } from './contactos';
import type { RolOficina } from './contactos';
import { sendText, sendButtons } from '@/lib/meta/client';
import { puedeAsignar } from '@/lib/auth/permisos';
import { mxn } from '@/lib/formato';

// ═══════════════════════════════════════════════════════════════════════════
// LA TALACHA AUTORIZADA POR WHATSAPP (0107, F4 del plan) — el circuito que
// Transportes Innovativos describió: el chofer reporta "se me ponchó una
// llanta" (con o sin la foto de la nota), el JEFE recibe la solicitud por
// WhatsApp con el monto si lo hay, y AUTORIZA O RECHAZA respondiendo. La
// decisión queda FIRMADA en la incidencia — quién y cuándo — porque el
// agente prepara y marca, pero NUNCA autoriza solo (§4.6).
//
// ── POR QUÉ EL RECONOCIMIENTO ES POR PALABRA CERRADA, NO POR FRASE ─────────
// A diferencia de los hitos ("ya llegué" es corto y estable), un reporte de
// avería trae contexto libre: "se me ponchó una llanta aquí en la caseta,
// la talacha me cobra 800". Exigir la frase completa dejaría fuera casi
// todos los reportes reales. Se exige en cambio una PALABRA del oficio
// (talacha, ponchadura, avería...) como palabra completa — lo que no la
// traiga sigue su camino al agente, que sí puede leer contexto. El daño del
// falso positivo es medio (una incidencia de más y un aviso al jefe, que un
// humano descarta), y el del falso negativo es bajo (el agente contesta);
// por eso la lista puede ser un poco más ancha que la de hitos.
//
// ── EL MONTO NUNCA SE INVENTA ──────────────────────────────────────────────
// Solo se lee un número que venga AMARRADO a dinero ($, "pesos", "me
// cobran..."). "llanta 295/80" trae números y ninguno es un precio. Y si el
// mensaje trae DOS cifras de dinero distintas, no se adivina cuál es: el
// monto queda en NULL y el flujo lo pide. NULL = no reportado, jamás $0.
//
// ── DÓNDE VIVE LA DECISIÓN Y POR QUÉ ES ATÓMICA ────────────────────────────
// En `incidencia.autorizacion` (0107). El claim es un UPDATE condicional
// `WHERE autorizacion = 'pendiente'` — el mismo patrón de sello de
// 0058/0087/0090: si el jefe aprieta el botón dos veces (o dos jefes a la
// vez), gana exactamente uno y el segundo recibe la verdad, no una re-firma.
// ═══════════════════════════════════════════════════════════════════════════

const MAX_LARGO_REPORTE = 220;

/** minúsculas, sin acentos, sin puntuación/emoji, espacios colapsados —
 *  el mismo aplanado que hitos_viaje, para reconocer, no para extraer. */
function limpiar(texto: string): string {
  return strip_accents(texto.toLowerCase())
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Las palabras del oficio, ya sin acentos. CERRADA: agregar una = una línea
 *  y un test que la fije. "llanta" sola NO está a propósito: "voy a checar la
 *  llanta" no es un reporte de avería. */
const PALABRAS_TALACHA =
  /\b(talacha|ponchadura|poncho|ponchamos|ponche|averia|descompuso|descompostura|vulcanizadora|desbielo|se trono)\b/;

export interface ReporteTalacha {
  /** Pesos leídos del texto. `null` = no dijo monto o no se pudo leer SIN
   *  ambigüedad. Nunca una aproximación. */
  monto: number | null;
}

/**
 * ¿El mensaje es un reporte de talacha/avería? `null` = no lo es y sigue su
 * camino (al agente en el chofer, al saludo en la oficina).
 */
export function interpretarTalacha(texto: string | undefined): ReporteTalacha | null {
  if (typeof texto !== 'string' || !texto.trim()) return null;
  if (texto.length > MAX_LARGO_REPORTE) return null;
  const t = limpiar(texto);
  if (!PALABRAS_TALACHA.test(t)) return null;
  return { monto: extraerMonto(texto) };
}

/**
 * El número SOLO cuenta si viene amarrado a dinero. Tres amarres reales:
 * `$800`, `800 pesos/varos`, y "me cobran 800". Si hay más de una cifra y no
 * coinciden, no se adivina: `null`, y el circuito pide el monto.
 */
export function extraerMonto(texto: string): number | null {
  const t = strip_accents(texto.toLowerCase());
  const encontrados = new Set<number>();
  const patrones = [
    /\$\s*([\d][\d,]{0,9}(?:\.\d{1,2})?)/g,
    /\b([\d][\d,]{0,9}(?:\.\d{1,2})?)\s*(?:pesos|varos|mxn)\b/g,
    /\b(?:son|cuesta|cuestan|cobra|cobran|me cobran|sale en|salio en|piden|me piden|costo)\s+(?:como\s+)?\$?\s*([\d][\d,]{0,9}(?:\.\d{1,2})?)\b/g,
  ];
  for (const p of patrones) {
    for (const m of t.matchAll(p)) {
      const n = Number(m[1].replace(/,/g, ''));
      if (Number.isFinite(n) && n > 0) encontrados.add(n);
    }
  }
  if (encontrados.size !== 1) return null;
  return [...encontrados][0];
}

// ── El lado del CHOFER: abrir/completar la solicitud ───────────────────────

interface PendienteExistente {
  id: string;
  monto: number | null;
  evidencia: string | null;
  gastoId: string | null;
}

/** La talacha pendiente de este viaje, si la hay. Lanza ante error de base:
 *  crear a ciegas sin saber si ya existe duplicaría la solicitud al jefe. */
async function pendienteDelViaje(tenantId: string, viajeId: string): Promise<PendienteExistente | null> {
  const { data, error } = await acotada(supabaseAdmin()
    .from('incidencia')
    .select('id, monto_estimado, evidencia_path, gasto_id')
    .eq('tenant_id', tenantId).eq('viaje_id', viajeId)
    .eq('tipo', 'averia').eq('autorizacion', 'pendiente')
    .order('abierta_en', { ascending: false })
    .limit(1), 'talacha.pendienteDelViaje');
  if (error) throw new Error(`talacha.pendienteDelViaje: ${error.message}`);
  const f = (data ?? [])[0];
  if (!f) return null;
  return {
    id: f.id as string,
    monto: f.monto_estimado == null ? null : Number(f.monto_estimado),
    evidencia: (f.evidencia_path as string) || null,
    gastoId: (f.gasto_id as string) || null,
  };
}

/** Etiquetas para el aviso al jefe. Best-effort A PROPÓSITO: son rótulos, no
 *  cifras — si la lectura falla, el aviso sale con "tu chofer"/"en curso" y
 *  se loguea; detener la solicitud por un rótulo dejaría la avería sin jefe. */
async function etiquetasAviso(tenantId: string, viajeId: string, operadorId: string): Promise<{ chofer: string; folio: string | null }> {
  try {
    const admin = supabaseAdmin();
    const [rOp, rViaje] = await Promise.all([
      admin.from('operador').select('nombre').eq('id', operadorId).eq('tenant_id', tenantId).maybeSingle(),
      admin.from('viaje').select('folio').eq('id', viajeId).eq('tenant_id', tenantId).maybeSingle(),
    ]);
    return {
      chofer: (rOp.data?.nombre as string) || 'Tu chofer',
      folio: (rViaje.data?.folio as string) || null,
    };
  } catch (e) {
    logger.warn('talacha.etiquetas_ilegibles', { viaje: viajeId, err: e instanceof Error ? e.message : String(e) });
    return { chofer: 'Tu chofer', folio: null };
  }
}

/**
 * Manda la solicitud al jefe con sus botones. `true` solo si Meta la aceptó —
 * el llamador le dice al chofer la VERDAD de si su jefe ya la tiene.
 */
async function avisarAlJefe(args: {
  tenantId: string;
  incidenciaId: string;
  chofer: string;
  folio: string | null;
  descripcion: string;
  monto: number | null;
  conFoto: boolean;
}): Promise<boolean> {
  let telefono: string | null = null;
  try {
    telefono = await telefonoJefeDe(args.tenantId);
  } catch (e) {
    logger.error('talacha.jefe_ilegible', { tenant: args.tenantId, err: e instanceof Error ? e.message : String(e) });
    return false;
  }
  if (!telefono) {
    logger.warn('talacha.sin_jefe', { tenant: args.tenantId, incidencia: args.incidenciaId });
    return false;
  }
  // El texto del chofer va con comillas y recortado: es SU reporte, no una
  // interpretación nuestra. La cifra solo aparece si existe.
  const desc = args.descripcion.replace(/\s+/g, ' ').trim().slice(0, 180);
  const cuerpo =
    `🔧 ${args.chofer} reporta una avería en ${args.folio ? `el viaje ${args.folio}` : 'su viaje en curso'}:\n` +
    `«${desc}»\n\n` +
    (args.monto !== null ? `Monto estimado: ${mxn(args.monto)}.` : 'Aún sin monto.') +
    (args.conFoto ? ' Ya mandó la foto de la nota.' : '') +
    `\n\n¿La autorizas? El gasto llegará marcado a la liquidación con tu decisión.`;
  const enviado = await sendButtons(telefono, cuerpo, [
    { id: `tal_si:${args.incidenciaId}`, titulo: 'Autorizar' },
    { id: `tal_no:${args.incidenciaId}`, titulo: 'Rechazar' },
  ]);
  return Boolean(enviado);
}

/** Lo que se le contesta al chofer cuando la solicitud SÍ le llegó al jefe. */
function acuseChofer(monto: number | null, conEvidencia: boolean): string {
  const partes = [
    monto !== null
      ? `Anotado 🔧 — le mandé a tu jefe la solicitud de ${mxn(monto)} para que la autorice.`
      : 'Anotado 🔧 — le avisé a tu jefe de la avería.',
    'En cuanto decida, te digo por aquí.',
  ];
  if (monto === null) partes.push('¿Cuánto te cobran? Mándame el monto para pasárselo.');
  if (!conEvidencia) partes.push('Y mándame la *foto de la nota* con este mismo texto para dejarla de evidencia. 📸');
  return partes.join(' ');
}

/**
 * El turno de un reporte de talacha del CHOFER — texto solo, o foto con su
 * caption. Devuelve SIEMPRE la respuesta a mandar: quien llama ya decidió que
 * el mensaje es talacha (`interpretarTalacha`).
 *
 * UNA solicitud pendiente por viaje: si ya hay una, el reporte repetido no
 * duplica — completa lo que falte (monto, foto, gasto) y, si el monto apenas
 * llegó, se le reenvía al jefe la solicitud ya con cifra.
 */
export async function atenderTalachaChofer(args: {
  tenantId: string;
  viajeId: string;
  operadorId: string;
  /** El texto del chofer tal cual — es la descripción que el jefe lee. */
  texto: string;
  monto: number | null;
  evidenciaPath?: string | null;
  gastoId?: string | null;
}): Promise<string> {
  let pendiente: PendienteExistente | null;
  try {
    pendiente = await pendienteDelViaje(args.tenantId, args.viajeId);
  } catch (e) {
    // Fallar cerrado: sin saber si ya existe, crear duplicaría la solicitud.
    logger.error('talacha.pendiente_ilegible', { viaje: args.viajeId, err: e instanceof Error ? e.message : String(e) });
    return 'No pude anotar la avería ahorita 😕 — mándamelo de nuevo en un momento. Si es urgente, márcale directo a tu jefe.';
  }

  if (pendiente) {
    // Completar SOLO lo que falta: el primer dato reportado manda, el
    // repetido no lo pisa (mismo criterio que el sello de hitos).
    const cambios: Record<string, unknown> = {};
    if (pendiente.monto === null && args.monto !== null) cambios.monto_estimado = args.monto;
    if (!pendiente.evidencia && args.evidenciaPath) cambios.evidencia_path = args.evidenciaPath;
    if (!pendiente.gastoId && args.gastoId) cambios.gasto_id = args.gastoId;

    if (Object.keys(cambios).length === 0) {
      return 'Ya tengo anotada esa avería y tu jefe tiene la solicitud 👍. En cuanto decida, te aviso por aquí.';
    }
    const { error } = await acotada(supabaseAdmin()
      .from('incidencia')
      .update(cambios)
      .eq('id', pendiente.id).eq('tenant_id', args.tenantId)
      // Solo mientras siga pendiente: una decidida ya no se completa — la
      // foto que llegue después queda en el gasto, que es donde se consulta.
      .eq('autorizacion', 'pendiente'), 'talacha.completar');
    if (error) {
      logger.error('talacha.completar_fallo', { incidencia: pendiente.id, err: error.message });
      return 'No pude completar el reporte ahorita 😕 — mándamelo de nuevo en un momento.';
    }
    // Si el monto APENAS llegó, el jefe todavía no lo tiene: se le reenvía la
    // solicitud ya con cifra, que es con lo que puede decidir.
    if (cambios.monto_estimado !== undefined) {
      const etiquetas = await etiquetasAviso(args.tenantId, args.viajeId, args.operadorId);
      const avisado = await avisarAlJefe({
        tenantId: args.tenantId,
        incidenciaId: pendiente.id,
        chofer: etiquetas.chofer,
        folio: etiquetas.folio,
        descripcion: args.texto,
        monto: args.monto,
        conFoto: Boolean(pendiente.evidencia || args.evidenciaPath),
      });
      logger.info('talacha.monto_completado', { incidencia: pendiente.id, avisado });
      return avisado
        ? `Anotado: ${mxn(args.monto!)} 🔧. Le pasé la cifra a tu jefe — en cuanto autorice te aviso.`
        : `Anoté los ${mxn(args.monto!)} 🔧, pero NO pude reenviarle la solicitud a tu jefe por WhatsApp — márcale directo para que la autorice.`;
    }
    logger.info('talacha.completada', { incidencia: pendiente.id, cambios: Object.keys(cambios) });
    return 'Listo, quedó la foto de evidencia en tu reporte 📸. Tu jefe ya tiene la solicitud — en cuanto decida te aviso.';
  }

  // No hay pendiente: se abre la incidencia con TODO lo que este mensaje trajo.
  let incidenciaId: string;
  try {
    incidenciaId = await crearIncidencia(args.tenantId, {
      viajeId: args.viajeId,
      tipo: 'averia',
      // Alta a propósito: una unidad parada en carretera es de lo más caro que
      // le pasa a una flota (dolor #3 del mapa de dolores).
      prioridad: 'alta',
      descripcion: args.texto.slice(0, 300),
      montoEstimado: args.monto,
      evidenciaPath: args.evidenciaPath ?? null,
      gastoId: args.gastoId ?? null,
      autorizacion: 'pendiente',
    });
  } catch (e) {
    logger.error('talacha.crear_fallo', { viaje: args.viajeId, err: e instanceof Error ? e.message : String(e) });
    return 'No pude anotar la avería ahorita 😕 — mándamelo de nuevo en un momento. Si es urgente, márcale directo a tu jefe.';
  }

  const etiquetas = await etiquetasAviso(args.tenantId, args.viajeId, args.operadorId);
  const avisado = await avisarAlJefe({
    tenantId: args.tenantId,
    incidenciaId,
    chofer: etiquetas.chofer,
    folio: etiquetas.folio,
    descripcion: args.texto,
    monto: args.monto,
    conFoto: Boolean(args.evidenciaPath),
  });
  logger.info('talacha.abierta', { incidencia: incidenciaId, viaje: args.viajeId, monto: args.monto, avisado });

  if (!avisado) {
    // La incidencia SÍ quedó (el panel la enseña pendiente); lo que no salió
    // es el WhatsApp al jefe — y eso se dice, no se promete una solicitud que
    // nadie recibió.
    return 'Anoté la avería 🔧 y quedó pendiente de autorización, pero NO le pude mandar el aviso a tu jefe por WhatsApp — márcale directo para que la autorice.';
  }
  return acuseChofer(args.monto, Boolean(args.evidenciaPath));
}

// ── El lado del JEFE: autorizar o rechazar ─────────────────────────────────

export interface CuentaAutoriza {
  /** `null` solo en superadmin sin flota — no hay averías suyas que decidir. */
  tenantId: string | null;
  rol: RolOficina;
  /** El app_user que firma la decisión. */
  userId: string;
}

type Decision = 'autorizada' | 'rechazada';

/** El botón del aviso: `tal_si:<uuid>` / `tal_no:<uuid>`. */
function leerBotonTalacha(texto: string): { decision: Decision; incidenciaId: string } | null {
  const m = /^tal_(si|no):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(texto.trim());
  if (!m) return null;
  return { decision: m[1].toLowerCase() === 'si' ? 'autorizada' : 'rechazada', incidenciaId: m[2] };
}

/**
 * La palabra escrita a mano, SIN el id. Cerrada y anclada: un "sí" o un "no"
 * pelones NO cuentan — esos le pertenecen a las confirmaciones de despacho y
 * asignación, que corren después. La negación se mira primero a propósito:
 * "no autorizo" contiene "autorizo".
 */
function leerPalabraDecision(texto: string): Decision | null {
  const t = limpiar(texto);
  if (/^(no (la |lo )?autorizo|no se autoriza|no autorizada|rechazo|rechazada|rechazala|rechazar)$/.test(t)) return 'rechazada';
  if (/^(si )?(la |lo )?(autorizo|autorizada|autorizala|autorizar|autorizado)$/.test(t)) return 'autorizada';
  return null;
}

/** Aviso al chofer del veredicto. Best-effort: la decisión YA está firmada; el
 *  valor de retorno le permite al jefe saber si el aviso salió de verdad. */
async function avisarVeredictoAlChofer(
  tenantId: string, viajeId: string | null, decision: Decision, monto: number | null,
): Promise<{ avisado: boolean; chofer: string | null }> {
  if (!viajeId) return { avisado: false, chofer: null };
  try {
    const admin = supabaseAdmin();
    const { data: viaje, error: errViaje } = await admin
      .from('viaje').select('operador_id')
      .eq('id', viajeId).eq('tenant_id', tenantId).maybeSingle();
    if (errViaje || !viaje?.operador_id) return { avisado: false, chofer: null };
    const { data: op, error: errOp } = await admin
      .from('operador').select('nombre, telefono')
      .eq('id', viaje.operador_id as string).eq('tenant_id', tenantId).maybeSingle();
    if (errOp || !op?.telefono) return { avisado: false, chofer: (op?.nombre as string) ?? null };
    const cifra = monto !== null ? ` de ${mxn(monto)}` : '';
    const texto = decision === 'autorizada'
      ? `Tu jefe autorizó la talacha${cifra} ✅. Adelante — y mándame la foto de la nota si no la has mandado, para que entre a tu liquidación.`
      : `Tu jefe NO autorizó la talacha${cifra} ❌. Márcale para ver cómo resolverlo.`;
    const id = await sendText(op.telefono as string, texto);
    return { avisado: Boolean(id), chofer: (op.nombre as string) ?? null };
  } catch (e) {
    logger.warn('talacha.veredicto_no_avisado', { viaje: viajeId, err: e instanceof Error ? e.message : String(e) });
    return { avisado: false, chofer: null };
  }
}

/** La firma atómica. Exactamente un ganador por el WHERE `pendiente`. */
async function firmarDecision(
  cuenta: CuentaAutoriza, incidenciaId: string, decision: Decision, ahora: Date,
): Promise<string> {
  const { data, error } = await acotada(supabaseAdmin()
    .from('incidencia')
    .update({
      autorizacion: decision,
      autorizada_por: cuenta.userId,
      autorizada_en: ahora.toISOString(),
    })
    .eq('id', incidenciaId)
    .eq('tenant_id', cuenta.tenantId!)   // tenant del LOOKUP, jamás del texto
    .eq('autorizacion', 'pendiente')
    .select('id, viaje_id, monto_estimado'), 'talacha.firmar');
  if (error) {
    logger.error('talacha.firma_fallo', { incidencia: incidenciaId, err: error.message });
    return 'No pude registrar tu decisión ahorita — inténtalo de nuevo en un momento.';
  }
  const fila = (data ?? [])[0] as { id: string; viaje_id: string | null; monto_estimado: unknown } | undefined;
  if (!fila) {
    // Nadie firmó: o ya estaba decidida (el segundo botón), o el id no es de
    // esta flota. Se lee para decir la verdad exacta — y si ni leer se puede,
    // se dice eso, no "no existe".
    const { data: existente, error: errLee } = await acotada(supabaseAdmin()
      .from('incidencia').select('autorizacion')
      .eq('id', incidenciaId).eq('tenant_id', cuenta.tenantId!)
      .maybeSingle(), 'talacha.releer');
    if (errLee) return 'No pude registrar tu decisión ahorita — inténtalo de nuevo en un momento.';
    if (!existente) return 'No encontré esa solicitud en tu flota.';
    const estado = existente.autorizacion as string | null;
    return estado === 'autorizada' || estado === 'rechazada'
      ? `Esa avería ya estaba ${estado} — no cambié nada.`
      : 'Esa solicitud ya no está pendiente — revísala en el panel.';
  }

  const monto = fila.monto_estimado == null ? null : Number(fila.monto_estimado);
  const r = await avisarVeredictoAlChofer(cuenta.tenantId!, fila.viaje_id, decision, monto);
  logger.info('talacha.decidida', { incidencia: incidenciaId, decision, por: cuenta.userId, avisado: r.avisado });

  const cifra = monto !== null ? ` · ${mxn(monto)}` : '';
  const quien = r.chofer ?? 'tu chofer';
  if (decision === 'autorizada') {
    return r.avisado
      ? `Autorizada ✅${cifra} — ya le avisé a ${quien}. El gasto llegará a la liquidación con tu autorización firmada.`
      : `Autorizada ✅${cifra} y quedó firmada, pero NO le pude avisar a ${quien} por WhatsApp — márcale tú.`;
  }
  return r.avisado
    ? `Rechazada ❌${cifra} — ya le avisé a ${quien}.`
    : `Rechazada ❌${cifra} y quedó firmada, pero NO le pude avisar a ${quien} por WhatsApp — márcale tú.`;
}

/**
 * El turno de un mensaje de OFICINA que puede ser una decisión de talacha.
 * Devuelve la respuesta, o `null` si el mensaje no es de este circuito (el
 * processor sigue con despacho → asignación → informes → saludo).
 *
 * El botón siempre se atiende (un id crudo llegando al saludo se vería roto);
 * la palabra suelta ("autorizo") solo actúa si se sabe SIN ambigüedad a qué
 * pendiente se refiere.
 */
export async function atenderAutorizacionTalacha(
  cuenta: CuentaAutoriza,
  texto: string,
  ahora: Date = new Date(),
): Promise<string | null> {
  if (!texto?.trim()) return null;

  const boton = leerBotonTalacha(texto);
  const palabra = boton ? null : leerPalabraDecision(texto);
  if (!boton && !palabra) return null;

  if (!cuenta.tenantId) {
    // Superadmin sin flota: no hay averías suyas que decidir. El botón se
    // contesta con la verdad; la palabra cae al saludo.
    return boton ? 'Esa solicitud no es de una flota tuya.' : null;
  }

  // El candado de rol ANTES de tocar nada: el contador ve liquidaciones, no
  // autoriza gastos de camino.
  if (!puedeAsignar(cuenta.rol)) {
    return 'Tu rol no autoriza gastos de camino — eso le toca al dueño o al jefe de tráfico.';
  }

  if (boton) return firmarDecision(cuenta, boton.incidenciaId, boton.decision, ahora);

  // Palabra sin id: solo si hay EXACTAMENTE una pendiente en la flota. Con
  // cero se dice la verdad; con varias no se adivina cuál.
  const { data, error } = await acotada(supabaseAdmin()
    .from('incidencia').select('id')
    .eq('tenant_id', cuenta.tenantId)
    .eq('autorizacion', 'pendiente')
    .limit(2), 'talacha.pendientesDeFlota');
  if (error) {
    logger.error('talacha.pendientes_ilegibles', { tenant: cuenta.tenantId, err: error.message });
    return 'No pude consultar las averías pendientes ahorita — inténtalo en un momento.';
  }
  const pendientes = data ?? [];
  if (pendientes.length === 0) return 'No tengo ninguna avería esperando tu autorización.';
  if (pendientes.length > 1) return 'Tienes varias averías esperando decisión — usa los botones del aviso de cada una para no confundirlas.';
  return firmarDecision(cuenta, pendientes[0].id as string, palabra!, ahora);
}
