// ═══════════════════════════════════════════════════════════════════════════
// LA PUERTA DE LA API v1 — un solo sitio donde se decide de qué flota habla
// una petición, cuánto puede pedir y qué se le contesta cuando algo truena.
//
// POR QUÉ EXISTE ESTE ARCHIVO Y NO CADA RUTA A SU MANERA. El repo ya pagó ese
// experimento: el criterio de "de qué flota es esta petición" vivía escrito a
// mano en `/api/dashboard/asistente` y FALTABA en los dos endpoints de export
// (ver la cabecera de `lib/auth/tenant-api.ts`). Cinco rutas nuevas de lectura
// pública son cinco oportunidades de volver a escribirlo mal, y el fallo #1
// documentado del código escrito por agentes es exactamente éste: se acota el
// tenant en cuatro rutas y se olvida en la quinta.
//
// ── EL TENANT SALE DE LA CREDENCIAL. PUNTO. ──────────────────────────────
//
// `resolverTenantApi` honra un `?tenant=` cuando —y solo cuando— la sesión es
// de superadmin: es correcto para el panel de Javier, donde la pantalla trae un
// selector de flota y el rótulo dice cuál está mirando. Una API pública NO
// tiene ese rótulo: el integrador guarda la URL en su TMS, y un parámetro que
// cambia de flota es una superficie de IDOR con un cliente automatizado del
// otro lado que nunca va a mirar quién le contestó.
//
// Por eso `abrir()` le entrega a `resolverTenantApi` una URL a la que ya le
// BORRÓ el parámetro. No se confía en "ningún llamador lo manda": se elimina en
// el borde, una vez, y hay una prueba que lo fija con una sesión de superadmin
// —la única que podría aprovecharlo— pidiendo otra flota y recibiendo la suya.
//
// ── LO QUE ESTA PUERTA NO ES (todavía) ───────────────────────────────────
//
// `resolverTenantApi` autentica por la COOKIE de sesión de Supabase
// (`getSessionTenant` → `supabaseServer()` → `cookies()`). O sea: hoy /v1 lo
// consume un navegador o un agente con sesión del panel, NO un TMS headless con
// una llave. La llave por flota (tabla `tenant_api_key`, hash + `last_used_at`,
// y una rama en `resolverTenantApi` que la acepte antes de mirar la cookie) es
// el siguiente paso y toca archivos que esta entrega no puede tocar. Está
// anotado, no resuelto, y el OpenAPI lo dice con todas sus letras: prometer una
// llave que no existe sería la clase de cifra inventada que este producto no se
// permite.
// ═══════════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { rateLimit, clientIp } from '@/lib/ratelimit';
import { resolverTenantApi } from '@/lib/auth/tenant-api';
import { llaveDelHeader, resolverLlave } from '@/lib/auth/llave-api';
import { puedeVerArea, type Area } from '@/lib/auth/visibilidad';
import { LecturaIncompleta } from '@/lib/likida/pg';

// ── El formato de error ────────────────────────────────────────────────────

/**
 * Los códigos que puede devolver /v1. Son un dominio CERRADO a propósito: un
 * integrador ramifica sobre `codigo`, no sobre el texto de `mensaje` (que se
 * puede reescribir sin romper a nadie). Es la misma razón por la que las
 * observaciones fiscales llevan `tipo` además de `nota`.
 */
export type CodigoError =
  | 'no_autenticado'
  | 'sin_permiso'
  | 'no_encontrado'
  | 'parametro_invalido'
  // El registro YA EXISTE con esa llave natural pero con OTRO contenido. No es
  // `parametro_invalido` (el cuerpo está bien formado) ni un 200 idempotente
  // (eso diría "tu escritura ya estaba hecha", y no lo está): el integrador
  // tiene que enterarse de que SUS DATOS NO SE GUARDARON.
  | 'conflicto'
  | 'demasiadas_peticiones'
  | 'lectura_incompleta'
  | 'error_interno'
  | 'dependencia_no_disponible';

