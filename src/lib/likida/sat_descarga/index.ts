// ═══════════════════════════════════════════════════════════════════════════
// RESOLUCIÓN DE LA DESCARGA MASIVA (0231) — de variables de entorno a
// proveedor, o a la verdad de que no hay ninguno.
//
// Variables (en Vercel; JAMÁS en el repo):
//   LIKIDA_SAT_PROVEEDOR   'sw' (el construido) | 'sat_directo' (declarado,
//                          no construido — ver abajo)
//   LIKIDA_SAT_URL         base de la API de gestión del proveedor, p. ej.
//                          https://api.sw.com.mx
//   LIKIDA_SAT_USUARIO     opcional: hereda de LIKIDA_PAC_USUARIO
//   LIKIDA_SAT_PASSWORD    opcional: hereda de LIKIDA_PAC_PASSWORD
//
// POR QUÉ EL USUARIO Y LA CONTRASEÑA SE HEREDAN DEL PAC. Son la MISMA cuenta
// de SW: el timbrado y la descarga masiva son dos servicios del mismo
// proveedor con el mismo `/security/authenticate`. Pedir que se capturen dos
// veces el mismo secreto multiplica los lugares donde puede quedar mal escrito
// sin agregar ninguna separación real. La herencia es EXPLÍCITA y en un solo
// lugar (aquí), no una adivinanza repartida: quien quiera cuentas distintas
// pone las dos variables propias y mandan ésas.
//
// La URL NO se hereda a propósito: son hosts distintos (`services.sw.com.mx`
// para timbrar, `api.sw.com.mx` para gestionar). Heredarla mandaría cada
// solicitud de descarga al host equivocado y el error se leería como
// credenciales malas.
//
// ─────────────────────────────────────────────────────────────────────────
// EL OTRO CAMINO, DECLARADO Y NO CONSTRUIDO ('sat_directo')
//
// Se puede hablar al web service del SAT sin intermediario: existe librería
// Node al día que implementa el ciclo v1.5 completo. No cuesta por CFDI. Pero
// la descarga masiva exige la e.firma, así que por esa vía LA FIRMA
// ELECTRÓNICA DEL CLIENTE TIENE QUE VIVIR DE ESTE LADO —cifrada en reposo con
// `conectores/cofre.ts`, descifrada en memoria para cada llamada, con bitácora
// de cada uso—. Likida pasaría de "no tenemos la e.firma de nadie" a
// custodiar la identidad jurídica de cada flota.
//
// La decisión (27-ago-2026) es arrancar por el PAC: el costo es de Javier y
// se negocia; la custodia de una e.firma es del cliente y no se devuelve si
// sale mal. `sat_directo` queda como valor conocido del resolvedor para que
// el día que se construya no haya que tocar la base ni el ciclo — y mientras
// tanto DICE que no está construido, en vez de caerse o simular.
// ═══════════════════════════════════════════════════════════════════════════

import { crearProveedorSatSw } from './sw';
import type { ProveedorDescargaSat } from './tipos';

export type {
  ProveedorDescargaSat, RangoDescarga, TipoDescarga, ClaseErrorSat, ErrorSat,
  ResultadoSolicitud, ResultadoVerificacion, ResultadoPaquete, ResultadoCredencial,
} from './tipos';

/** Los proveedores que el resolvedor conoce. Uno construido, uno declarado. */
export const PROVEEDORES_CONOCIDOS = ['sw', 'sat_directo'] as const;

/** El único host al que 'sw' habla para gestión de descarga (ver sw.ts:5). */
const HOST_SW_GESTION = 'api.sw.com.mx';

/**
 * AUDITORÍA 25, SEGURIDAD (BAJO, línea 212, REINCIDENTE). La contraseña
 * HEREDADA (`LIKIDA_SAT_PASSWORD` ausente → cae a `LIKIDA_PAC_PASSWORD`) es
 * la MISMA que timbra el CFDI de la flota. Nada comprobaba a qué host viajaba
 * `LIKIDA_SAT_URL` antes de mandarla: un valor mal escrito, o apuntado a otro
 * lado, la expone a quien sea que atienda ahí. Con una contraseña PROPIA
 * (`LIKIDA_SAT_PASSWORD` sí capturada) no se restringe el host: es la
 * responsabilidad de quien la capturó junto con esa URL, no una herencia
 * silenciosa. Fail closed ante una URL ilegible, igual que ante un host
 * equivocado — nunca se adivina a dónde iba.
 */
