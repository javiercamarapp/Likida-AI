// ═══════════════════════════════════════════════════════════════════════════
// SW SAPIEN (sw.com.mx) — el primer proveedor de la capa PAC (0226).
//
// POR QUÉ SW Y NO FINKOK (investigado 27-ago-2026): SW expone API REST con
// sandbox de acceso libre y documentado (services.test.sw.com.mx — las
// credenciales demo son públicas en su documentación), mientras Finkok es
// SOAP y su demo exige registro. REST + sandbox libre = el circuito completo
// se prueba HOY sin firmar nada; pasar a producción es cambiar URL y
// credenciales, no el código.
//
// EL SERVICIO ELEGIDO ES `issue`, NO `stamp`: issue recibe el CFDI SIN sellar
// ("los atributos Sello, Certificado y NoCertificado deben ir vacíos" — su
// doc) y el PAC lo SELLA con el CSD que la flota cargó en SU bóveda antes de
// timbrar. Eso decide dónde vive la llave privada del cliente: en la bóveda
// del PAC, jamás en Likida. `stamp` exigiría sellar aquí (cadena original +
// custodiar CSD y contraseña) — más superficie para el mismo timbre.
//
// La ruta dice /cfdi33/ por historia del proveedor; acepta el CFDI vigente
// (4.0) — está dicho así en su propia documentación.
//
// El token se cachea en memoria del proceso con margen: autenticar en cada
// timbre duplicaría latencia sin ganar nada; un 401 con token cacheado se
// reintenta UNA vez con token fresco (el token venció — no es un fallo del
// XML) y solo entonces es 'auth'.
// ═══════════════════════════════════════════════════════════════════════════

import { logger } from '@/lib/logger';
import type { ProveedorPac, ResultadoTimbre } from './tipos';

const TIMEOUT_MS = 20_000;
// SW emite tokens largos; 2 h de caché deja margen de sobra sin acercarse a
// la expiración real. Renovar de más es barato; usar un token muerto no.
const TOKEN_CACHE_MS = 2 * 60 * 60 * 1000;

interface ConfigSw {
  urlBase: string;
  usuario: string;
  password: string;
}

let tokenCache: { token: string; desde: number; llave: string } | null = null;

/** Solo para pruebas: tirar el token cacheado entre casos. */
export function _limpiarTokenSw(): void {
  tokenCache = null;
}

