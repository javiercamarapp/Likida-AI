// Resolución de operador por teléfono + estado de conversación WhatsApp.
// El estado (últimos turnos + viaje activo) vive en wa_conversacion.estado jsonb.

import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import type { TenantContext } from '@/lib/agents/types';
import { acotada } from './presupuesto';
import { violaIndice } from './pg_errores';

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
 * LO QUE LA CONVERSACIÓN RECUERDA ADEMÁS DE LOS TURNOS.
 *
 * Viven en el MISMO jsonb (`wa_conversacion.estado`) y se descartan junto con
 * los turnos cuando cambia el viaje: son estado de ESTA charla sobre ESTE
 * viaje, no del viaje —el viaje tiene sus propias columnas—.
 *
 * ── POR QUÉ NO SE DEDUCEN DEL TEXTO ──────────────────────────────────────
 *
 * Las dos cosas que el pipeline necesita recordar entre mensajes se deducían
 * leyendo el TEXTO de los turnos con un regex. Un regex se desincroniza del
 * texto en cuanto alguien lo edita, y eso YA PASÓ: el contador de intentos de
 * confirmación era
 *
 *     turns.filter(t => t.role === 'assistant' && /confirma|¿cu[áa]l de|arranco/i.test(t.content))
 *
 * y esa expresión no empata con NINGUNO de los mensajes que `inicio_viaje.ts`
 * manda de verdad ("¿Arrancas este viaje?", "✅ Va, arrancamos:", "Sí, pero
 * ¿cuál? Traes 2."). El contador valía 1 para siempre, el freno del segundo
 * intento era inalcanzable, y el chofer recibía "Perdón, no te entendí" sin
 * final. Un número contado por su cuenta no se puede romper editando una frase.
 */
export interface MarcasConversacion {
  /**
   * Cuántas veces se le ha preguntado ya CUÁL viaje arranca.
   *
   * `decidirInicio` es puro y no tiene memoria: sin este número, "se repregunta
   * UNA vez" no se puede cumplir.
   */
  intentosConfirmacion?: number;
  /**
   * Ya se le advirtió que iba a cerrar SIN comprobantes y aun así insistió.
   *
   * Es lo que hace que el freno del cierre pregunte una vez y no se convierta
   * en el mismo bucle que ya costó el hallazgo de arriba.
   */
  cierreSinComprobantes?: boolean;
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
  const { data, error } = await acotada(supabaseAdmin()
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
    .limit(2), 'resolveOperador');
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
  const { data, error } = await acotada(supabaseAdmin()
    .from('viaje')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('operador_id', operadorId)
    .in('estatus', ['abierto', 'en_cuadre'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle(), 'getOpenViaje');
  // Misma distinción que en `resolveOperador`, y aquí es peor: un error de red en
  // la RE-VERIFICACIÓN posterior al mutex hacía que el operador recibiera "ese
  // viaje ya quedó cerrado 👍" sobre un viaje que sigue `abierto`, sin liquidación,
  // sin PDF y sin log. El producto afirmaba un hecho falso sobre su dinero.
  if (error) throw new ConsultaFallida(`viaje abierto: ${error.message}`);
  if (!data) return null;
  return data.id as string;
}

export async function getTenantContext(tenantId: string): Promise<TenantContext> {
  const { data, error } = await acotada(supabaseAdmin().from('tenant').select('nombre').eq('id', tenantId).maybeSingle(), 'getTenantContext');
  // El `|| 'la flota'` de abajo es un default para una flota SIN nombre
  // capturado, no una tapadera para una base que no contestó. Sin este chequeo
  // los dos casos se veían igual, y el segundo sale impreso en el aviso de
  // privacidad que el operador lee en su primer contacto: "Likida procesa esta
  // información por cuenta de la flota" en vez del nombre de su empresa. Un
  // texto legal con el nombre del responsable borrado no es una degradación
  // cosmética. Misma decisión que sus vecinas `resolveOperador` y
  // `getOpenViaje`: no se sabe, se dice.
  if (error) throw new ConsultaFallida(`getTenantContext: ${error.message}`);
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
export async function loadConversation(tenantId: string, telefono: string, viajeId: string | null): Promise<Conversacion> {
  const admin = supabaseAdmin();
  const { data, error } = await acotada(admin
    .from('wa_conversacion')
    .select('id, estado, viaje_id')
    .eq('tenant_id', tenantId)
    .eq('telefono', telefono)
    .maybeSingle(), 'loadConversation');
  // AUDITORÍA 8, ALTO: era la única vecina de `getOpenViaje`/`resolveOperador`
  // que descartaba `error`. Un blip de Supabase se leía como "no existe la
  // conversación", caía al INSERT de abajo, chocaba con
  // `wa_conversacion_tenant_tel_uidx` (23505), y el turno del asistente que el
  // operador SÍ leyó se perdía — el agente arrancaba el siguiente mensaje sin
  // memoria de lo que ya se dijo.
  if (error) throw new ConsultaFallida(`loadConversation: ${error.message}`);
  if (data) return desdeFila(data, viajeId, telefono);

  // EL INSERT PIERDE UNA CARRERA QUE EL PRODUCTO PROVOCA A DIARIO.
  //
  // El caso normal —un operador mandando 22 fotos seguidas— arranca varias
  // invocaciones concurrentes de `after()` para el MISMO (tenant, teléfono).
  // Todas leen arriba, ninguna encuentra fila, todas insertan: una gana y las
  // demás chocan contra `wa_conversacion_tenant_tel_uidx` (23505). Sin mirar
  // `error`, `created` quedaba `undefined` y se devolvía `id: ''`, con lo que el
  // `saveConversation` posterior hacía `.eq('id', '')` —cero filas actualizadas—
  // y el turno del asistente que el operador SÍ leyó desaparecía. El agente
  // arrancaba el siguiente mensaje sin memoria de lo que ya se había dicho.
  //
  // No es un upsert porque el upsert PISARÍA el `estado` de la fila que ganó:
  // sobrescribir con `{ turns: [] }` borra justamente el historial que se está
  // tratando de conservar. Chocar y releer devuelve la fila real, con sus turnos.
  const { data: creada, error: errInsert } = await acotada(admin
    .from('wa_conversacion')
    .insert({ tenant_id: tenantId, telefono, viaje_id: viajeId, estado: { turns: [] } })
    .select('id, estado, viaje_id')
    .single(), 'loadConversation.insert');
  if (!errInsert && creada) return desdeFila(creada, viajeId, telefono);
  // Cualquier otro fallo —red, permisos, un choque contra OTRO índice— no es
  // esta carrera y tragárselo escondería un bug distinto.
  if (errInsert && !violaIndice(errInsert, 'wa_conversacion_tenant_tel_uidx')) {
    throw new ConsultaFallida(`loadConversation.insert: ${errInsert.message}`);
  }

  const { data: ganadora, error: errRelectura } = await acotada(admin
    .from('wa_conversacion')
    .select('id, estado, viaje_id')
    .eq('tenant_id', tenantId)
    .eq('telefono', telefono)
    .maybeSingle(), 'loadConversation.relectura');
  if (errRelectura) throw new ConsultaFallida(`loadConversation.relectura: ${errRelectura.message}`);
  // Chocó con el índice y aun así no está: la fila no se puede nombrar, y
  // devolver `id: ''` es exactamente lo que hacía perderse el historial en
  // silencio. Se lanza para que el llamador sepa que no hay dónde guardar.
  if (!ganadora) throw new ConsultaFallida('loadConversation: la conversación chocó con el índice único y no apareció al releerla');
  logger.info('conv.carrera_insert', { telefono, viaje: viajeId });
  return desdeFila(ganadora, viajeId, telefono);
}

/**
 * Una fila de `wa_conversacion` → lo que el agente necesita.
 *
 * El historial pertenece al viaje en el que se dijo. Si la fila viene de otro
 * viaje —o de ninguno, porque el anterior ya cerró— se empieza limpio.
 */
function desdeFila(
  fila: { id: unknown; estado: unknown; viaje_id: unknown },
  viajeId: string | null,
  telefono: string,
): Conversacion {
  const estado = (fila.estado as { turns?: ConvTurn[] } & MarcasConversacion) || {};
  const mismoViaje = viajeId !== null && fila.viaje_id === viajeId;
  if (!mismoViaje && (estado.turns?.length ?? 0) > 0) {
    logger.info('conv.historial_descartado', { telefono, de: (fila.viaje_id as string | null) ?? null, a: viajeId });
  }
  return {
    id: fila.id as string,
    turns: mismoViaje ? (estado.turns ?? []).slice(-MAX_TURNS) : [],
    // LAS MARCAS SIGUEN LA MISMA REGLA QUE LOS TURNOS. Un contador de intentos
    // del viaje anterior aplicado al de hoy mandaría al chofer con su encargado
    // a la primera respuesta que no se entienda de un viaje que acaba de
    // empezar.
    intentosConfirmacion: mismoViaje ? (estado.intentosConfirmacion ?? 0) : 0,
    cierreSinComprobantes: mismoViaje ? (estado.cierreSinComprobantes ?? false) : false,
  };
}

/** La conversación tal como la usa el pipeline: turnos + lo que hay que recordar. */
export interface Conversacion extends MarcasConversacion {
  id: string;
  turns: ConvTurn[];
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
  const { error } = await acotada(supabaseAdmin()
    .from('wa_mensaje_procesado')
    .insert({ wa_message_id: waMessageId }), 'claimMessage');
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
/**
 * `marcas` OMITIDAS SE BORRAN, y es a propósito.
 *
 * El `estado` se reescribe entero (es un jsonb, no hay UPDATE parcial sin RPC),
 * así que no hay forma de "no tocar" una marca sin releer la fila —y releerla
 * abriría una carrera con las fotos, que escriben esta misma fila sin mutex—.
 * El default es el estado LIMPIO porque es el que corresponde al camino normal:
 * quien guarda sin marcas es el turno del agente, que corre justamente cuando
 * no hay ninguna pregunta nuestra pendiente de respuesta. Los atajos que sí
 * tienen algo pendiente las pasan explícitamente (ver `processor.ts`).
 */
export async function saveConversation(
  convId: string,
  turns: ConvTurn[],
  viajeId: string | null,
  marcas: MarcasConversacion = {},
): Promise<void> {
  const { error } = await acotada(supabaseAdmin()
    .from('wa_conversacion')
    .update({
      estado: {
        turns: turns.slice(-MAX_TURNS),
        // Solo las que valen algo: escribir `0`/`false` en cada guardado ensucia
        // el jsonb de todas las conversaciones para no decir nada.
        ...(marcas.intentosConfirmacion ? { intentosConfirmacion: marcas.intentosConfirmacion } : {}),
        ...(marcas.cierreSinComprobantes ? { cierreSinComprobantes: true } : {}),
      },
      viaje_id: viajeId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', convId), 'saveConversation');
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
  const { data, error } = await acotada(supabaseAdmin().rpc('intake_delta', { p_viaje: viajeId, p_delta: delta }), 'intakeDelta');
  if (error) {
    // El viaje va en el log: sin él, a la mañana siguiente no se puede saber CUÁL
    // liquidación salió corta.
    logger.warn('intake.delta', { viaje: viajeId, delta, code: error.code, msg: error.message });
    return null;
  }
  return typeof data === 'number' ? data : null;
}

/**
 * Cuántos OCR hay en vuelo, SIN escribir. `null` = no se pudo consultar.
 *
 * ── POR QUÉ EXISTE: EL SONDEO ERA UNA ESCRITURA ────────────────────────────
 *
 * `esperarIntake` sondeaba con `intakeDelta(viajeId, 0)`, y `intake_delta` es un
 * UPDATE aunque el delta sea 0 (mig. 0011/0031: la fila se reescribe entera para
 * poder aplicar el `greatest(0, …)` de forma atómica). O sea que la barrera
 * hacía un UPDATE cada 500 ms sobre la MISMA fila de `viaje` que las 22 fotos de
 * la ráfaga están actualizando con sus `+1`/`-1`. Es la RPC más llamada del
 * sistema, y cada sondeo compite por el mismo row lock que el trabajo de verdad.
 *
 * ── LO QUE NO SE PUEDE PERDER AL CAMBIARLO ─────────────────────────────────
 *
 * La 0031 dice, con todas sus letras, que el olvido del contador muerto ocurre
 * TAMBIÉN en el sondeo: sin eso, el primer "listo" después de una invocación
 * muerta ve un `+1` huérfano, espera la barrera completa y le miente al operador
 * diciéndole que su liquidación salió corta. Ese olvido lo hacía la escritura.
 *
 * Por eso este SELECT trae las DOS columnas y aplica la misma regla de los 10
 * minutos del lado del cliente: un contador vivo con sello vencido —o sin
 * sello— es basura de un proceso que no volvió, y vale 0. El `-1` de la foto y
 * el `+1` que sella siguen siendo la RPC, que es donde la atomicidad importa;
 * lo único que deja de escribir es la pregunta.
 */
export async function intakePendientes(viajeId: string): Promise<number | null> {
  const { data, error } = await acotada(supabaseAdmin()
    .from('viaje')
    .select('intake_pendientes, intake_pendientes_en')
    .eq('id', viajeId)
    .maybeSingle(), 'intakePendientes');
  if (error) {
    // Mismo contrato que `intakeDelta`: `null` es "no sé", y "no sé" NO abre la
    // barrera. Devolver 0 aquí sería el fallo que su comentario documenta.
    logger.warn('intake.sondeo', { viaje: viajeId, code: error.code, msg: error.message });
    return null;
  }
  // La fila no existe (viaje borrado a media ráfaga): no hay nada en vuelo que
  // esperar, y quedarse esperando a un viaje que no está sería colgar al
  // operador hasta el tope.
  if (!data) return 0;
  const n = typeof data.intake_pendientes === 'number' ? data.intake_pendientes : 0;
  if (n <= 0) return 0;
  const sello = data.intake_pendientes_en ? Date.parse(String(data.intake_pendientes_en)) : NaN;
  if (!Number.isFinite(sello) || Date.now() - sello > TTL_INTAKE_MS) {
    logger.info('intake.contador_vencido', { viaje: viajeId, pendientes: n });
    return 0;
  }
  return n;
}

/**
 * Los 10 minutos de la 0031. Un `+1` más viejo que esto es de un proceso que no
 * volvió: el tope de la función son 120 s, así que son 5× el peor caso legítimo.
 * El número vive aquí Y en la migración; `barrera.test.ts` fija la regla.
 */
const TTL_INTAKE_MS = 10 * 60_000;

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
  //
  // El default era `intakeDelta(id, 0)` — una ESCRITURA por sondeo, cada 500 ms,
  // sobre la misma fila que la ráfaga está actualizando. Ver `intakePendientes`.
  probe: (id: string) => Promise<number | null> = intakePendientes,
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
    await acotada(supabaseAdmin().rpc('unlock_viaje', { p_viaje: viajeId }), 'releaseViajeLock');
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
    await acotada(supabaseAdmin().from('wa_mensaje_procesado').delete().eq('wa_message_id', waMessageId), 'releaseMessageClaim');
  } catch (e) {
    logger.warn('wa.release_claim', { err: e instanceof Error ? e.message : String(e) });
  }
}