export interface CuerpoError {
  error: {
    codigo: CodigoError;
    /** En español y para un humano. NUNCA lleva el mensaje de Postgres. */
    mensaje: string;
  };
}

const STATUS: Record<CodigoError, number> = {
  no_autenticado: 401,
  sin_permiso: 403,
  no_encontrado: 404,
  parametro_invalido: 400,
  conflicto: 409,
  demasiadas_peticiones: 429,
  // Los dos son 500 y aun así son códigos distintos: `lectura_incompleta` le
  // dice al integrador que reintentar NO lo va a arreglar (la flota rebasó lo
  // que una lectura puede demostrar completo), y `error_interno` que sí.
  lectura_incompleta: 500,
  error_interno: 500,
  dependencia_no_disponible: 503,
};

export function errorApi(codigo: CodigoError, mensaje: string): NextResponse<CuerpoError> {
  return NextResponse.json({ error: { codigo, mensaje } }, { status: STATUS[codigo] });
}

/**
 * El 500 de una lectura que reventó.
 *
 * EL MENSAJE INTERNO NO CRUZA. `tool-executor.ts` filtra por VOCABULARIO
 * (`relation`, `constraint`, `violates`…) porque el modelo necesita que un
 * mensaje de negocio deliberado le llegue intacto para reaccionar. Una API
 * pública no tiene esa necesidad: quien llama ramifica sobre `codigo`, así que
 * aquí se corta ENTERO y no se copia el regex.
 *
 * Copiarlo habría sido peor que cortar: sería una segunda versión de la lista
 * de palabras, y la primera vez que alguien agregue un término a una y no a la
 * otra, la API empieza a filtrar nombres de tablas sin que nadie lo note. El
 * detalle completo sigue en el log, que es el canal de observabilidad.
 */
export function fallo(evento: string, err: unknown, contexto: Record<string, unknown> = {}): NextResponse<CuerpoError> {
  const crudo = err instanceof Error ? err.message : String(err);
  logger.error(evento, { ...contexto, err: crudo });

  if (err instanceof LecturaIncompleta) {
    return errorApi(
      'lectura_incompleta',
      'La flota tiene más filas de las que una lectura puede traer demostrando que están todas. No devolvemos una cifra parcial: acota el rango o avísanos para paginar del lado del servidor.',
    );
  }
  return errorApi(
    'error_interno',
    'No se pudo completar la lectura. El detalle quedó en nuestros registros; vuelve a intentar en un momento.',
  );
}

// ── El gateo ───────────────────────────────────────────────────────────────

/** Peticiones por minuto ANTES de saber quién llama. Protege el viaje a
 *  Supabase que cuesta averiguarlo, no los datos (esos ya los cierra el 401). */
export const TASA_ANONIMA = 60;
/** Peticiones por minuto de una flota YA autenticada. Un TMS que sincroniza
 *  cada 5 minutos ni se acerca; uno en bucle infinito se topa aquí. */
export const TASA_POR_FLOTA = 240;
export const VENTANA_MS = 60_000;

export type Acceso =
  | { ok: true; tenantId: string; rol: string }
  | { ok: false; respuesta: NextResponse<CuerpoError> };

/**
 * Borra el `?tenant=` de una URL.
 *
 * No lo rechaza con un 400: un TMS puede reenviar la query completa que le
 * pegaron, y tirarle la sincronización por un parámetro que de todos modos se
 * va a ignorar es peor que ignorarlo. Lo que NO puede pasar es que llegue vivo
 * a `resolverTenantApi`, que sí lo honraría para un superadmin.
 */
export function urlSinTenant(url: string): string {
  const u = new URL(url);
  u.searchParams.delete('tenant');
  return u.toString();
}

