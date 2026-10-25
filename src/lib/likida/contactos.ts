import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { variantesTelefono } from './conv';
import { acotada } from './presupuesto';
import { traerTodo } from './pg';
import { ordenAvisoDeclarado, type RolAviso } from './perfil/preguntas';

// ═══════════════════════════════════════════════════════════════════════════
// QUIÉN ES EL NÚMERO QUE ESCRIBE — Y A QUÉ NÚMERO SE LE ESCRIBE.
//
// Las dos caras del mismo dato, y por eso viven juntas.
//
// Hasta la 0059 el agente solo sabía reconocer CHOFERES: `operador` tenía
// teléfono, `app_user` no. Cualquier otro número recibía "no te tengo
// registrado como operador" y se acababa la conversación. Consecuencia que
// costó encontrar: los avisos que salen hacia la oficina —"tu chofer no aceptó
// el viaje", "tienes tickets por facturar"— llegaban a un teléfono que el
// sistema no reconocía de vuelta. El jefe podía contestar "cámbialo a Pérez" y
// nadie estaba escuchando. Un aviso que no se puede contestar no es una
// conversación, es una alerta.
//
// ── UN NÚMERO PUEDE SER LAS DOS COSAS ────────────────────────────────────
//
// En una flota chica el dueño maneja. No se elige por él ni se falla: se
// devuelven LAS DOS caras y quien llama decide con su propio contexto (si trae
// viaje abierto, es chofer; si pregunta por su flota, es oficina). Colapsarlo
// aquí obligaría a adivinar sin la información que hace falta para acertar.
//
// ── LO QUE SÍ SE NIEGA ───────────────────────────────────────────────────
//
// Que un número apunte a DOS flotas. Ahí no hay contexto que desempate: el
// mensaje entrante trae solo el número, y es el número el que determina de qué
// flota se habla. `resolveOperador` ya se niega ante eso; aquí se aplica el
// mismo criterio, y la 0059 lo vuelve imposible desde la base para `app_user`.
// ═══════════════════════════════════════════════════════════════════════════

export type RolOficina = 'flota_admin' | 'contador' | 'encargado' | 'superadmin';

export interface CuentaOficina {
  userId: string;
  /** `null` solo en superadmin: no pertenece a una flota. */
  tenantId: string | null;
  rol: RolOficina;
  nombre: string | null;
  email: string;
}

export class TelefonoAmbiguo extends Error {}

/**
 * La cuenta de oficina detrás de un número. `null` = no hay ninguna.
 *
 * Lanza `ConsultaFallida` implícita vía throw si la base no contesta: "no está
 * dado de alta" y "no pude preguntar" NO son lo mismo, y confundirlos le diría
 * a un jefe que su cuenta no existe por un fallo transitorio de red.
 */
export async function resolverCuentaOficina(telefono: string): Promise<CuentaOficina | null> {
  // AUDITORÍA 18, ALTO (A23): con techo — corre en el camino caliente del
  // webhook, y sin `acotada` un socket colgado gastaba los 300 s de undici.
  // AUDITORÍA 24, CRÍTICO (AGEN-1): `activo` entra al select y a la consulta.
  // La 0294 le enseñó a la base a dar de baja y `session.ts:99` lo respeta,
  // pero WhatsApp no pasa por Auth ni por `session.ts` — pasa por aquí. El
  // contador al que la flota le quitó el acceso el viernes seguía siendo
  // atendido el lunes, comandos de administración incluidos
  // (`admin_comandos_wa.ts:45` delega su autenticación en esta función).
  //
  // El filtro va en la BASE y otra vez en TS, y no es redundancia ociosa: el
  // `.limit(2)` cuenta filas del servidor, así que sin el filtro de allá dos
  // cuentas de baja podrían llenar el cupo y esconder a la viva. `activo` es
  // NULL en una base sin la 0294, y en PostgREST `neq` descarta los NULL —
  // por eso el `or(...is.null, ...eq.true)` explícito.
  const { data, error } = await acotada(supabaseAdmin()
    .from('app_user')
    .select('id, tenant_id, rol, nombre, email, telefono, activo')
    .in('telefono', variantesTelefono(telefono))
    .or('activo.is.null,activo.eq.true')
    .limit(2), 'resolverCuentaOficina'); // dos, para poder DETECTAR la ambigüedad en vez de recortarla

  if (error) throw new Error(`cuenta de oficina por teléfono: ${error.message}`);

  // Solo el `false` EXPLÍCITO da de baja, exactamente como `session.ts:99`: una
  // fila sin la columna sigue entrando. Una regla, dos capas — no dos reglas.
  const filas = (data ?? []).filter((f) => (f as { activo?: boolean }).activo !== false);
  if (filas.length === 0) return null;
  if (filas.length > 1) {
    logger.error('cuenta.ambigua', {
      telefono,
      tenants: [...new Set(filas.map((f) => f.tenant_id as string | null))],
      usuarios: filas.map((f) => f.id as string),
    });
    throw new TelefonoAmbiguo(`el teléfono ${telefono} corresponde a más de una cuenta`);
  }

  const f = filas[0];
  return {
    userId: f.id as string,
    tenantId: (f.tenant_id as string) ?? null,
    rol: f.rol as RolOficina,
    nombre: (f.nombre as string) ?? null,
    email: f.email as string,
  };
}

