// ═══════════════════════════════════════════════════════════════════════════
// SW SAPIEN — DESCARGA MASIVA (Efisco), proveedor 1 de la capa 0231.
//
// El MISMO PAC que ya timbra (0226), otro servicio y otro host: el timbrado
// vive en `services.sw.com.mx` y la gestión de descarga en `api.sw.com.mx`.
// El mecanismo de token es el mismo (`/security/authenticate` con las
// credenciales en cabeceras planas), y las credenciales son las de la MISMA
// cuenta — por eso `index.ts` permite heredarlas del PAC en vez de pedir que
// se capturen dos veces el mismo usuario y la misma contraseña.
//
// LOS TRES ENDPOINTS DEL CICLO (documentación del proveedor):
//   POST /gestion/v1/api/massiveservicemanager/request/create/webservice
//   GET  /gestion/v1/api/gestionxml/{requestId}
//   POST /gestion/v1/api/file           → URL firmada de S3, se baja aparte
//
// Y EL QUE HACE QUE LIKIDA NO TOQUE LA e.firma:
//   GET  /certificates/rfc/{rfc}        → ¿hay FIEL en la bóveda del PAC?
//
// Ese último es el corazón del diseño de seguridad: la flota sube su e.firma
// EN EL PORTAL DEL PAC (como ya subió su CSD), y desde aquí solo se pregunta
// si existe y hasta cuándo sirve. La solicitud de descarga viaja con `taxId`,
// nunca con la llave. Likida no recibe, no transporta y no guarda la firma
// electrónica de su cliente.
//
// NO HAY AMBIENTE DE PRUEBAS para descarga masiva —lo advierte el propio
// proveedor y el SAT tampoco lo tiene—, así que la primera llamada real es
// contra producción y contra el buzón real de la flota. Por eso cada tope se
// respeta y se declara, y por eso la solicitud tiene un candado de "un solo
// trámite vivo por rango" en la base (0231) y no un `if` aquí.
// ═══════════════════════════════════════════════════════════════════════════

import { logger } from '@/lib/logger';
import { leerZip } from './zip';
import type {
  ProveedorDescargaSat, RangoDescarga, ResultadoCredencial, ResultadoPaquete,
  ResultadoSolicitud, ResultadoVerificacion, ErrorSat,
} from './tipos';

const TIMEOUT_MS = 30_000;
/** Bajar el paquete es lo pesado del ciclo: un ZIP con miles de CFDI no cabe
 *  en los 30 s del resto de las llamadas. */
const TIMEOUT_DESCARGA_MS = 120_000;
// Mismo criterio que la capa PAC: SW emite tokens largos y 2 h de caché deja
// margen de sobra. Renovar de más es barato; usar un token muerto no.
const TOKEN_CACHE_MS = 2 * 60 * 60 * 1000;

/** Los estados numéricos que documenta SW para una solicitud de gestión. */
const ESTADOS_SW: Record<number, 'en_proceso' | 'lista' | 'error' | 'expirada'> = {
  1: 'en_proceso',
  3: 'error',
  4: 'expirada',
  6: 'lista',
};

export interface ConfigSw {
  urlBase: string;
  usuario: string;
  password: string;
}

let tokenCache: { token: string; desde: number; llave: string } | null = null;

/** Solo para pruebas: tirar el token cacheado entre casos. */
export function _limpiarTokenSat(): void {
  tokenCache = null;
}

function err(clase: ErrorSat['clase'], mensaje: string, codigo: string | null = null): ErrorSat {
  return { ok: false, clase, codigo, mensaje };
}