/**
 * La puerta de toda ruta de /v1: tasa, credencial, flota y área.
 *
 * EL ORDEN IMPORTA y es éste:
 *   1. tasa por IP — antes de gastar un viaje a Supabase averiguando quién es;
 *   2. credencial → flota, con el `?tenant=` ya borrado;
 *   3. tasa por flota — una credencial válida en bucle también se acota;
 *   4. ÁREA. Acotar el tenant y olvidar el rol es el patrón que este repo tiene
 *      documentado como el fallo más común del código escrito por agentes: la
 *      ruta autorizaba por sesión y por tenant, y ahí se detenía.
 *
 * `area` no tiene default a propósito. Un default sería el día en que alguien
 * agregue una ruta de dinero y se le olvide el argumento.
 */
/**
 * ¿El área de una llave alcanza para lo que pide la ruta?
 *
 * El orden es el de la app: quien administra ve todo, quien ve dinero ve
 * también operación, y quien solo ve operación no ve dinero. Se escribe aquí
 * y no se deriva de `AREAS_POR_ROL` a propósito: los roles son de personas y
 * pueden cambiar; el alcance de una llave es un contrato con un sistema ajeno
 * que ya está corriendo en producción del cliente.
 */
export function areaDeLlaveAlcanza(areaLlave: string, pedida: Area): boolean {
  if (areaLlave === 'administracion') return true;
  if (areaLlave === 'dinero') return pedida === 'dinero' || pedida === 'operacion';
  if (areaLlave === 'operacion') return pedida === 'operacion';
  // Un área desconocida no alcanza para nada: fail closed, igual que un rol
  // desconocido en `visibilidad.ts`.
  return false;
}

export async function abrir(req: Request, area: Area): Promise<Acceso> {
  const ip = clientIp(req);
  if (!rateLimit(`v1:ip:${ip}`, TASA_ANONIMA, VENTANA_MS)) {
    return { ok: false, respuesta: errorApi('demasiadas_peticiones', `Máximo ${TASA_ANONIMA} peticiones por minuto sin identificar. Espera un momento.`) };
  }

  // ── LA LLAVE MANDA SOBRE LA COOKIE ─────────────────────────────────────
  //
  // Se mira PRIMERO el header `Authorization: Bearer`, y solo si no viene se
  // cae a la sesión del panel. El orden importa: si mandara la cookie, un
  // navegador con sesión abierta que además pusiera una llave estaría leyendo
  // con los permisos de la PERSONA y no con los de la llave — y el área
  // acotada de la llave (`operacion` para un tablero, por ejemplo) no serviría
  // de nada.
  //
  // Una llave trae su propio área, más angosta que la del rol: se pasa como
  // `rol` sintético para que `puedeVerArea` de abajo la aplique sin conocer la
  // diferencia. Un solo camino de autorización, dos formas de identificarse.
  const bearer = llaveDelHeader(req.headers.get('authorization'));
  if (bearer) {
    let l: Awaited<ReturnType<typeof resolverLlave>>;
    try {
      l = await resolverLlave(bearer);
    } catch (e) {
      return { ok: false, respuesta: fallo('v1.llave', e) };
    }
    if (!l.ok) {
      const codigo: CodigoError = l.status === 401 ? 'no_autenticado' : 'dependencia_no_disponible';
      return { ok: false, respuesta: errorApi(codigo, l.motivo) };
    }
    if (!rateLimit(`v1:flota:${l.tenantId}`, TASA_POR_FLOTA, VENTANA_MS)) {
      return { ok: false, respuesta: errorApi('demasiadas_peticiones', `Máximo ${TASA_POR_FLOTA} peticiones por minuto por flota. Espera un momento.`) };
    }
    // El área de la llave se compara con la que pide la ruta usando el MISMO
    // orden de la app: `administracion` ve todo, `dinero` ve dinero y
    // operación, `operacion` solo operación.
    if (!areaDeLlaveAlcanza(l.area, area)) {
      logger.warn('v1.llave_area', { area_llave: l.area, area });
      return { ok: false, respuesta: errorApi('sin_permiso', 'Esta llave no tiene acceso a esa parte de la flota.') };
    }
    return { ok: true, tenantId: l.tenantId, rol: `llave:${l.area}` };
  }

  let t: Awaited<ReturnType<typeof resolverTenantApi>>;
  try {
    t = await resolverTenantApi(urlSinTenant(req.url));
  } catch (e) {
    // `resolverTenantApi` normalmente devuelve el motivo en vez de lanzar, pero
    // por debajo hay `supabaseAdmin()` y `cookies()`: una env var ausente o un
    // SDK que truena SÍ lanzan. Sin este catch eso sería un 500 de Next con el
    // stack del framework, que es justo lo que no debe cruzar.
    return { ok: false, respuesta: fallo('v1.credencial', e) };
  }

  if (!t.ok) {
    // Fallar CERRADO: 401/403/503 con cuerpo, nunca datos parciales ni un 200
    // con la lista vacía (una lista vacía por falta de credencial afirmaría
    // "esta flota no tiene viajes", que es una mentira medible).
    const codigo: CodigoError =
      t.status === 401 ? 'no_autenticado' : t.status === 403 ? 'sin_permiso' : 'dependencia_no_disponible';
    return { ok: false, respuesta: errorApi(codigo, t.motivo) };
  }

  if (!rateLimit(`v1:flota:${t.tenantId}`, TASA_POR_FLOTA, VENTANA_MS)) {
    return { ok: false, respuesta: errorApi('demasiadas_peticiones', `Máximo ${TASA_POR_FLOTA} peticiones por minuto por flota. Espera un momento.`) };
  }

  if (!puedeVerArea(t.rol, area)) {
    logger.warn('v1.area_sin_permiso', { rol: t.rol, area });
    return {
      ok: false,
      respuesta: errorApi('sin_permiso', area === 'dinero'
        ? 'Tu rol no ve las cifras de dinero de la flota.'
        : 'Tu rol no tiene acceso a esta parte de la flota.'),
    };
  }

  return { ok: true, tenantId: t.tenantId, rol: t.rol };
}

