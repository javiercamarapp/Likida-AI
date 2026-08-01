// Resolución de operador por teléfono + estado de conversación WhatsApp.
// El estado (últimos turnos + viaje activo) vive en wa_conversacion.estado jsonb.

import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import type { TenantContext } from '@/lib/agents/types';

export interface ResolvedOperador {
  tenantId: string;
  operadorId: string;
  nombre: string;
  telefono: string;
}

export interface ConvTurn {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Las formas en que el MISMO número mexicano puede llegar desde WhatsApp.
 *
 * México arrastra el "1" que Telmex metió entre la lada de país y el número de
 * celular. WhatsApp lo dejó de usar en 2020 para los `wa_id` nuevos, pero sigue
 * apareciendo: el mismo teléfono llega como `529993700779` o como
 * `5219993700779` según por dónde entre, y la búsqueda del operador es una
 * igualdad exacta contra la columna.
 *
 * El modo de fallo es el peor de todos para depurar: el sistema contesta
 * "no te tengo registrado" —una frase que suena a dato mal capturado— cuando el
 * operador SÍ está dado de alta y lo único que sobra es un dígito. Y como el
 * mensaje es amable y el webhook devolvió 200, nada en los logs dice "error".
 *
 * Se generan las variantes en vez de normalizar a una sola forma porque la
 * columna ya puede tener cualquiera de las dos: hay flotas capturadas a mano.
 * Aquí no se decide cuál es la buena, se aceptan las dos.
 *
 * Y el "+" es el mismo problema con otra cara, encontrado en la propia semilla
 * del demo: los operadores están guardados como `+521111111101` mientras que
 * Meta manda el `wa_id` sin signo (`521111111101`). Con la igualdad exacta que
 * había, NINGUNO de los operadores de demostración habría resuelto nunca.
 */
export function variantesTelefono(telefono: string): string[] {
  const limpio = telefono.replace(/[^\d]/g, '');
  const nums = new Set<string>([limpio]);
  // 52 + 1 + 10 dígitos → también sin el 1.
  const con1 = /^521(\d{10})$/.exec(limpio);
  if (con1) nums.add(`52${con1[1]}`);
  // 52 + 10 dígitos → también con el 1.
  const sin1 = /^52(\d{10})$/.exec(limpio);
  if (sin1) nums.add(`521${sin1[1]}`);
  // Cada forma, con y sin "+": la columna tiene una y el webhook trae la otra.
  const vistas = new Set<string>([telefono]);
  for (const n of nums) { vistas.add(n); vistas.add(`+${n}`); }
  return [...vistas];
}

/** Resuelve el operador (y su flota) por número de WhatsApp. */
export async function resolveOperador(telefono: string): Promise<ResolvedOperador | null> {
  const { data, error } = await supabaseAdmin()
    .from('operador')
    .select('id, tenant_id, nombre, telefono')
    .in('telefono', variantesTelefono(telefono))
    .eq('activo', true)
    // DOS, no una. `.limit(1)` recortaba ANTES de que `maybeSingle()` mirara, así
    // que ante dos filas no fallaba: devolvía una arbitraria —sin `order by`— y
    // con ella se decidía el `tenant_id` con el que se escriben el gasto y la
    // liquidación. En un producto multi-tenant eso es dinero de una flota
    // anotado en la de otra, y en silencio.
    //
    // Esta función es la que DETERMINA el tenant, así que no puede filtrar por
    // él: lo único correcto ante la ambigüedad es negarse.
    .limit(2);
  // "No está dado de alta" y "no pude preguntar" NO son lo mismo, y `error || !data`
  // los volvía la misma cosa. Con un fallo transitorio de Supabase, un operador que
  // SÍ existe recibía "no te tengo registrado" —una frase que suena a dato mal
  // capturado— y no quedaba una sola línea en el log. Es la misma confusión que ya
  // se corrigió en el diagnóstico de migraciones el 28-jul; vivía aquí también.
  //
  // Sin respuesta no se afirma nada: se lanza, y el llamador decide qué decirle al
  // operador. `null` queda reservado para lo que de verdad significa: no existe.
  if (error) throw new ConsultaFallida(`operador por teléfono: ${error.message}`);
  const filas = data ?? [];
  if (filas.length === 0) return null;
  if (filas.length > 1) {
    // Se registra con los tenants implicados: es lo único que permite arreglar el
    // dato. No se elige uno "por si acaso" — adivinar aquí escribe dinero en la
    // flota equivocada y nadie lo nota hasta la conciliación.
    logger.error('operador.ambiguo', {
      telefono,
      tenants: [...new Set(filas.map((f) => f.tenant_id as string))],
      operadores: filas.map((f) => f.id as string),
    });
    throw new OperadorAmbiguo(`el teléfono ${telefono} corresponde a más de un operador activo`);
  }
  const fila = filas[0];
  return { tenantId: fila.tenant_id as string, operadorId: fila.id as string, nombre: fila.nombre as string, telefono: fila.telefono as string };
}

/**
 * La base no contestó. NO es "no existe": es que no se sabe.
 *
 * Existe como tipo propio para que el llamador pueda distinguirla de cualquier
 * otro error y decirle al operador algo cierto —"no pude consultar, inténtalo de
 * nuevo"— en vez de una negación inventada.
 */
export class ConsultaFallida extends Error {
  constructor(mensaje: string) { super(mensaje); this.name = 'ConsultaFallida'; }
}

/**
 * El mismo teléfono resuelve a más de un operador activo.
 *
 * No se puede decidir de quién es el dinero, así que no se decide. Es un dato
 * que hay que corregir en la base, no una situación que el código deba salvar
 * eligiendo uno.
 */
export class OperadorAmbiguo extends Error {
  constructor(mensaje: string) { super(mensaje); this.name = 'OperadorAmbiguo'; }
}

/** Viaje abierto del operador (el que se está liquidando). */
export async function getOpenViaje(tenantId: string, operadorId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin()
    .from('viaje')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('operador_id', operadorId)
    .in('estatus', ['abierto', 'en_cuadre'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  // Misma distinción que en `resolveOperador`, y aquí es peor: un error de red en
  // la RE-VERIFICACIÓN posterior al mutex hacía que el operador recibiera "ese
  // viaje ya quedó cerrado 👍" sobre un viaje que sigue `abierto`, sin liquidación,
  // sin PDF y sin log. El producto afirmaba un hecho falso sobre su dinero.
  if (error) throw new ConsultaFallida(`viaje abierto: ${error.message}`);
  if (!data) return null;
  return data.id as string;
}

export async function getTenantContext(tenantId: string): Promise<TenantContext> {
  const { data } = await supabaseAdmin().from('tenant').select('nombre').eq('id', tenantId).maybeSingle();
  return {
    tenantId,
    nombreFlota: (data?.nombre as string) || 'la flota',
    // EL NOMBRE QUE EL OPERADOR LEE PRIMERO. Decía 'Cuadra', que es el nombre
    // viejo del repo, y el operador terminaba leyendo LOS DOS en la misma
    // pantalla: el aviso de privacidad dice "Likida procesa esta información por
    // cuenta de la empresa" y tres líneas después llegaba "Soy Cuadra".
    //
    // Dos nombres para lo mismo, en el primer contacto, ante alguien que no sabe
    // nada del producto. Se detectó el 1-ago mirando la conversación real, no el
    // código: en el fuente `agentName: 'Cuadra'` se lee como una constante
    // cualquiera.
    //
    // Misma familia que `cuadra.mx` impreso en el pie del PDF. `marca.test.ts`
    // vigila que no vuelvan a separarse.
    agentName: 'Likida',
    timezone: 'America/Mexico_City',
  };
}

const MAX_TURNS = 12;

/**
 * Carga la conversación del teléfono, con los turnos DE ESTE VIAJE.
 *
 * `viaje_id` se guardaba en la fila y no se usaba nunca como condición de
 * lectura: la conversación estaba modelada por (tenant, teléfono) y arrastraba
 * los turnos del viaje anterior al prompt del siguiente. `saveConversation` pone
 * `viaje_id = null` al cerrar pero CONSERVA los turnos, así que el último
 * "Listo, cuadré tu viaje 👇 • Comprobado: $5,000.00 • Anticipo: $6,000.00" del
 * viaje A entraba como contexto del viaje B, que tiene otro anticipo.
 *
 * Si el modelo repite una cifra, `guardiaCifras` lo tapa. Si concluye "eso ya lo
 * cerré", no lo tapa nada — es munición para la afirmación de estado falsa. Y
 * encima se pagan tokens de un viaje ajeno en cada turno.
 */
export async function loadConversation(tenantId: string, telefono: string, viajeId: string | null): Promise<{ id: string; turns: ConvTurn[] }> {
  const admin = supabaseAdmin();
  const { data, error } = await admin
    .from('wa_conversacion')
    .select('id, estado, viaje_id')
    .eq('tenant_id', tenantId)
    .eq('telefono', telefono)
    .maybeSingle();
  // AUDITORÍA 8, ALTO: era la única vecina de `getOpenViaje`/`resolveOperador`
  // que descartaba `error`. Un blip de Supabase se leía como "no existe la
  // conversación", caía al INSERT de abajo, chocaba con
  // `wa_conversacion_tenant_tel_uidx` (23505), y el turno del asistente que el
  // operador SÍ leyó se perdía — el agente arrancaba el siguiente mensaje sin
  // memoria de lo que ya se dijo.
  if (error) throw new ConsultaFallida(`loadConversation: ${error.message}`);
  if (data) {
    const estado = (data.estado as { turns?: ConvTurn[] }) || {};
    // El historial pertenece al viaje en el que se dijo. Si la fila viene de otro
    // viaje —o de ninguno, porque el anterior ya cerró— se empieza limpio.
    const mismoViaje = viajeId !== null && data.viaje_id === viajeId;
    if (!mismoViaje && (estado.turns?.length ?? 0) > 0) {
      logger.info('conv.historial_descartado', { telefono, de: data.viaje_id ?? null, a: viajeId });
    }
    return { id: data.id as string, turns: mismoViaje ? (estado.turns ?? []).slice(-MAX_TURNS) : [] };
  }
  const { data: created } = await admin
    .from('wa_conversacion')
    .insert({ tenant_id: tenantId, telefono, viaje_id: viajeId, estado: { turns: [] } })
    .select('id')
    .single();
  return { id: (created?.id as string) ?? '', turns: [] };
}

/**
 * Resultado de reclamar un mensaje. Son TRES estados, no dos: la diferencia entre
 * "ya lo procesamos" y "no pude averiguarlo" decide si el operador recibe
 * respuesta o se queda sin nada.
 */
export type Claim = 'nuevo' | 'duplicado' | 'indeterminado';

/**
 * Reclama un mensaje de WhatsApp de forma atómica (idempotencia).
 *
 * ANTES devolvía un booleano y trataba cualquier error de DB como "duplicado",
 * con el argumento de que "el retry de Meta lo reprocesará cuando la DB
 * responda". Ese retry NO EXISTE: `route.ts` responde 200 y hace el trabajo en
 * `after()`, así que Meta ya recibió su acuse y no reintenta nunca —lo dice el
 * propio comentario de `presupuesto.ts`—. Un blip de Supabase en el insert hacía
 * que el "listo" del operador desapareciera para siempre, con un log de nivel
 * info que además mentía llamándolo duplicado.
 *
 * Ahora el caso indeterminado se distingue y lo decide el llamador, que es quien
 * sabe si lo que está en juego es dinero o una respuesta.
 */
export async function claimMessage(waMessageId: string): Promise<Claim> {
  if (!waMessageId) return 'nuevo';
  const { error } = await supabaseAdmin()
    .from('wa_mensaje_procesado')
    .insert({ wa_message_id: waMessageId });
  if (!error) return 'nuevo';
  // 23505 = unique_violation → ya existía → duplicado de verdad (no reprocesar).
  if (error.code === '23505') return 'duplicado';
  logger.error('wa.claim_error', { code: error.code, msg: error.message });
  return 'indeterminado';
}

// AUDITORÍA 8, ALTO: no lanza a propósito — para cuando esto corre, la
// respuesta (y el PDF) ya pudieron haberse entregado, y el catch general de
// `processInbound` mandaría un segundo mensaje "se me trabó" contradiciendo
// una respuesta que sí llegó. Pero antes tampoco miraba `error`: un `.eq('id',
// '')` sobre un `convId` vacío (el que devuelve `loadConversation` cuando su
// propio INSERT choca) no actualizaba nada y no lo decía nadie. Ahora al
// menos queda un ERROR en el log — se pierde el turno, no el rastro de que se
// perdió.
export async function saveConversation(convId: string, turns: ConvTurn[], viajeId: string | null): Promise<void> {
  const { error } = await supabaseAdmin()
    .from('wa_conversacion')
    .update({ estado: { turns: turns.slice(-MAX_TURNS) }, viaje_id: viajeId, updated_at: new Date().toISOString() })
    .eq('id', convId);
  if (error) logger.error('conv.no_se_guardo', { convId, err: error.message });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * ¿El error dice que la función NO EXISTE? Eso es una migración sin aplicar, no
 * un tropiezo de red: reintentarlo no cambia nada.
 *
 * PGRST202 es el código de PostgREST para "no encontré esa función"; el texto se
 * revisa además por si la capa de error cambia de forma.
 */
function rpcAusente(error: { code?: string; message?: string }): boolean {
  if (error.code === 'PGRST202' || error.code === '42883') return true;
  const m = (error.message ?? '').toLowerCase();
  return m.includes('could not find the function') || m.includes('does not exist');
}

/**
 * Mutex por viaje (AL-1/CR-1): serializa el procesamiento de mensajes del mismo
 * viaje para que un "listo" no cierre la liquidación antes de que el OCR de la
 * última foto haya guardado su gasto. Reintenta con backoff hasta maxWaitMs;
 * devuelve false si no logró el lease (otro after() lo tiene vigente).
 */
export async function acquireViajeLock(viajeId: string, opts?: { ttlMs?: number; maxWaitMs?: number }): Promise<boolean> {
  const ttlMs = opts?.ttlMs ?? 60_000;
  const maxWaitMs = opts?.maxWaitMs ?? 12_000;
  const admin = supabaseAdmin();
  const start = Date.now();
  let delay = 150;
  let ultimoError: { code?: string; message?: string } | null = null;
  for (;;) {
    const { data, error } = await admin.rpc('try_lock_viaje', { p_viaje: viajeId, p_ttl_ms: ttlMs });
    if (!error && data === true) return true;
    if (error) {
      ultimoError = error;
      // Se distingue el error PERMANENTE del TRANSITORIO. Antes los dos abrían
      // el mutex de inmediato, y solo uno de los dos lo merece.
      //
      // AUSENTE (la migración 0005 no está aplicada): se cae el mutex Y el
      // unique(viaje_id) juntos. Reintentar no va a hacer aparecer la función, y
      // bloquear dejaría al operador sin respuesta por un problema de
      // despliegue. Se abre — con ERROR, no warn, porque es la protección de
      // doble cierre — y el arranque ya falla ruidoso por esto
      // (ver instrumentation.ts).
      if (rpcAusente(error)) {
        logger.error('viaje.lock_rpc_ausente', { code: error.code, msg: error.message });
        return true;
      }
      // TRANSITORIO (timeout, pool agotado, 503): un error no significa que el
      // lock esté libre, significa que no se supo. Abrir de golpe deja correr
      // dos "listo" completos sobre el mismo viaje — dos ciclos de agente, dos
      // cierres. Se reintenta como si estuviera ocupado; abajo decide qué hacer
      // si la ventana se agota.
      logger.warn('viaje.lock_error_transitorio', { code: error.code, msg: error.message });
    }
    if (Date.now() - start >= maxWaitMs) {
      // Se agotó la ventana. Ocupado de verdad → false (otro lo tiene, y ese
      // otro va a responder). Fallando todo el rato → se abre para no dejar al
      // operador colgado, pero después de haberlo intentado, no al primer
      // tropiezo, y queda como ERROR.
      if (ultimoError) {
        logger.error('viaje.lock_error_persistente', { code: ultimoError.code, msg: ultimoError.message });
        return true;
      }
      return false;
    }
    await sleep(delay);
    delay = Math.min(delay * 2, 1500);
  }
}

/**
 * Barrera de ráfaga (contador de OCR en vuelo). Incremento/decremento atómico;
 * devuelve el nuevo contador. Las fotos hacen +1 al entrar y -1 al terminar.
 */
/**
 * Devuelve `null` cuando NO se pudo consultar. NO cero.
 *
 * Devolvía 0 ante cualquier error, y 0 significa además "no hay nada en vuelo",
 * así que un blip de la RPC ABRÍA la barrera: `esperarIntake` sondea con
 * `intakeDelta(id, 0)`, veía 0, y devolvía `true` de inmediato.
 *
 * Escenario medido: el operador manda 5 fotos, la #5 sigue en OCR cuando llega
 * "listo", y el sondeo cae por un 503 transitorio. La barrera se abre, el agente
 * cuadra con 4 comprobantes, y si el #5 era el diésel de $8,000 la liquidación
 * cierra con $8,000 menos comprobados —con el PDF emitido y el viaje ya
 * `liquidado`—. El operador termina debiendo de su bolsa un gasto que sí hizo. Y
 * como `intakeOk` salía `true`, tampoco se le avisaba.
 *
 * Es la misma confusión que ya se corrigió hoy en el diagnóstico de migraciones y
 * en `resolveOperador`: un fallo de consulta disfrazado del valor que significa
 * "no hay". Aquí el disfraz cuesta dinero del operador.
 */
export async function intakeDelta(viajeId: string, delta: number): Promise<number | null> {
  const { data, error } = await supabaseAdmin().rpc('intake_delta', { p_viaje: viajeId, p_delta: delta });
  if (error) {
    // El viaje va en el log: sin él, a la mañana siguiente no se puede saber CUÁL
    // liquidación salió corta.
    logger.warn('intake.delta', { viaje: viajeId, delta, code: error.code, msg: error.message });
    return null;
  }
  return typeof data === 'number' ? data : null;
}

/**
 * Espera a que NO haya OCR de fotos en vuelo para el viaje (contador = 0). Es la
 * barrera que garantiza que el "listo" cuadre sobre TODOS los gastos, no parciales.
 * NUNCA espera indefinido: tope configurable (env CUADRA_INTAKE_ESPERA_MS, default
 * 60s). Devuelve true si se vació, false si venció el tope (→ el caller avisa al
 * operador y cuadra con lo que alcanzó). El decremento vive en el `finally` del
 * intake, así que un OCR que truena igual libera su +1.
 */
export async function esperarIntake(
  viajeId: string,
  timeoutMs?: number,
  // probe inyectable SOLO para test (default = el contador real). No cambia el
  // comportamiento en runtime; permite probar la gracia anti-carrera sin DB.
  probe: (id: string) => Promise<number | null> = (id) => intakeDelta(id, 0),
): Promise<boolean> {
  // Default 20s, NO 60s. El presupuesto de la función es maxDuration=60 y por
  // debajo de esta barrera todavía corren el lock (12s) y el agente (40s): con
  // 60s aquí el peor caso son 112s, y cuando revienta Meta YA recibió su 200 OK
  // y el mensaje quedó marcado como procesado. Ese "listo" se pierde sin
  // reintento y sin que nadie se entere. El env puede subirlo si el plan aguanta.
  const tope = timeoutMs ?? (Number(process.env.CUADRA_INTAKE_ESPERA_MS) || 20_000);
  // AUDIT_V3 orquestación CRÍTICO (carrera de barrera): cuando fotos y "listo"
  // llegan en el MISMO lote, corren en Promise.all; el "listo" puede leer el
  // contador ANTES de que una foto registre su +1 → ve 0 → cuadra sobre parciales.
  // GRACIA inicial: si el contador arranca en 0, se espera una ventana corta para
  // dar tiempo a que las fotos de la ráfaga incrementen antes de confiar en el 0.
  // FLAG (HARD RULE 3): default 0 = comportamiento actual EXACTO. Se recomienda
  // ~2000ms para el demo (ver DECISIONES_PENDIENTES / REPORTE_NOCHE).
  // Default 2s. Con 0 la carrera fotos+"listo" cierra sobre datos parciales, y es
  // el ÚNICO camino que no le avisa nada al operador: su liquidación sale corta.
  const grace = Number(process.env.CUADRA_INTAKE_GRACE_MS) || 2_000;
  const start = Date.now();
  // `null` es "no sé", y no puede abrir la barrera. Fail-CLOSED: se sigue
  // esperando hasta el tope y se devuelve `false`, que es lo que hace que el
  // operador reciba el aviso de "cuadré con los N que alcancé a procesar". Antes
  // un error de RPC devolvía 0 y abría la barrera en silencio, que es el único
  // camino en el que la liquidación sale corta SIN decírselo a nadie.
  const vacio = async (): Promise<boolean> => {
    const n = await probe(viajeId);
    return n !== null && n <= 0;
  };
  if (grace > 0 && (await vacio())) {
    await sleep(Math.min(grace, tope));
  }
  for (;;) {
    if (await vacio()) return true;
    if (Date.now() - start >= tope) return false;
    await sleep(500);
  }
}

/** Libera el mutex del viaje (best-effort; si falla, expira por TTL). */
export async function releaseViajeLock(viajeId: string): Promise<void> {
  try {
    await supabaseAdmin().rpc('unlock_viaje', { p_viaje: viajeId });
  } catch (e) {
    logger.warn('viaje.unlock', { err: e instanceof Error ? e.message : String(e) });
  }
}

/**
 * Libera el claim de idempotencia de un mensaje (CR-2): si el procesamiento
 * crashea, se borra la marca para que el retry de Meta lo reprocese (at-least-once).
 */
export async function releaseMessageClaim(waMessageId: string): Promise<void> {
  if (!waMessageId) return;
  try {
    await supabaseAdmin().from('wa_mensaje_procesado').delete().eq('wa_message_id', waMessageId);
  } catch (e) {
    logger.warn('wa.release_claim', { err: e instanceof Error ? e.message : String(e) });
  }
}