// ── LA OTRA CARA: A QUIÉN SE LE ESCRIBE ────────────────────────────────────

/**
 * Los roles que reciben los avisos de operación de una flota, en orden.
 *
 * El encargado va PRIMERO y no es un detalle: es quien opera el día a día y
 * quien puede reasignar un viaje o entrar a un portal a facturar. El
 * flota_admin es el dueño — avisarle a él de cada ticket por vencer lo entrena
 * a ignorar el canal. El contador no está: no despacha.
 */
/** Default de operación — el encargado primero. Paso 6: si el perfil
 *  declaró otro orden, `telefonosJefe` lo usa; esto queda como fallback. */
export const ORDEN_AVISO: RolOficina[] = ['encargado', 'flota_admin'];
const ROLES_OFICINA_CONSULTA: RolOficina[] = ['encargado', 'flota_admin', 'contador'];

/** E.164 sin `+`. `null` si esa flota no tiene a quién escribirle. */
export async function telefonoJefeDe(tenantId: string, terminalId?: string | null): Promise<string | null> {
  const jefe = await resolverJefes([tenantId]);
  return jefe(tenantId, terminalId);
}

/**
 * Los roles que reciben los avisos de DINERO (el cierre de una liquidación:
 * anticipo, comprobado, diferencia y el PDF completo), en orden.
 *
 * AUDITORÍA 18, ALTO (A28): `ORDEN_AVISO` es para la ESCALACIÓN de despacho,
 * donde el encargado es el destinatario correcto. El cierre la reusaba tal
 * cual, y el encargado —`visibilidad.ts`: `['operacion']`, sin `dinero`—
 * recibía por WhatsApp las cifras que el panel le esconde a propósito. El
 * canal no puede ser la puerta trasera de la matriz de visibilidad
 * (`oficina_wa.ts`). Todo rol de esta lista ve `dinero` en `visibilidad.ts`;
 * `avisar_cierre.test.ts` lo comprueba contra la matriz real.
 */
export const ORDEN_AVISO_DINERO: RolOficina[] = ['flota_admin', 'contador'];
// E1-B (P0-7): el encargado NO entra aquí a propósito. Se entera del cierre por
// el acuse «solo folio» (`acuse_folio.ts`: folio, operador y fecha, cero cifras)
// que sale al primero de `ORDEN_AVISO` (`telefonoJefeDe`).


/** A quién se le mandan las CIFRAS de un cierre. `null` si nadie que vea
 *  dinero tiene teléfono capturado — y entonces no se manda a nadie, nunca
 *  al encargado "por lo menos". */
export async function telefonoParaDineroDe(tenantId: string): Promise<string | null> {
  // AUDITORÍA 25, CRÍTICO (AGEN-C1): `activo`, igual que en la ENTRADA.
  // El arreglo de la 24 cerró `resolverCuentaOficina` y dejó abierta la salida:
  // `desactivarUsuario` escribe `activo=false` pero NO borra el teléfono, así
  // que esta consulta seguía encontrándolo y por aquí salen las CIFRAS del
  // cierre y el ejemplar del CONTRALOR. Mismas dos capas y misma regla que
  // arriba: solo el `false` explícito da de baja.
  //
  // CORRECCIÓN (reauditoría de la 25): la rama `activo.is.null` es cinturón
  // sobre tirantes, no una red para la base vieja. La 0294 declara la columna
  // `not null default true` (`0294:47`), así que **aplicada, `activo` nunca es
  // NULL**; y **sin aplicar, la columna no existe** y este `select` devuelve
  // 42703 — esta función LANZA, no «sigue avisando». El supuesto sin comprobar
  // lo heredan las cuatro consultas de este camino, `resolverCuentaOficina`
  // incluida, desde la 24. Lo que de verdad cubre ese caso es la compuerta de
  // despliegue, que se niega a construir si la base va atrás de las migraciones.
  const { data, error } = await acotada(supabaseAdmin()
    .from('app_user')
    .select('rol, telefono, activo')
    .eq('tenant_id', tenantId)
    .in('rol', ORDEN_AVISO_DINERO)
    .or('activo.is.null,activo.eq.true')
    .not('telefono', 'is', null), 'telefonoParaDineroDe');
  if (error) throw new Error(`telefonoParaDineroDe: ${error.message}`);
  for (const rol of ORDEN_AVISO_DINERO) {
    const u = (data ?? []).find((f) => f.rol === rol && f.telefono && f.activo !== false);
    if (u) return u.telefono as string;
  }
  return null;
}

