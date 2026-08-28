import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { hoyMx } from '@/lib/formato';
import { acotada } from '../presupuesto';
import { anotarBitacora } from '../bitacora_escritura';
import { cifrar, descifrar, cofreConfigurado } from '../conectores/cofre';
import { conectorDePortal } from '../conectores/portales_facturacion';
import type { ClaseDeCorte } from './relogin_cortes';

// ════════════════════════════════════════════════════════════════════════════
// EL PERMISO PARA RECONECTAR SOLA — el consentimiento, el candado y la
// bitácora. Todo lo que se guarda de un re-login; nada de lo que se teclea.
//
// ── LO QUE ESTO CAMBIA, Y LO QUE NO ──────────────────────────────────────
//
// El #146 (27-ago-2026) retiró el auto-tecleo de contraseñas: se descifraban
// en CADA ticket, en el camino de facturar, y una guarda de código impide
// escribir en un campo `type="password"`. Eso NO se deshace aquí y no se puede
// deshacer desde aquí: `facturar` sigue sin tener una sola entrada al cofre de
// contraseñas, y la guarda sigue dura para él.
//
// Lo que se agrega es una PUERTA APARTE, con su propia llave y su propio
// candado, que se abre a lo sumo una vez por caducidad:
//
//   · POR CONSENTIMIENTO EXPLÍCITO. Por flota y por portal, con quién lo dio y
//     cuándo. Sin esa casilla marcada, el comportamiento es el de hoy: la
//     sesión caduca, el estado pasa a `caducada` y entra una persona. No hay
//     default silencioso ni «lo activamos para todos y avisamos».
//   · UNA VEZ POR CADUCIDAD, NO POR TICKET. `reconectarPortal` corre fuera del
//     lote, después de que el portal ya nos sacó, y el tope de intentos de
//     abajo lo hace verdad aunque alguien lo llame de más.
//   · CON UN CANDADO QUE NO SE NEGOCIA. Si el portal dice «credenciales
//     inválidas», se DETIENE. Reintentar con una contraseña mala es la forma
//     más rápida de que le bloqueen la cuenta al cliente, y ese daño no lo
//     paga Likida: lo paga la flota, con su facturación del mes.
//
// ── DÓNDE VIVE CADA COSA ─────────────────────────────────────────────────
//
//   · LA CONTRASEÑA: en `conector_credencial` (cofre AES-256-GCM), donde
//     siempre estuvo. Este módulo la lee en UNA función —`contrasenaDePortal`—
//     que solo llama `relogin.ts`, y el valor no se devuelve a ningún otro
//     sitio, no se loguea y no entra a ningún mensaje de error.
//   · EL PERMISO, LOS INTENTOS Y EL ÚLTIMO MOTIVO: en `portal_relogin`
//     (mig. 0233), EN CLARO. Son lo que la pantalla enseña y ninguno es un
//     secreto — el mismo criterio por el que `portal_estado` (0232) existe
//     aparte del cofre: una píldora no puede costar tocar una llave.
// ════════════════════════════════════════════════════════════════════════════

/** Cuántos re-logins automáticos se permiten por portal y por DÍA. */
export const TOPE_INTENTOS_DIA = 3;

/**
 * Cuánto tiene que pasar entre dos intentos del mismo portal.
 *
 * Quince minutos, y el número sale del riesgo, no de la comodidad: los
 * portales que cuentan intentos fallidos suelen bloquear a los 3-5 seguidos, y
 * un cron que corre cada pocos minutos podría gastarlos en un cuarto de hora
 * sin este freno. Con esto, tres intentos ocupan al menos media hora — tiempo
 * de sobra para que el aviso llegue a una persona antes del tercero.
 */
export const ESPERA_ENTRE_INTENTOS_MS = 15 * 60 * 1000;