function hostSwSinVerificar(proveedor: string, urlBase: string): boolean {
  if (proveedor !== 'sw' || urlBase === '') return false;
  const passwordHeredada = (process.env.LIKIDA_SAT_PASSWORD ?? '') === '';
  if (!passwordHeredada) return false;
  try {
    return new URL(urlBase).hostname.toLowerCase() !== HOST_SW_GESTION;
  } catch {
    return true;
  }
}

export interface EstadoDescargaSat {
  configurado: boolean;
  proveedor: string | null;
  /** Qué falta, en cristiano, cuando no está configurado. NULL cuando sí lo
   *  está. La pantalla lo imprime tal cual: "no configurado" a secas no le
   *  dice a nadie qué hacer ni a quién pedírselo. */
  motivo: string | null;
}

export function estadoDescargaSat(): EstadoDescargaSat {
  const proveedor = process.env.LIKIDA_SAT_PROVEEDOR?.trim() ?? '';
  if (proveedor === '') {
    return {
      configurado: false, proveedor: null,
      motivo: 'La descarga masiva no está configurada: falta LIKIDA_SAT_PROVEEDOR en el servidor. Lo destraba Javier (contrato con el PAC y variables de entorno).',
    };
  }
  if (proveedor === 'sat_directo') {
    return {
      configurado: false, proveedor: 'sat_directo',
      motivo: 'El camino directo al SAT está declarado pero NO construido: exigiría que Likida custodie la e.firma de la flota, y la decisión fue arrancar por el PAC (que la guarda en su bóveda). Cambia LIKIDA_SAT_PROVEEDOR a «sw».',
    };
  }
  if (!(PROVEEDORES_CONOCIDOS as readonly string[]).includes(proveedor)) {
    return {
      configurado: false, proveedor: null,
      motivo: `LIKIDA_SAT_PROVEEDOR dice «${proveedor}», que no es un proveedor conocido. Los conocidos son: ${PROVEEDORES_CONOCIDOS.join(', ')}.`,
    };
  }
  const urlBase = process.env.LIKIDA_SAT_URL?.trim().replace(/\/+$/, '') ?? '';
  if (hostSwSinVerificar(proveedor, urlBase)) {
    return {
      configurado: false, proveedor: null,
      motivo: `LIKIDA_SAT_URL no apunta al host que se espera del proveedor (${HOST_SW_GESTION}): con la contraseña heredada del PAC, mandarla a otro host expondría la MISMA credencial que timbra el CFDI de la flota. Corrige LIKIDA_SAT_URL, o captura LIKIDA_SAT_USUARIO/LIKIDA_SAT_PASSWORD propios si de verdad es otro proveedor.`,
    };
  }
  if (resolverDescargaSat() === null) {
    return {
      configurado: false, proveedor: null,
      motivo: 'Falta LIKIDA_SAT_URL, o el usuario y la contraseña del proveedor (LIKIDA_SAT_USUARIO/LIKIDA_SAT_PASSWORD, que por omisión heredan de LIKIDA_PAC_*). Lo destraba Javier.',
    };
  }
  return { configurado: true, proveedor, motivo: null };
}

export function resolverDescargaSat(): ProveedorDescargaSat | null {
  const proveedor = process.env.LIKIDA_SAT_PROVEEDOR?.trim() ?? '';
  const urlBase = process.env.LIKIDA_SAT_URL?.trim().replace(/\/+$/, '') ?? '';
  // La herencia explícita del PAC: misma cuenta de SW, un solo lugar donde se
  // decide. `??` y no `||` sería incorrecto aquí — una variable presente pero
  // vacía es "no configurada", no "cadena vacía a propósito".
  const usuario = (process.env.LIKIDA_SAT_USUARIO?.trim() || process.env.LIKIDA_PAC_USUARIO?.trim()) ?? '';
  const password = (process.env.LIKIDA_SAT_PASSWORD || process.env.LIKIDA_PAC_PASSWORD) ?? '';
  if (urlBase === '' || usuario === '' || password === '') return null;
  // Proveedor desconocido —o declarado y no construido— = no configurado.
  // Jamás adivinar, jamás simular una descarga.
  if (proveedor !== 'sw') return null;
  if (hostSwSinVerificar(proveedor, urlBase)) return null;
  return crearProveedorSatSw({ urlBase, usuario, password });
}
