import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { acotada } from '../presupuesto';
import { conectorDePortal } from '../conectores/portales_facturacion';
import {
  guardarSesionPortal, invalidarSesionPortal, sesionesDePortales, sesionFresca,
  type SesionPortal,
} from './sesion_portal';
import { recortarEstadoAlPortal, unirEstados, type ClaseDeFallo } from './vinculo_senales';

// Las señales puras se re-exportan desde aquí para que quien orquesta importe
// UN módulo y no dos. La separación es de dependencias (ver el encabezado de
// `vinculo_senales.ts`), no de vocabulario.
export {
  pantallaDeLogin, clasificarFallo, recortarEstadoAlPortal, unirEstados,
  type ClaseDeFallo, type FalloDeVinculo,
} from './vinculo_senales';

// ═══════════════════════════════════════════════════════════════════════════
// EL VÍNCULO DE UN PORTAL — quién abrió la puerta, cuándo, y qué se hace
// cuando el portal la vuelve a cerrar.
//
// `sesion_portal.ts` sabía guardar la sesión de Playwright cifrada desde el
// 21-ago-2026 y NADIE la consumía: `SesionNavegador.abrir()` creaba el
// contexto sin `storageState`, así que cada corrida volvía al login. Este
// módulo es la otra mitad que faltaba — la que decide QUÉ pasó y CÓMO se
// llama, y la que deja el estado escrito donde una pantalla lo pueda leer.
//
// ── POR QUÉ EL ESTADO VIVE EN CLARO Y APARTE DE LA SESIÓN ────────────────
//
// La sesión (cookies) vive cifrada en el cofre, y ahí tiene que quedarse.
// Pero el CONTRALOR necesita ver tres cosas por (flota, portal) —vinculado /
// sin vincular / sesión caducada, con fecha— y ninguna de las tres es un
// secreto. Derivarlas del cofre obligaría a la pantalla a descifrar sesiones
// para pintar una píldora: la peor razón posible para tocar una llave.
// `portal_estado` (mig. 0232) guarda ese resumen en claro, sin una sola
// cookie, y la pantalla nunca se acerca al cofre.
//
// ── LAS DOS CAUSAS QUE PARECEN UNA Y NO LO SON ───────────────────────────
//
// «Falló el portal» son dos hechos con DUEÑOS distintos:
//
//   · SESIÓN CADUCADA — el portal nos mandó al login. Lo arregla el
//     contralor: entra él una vez y la sesión vuelve a servir. Likida no
//     tiene nada que corregir.
//   · EL PORTAL CAMBIÓ — seguimos dentro, pero el formulario ya no es el que
//     el adaptador conoce. Lo arregla LIKIDA: hay que rehacer el mapeo. Pedir
//     una re-vinculación aquí manda al cliente a hacer un login que ya
//     funciona, y el problema sigue igual la corrida siguiente.
//
// Confundirlas es mandar a la persona equivocada a arreglar algo. Por eso el
// resultado del agente lleva las dos banderas y no un `error` que haya que
// leer con expresiones regulares.
//
// ── LO QUE ESTO NO HACE ──────────────────────────────────────────────────
//
// Reintentar a ciegas. Si el portal contestó "no estás dentro", volver a
// entrar con la MISMA cookie da el mismo resultado y gasta otra sesión de
// navegador; y si el muro es un CAPTCHA, insistir es exactamente lo que la
// casa no hace (ver `CAPTCHA` en `agente.ts`). Se invalida el estado guardado,
// se anota el porqué y se le avisa al contralor. Una vez.
// ═══════════════════════════════════════════════════════════════════════════

/** Los tres estados que la pantalla enseña por (flota, portal). */
export type EstadoVinculo = 'vinculado' | 'sin_vincular' | 'caducada';