/** Lo que la pantalla y el candado necesitan saber de un (flota, portal). */
export interface PermisoRelogin {
  comercio: string;
  /** ¿La flota autorizó guardar la contraseña y reconectar sola? */
  permitido: boolean;
  /** Quién lo autorizó (correo). El consentimiento sin autor no es auditable. */
  permitidoPor: string | null;
  permitidoEn: string | null;
  /** Intentos automáticos gastados en `diaDeIntentos`. */
  intentosDia: number;
  /** `YYYY-MM-DD` del día que cuenta `intentosDia`. */
  diaDeIntentos: string | null;
  ultimoIntentoEn: string | null;
  /** La bitácora citable: «reconecté sola el 9 de agosto a las 15:04». */
  ultimoExitoEn: string | null;
  /** El último motivo de corte, en español. Nunca un secreto. */
  ultimoMotivo: string | null;
  ultimaClase: string | null;
  /** `true` = el re-login está detenido hasta que una persona intervenga. */
  bloqueado: boolean;
}

interface FilaRelogin {
  comercio: unknown;
  permitido: unknown;
  permitido_por: unknown;
  permitido_en: unknown;
  intentos_dia: unknown;
  dia_de_intentos: unknown;
  ultimo_intento_en: unknown;
  ultimo_exito_en: unknown;
  ultimo_motivo: unknown;
  ultima_clase: unknown;
  bloqueado: unknown;
}

const COLUMNAS =
  'comercio, permitido, permitido_por, permitido_en, intentos_dia, dia_de_intentos, ultimo_intento_en, ultimo_exito_en, ultimo_motivo, ultima_clase, bloqueado';

/** Tope del motivo. Acaba en una pantalla y en un WhatsApp, no en un volcado. */
const MAX_MOTIVO = 400;

function aPermiso(f: FilaRelogin): PermisoRelogin | null {
  const comercio = String(f.comercio ?? '');
  if (!comercio) return null;
  return {
    comercio,
    permitido: f.permitido === true,
    permitidoPor: f.permitido_por == null ? null : String(f.permitido_por),
    permitidoEn: f.permitido_en == null ? null : String(f.permitido_en),
    intentosDia: Number(f.intentos_dia ?? 0),
    diaDeIntentos: f.dia_de_intentos == null ? null : String(f.dia_de_intentos),
    ultimoIntentoEn: f.ultimo_intento_en == null ? null : String(f.ultimo_intento_en),
    ultimoExitoEn: f.ultimo_exito_en == null ? null : String(f.ultimo_exito_en),
    ultimoMotivo: f.ultimo_motivo == null ? null : String(f.ultimo_motivo),
    ultimaClase: f.ultima_clase == null ? null : String(f.ultima_clase),
    bloqueado: f.bloqueado === true,
  };
}