async function autenticar(cfg: ConfigSw): Promise<string | { error: ResultadoTimbre & { ok: false } }> {
  const llave = `${cfg.urlBase}|${cfg.usuario}`;
  if (tokenCache !== null && tokenCache.llave === llave && Date.now() - tokenCache.desde < TOKEN_CACHE_MS) {
    return tokenCache.token;
  }
  let res: Response;
  try {
    res = await fetch(`${cfg.urlBase}/v2/security/authenticate`, {
      method: 'POST',
      headers: { user: cfg.usuario, password: cfg.password },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    // Sin respuesta del PAC ni para autenticar: ambiguo NO — autenticar no
    // timbra nada, así que es 'red' pero seguro de reintentar; la clase la
    // decide el llamador del timbre, aquí solo se reporta.
    return { error: { ok: false, clase: 'red', codigo: null, mensaje: `Sin respuesta del PAC al autenticar: ${e instanceof Error ? e.message : String(e)}` } };
  }
  let cuerpo: unknown = null;
  try { cuerpo = await res.json(); } catch { /* cuerpo no-JSON: se trata abajo */ }
  const data = (cuerpo as { data?: { token?: unknown } } | null)?.data;
  const token = typeof data?.token === 'string' ? data.token : null;
  if (!res.ok || token === null) {
    const msg = (cuerpo as { message?: unknown } | null)?.message;
    return {
      error: {
        ok: false, clase: 'auth', codigo: null,
        mensaje: typeof msg === 'string' && msg.length > 0
          ? msg
          : `El PAC no entregó token (HTTP ${res.status}).`,
      },
    };
  }
  tokenCache = { token, desde: Date.now(), llave };
  return token;
}

interface RespuestaIssue {
  status?: unknown;
  message?: unknown;
  messageDetail?: unknown;
  data?: {
    uuid?: unknown;
    cfdi?: unknown;
    fechaTimbrado?: unknown;
    selloSAT?: unknown;
    noCertificadoSAT?: unknown;
  } | null;
}

export function crearProveedorSw(cfg: ConfigSw): ProveedorPac {
  async function llamarIssue(xml: string, token: string): Promise<Response> {
    // multipart/form-data con el XML como archivo — el método documentado que
    // no exige base64 ni cabeceras exóticas. FormData/Blob son nativos de
    // Node 18+, sin dependencias nuevas.
    const forma = new FormData();
    forma.append('xml', new Blob([xml], { type: 'text/xml' }), 'cfdi.xml');
    return fetch(`${cfg.urlBase}/cfdi33/issue/v4`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: forma,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  }

  return {
    nombre: 'sw',

    async timbrar(xmlSinSellar: string): Promise<ResultadoTimbre> {
      const auth = await autenticar(cfg);
      if (typeof auth !== 'string') return auth.error;

      let res: Response;
      try {
        res = await llamarIssue(xmlSinSellar, auth);
      } catch (e) {
        // AQUÍ el timeout es AMBIGUO: el POST del timbre pudo haber llegado.
        logger.error('pac.sw.red', { error: e instanceof Error ? e.message : String(e) });
        return { ok: false, clase: 'red', codigo: null, mensaje: `Sin respuesta del PAC al timbrar (el timbre PUDO emitirse — verifica en el panel del PAC antes de reintentar): ${e instanceof Error ? e.message : String(e)}` };
      }

      // Token vencido con caché: UNA renovación y un solo reintento — el 401
      // no es del XML. Cualquier otro 401 posterior sí es 'auth'.
      if (res.status === 401 && tokenCache !== null) {
        tokenCache = null;
        const fresco = await autenticar(cfg);
        if (typeof fresco !== 'string') return fresco.error;
        try {
          res = await llamarIssue(xmlSinSellar, fresco);
        } catch (e) {
          logger.error('pac.sw.red', { error: e instanceof Error ? e.message : String(e) });
          return { ok: false, clase: 'red', codigo: null, mensaje: `Sin respuesta del PAC al timbrar (el timbre PUDO emitirse — verifica en el panel del PAC antes de reintentar): ${e instanceof Error ? e.message : String(e)}` };
        }
      }
      if (res.status === 401) {
        return { ok: false, clase: 'auth', codigo: null, mensaje: 'El PAC rechazó las credenciales (401) incluso con token fresco.' };
      }

      let cuerpo: RespuestaIssue | null = null;
      try { cuerpo = (await res.json()) as RespuestaIssue; } catch { /* abajo */ }
      if (cuerpo === null) {
        // Respuesta ilegible tras un POST que sí llegó: mismo trato que la
        // red — el timbre pudo quedar emitido del lado del PAC.
        return { ok: false, clase: 'red', codigo: null, mensaje: `El PAC contestó HTTP ${res.status} sin cuerpo legible — verifica en su panel antes de reintentar.` };
      }

      if (cuerpo.status === 'success' && cuerpo.data && typeof cuerpo.data.uuid === 'string' && typeof cuerpo.data.cfdi === 'string') {
        return {
          ok: true,
          uuid: cuerpo.data.uuid,
          xmlTimbrado: cuerpo.data.cfdi,
          fechaTimbrado: typeof cuerpo.data.fechaTimbrado === 'string' ? cuerpo.data.fechaTimbrado : '',
          selloSat: typeof cuerpo.data.selloSAT === 'string' ? cuerpo.data.selloSAT : null,
          noCertificadoSat: typeof cuerpo.data.noCertificadoSAT === 'string' ? cuerpo.data.noCertificadoSAT : null,
        };
      }

      // Rechazo del PAC: mensaje TAL CUAL, con el código separado si viene en
      // la forma "CFDI40147 - …" que SW usa.
      const msg = typeof cuerpo.message === 'string' ? cuerpo.message : `El PAC contestó ${String(cuerpo.status ?? res.status)} sin mensaje.`;
      const detalle = typeof cuerpo.messageDetail === 'string' && cuerpo.messageDetail.length > 0 ? ` — ${cuerpo.messageDetail}` : '';
      const codigo = /^([A-Z0-9]{3,12})\s*-\s/.exec(msg)?.[1] ?? null;
      return { ok: false, clase: 'rechazado', codigo, mensaje: `${msg}${detalle}` };
    },

    async cancelar(_uuid: string, _motivo: string): Promise<{ ok: boolean; mensaje: string }> {
      // El contrato existe; el flujo de cancelación (motivos SAT 01-04,
      // ventana, sustitución) es fase posterior y se dirá cuando exista.
      return { ok: false, mensaje: 'La cancelación por API aún no está construida — cancela en el panel del PAC.' };
    },
  };
}
