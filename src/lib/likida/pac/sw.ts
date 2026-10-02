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
import type { ProveedorPac, ResultadoCancelacion, ResultadoTimbre, SolicitudCancelacion } from './tipos';

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

      // ── ÉXITO SIN TIMBRE LEGIBLE = AMBIGUO, JAMÁS RECHAZO (c6-2) ────────
      // El PAC dijo `success`: el CFDI muy probablemente SÍ se timbró y el
      // folio existe ante el SAT. Que no se pueda leer el uuid o el XML es un
      // problema de la respuesta, no del comprobante. Devolver 'rechazado'
      // aquí sería invitar al reintento —y a un segundo CFDI real—, así que
      // se devuelve 'red': la clase que en este repo significa "no sabemos, y
      // no se toca hasta verificar en el panel del PAC".
      if (cuerpo.status === 'success') {
        logger.error('pac.sw.exito_ilegible', {
          uuid: typeof cuerpo.data?.uuid,
          cfdi: typeof cuerpo.data?.cfdi,
        });
        return {
          ok: false, clase: 'red', codigo: null,
          mensaje: 'El PAC contestó ÉXITO pero sin un folio fiscal ni un XML timbrado legibles — el CFDI casi seguro SÍ se emitió. NO reintentes: verifica en el panel del PAC y avisa a soporte para registrarlo a mano.',
        };
      }

      // Rechazo del PAC: mensaje TAL CUAL, con el código separado si viene en
      // la forma "CFDI40147 - …" que SW usa.
      const msg = typeof cuerpo.message === 'string' ? cuerpo.message : `El PAC contestó ${String(cuerpo.status ?? res.status)} sin mensaje.`;
      const detalle = typeof cuerpo.messageDetail === 'string' && cuerpo.messageDetail.length > 0 ? ` — ${cuerpo.messageDetail}` : '';
      const codigo = /^([A-Z0-9]{3,12})\s*-\s/.exec(msg)?.[1] ?? null;
      return { ok: false, clase: 'rechazado', codigo, mensaje: `${msg}${detalle}` };
    },

    /**
     * CANCELACIÓN POR UUID — documentación oficial de SW sapien:
     *   https://developers.sw.com.mx/knowledge-base/cancelacion-cfdi/
     *   POST {urlBase}/cfdi33/cancel/{rfc}/{uuid}/{motivo}[/{folioSustitucion}]
     *   Authorization: Bearer {token}   (el CSD del emisor vive en la bóveda del PAC)
     *   200 → { status:'success', data:{ acuse:'<xml…>', uuid:{ 'UUID-EN-MAYUSCULAS': '201' } } }
     *   400 → { status:'error', message:'CACFDI33 - …', messageDetail:'CA305 - …', data:null }
     *   Códigos por UUID (…/cancelacion-cfdi-con-estatus/): 201 solicitud exitosa (en
     *   proceso), 202 ya estaba cancelado, 203 folio no corresponde al emisor, 205 UUID
     *   inexistente, 207 motivo inválido, 304 certificado revocado, 305 inválido.
     *
     * LO QUE NO ESTÁ VERIFICADO contra SW real (va a bloqueos_externos): que la cuenta
     * de la flota tenga su CSD cargado, el comportamiento con receptor que debe aceptar,
     * y el endpoint de consulta de estatus (no se usa: la confirmación final es humana).
     */
    async cancelar(s: SolicitudCancelacion): Promise<ResultadoCancelacion> {
      const motivosValidos = ['01', '02', '03', '04'];
      if (!motivosValidos.includes(s.motivo)) {
        return { ok: false, clase: 'rechazado', codigo: null, mensaje: `Motivo de cancelación "${s.motivo}" no existe en el catálogo del SAT (01-04).` };
      }
      if (s.motivo === '01' && !s.folioSustitucion) {
        return { ok: false, clase: 'rechazado', codigo: null, mensaje: 'El motivo 01 exige el UUID del comprobante que sustituye al cancelado.' };
      }
      if (s.motivo !== '01' && s.folioSustitucion) {
        return { ok: false, clase: 'rechazado', codigo: null, mensaje: 'Solo el motivo 01 lleva folio de sustitución; con los demás el SAT lo rechaza.' };
      }

      const auth = await autenticar(cfg);
      if (typeof auth !== 'string') return auth.error;

      const ruta = [s.rfcEmisor, s.uuid, s.motivo, ...(s.folioSustitucion ? [s.folioSustitucion] : [])]
        .map(encodeURIComponent).join('/');
      const llamar = (token: string) => fetch(`${cfg.urlBase}/cfdi33/cancel/${ruta}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      let res: Response;
      try {
        res = await llamar(auth);
        if (res.status === 401 && tokenCache !== null) {
          tokenCache = null;
          const fresco = await autenticar(cfg);
          if (typeof fresco !== 'string') return fresco.error;
          res = await llamar(fresco);
        }
      } catch (e) {
        // Pedir la misma cancelación otra vez es inocuo (202 «ya cancelado»), pero
        // sin respuesta no se sabe si el SAT la recibió: se dice y no se da por hecha.
        logger.error('pac.sw.cancelar_red', { error: e instanceof Error ? e.message : String(e) });
        return { ok: false, clase: 'red', codigo: null, mensaje: `Sin respuesta del PAC al cancelar (la solicitud PUDO llegar al SAT): ${e instanceof Error ? e.message : String(e)}. Repetir la petición es seguro; hasta confirmar, el CFDI sigue vigente.` };
      }
      if (res.status === 401) {
        return { ok: false, clase: 'auth', codigo: null, mensaje: 'El PAC rechazó las credenciales (401) incluso con token fresco.' };
      }

      let cuerpo: { status?: unknown; message?: unknown; messageDetail?: unknown; data?: { acuse?: unknown; uuid?: unknown } | null } | null = null;
      try { cuerpo = await res.json(); } catch { /* abajo */ }
      if (cuerpo === null) {
        return { ok: false, clase: 'red', codigo: null, mensaje: `El PAC contestó HTTP ${res.status} sin cuerpo legible: verifica el estatus del CFDI en el SAT/PAC antes de dar la cancelación por hecha.` };
      }

      if (cuerpo.status === 'success' && cuerpo.data && typeof cuerpo.data.uuid === 'object' && cuerpo.data.uuid !== null) {
        const porUuid = cuerpo.data.uuid as Record<string, unknown>;
        const codigo = String(porUuid[s.uuid.toUpperCase()] ?? Object.values(porUuid)[0] ?? '');
        const acuse = typeof cuerpo.data.acuse === 'string' ? cuerpo.data.acuse : null;
        if (codigo === '201') return { ok: true, estado: 'en_proceso', codigoSat: codigo, acuse, yaEstaba: false };
        if (codigo === '202') return { ok: true, estado: 'cancelado', codigoSat: codigo, acuse, yaEstaba: true };
        // Cualquier otro código por UUID (203, 205, 207…) NO es una cancelación.
        return { ok: false, clase: 'rechazado', codigo: codigo || null, mensaje: `El SAT/PAC contestó el código ${codigo || '(vacío)'} para este UUID: no quedó cancelado. ${textoCodigoCancelacion(codigo)}` };
      }

      if (cuerpo.status === 'success') {
        return { ok: false, clase: 'red', codigo: null, mensaje: 'El PAC contestó éxito sin el código por UUID legible: verifica el estatus del CFDI antes de dar la cancelación por hecha.' };
      }

      const msg = typeof cuerpo.message === 'string' ? cuerpo.message : `El PAC contestó ${String(cuerpo.status ?? res.status)} sin mensaje.`;
      const detalle = typeof cuerpo.messageDetail === 'string' && cuerpo.messageDetail.length > 0 ? ` — ${cuerpo.messageDetail}` : '';
      const codigo = /^([A-Z0-9]{3,12})\s*-\s/.exec(msg)?.[1] ?? null;
      return { ok: false, clase: 'rechazado', codigo, mensaje: `${msg}${detalle}` };
    },
  };
}

/** Lo que significa cada código por UUID de la cancelación (doc. oficial de SW). */
function textoCodigoCancelacion(codigo: string): string {
  switch (codigo) {
    case '203': return 'El folio fiscal no corresponde al emisor.';
    case '205': return 'El UUID no existe (el SAT da hasta 48 h tras el timbrado para que aparezca).';
    case '207': return 'El motivo de cancelación es inválido o falta.';
    case '304': return 'El certificado del emisor está revocado o venció.';
    case '305': return 'El certificado del emisor es inválido.';
    default: return 'Revisa el código en la documentación del PAC.';
  }
}