/** El permiso «no hay», que es lo mismo que «no lo han autorizado». */
export function sinPermiso(comercio: string): PermisoRelogin {
  return {
    comercio, permitido: false, permitidoPor: null, permitidoEn: null,
    intentosDia: 0, diaDeIntentos: null, ultimoIntentoEn: null, ultimoExitoEn: null,
    ultimoMotivo: null, ultimaClase: null, bloqueado: false,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// EL CANDADO — puro, sin base. Es la parte que tiene que estar probada.
// ═══════════════════════════════════════════════════════════════════════════

export type VeredictoCandado =
  | { puede: true }
  | { puede: false; clase: 'sin_consentimiento' | 'detenido' | 'tope_dia' | 'backoff'; motivo: string };

/**
 * ¿Se puede intentar un re-login automático AHORA?
 *
 * El orden es el de la fuerza de cada «no», y el primero es el que más
 * importa: sin consentimiento no se mira nada más y —sobre todo— no se abre el
 * cofre. Que la comprobación del permiso esté ANTES de cualquier lectura de
 * contraseña no es una optimización: es lo que hace verdad la promesa de que
 * una flota que no marcó la casilla no tiene su contraseña descifrada nunca.
 *
 * `ahoraMs` y `hoy` entran como dato, no se leen del reloj interno: mismo
 * criterio que `sesionFresca`, y así el candado se prueba sin viajar en el
 * tiempo.
 */
export function candadoDeRelogin(p: PermisoRelogin, ahoraMs: number, hoy: string): VeredictoCandado {
  if (!p.permitido) {
    return {
      puede: false, clase: 'sin_consentimiento',
      motivo: 'Esta flota no ha autorizado que Likida guarde su contraseña de este portal, así que la reconexión la hace una persona.',
    };
  }

  // EL CANDADO INNEGOCIABLE. Una vez que el portal dijo que la credencial no
  // sirve, no hay número de intentos que valga: hasta que alguien guarde la
  // contraseña buena, aquí no se vuelve a tocar esa cuenta.
  if (p.bloqueado) {
    return {
      puede: false, clase: 'detenido',
      motivo: p.ultimoMotivo
        ?? 'El re-login de este portal está detenido a la espera de que una persona lo revise.',
    };
  }

  if (p.diaDeIntentos === hoy && p.intentosDia >= TOPE_INTENTOS_DIA) {
    return {
      puede: false, clase: 'tope_dia',
      motivo: `Ya se intentaron ${p.intentosDia} reconexiones automáticas de este portal hoy (el tope es ${TOPE_INTENTOS_DIA}). No se insiste más: seguir intentando es lo que hace que un portal bloquee la cuenta.`,
    };
  }

  if (p.ultimoIntentoEn) {
    const ultimo = Date.parse(p.ultimoIntentoEn);
    // Una fecha ilegible NO abre la puerta: no saber cuándo fue el último
    // intento es exactamente cuando no se puede afirmar que ya pasó el freno.
    if (Number.isNaN(ultimo)) {
      return { puede: false, clase: 'backoff', motivo: 'No se pudo leer cuándo fue el último intento de reconexión, así que no se intenta otro.' };
    }
    const desde = ahoraMs - ultimo;
    // Un último intento en el FUTURO (reloj desalineado) también frena: mismo
    // criterio que `sesionFresca`, un dato en el que no se puede confiar.
    if (desde < 0 || desde < ESPERA_ENTRE_INTENTOS_MS) {
      const faltan = Math.max(1, Math.ceil((ESPERA_ENTRE_INTENTOS_MS - Math.max(0, desde)) / 60_000));
      return {
        puede: false, clase: 'backoff',
        motivo: `Se intentó reconectar hace muy poco. El siguiente intento puede ser en ~${faltan} min: entre dos intentos van ${Math.round(ESPERA_ENTRE_INTENTOS_MS / 60_000)} minutos para no gastarle los intentos a la cuenta.`,
      };
    }
  }

  return { puede: true };
}

/**
 * El día en México, `YYYY-MM-DD`, para la ventana de intentos.
 *
 * Se delega en `hoyMx` y no se calcula aquí: la zona horaria de México vive en
 * UN solo sitio del repo (`formato.ts`) y hay una prueba estructural que lo
 * exige. La ventana tiene que ser la del DÍA DE LA FLOTA —que es donde el
 * portal cuenta sus intentos— y no la del servidor, que corre en UTC: con una
 * ventana en UTC, los intentos de la tarde y los de la noche de la misma
 * jornada caerían en días distintos y el tope no toparía nada.
 */
export function diaMx(ahora: Date): string {
  return hoyMx(ahora);
}

// ═══════════════════════════════════════════════════════════════════════════
// EL REPOSITORIO. Lecturas que distinguen «no hay» de «no pude preguntar».
// ═══════════════════════════════════════════════════════════════════════════

/**
 * El permiso de UN portal. `null` = LA BASE NO CONTESTÓ, y la diferencia con
 * «no hay permiso» es la que decide si se abre el cofre: ante una lectura
 * caída NO se intenta nada. Fail-closed hacia la persona.
 */
export async function permisoDeRelogin(tenantId: string, comercio: string): Promise<PermisoRelogin | null> {
  const { data, error } = await acotada(supabaseAdmin()
    .from('portal_relogin')
    .select(COLUMNAS)
    .eq('tenant_id', tenantId)
    .eq('comercio', comercio)
    .maybeSingle(), 'permisoDeRelogin');

  if (error) {
    logger.warn('relogin.permiso_sin_leer', { tenant: tenantId, comercio, err: error.message });
    return null;
  }
  // Sin fila = nadie lo autorizó. Eso SÍ se puede afirmar: la ausencia de
  // consentimiento es la ausencia de fila, igual que en la 0232.
  if (!data) return sinPermiso(comercio);
  return aPermiso(data as FilaRelogin) ?? sinPermiso(comercio);
}

/**
 * TODOS los permisos de una flota, por clave de comercio. `null` = no se pudo
 * leer, y la pantalla lo dice con esas palabras en vez de pintar «ninguno
 * autorizado» sobre una lectura ciega.
 */
export async function permisosDeRelogin(tenantId: string): Promise<Map<string, PermisoRelogin> | null> {
  const { data, error } = await acotada(supabaseAdmin()
    .from('portal_relogin')
    .select(COLUMNAS)
    .eq('tenant_id', tenantId), 'permisosDeRelogin');

  if (error) {
    logger.warn('relogin.permisos_sin_leer', { tenant: tenantId, err: error.message });
    return null;
  }

  const mapa = new Map<string, PermisoRelogin>();
  for (const f of (data ?? []) as FilaRelogin[]) {
    const p = aPermiso(f);
    if (p) mapa.set(p.comercio, p);
  }
  return mapa;
}

// ═══════════════════════════════════════════════════════════════════════════
// LAS ESCRITURAS.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * LA FLOTA AUTORIZA. Se guarda quién y cuándo, y se levanta cualquier bloqueo
 * anterior —volver a dar el permiso es, casi siempre, «ya guardé la contraseña
 * buena»— junto con el contador del día, para que el arreglo sirva de
 * inmediato y no haya que esperar a mañana.
 *
 * LANZA si no se pudo escribir: esto lo dispara una persona apretando un botón
 * y tiene que poder ver que no quedó. Es lo contrario de `anotarVinculo`, que
 * corre dentro de un cron y es best-effort a propósito.
 */
export async function autorizarRelogin(args: {
  tenantId: string;
  comercio: string;
  actor: { id?: string | null; email?: string | null };
  /**
   * Cómo se enseña a quien autorizó, en la pantalla. Si no se pasa, el correo
   * o el id del actor. Existe porque la sesión de este repo trae `nombre` y
   * `userId` pero no correo, y un renglón que diga «lo autorizó
   * 8f3a-…-91b2» no le sirve a nadie — mientras que la bitácora sí guarda el
   * id, que es lo que hace el rastro reconstruible.
   */
  firma?: string | null;
  ahora: string;
}): Promise<void> {
  const quien = args.firma?.trim() || args.actor.email?.trim() || args.actor.id?.trim() || null;
  if (!quien) {
    // El CHECK de la 0233 lo rechazaría igual; se dice aquí con palabras.
    throw new Error('No se puede registrar el permiso sin saber quién lo dio: un consentimiento sin autor no es auditable.');
  }

  const { error } = await acotada(supabaseAdmin().from('portal_relogin').upsert({
    tenant_id: args.tenantId,
    comercio: args.comercio,
    permitido: true,
    permitido_por: quien,
    permitido_en: args.ahora,
    revocado_por: null,
    revocado_en: null,
    bloqueado: false,
    intentos_dia: 0,
    dia_de_intentos: null,
    ultimo_intento_en: null,
    ultimo_motivo: null,
    ultima_clase: null,
    actualizado_en: args.ahora,
  }, { onConflict: 'tenant_id,comercio' }), 'autorizarRelogin');

  if (error) throw new Error(`No se pudo guardar el permiso: ${error.message}`);

  await anotarBitacora({
    tenantId: args.tenantId,
    actor: args.actor,
    accion: 'portal_relogin.autorizado',
    entidad: 'portal_relogin',
    entidadId: args.comercio,
    detalle: { comercio: args.comercio },
  }, { evento: 'relogin.bitacora_no_escribio' });

  logger.info('relogin.autorizado', { tenant: args.tenantId, comercio: args.comercio });
}

/**
 * LA FLOTA REVOCA: se apaga el permiso Y SE BORRA LA CONTRASEÑA GUARDADA.
 *
 * Las dos cosas juntas, y en ese orden, porque «revoqué el permiso pero mi
 * contraseña sigue ahí» no es lo que nadie entiende al apretar ese botón.
 *
 * Lo que NO hace, y es deliberado: no tumba la sesión viva ni borra la fila de
 * la credencial. La cuenta compartida es lo que hace que los tickets de ese
 * portal vayan por el camino automático (`cuentasCompartidas`); borrar la fila
 * entera mandaría a la persona TODOS los tickets del portal por revocar un
 * permiso que solo tiene que ver con la reconexión. Se quita la contraseña y
 * se deja el usuario, que no es un secreto y sí es lo que la pantalla enseña.
 */
export async function revocarRelogin(args: {
  tenantId: string;
  comercio: string;
  actor: { id?: string | null; email?: string | null };
  /** Ver `autorizarRelogin.firma`. */
  firma?: string | null;
  ahora: string;
}): Promise<{ contrasenaBorrada: boolean }> {
  const quien = args.firma?.trim() || args.actor.email?.trim() || args.actor.id?.trim() || null;

  const borrada = await borrarContrasenaGuardada(args.tenantId, args.comercio);

  const { error } = await acotada(supabaseAdmin().from('portal_relogin').upsert({
    tenant_id: args.tenantId,
    comercio: args.comercio,
    permitido: false,
    revocado_por: quien,
    revocado_en: args.ahora,
    actualizado_en: args.ahora,
  }, { onConflict: 'tenant_id,comercio' }), 'revocarRelogin');

  if (error) throw new Error(`No se pudo revocar el permiso: ${error.message}`);

  await anotarBitacora({
    tenantId: args.tenantId,
    actor: args.actor,
    accion: 'portal_relogin.revocado',
    entidad: 'portal_relogin',
    entidadId: args.comercio,
    detalle: { comercio: args.comercio, contrasenaBorrada: borrada },
  }, { evento: 'relogin.bitacora_no_escribio' });

  logger.info('relogin.revocado', { tenant: args.tenantId, comercio: args.comercio, contrasenaBorrada: borrada });
  return { contrasenaBorrada: borrada };
}

/**
 * Quita la contraseña de la credencial guardada de un portal, dejando lo que
 * no es secreto (el usuario).
 *
 * Se reescribe la fila CIFRADA sin esa llave en vez de vaciar la columna: el
 * CHECK `conector_credencial_no_en_claro` exige que lo guardado siga siendo un
 * blob del cofre, y una columna a medias sería una credencial que no se puede
 * abrir en vez de una sin contraseña.
 *
 * Devuelve `true` si de verdad había una contraseña que borrar.
 */
export async function borrarContrasenaGuardada(tenantId: string, comercio: string): Promise<boolean> {
  if (!cofreConfigurado()) return false;
  const conectorId = conectorDePortal(comercio);

  const { data, error } = await acotada(supabaseAdmin()
    .from('conector_credencial')
    .select('valores_cifrados')
    .eq('tenant_id', tenantId)
    .eq('conector_id', conectorId)
    .maybeSingle(), 'borrarContrasenaGuardada.leer');

  if (error) throw new Error(`No se pudo leer la credencial para borrar la contraseña: ${error.message}`);
  const cifrado = (data as { valores_cifrados?: unknown } | null)?.valores_cifrados;
  if (typeof cifrado !== 'string' || cifrado === '') return false;

  let restantes: Record<string, string>;
  try {
    const v = descifrar(cifrado);
    if (v.contrasena === undefined) return false;
    restantes = {};
    for (const [k, valor] of Object.entries(v)) {
      if (k === 'contrasena' || valor === undefined) continue;
      restantes[k] = valor;
    }
  } catch (e) {
    // Si el cofre no puede abrir lo guardado, la contraseña ya es inservible.
    // Se dice el HECHO —nunca un byte del cifrado— y se cuenta como borrada:
    // el objetivo del botón (que ahí no quede una contraseña usable) se cumple.
    logger.warn('relogin.contrasena_no_descifra_al_borrar', {
      tenant: tenantId, comercio, err: e instanceof Error ? e.message : 'error',
    });
    restantes = {};
  }

  const { error: errU } = await acotada(supabaseAdmin()
    .from('conector_credencial')
    .update({ valores_cifrados: cifrar(restantes) })
    .eq('tenant_id', tenantId)
    .eq('conector_id', conectorId), 'borrarContrasenaGuardada.escribir');

  if (errU) throw new Error(`No se pudo borrar la contraseña guardada: ${errU.message}`);
  return true;
}

/**
 * SE VA A INTENTAR. Se anota ANTES de abrir el navegador, no después.
 *
 * Fail-closed en el sentido que importa: si la función muere a media sesión
 * —timeout de Vercel, Chromium caído— el contador YA se movió, así que la
 * corrida siguiente no vuelve a gastar un intento contra la cuenta del
 * cliente. Anotarlo al final haría que un re-login que revienta a mitad no
 * contara nunca, que es exactamente el bucle que bloquea cuentas.
 *
 * Best-effort al escribir, pero devuelve si quedó: quien no pueda anotar el
 * intento NO intenta. No poder contar es no poder frenar.
 */
export async function registrarIntento(args: {
  tenantId: string;
  comercio: string;
  permiso: PermisoRelogin;
  hoy: string;
  ahora: string;
}): Promise<boolean> {
  // El contador se reinicia al cambiar el día. Se calcula aquí y no con un
  // `+1` en SQL para que la ventana sea la del DÍA DE MÉXICO y no la del
  // servidor, que corre en UTC.
  const previos = args.permiso.diaDeIntentos === args.hoy ? args.permiso.intentosDia : 0;

  const { error } = await acotada(supabaseAdmin().from('portal_relogin').upsert({
    tenant_id: args.tenantId,
    comercio: args.comercio,
    intentos_dia: previos + 1,
    dia_de_intentos: args.hoy,
    ultimo_intento_en: args.ahora,
    actualizado_en: args.ahora,
  }, { onConflict: 'tenant_id,comercio' }), 'registrarIntento');

  if (error) {
    logger.warn('relogin.intento_sin_anotar', { tenant: args.tenantId, comercio: args.comercio, err: error.message });
    return false;
  }
  return true;
}

/**
 * CÓMO TERMINÓ. Lo que la pantalla cita después.
 *
 * `bloquear` es lo que convierte un corte en un candado. Va `true` SOLO para
 * `credencial_invalida`: los otros cortes (CAPTCHA, segundo factor) son
 * circunstancias de esa pantalla, y mañana el portal puede no pedirlas —
 * detenerlos para siempre obligaría a la flota a re-autorizar por algo que se
 * arregló solo. Una credencial rechazada, en cambio, sigue rechazada mañana.
 */
export async function registrarResultado(args: {
  tenantId: string;
  comercio: string;
  ok: boolean;
  clase: ClaseDeCorte | 'reconectado' | 'sin_campos' | 'portal_no_contesto' | null;
  motivo: string | null;
  ahora: string;
}): Promise<void> {
  const bloquear = args.clase === 'credencial_invalida';
  const fila: Record<string, unknown> = {
    tenant_id: args.tenantId,
    comercio: args.comercio,
    ultima_clase: args.clase,
    // El motivo se recorta y NUNCA lleva un valor tecleado: lo escriben
    // `relogin_cortes.ts` y `relogin.ts`, que solo citan lo que la PÁGINA dijo.
    ultimo_motivo: args.motivo ? args.motivo.slice(0, MAX_MOTIVO) : null,
    actualizado_en: args.ahora,
  };
  if (args.ok) fila.ultimo_exito_en = args.ahora;
  if (bloquear) fila.bloqueado = true;

  try {
    const { error } = await acotada(supabaseAdmin()
      .from('portal_relogin')
      .upsert(fila, { onConflict: 'tenant_id,comercio' }), 'registrarResultado');
    if (error) throw new Error(error.message);
  } catch (e) {
    logger.warn('relogin.resultado_sin_anotar', {
      tenant: args.tenantId, comercio: args.comercio,
      err: e instanceof Error ? e.message : String(e),
    });
  }

  // La bitácora es lo que hace citable «reconecté sola el 9 de agosto». El
  // actor es `'sistema'` A PROPÓSITO y no un olvido: no hubo persona, y esa es
  // justo la afirmación que este registro existe para poder hacer.
  await anotarBitacora({
    tenantId: args.tenantId,
    actor: 'sistema',
    accion: args.ok ? 'portal_relogin.reconectado' : 'portal_relogin.corte',
    entidad: 'portal_relogin',
    entidadId: args.comercio,
    detalle: { comercio: args.comercio, clase: args.clase, motivo: args.motivo?.slice(0, MAX_MOTIVO) ?? null },
  }, { evento: 'relogin.bitacora_no_escribio' });
}

/**
 * LA CONTRASEÑA, DESCIFRADA. La única entrada al cofre de todo el re-login.
 *
 * Está en este módulo y no en `cuentas.ts` a propósito: `cuentas.ts` lo importa
 * el camino de FACTURAR, y desde el #146 ese camino no puede volver a tener
 * acceso a una contraseña. Aquí solo entra `relogin.ts`.
 *
 * Devuelve el par en un objeto de vida corta que el llamador destruye al salir
 * de su función. NO se loguea, NO viaja en un error, NO se guarda en ningún
 * lado. `null` = no hay contraseña que usar (o no se pudo abrir), y ahí el
 * re-login se detiene y entra una persona.
 */
export async function contrasenaDePortal(
  tenantId: string,
  comercio: string,
): Promise<{ usuario: string; contrasena: string } | null> {
  if (!cofreConfigurado()) return null;

  const { data, error } = await acotada(supabaseAdmin()
    .from('conector_credencial')
    .select('valores_cifrados')
    .eq('tenant_id', tenantId)
    .eq('conector_id', conectorDePortal(comercio))
    .eq('activo', true)
    .maybeSingle(), 'contrasenaDePortal');

  if (error) {
    logger.warn('relogin.credencial_sin_leer', { tenant: tenantId, comercio, err: error.message });
    return null;
  }
  const cifrado = (data as { valores_cifrados?: unknown } | null)?.valores_cifrados;
  if (typeof cifrado !== 'string' || cifrado === '') return null;

  try {
    const v = descifrar(cifrado);
    const usuario = v.usuario?.trim();
    const contrasena = v.contrasena;
    if (!usuario || !contrasena) return null;
    return { usuario, contrasena };
  } catch (e) {
    // Cofre rotado o fila corrupta: se dice el hecho, jamás el contenido.
    logger.warn('relogin.credencial_no_descifra', {
      tenant: tenantId, comercio, err: e instanceof Error ? e.message : 'error',
    });
    return null;
  }
}