// ── Paginación con tope ────────────────────────────────────────────────────

export const LIMITE_DEFECTO = 50;
export const LIMITE_MAXIMO = 200;

/**
 * El techo de `desplazamiento + limite` en UNA petición.
 *
 * No es un número redondo por gusto: 1,000 es el `max_rows` por default de
 * PostgREST (ver `lib/likida/pg.ts`), o sea lo máximo que el servidor entrega
 * en una pasada. Los lectores de este repo que paginan de verdad lo hacen con
 * `traerTodo`, que DEMUESTRA que trajo todo; `getViajes` no pagina —pide N y
 * recibe min(N, max_rows)— así que dejar pedir más allá de esa marca sería
 * servir una página corta sin decirlo, que es exactamente el recorte silencioso
 * que este repo persigue.
 *
 * Y es el tope que la tarea pide por el otro lado: sin él, un `GET /v1/viajes`
 * se lleva la base entera en una llamada y con ella el presupuesto de PostgREST.
 */
export const VENTANA_MAXIMA = 1_000;

export interface Pagina {
  limite: number;
  desplazamiento: number;
}

export type LecturaPagina =
  | { ok: true; pagina: Pagina }
  | { ok: false; respuesta: NextResponse<CuerpoError> };

function entero(v: string | null): number | null {
  if (v === null || v.trim() === '') return null;
  // `Number` acepta ' 12 ', '1e3' y '0x10'; el regex los cierra. Un
  // `parseInt('12abc')` daría 12 y aceptaría en silencio una petición mal
  // formada, que es como se cuelan los off-by-one del otro lado.
  if (!/^\d+$/.test(v.trim())) return null;
  const n = Number(v.trim());
  return Number.isSafeInteger(n) ? n : null;
}