export interface VinculoPortal {
  /** Clave del comercio en `comercios.ts`. */
  comercio: string;
  estado: EstadoVinculo;
  /** ISO del último login humano que sí produjo sesión. `null` = nunca hubo. */
  vinculadaEn: string | null;
  /** ISO de cuándo el portal rechazó la sesión guardada. */
  caducadaEn: string | null;
  /** En palabras, para la pantalla. Nunca una cookie ni un secreto. */
  motivo: string | null;
  actualizadoEn: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// DÓNDE SE ANOTA — `portal_estado` (mig. 0232), en claro y sin cookies.
// ═══════════════════════════════════════════════════════════════════════════

interface FilaPortalEstado {
  comercio: unknown;
  estado: unknown;
  vinculada_en: unknown;
  caducada_en: unknown;
  motivo: unknown;
  actualizado_en: unknown;
}

const ESTADOS: readonly EstadoVinculo[] = ['vinculado', 'sin_vincular', 'caducada'];

/** Motivo acotado: acaba en una pantalla y en un WhatsApp, no en un volcado. */
const MAX_MOTIVO = 400;

function aVinculo(f: FilaPortalEstado): VinculoPortal | null {
  const comercio = String(f.comercio ?? '');
  const estado = String(f.estado ?? '') as EstadoVinculo;
  // Un estado que la base traiga y este código no conozca se DESCARTA con
  // grito: pintarlo como "vinculado" por defecto sería afirmarle al contralor
  // que puede facturar solo en un portal cuyo estado no sabemos leer.
  if (!comercio || !ESTADOS.includes(estado)) return null;
  return {
    comercio,
    estado,
    vinculadaEn: f.vinculada_en == null ? null : String(f.vinculada_en),
    caducadaEn: f.caducada_en == null ? null : String(f.caducada_en),
    motivo: f.motivo == null ? null : String(f.motivo),
    actualizadoEn: String(f.actualizado_en ?? ''),
  };
}

/**
 * El estado de vínculo de TODOS los portales de una flota, por clave de
 * comercio.
 *
 * DEVUELVE `null` SI LA BASE NO CONTESTÓ, y eso no es un detalle: un `Map`
 * vacío significaría "ningún portal está vinculado" y la pantalla mandaría al
 * contralor a re-vincular doce portales que están bien. Es la misma regla que
 * `seccion-credenciales.tsx` ya aplica con `guardadas === null`.
 */
export async function vinculosDePortales(tenantId: string): Promise<Map<string, VinculoPortal> | null> {
  const { data, error } = await acotada(supabaseAdmin()
    .from('portal_estado')
    .select('comercio, estado, vinculada_en, caducada_en, motivo, actualizado_en')
    .eq('tenant_id', tenantId), 'vinculosDePortales');

  if (error) {
    logger.warn('portal_estado.sin_leer', { tenant: tenantId, err: error.message });
    return null;
  }

  const mapa = new Map<string, VinculoPortal>();
  for (const f of (data ?? []) as FilaPortalEstado[]) {
    const v = aVinculo(f);
    if (!v) {
      logger.warn('portal_estado.fila_ilegible', { tenant: tenantId, estado: String(f.estado ?? '') });
      continue;
    }
    mapa.set(v.comercio, v);
  }
  return mapa;
}

/**
 * Deja escrito el estado de un (flota, portal). Idempotente por diseño: la
 * llave es `(tenant_id, comercio)` y se hace UPSERT, así que dos corridas que
 * vean lo mismo dejan lo mismo.
 *
 * BEST-EFFORT A PROPÓSITO: no lanza. Esto se llama DESPUÉS de que el lote ya
 * decidió si facturó o no, y tumbar un lote bueno por no poder anotar una
 * píldora sería cambiar un problema de pantalla por uno de dinero. El fallo se
 * grita en el log y el estado se vuelve a escribir en la corrida siguiente.
 *
 * `ahora` entra como dato —mismo criterio que `capturadaEn` en
 * `sesion_portal.ts`— para que la función sea probable sin tocar el reloj.
 */
export async function anotarVinculo(args: {
  tenantId: string;
  comercio: string;
  estado: EstadoVinculo;
  motivo?: string | null;
  ahora: string;
}): Promise<void> {
  const motivo = args.motivo ? args.motivo.slice(0, MAX_MOTIVO) : null;
  const fila: Record<string, unknown> = {
    tenant_id: args.tenantId,
    comercio: args.comercio,
    estado: args.estado,
    motivo,
    actualizado_en: args.ahora,
  };

  // Las dos fechas se escriben SOLO cuando el estado las produce, y no se
  // borran cuando no: «vinculado el 3 y caducado el 9» es la historia que la
  // pantalla necesita para que el contralor entienda que esto ya le pasó. El
  // CHECK de la 0232 exige que el estado vigente traiga la suya.
  if (args.estado === 'vinculado') fila.vinculada_en = args.ahora;
  if (args.estado === 'caducada') fila.caducada_en = args.ahora;

  try {
    const { error } = await acotada(supabaseAdmin()
      .from('portal_estado')
      .upsert(fila, { onConflict: 'tenant_id,comercio' }), 'anotarVinculo');
    if (error) throw new Error(error.message);
    logger.info('portal_estado.anotado', { tenant: args.tenantId, comercio: args.comercio, estado: args.estado });
  } catch (e) {
    logger.warn('portal_estado.sin_anotar', {
      tenant: args.tenantId, comercio: args.comercio, estado: args.estado,
      err: e instanceof Error ? e.message : String(e),
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// EL CICLO DE UNA CORRIDA: con qué se entra, y qué se guarda al salir.
// ═══════════════════════════════════════════════════════════════════════════

/** Las sesiones que valen la pena intentar, por clave de comercio. */
export interface SesionesVigentes {
  /** clave de comercio → la sesión guardada que pasó el pre-cheque de edad. */
  porComercio: Map<string, SesionPortal>;
  /** Lo que se le pasa a `SesionNavegador.abrir({ storageState })`. */
  storageState: string | null;
  /** Las que se descartaron por viejas. Se invalidan y la pantalla lo dice. */
  vencidasPorEdad: string[];
}

/** Vacío honesto, para cuando no hay nada que restaurar. */
const SIN_SESIONES: SesionesVigentes = { porComercio: new Map(), storageState: null, vencidasPorEdad: [] };

/** `portal_facturacion:g500` → `g500`. */
function comercioDeConectorDePortal(conectorId: string): string | null {
  const pre = 'portal_facturacion:';
  return conectorId.startsWith(pre) ? conectorId.slice(pre.length) : null;
}

/**
 * CON QUÉ ENTRA EL NAVEGADOR DE ESTA FLOTA.
 *
 * El pre-cheque de edad (`sesionFresca`) se hace AQUÍ y no dentro del lote a
 * propósito: es gratis y descarta lo obviamente vencido ANTES de arrancar
 * Chromium. Sigue sin ser un veredicto —la única prueba de que una sesión vive
 * es usarla— y por eso lo que pasa el filtro entra como "vale la pena
 * intentar", nunca como "está viva".
 *
 * FALLA CERRADO HACIA EL LOGIN: si la base no contesta se devuelve vacío y
 * nadie se invalida. El lote pedirá vinculación —una molestia— en vez de
 * borrar sesiones buenas por un timeout, que sería el error caro.
 *
 * `ahoraMs` y `maxEdadMs` entran como dato, mismo criterio que `sesionFresca`.
 */
export async function sesionesVigentes(
  tenantId: string,
  ahoraMs: number,
  maxEdadMs?: number,
): Promise<SesionesVigentes> {
  const guardadas = await sesionesDePortales(tenantId);
  if (guardadas === null || guardadas.size === 0) return SIN_SESIONES;

  const porComercio = new Map<string, SesionPortal>();
  const vencidasPorEdad: string[] = [];

  for (const [conectorId, sesion] of guardadas) {
    const comercio = comercioDeConectorDePortal(conectorId);
    if (!comercio) continue; // una fila `#sesion` de otro conector: no es nuestra
    if (sesionFresca(sesion, ahoraMs, maxEdadMs)) porComercio.set(comercio, sesion);
    else vencidasPorEdad.push(comercio);
  }

  return {
    porComercio,
    storageState: unirEstados([...porComercio.values()].map((s) => s.storageState)),
    vencidasPorEdad,
  };
}

/** Lo que este módulo necesita de `SesionNavegador`, sin importar Playwright. */
export interface NavegadorConSesion {
  estadoDeSesion(): Promise<string | null>;
}

/**
 * AL SALIR: guarda la sesión ACTUALIZADA de los portales que siguieron dentro.
 *
 * No es un lujo. Estos portales usan TTL deslizante (ASP.NET, el caso de
 * Megasur): cada petición renueva la cookie, así que la sesión que sale del
 * lote vale más que la que entró. Sin volver a guardarla, la sesión envejece
 * desde el primer login y el pre-cheque de edad la tira aunque el portal la
 * siguiera aceptando — o sea, se pediría re-vincular cada 30 minutos para
 * siempre.
 *
 * `portales` es clave de comercio → URL de su portal, y de ahí se recorta cada
 * bolsa de cookies. Best-effort de punta a punta: si algo falla se dice, y el
 * lote —que ya facturó— se queda como está.
 */
export async function refrescarSesiones(args: {
  tenantId: string;
  navegador: NavegadorConSesion;
  portales: ReadonlyMap<string, string>;
  /** ISO de la captura. Es el reloj de la frescura: entra como dato. */
  ahora: string;
}): Promise<string[]> {
  if (args.portales.size === 0) return [];

  const completo = await args.navegador.estadoDeSesion();
  if (!completo) return [];

  const refrescados: string[] = [];
  for (const [comercio, urlPortal] of args.portales) {
    const recortado = recortarEstadoAlPortal(completo, urlPortal);
    if (!recortado) {
      // El portal no dejó ni una cookie suya: no hay sesión que refrescar, y
      // sobrescribir la guardada con una bolsa vacía la mataría.
      logger.info('vinculo_portal.sin_cookies_que_guardar', { tenant: args.tenantId, comercio });
      continue;
    }
    try {
      await guardarSesionPortal(args.tenantId, conectorDePortal(comercio), {
        storageState: recortado,
        capturadaEn: args.ahora,
      });
      await anotarVinculo({ tenantId: args.tenantId, comercio, estado: 'vinculado', ahora: args.ahora, motivo: null });
      refrescados.push(comercio);
    } catch (e) {
      logger.warn('vinculo_portal.refresco_fallo', {
        tenant: args.tenantId, comercio, err: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return refrescados;
}

/**
 * EL PORTAL NOS SACÓ: se apaga la sesión guardada y se deja escrito el porqué.
 *
 * Las dos cosas van JUNTAS y en este orden: primero muere la cookie (que es lo
 * que impide que la corrida siguiente vuelva a estrellarse con ella) y después
 * se anota el estado (que es lo que la pantalla lee). Invertirlo dejaría una
 * ventana en la que la pantalla dice «caducada» y el robot sigue reintentando.
 */
export async function invalidarVinculo(args: {
  tenantId: string;
  comercio: string;
  clase: ClaseDeFallo;
  motivo: string;
  ahora: string;
}): Promise<void> {
  // `portal_cambio` NO toca la sesión: está viva y el problema es nuestro
  // mapeo. Borrarla aquí le costaría al cliente un login por un bug de Likida.
  if (args.clase === 'portal_cambio') return;

  await invalidarSesionPortal(args.tenantId, conectorDePortal(args.comercio));
  await anotarVinculo({
    tenantId: args.tenantId,
    comercio: args.comercio,
    estado: args.clase === 'sesion_caducada' ? 'caducada' : 'sin_vincular',
    motivo: args.motivo,
    ahora: args.ahora,
  });
}