async function autenticar(cfg: ConfigSw): Promise<string | ErrorSat> {
  const llave = `${cfg.urlBase}|${cfg.usuario}`;
  if (tokenCache !== null && tokenCache.llave === llave && Date.now() - tokenCache.desde < TOKEN_CACHE_MS) {
    return tokenCache.token;
  }
  let res: Response;
  try {
    res = await fetch(`${cfg.urlBase}/security/authenticate`, {
      method: 'POST',
      headers: { user: cfg.usuario, password: cfg.password },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    return err('red', `Sin respuesta del proveedor al autenticar: ${e instanceof Error ? e.message : String(e)}`);
  }
  let cuerpo: unknown = null;
  try { cuerpo = await res.json(); } catch { /* cuerpo no-JSON: se trata abajo */ }
  const data = (cuerpo as { data?: { token?: unknown } } | null)?.data;
  const token = typeof data?.token === 'string' ? data.token : null;
  if (!res.ok || token === null) {
    const msg = (cuerpo as { message?: unknown } | null)?.message;
    return err('auth', typeof msg === 'string' && msg.length > 0
      ? msg
      : `El proveedor no entregó token (HTTP ${res.status}).`);
  }
  tokenCache = { token, desde: Date.now(), llave };
  return token;
}

/** Mensaje del proveedor tal cual, con su código si lo trae — el contador que
 *  lee "305 - Certificado inválido" puede actuar; un "algo falló" no. */
function mensajeDe(cuerpo: unknown, status: number): { mensaje: string; codigo: string | null } {
  const c = cuerpo as { message?: unknown; messageDetail?: unknown; codStatus?: unknown } | null;
  const msg = typeof c?.message === 'string' && c.message.length > 0
    ? c.message
    : `El proveedor contestó HTTP ${status} sin mensaje.`;
  const detalle = typeof c?.messageDetail === 'string' && c.messageDetail.length > 0
    ? ` — ${c.messageDetail}` : '';
  const codigo = typeof c?.codStatus === 'string' && c.codStatus.length > 0
    ? c.codStatus
    : (/^([A-Z0-9]{3,12})\s*-\s/.exec(msg)?.[1] ?? null);
  return { mensaje: `${msg}${detalle}`, codigo };
}

export function crearProveedorSatSw(cfg: ConfigSw): ProveedorDescargaSat {
  /** Una llamada autenticada, con UNA renovación de token ante 401 (el 401 no
   *  es de la petición, es del token cacheado). Mismo patrón que la capa PAC. */
  async function llamar(
    ruta: string,
    init: RequestInit,
    timeoutMs = TIMEOUT_MS,
  ): Promise<{ res: Response } | { error: ErrorSat }> {
    const auth = await autenticar(cfg);
    if (typeof auth !== 'string') return { error: auth };

    const pedir = (token: string): Promise<Response> => fetch(`${cfg.urlBase}${ruta}`, {
      ...init,
      headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(timeoutMs),
    });

    let res: Response;
    try {
      res = await pedir(auth);
    } catch (e) {
      return { error: err('red', `Sin respuesta del proveedor: ${e instanceof Error ? e.message : String(e)}`) };
    }
    if (res.status === 401 && tokenCache !== null) {
      tokenCache = null;
      const fresco = await autenticar(cfg);
      if (typeof fresco !== 'string') return { error: fresco };
      try {
        res = await pedir(fresco);
      } catch (e) {
        return { error: err('red', `Sin respuesta del proveedor: ${e instanceof Error ? e.message : String(e)}`) };
      }
    }
    if (res.status === 401) {
      return { error: err('auth', 'El proveedor rechazó las credenciales (401) incluso con token fresco.') };
    }
    return { res };
  }

  return {
    nombre: 'sw',

    async solicitar(rango: RangoDescarga): Promise<ResultadoSolicitud> {
      // `documentType` es el vocabulario del proveedor: Recepcion = lo que le
      // timbraron a este RFC (el que da el valor), Emision = lo que emitió.
      const cuerpoPeticion = {
        documentType: rango.tipo === 'recibidos' ? 'Recepcion' : 'Emision',
        // El SAT quiere el día completo: de las 00:00:00 a las 23:59:59.
        startDate: `${rango.desde} 00:00:00`,
        endDate: `${rango.hasta} 23:59:59`,
        taxId: rango.rfc,
        generatePDF: false,
        googleDrive: false,
        rfcReceptor: [],
        cfdiType: null,
        cfdiComplement: null,
        includeStatus: false,
        cfdiStatus: 'Todos',
      };
      const r = await llamar('/gestion/v1/api/massiveservicemanager/request/create/webservice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cuerpoPeticion),
      });
      if ('error' in r) {
        // SOLICITAR es la única llamada AMBIGUA del ciclo: el trámite pudo
        // quedar abierto del lado del SAT. El llamador no debe re-solicitar a
        // ciegas — quemaría el tope diario del RFC contra el mismo rango.
        if (r.error.clase === 'red') {
          return err('red', `${r.error.mensaje} — la solicitud PUDO quedar abierta ante el SAT: verifica antes de volver a pedir el mismo rango (el tope diario del RFC se consume igual).`);
        }
        return r.error;
      }
      let cuerpo: unknown = null;
      try { cuerpo = await r.res.json(); } catch { /* abajo */ }
      const data = (cuerpo as { data?: Record<string, unknown> } | null)?.data ?? null;
      const requestId = typeof data?.requestId === 'string' ? data.requestId
        : typeof data?.idSolicitud === 'string' ? data.idSolicitud
        : null;
      const { mensaje, codigo } = mensajeDe(cuerpo, r.res.status);
      if ((cuerpo as { status?: unknown } | null)?.status === 'success' && requestId !== null) {
        return { ok: true, requestId };
      }
      if ((cuerpo as { status?: unknown } | null)?.status === 'success') {
        // Éxito sin id: el trámite existe y no se puede seguir. Es 'red'
        // (ambiguo) y no 'rechazado', porque reintentar NO es seguro.
        logger.error('sat.sw.solicitud_sin_id', { rfc: rango.rfc, tipo: rango.tipo });
        return err('red', 'El proveedor contestó ÉXITO pero sin un identificador de solicitud legible — el trámite casi seguro SÍ se abrió ante el SAT. NO reintentes: revísalo en el panel del proveedor.');
      }
      // Sin e.firma en la bóveda, el proveedor responde un rechazo de
      // certificado. Se separa porque lo destraba la FLOTA (subir su e.firma),
      // no Likida ni Javier — y la pantalla tiene que decir eso.
      if (/certificad|fiel|e\.?firma/i.test(mensaje)) return err('sin_credencial', mensaje, codigo);
      return err('rechazado', mensaje, codigo);
    },

    async verificar(requestId: string): Promise<ResultadoVerificacion> {
      const r = await llamar(`/gestion/v1/api/gestionxml/${encodeURIComponent(requestId)}`, { method: 'GET' });
      if ('error' in r) return r.error;
      let cuerpo: unknown = null;
      try { cuerpo = await r.res.json(); } catch { /* abajo */ }
      const data = (cuerpo as { data?: Record<string, unknown> } | null)?.data ?? null;
      const { mensaje, codigo } = mensajeDe(cuerpo, r.res.status);
      if ((cuerpo as { status?: unknown } | null)?.status !== 'success' || data === null) {
        return err('rechazado', mensaje, codigo);
      }

      const bruto = data.status ?? data.requestStatus ?? data.estado;
      const numero = typeof bruto === 'number' ? bruto
        : typeof bruto === 'string' && /^\d+$/.test(bruto) ? Number(bruto)
        : null;
      const estado = numero !== null ? ESTADOS_SW[numero] : undefined;
      if (estado === undefined) {
        // Un estado que no está en la tabla del proveedor NO se traduce a
        // 'en_proceso' por comodidad: eso dejaría un trámite girando para
        // siempre. Se reporta como rechazo con el valor crudo a la vista.
        return err('rechazado', `El proveedor reportó un estado que esta versión no conoce (${String(bruto)}). ${mensaje}`, codigo);
      }

      const lista = Array.isArray(data.files) ? data.files
        : Array.isArray(data.packages) ? data.packages
        : [];
      const paquetes = lista
        .map((f: unknown) => typeof f === 'string' ? f
          : typeof (f as { pathFile?: unknown })?.pathFile === 'string' ? (f as { pathFile: string }).pathFile
          : null)
        .filter((p): p is string => p !== null);

      const cfdis = typeof data.totalCfdis === 'number' ? data.totalCfdis
        : typeof data.total === 'number' ? data.total
        : null;

      return { ok: true, estado, paquetes, cfdis, mensaje };
    },

    async descargar(paquete: string): Promise<ResultadoPaquete> {
      // Dos saltos: el proveedor devuelve una URL firmada y el ZIP se baja de
      // ahí. La URL trae la firma en el query string, así que NO se registra
      // en ningún log — es una credencial de un solo uso.
      const r = await llamar('/gestion/v1/api/file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pathFile: paquete }),
      });
      if ('error' in r) return r.error;
      let cuerpo: unknown = null;
      try { cuerpo = await r.res.json(); } catch { /* abajo */ }
      const data = (cuerpo as { data?: unknown } | null)?.data;
      const url = typeof data === 'string' ? data
        : typeof (data as { url?: unknown })?.url === 'string' ? (data as { url: string }).url
        : null;
      if (url === null) {
        const { mensaje, codigo } = mensajeDe(cuerpo, r.res.status);
        return err('rechazado', mensaje, codigo);
      }

      let zip: Response;
      try {
        zip = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_DESCARGA_MS) });
      } catch (e) {
        return err('red', `No se pudo bajar el paquete: ${e instanceof Error ? e.message : String(e)}`);
      }
      if (!zip.ok) {
        // El paquete del SAT vive 72 h y se puede bajar 2 veces. Un 403/404
        // aquí suele ser exactamente eso, y decirlo evita que alguien reintente
        // en vano lo que ya caducó.
        return err('rechazado', `El paquete no se pudo bajar (HTTP ${zip.status}). Los paquetes del SAT viven 72 horas y admiten 2 descargas: si ya se consumieron, hay que volver a solicitar el rango.`);
      }
      const bytes = Buffer.from(await zip.arrayBuffer());
      const { entradas, truncado, ilegibles } = leerZip(bytes);
      if (truncado || ilegibles > 0) {
        logger.warn('sat.sw.paquete_parcial', { entradas: entradas.length, truncado, ilegibles });
      }
      if (entradas.length === 0 && bytes.length > 0) {
        return err('rechazado', `El paquete bajó (${bytes.length} bytes) pero no traía ningún XML legible adentro. NO se ingirió nada — revísalo en el panel del proveedor antes de darlo por vacío.`);
      }
      return { ok: true, xmls: entradas.map((e) => e.contenido) };
    },

    async credencial(rfc: string): Promise<ResultadoCredencial> {
      const r = await llamar(`/certificates/rfc/${encodeURIComponent(rfc)}`, { method: 'GET' });
      if ('error' in r) return r.error;
      let cuerpo: unknown = null;
      try { cuerpo = await r.res.json(); } catch { /* abajo */ }
      const lista = (cuerpo as { data?: unknown } | null)?.data;
      if (!Array.isArray(lista)) {
        const { mensaje, codigo } = mensajeDe(cuerpo, r.res.status);
        return err('rechazado', mensaje, codigo);
      }
      // Se busca la FIEL, NO el CSD: el sello sirve para timbrar y NO sirve
      // para descargar (el SAT exige e.firma). Confundirlos diría "ya está
      // conectado" de una flota que no puede descargar nada.
      const fiel = lista.find((c: unknown) => {
        const t = (c as { certificate_type?: unknown })?.certificate_type;
        return typeof t === 'string' && /fiel|firma/i.test(t);
      }) as { certificate_number?: unknown; valid_to?: unknown } | undefined;
      if (fiel === undefined) {
        return err('sin_credencial', `No hay e.firma (FIEL) cargada en la bóveda del proveedor para el RFC ${rfc}. El CSD del timbrado NO sirve para descargar: el SAT exige la e.firma. La sube la flota en el portal del proveedor — Likida jamás la recibe.`);
      }
      const numero = typeof fiel.certificate_number === 'string' ? fiel.certificate_number : null;
      if (numero === null) {
        return err('rechazado', 'El proveedor reportó una e.firma sin número de certificado legible.');
      }
      return {
        ok: true,
        numero,
        venceEn: typeof fiel.valid_to === 'string' ? fiel.valid_to.slice(0, 10) : null,
      };
    },
  };
}