/**
 * El mapa que consume la escalación: flota → teléfono de quien decide.
 *
 * UNA sola consulta para todas las flotas. La alternativa —un viaje a la base
 * por viaje vencido— multiplica las consultas por un dato que no cambia entre
 * un viaje y otro dentro de la misma corrida.
 *
 * Devuelve el mapa INCOMPLETO cuando una flota no tiene contacto, en vez de
 * inventar un default: quien llama ya trata la ausencia como "no hay a quién
 * avisar" y lo dice en su reporte. Un fallback a otro número mandaría la
 * operación de una flota al teléfono de otra.
 */
export async function telefonosJefe(tenantIds: string[]): Promise<Record<string, string>> {
  const ids = [...new Set(tenantIds)].filter(Boolean);
  if (ids.length === 0) return {};
  const jefe = await resolverJefes(ids);
  const mapa: Record<string, string> = {};
  for (const tenantId of ids) {
    const tel = jefe(tenantId);
    if (tel) mapa[tenantId] = tel;
  }
  return mapa;
}

/** Quién recibe el aviso de operación de una flota; con `terminalId` (el patio
 *  del viaje) prefiere al encargado de ESE patio. `null` = no hay a quién avisar. */
export type ResolverJefe = (tenantId: string, terminalId?: string | null) => string | null;

/**
 * A37-S39-06: la misma lectura de `telefonosJefe`, pero devolviendo un
 * resolvedor por patio. Dentro de cada rol del orden de aviso se prefiere, en
 * este orden: (1) quien tiene el `terminal_id` del viaje, (2) quien no está
 * atado a ningún patio. Si el rol solo tiene gente de OTROS patios se pasa al
 * siguiente rol; solo si ningún rol sirve y el viaje trae patio se cae a la
 * selección anterior (cualquiera de la flota), para no perder el aviso.
 *
 * FAIL-CLOSED: si el perfil de la flota (que declara a quién avisar y a quién
 * NO) no se pudo leer ni tras un reintento, esa flota queda SIN destinatario —
 * antes caía al orden por omisión y avisaba al encargado aunque la flota
 * hubiera declarado enviar solo al dueño o al contador.
 */
export async function resolverJefes(tenantIds: string[]): Promise<ResolverJefe> {
  const ids = [...new Set(tenantIds)].filter(Boolean);
  if (ids.length === 0) return () => null;

  // AUDITORÍA 18, ALTO (A23): con techo — `telefonoJefeDe` corre en el cierre.
  // AUDITORÍA 25, CRÍTICO (AGEN-C1): `activo`, por la misma razón que arriba.
  // Por este mapa salen los ~20 avisos operativos (escalación de viajes, la
  // talacha con botones de autorizar, la carta porte, los relojes legales): un
  // ex-empleado no puede seguir recibiéndolos ni autorizando desde ellos.
  //
  // AUDITORÍA 25, BAJO (reauditoría): el "con techo" de arriba era de
  // PALABRA, no de código — no había `.limit()` ni `traerTodo()`, y
  // `escalar_viaje.ts` llama esta función con TODOS los tenants que tienen
  // viajes vencidos en una corrida. Con más de 1,000 filas de `app_user` en
  // el lote, PostgREST recorta EN SILENCIO y las flotas fuera del corte
  // salían del mapa como si no tuvieran contacto. `traerTodo` pagina y LANZA
  // si no puede demostrar que trajo todo, en vez de devolver el recorte.
  const data = await traerTodo<{ tenant_id: string; rol: string; telefono: string; activo: boolean | null; terminal_id?: string | null }>(
    (desde, hasta) => acotada(supabaseAdmin()
      .from('app_user')
      .select('tenant_id, rol, telefono, activo, terminal_id')
      .in('tenant_id', ids)
      .in('rol', ROLES_OFICINA_CONSULTA)
      .or('activo.is.null,activo.eq.true')
      .not('telefono', 'is', null)
      .order('id')
      .range(desde, hasta), 'telefonosJefe'),
    'telefonosJefe',
  );

  const { ordenes: ordenPorTenant, ilegibles } = await ordenesAvisoDe(ids);

  return (tenantId, terminalId = null) => {
    if (ilegibles.has(tenantId)) return null;
    const orden = ordenPorTenant[tenantId] ?? ORDEN_AVISO;
    const vivos = (data ?? []).filter((f) => f.tenant_id === tenantId && f.telefono && f.activo !== false);
    // Se recorre en el orden de preferencia, no en el que devolvió la base: sin
    // esto, qué persona recibe el aviso dependería del orden de inserción.
    for (const rol of orden) {
      const delRol = vivos.filter((f) => f.rol === rol);
      const elegido = terminalId
        ? (delRol.find((f) => f.terminal_id === terminalId) ?? delRol.find((f) => !f.terminal_id))
        : delRol[0];
      if (elegido) return elegido.telefono as string;
    }
    if (terminalId) {
      for (const rol of orden) {
        const u = vivos.find((f) => f.rol === rol);
        if (u) return u.telefono as string;
      }
    }
    return null;
  };
}