/**
 * Lee `?limite=` y `?desplazamiento=` de la query.
 *
 * NO RECORTA EN SILENCIO. Un `limite=5000` podría clavarse a 200 y contestar
 * 200 filas con un 200 OK; el integrador escribiría su bucle creyendo que pidió
 * 5,000 y se llevaría el 4% de sus viajes sin enterarse. Se contesta 400 y se
 * dice cuál es el techo: un error ruidoso es más barato que un dato corto.
 */
export function leerPagina(url: string): LecturaPagina {
  const q = new URL(url).searchParams;

  const crudoLimite = q.get('limite');
  const crudoDesp = q.get('desplazamiento');

  const limite = crudoLimite === null ? LIMITE_DEFECTO : entero(crudoLimite);
  const desplazamiento = crudoDesp === null ? 0 : entero(crudoDesp);

  if (limite === null || limite < 1) {
    return { ok: false, respuesta: errorApi('parametro_invalido', '`limite` tiene que ser un entero mayor o igual a 1.') };
  }
  if (limite > LIMITE_MAXIMO) {
    return { ok: false, respuesta: errorApi('parametro_invalido', `\`limite\` no puede pasar de ${LIMITE_MAXIMO}.`) };
  }
  if (desplazamiento === null || desplazamiento < 0) {
    return { ok: false, respuesta: errorApi('parametro_invalido', '`desplazamiento` tiene que ser un entero mayor o igual a 0.') };
  }
  if (desplazamiento + limite > VENTANA_MAXIMA) {
    return {
      ok: false,
      respuesta: errorApi(
        'parametro_invalido',
        `\`desplazamiento\` + \`limite\` no puede pasar de ${VENTANA_MAXIMA} en una petición. Para recorrer un histórico más largo hace falta un cursor: pídenoslo antes de escribir el bucle.`,
      ),
    };
  }

  return { ok: true, pagina: { limite, desplazamiento } };
}

export interface Sobre<T> {
  datos: T[];
  pagina: {
    limite: number;
    desplazamiento: number;
    /** Cuántas filas trae ESTA respuesta. */
    devueltos: number;
    /** Cuántas hay en total del otro lado del filtro. `null` = NO SE PUDO
     *  CONTAR, jamás 0: un 0 se leería como "esta flota no tiene nada". */
    total: number | null;
    /** Si vale la pena pedir la siguiente página. */
    hayMas: boolean;
  };
}

/**
 * Envuelve la respuesta de una lista.
 *
 * `hayMas` tiene DOS derivaciones y no es un descuido:
 *  · con `total` conocido es exacto (`desplazamiento + devueltos < total`);
 *  · sin él se cae a "vino la página llena, puede haber más". Es conservador
 *    a propósito: en la duda, decir que quizá falta hace que el integrador
 *    pida una página de más; decir que no falta le esconde el resto.
 */
export function sobre<T>(datos: T[], pagina: Pagina, total: number | null): Sobre<T> {
  const devueltos = datos.length;
  return {
    datos,
    pagina: {
      limite: pagina.limite,
      desplazamiento: pagina.desplazamiento,
      devueltos,
      total,
      hayMas: total === null ? devueltos === pagina.limite : pagina.desplazamiento + devueltos < total,
    },
  };
}

/**
 * Corta una lista YA COMPLETA en la página pedida.
 *
 * Se rebana en memoria en vez de mandarle el `range` a Postgres porque los
 * lectores de este repo (`getUnidades`, `getPanelClientes`) ya traen la lista
 * entera con `traerTodo`, que es lo único que DEMUESTRA que está completa. Un
 * `range` por posición sobre un `order` que empata puede repetir una fila y
 * saltarse otra entre dos páginas — la advertencia está escrita en `pg.ts` — y
 * una sola foto rebanada no tiene ese problema.
 */
export function rebanar<T>(todos: readonly T[], pagina: Pagina): T[] {
  return todos.slice(pagina.desplazamiento, pagina.desplazamiento + pagina.limite);
}