/**
 * El teléfono de UN `app_user` puntual, si sigue ACTIVO en esa flota.
 *
 * AUDITORÍA 28, ALTO (AG-A4): la cotización de la grúa se le mandaba al jefe
 * por ROL (`telefonoJefeDe`), no a quien de verdad autorizó el contacto
 * (`coordinacion_proveedor.autorizada_por`) — si el dueño autorizó, la
 * cotización con los botones de confirmar le llegaba al encargado. Este
 * helper resuelve ESE humano puntual, con el mismo criterio de `activo` que
 * `resolverCuentaOficina` (solo el `false` explícito da de baja) y el mismo
 * candado de tenant que el resto del archivo: un `app_user` de OTRA flota
 * (o ya dado de baja) no puede recibir el aviso de una coordinación ajena.
 * `null` = no hay a quién avisar por esta vía — el llamador cae a
 * `telefonoJefeDe`.
 */
export async function telefonoDeUsuario(userId: string, tenantId: string): Promise<string | null> {
  const { data, error } = await acotada(supabaseAdmin()
    .from('app_user')
    .select('telefono, activo')
    .eq('id', userId)
    .eq('tenant_id', tenantId)
    .not('telefono', 'is', null)
    .maybeSingle(), 'telefonoDeUsuario');
  if (error) throw new Error(`telefonoDeUsuario: ${error.message}`);
  if (!data) return null;
  const f = data as { telefono: string | null; activo: boolean | null };
  if (f.activo === false) return null;
  return f.telefono;
}

/**
 * Perfil por flota. Una lectura fallida se reintenta una vez; si sigue
 * fallando, las flotas quedan en `ilegibles` y NO se les avisa (A37-S39-06):
 * el perfil es quien dice a quién NO se le manda, y usar el orden por omisión
 * a ciegas filtraría avisos con nombre de chofer y viaje al rol equivocado.
 */
async function ordenesAvisoDe(ids: string[]): Promise<{ ordenes: Record<string, RolAviso[]>; ilegibles: Set<string> }> {
  for (let intento = 0; intento < 2; intento++) {
    try {
      const { data, error } = await acotada(
        supabaseAdmin().from('tenant').select('id, perfil').in('id', ids),
        'telefonosJefe.perfil',
      );
      if (error || !data) throw new Error(error?.message ?? 'sin datos');
      const ordenes: Record<string, RolAviso[]> = {};
      for (const t of data as Array<{ id: unknown; perfil: unknown }>) {
        const id = typeof t.id === 'string' ? t.id : null;
        if (!id) continue;
        const orden = ordenAvisoDeclarado(t.perfil);
        if (orden) ordenes[id] = orden;
      }
      return { ordenes, ilegibles: new Set() };
    } catch (e) {
      logger.warn('contactos.orden_aviso_perfil', { intento, err: e instanceof Error ? e.message : String(e) });
    }
  }
  logger.error('contactos.orden_aviso_perfil_ilegible', { flotas: ids.length });
  return { ordenes: {}, ilegibles: new Set(ids) };
}
