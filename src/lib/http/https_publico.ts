import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { isIP, type LookupFunction } from 'node:net';
import type { ClientRequest, IncomingMessage } from 'node:http';
import { esIpPublica, hostNoPublico } from './destino_publico';

export const MAX_RESPUESTA_PUBLICA_BYTES = 8 * 1024 * 1024;

interface PeticionPublica {
  url: string;
  metodo: 'GET' | 'POST';
  encabezados?: Record<string, string>;
  cuerpo?: string;
  /**
   * SSRF del investigador (auditoría ola 1, #3): también acepta `http://` (los
   * sitios de prospectos a veces no tienen TLS). La garantía es la MISMA: el
   * `lookup` valida TODAS las direcciones y es el que entrega las IP al socket,
   * así que no hay una segunda resolución que un DNS con TTL 0 pueda cambiar.
   * Por omisión solo https, como siempre.
   */
  permitirHttp?: boolean;
  /** Tope de bytes del cuerpo (por omisión y como máximo, 8 MiB). */
  maxBytes?: number;
  /** Al llegar a `maxBytes`, entregar lo leído en vez de fallar (para páginas
   *  web, donde el recorte es lo esperado y no un error). */
  truncar?: boolean;
  /** Decide con estado y encabezados si vale la pena leer el cuerpo. `false` →
   *  se corta la conexión y se devuelve `cuerpo: ''` (p. ej. un PDF o un
   *  redirect cuyo cuerpo no se quiere). */
  aceptar?: (estado: number, encabezados: Record<string, string>) => boolean;
}

/** Sin proxies ni reutilización de sockets: el lookup validado entrega las IP
 * directamente a TLS. Conservamos el hostname para SNI y comprobación del cert.
 * https://nodejs.org/api/https.html#httpsrequestoptions-callback
 * No se siguen redirects. identity es obligatorio; una codificación inesperada
 * se cancela antes de leerla, evitando también bombas de descompresión.
 */
export async function httpsPublico(p: PeticionPublica, timeoutMs: number) {
  let url: URL;
  try { url = new URL(p.url); } catch { throw new Error('Dirección del proveedor inválida.'); }
  const esHttp = url.protocol === 'http:';
  if ((url.protocol !== 'https:' && !(esHttp && p.permitirHttp)) || url.username || url.password || hostNoPublico(url.hostname)) {
    throw new Error('El proveedor debe usar una dirección HTTPS pública sin credenciales en la URL.');
  }
  const maxBytes = Math.min(p.maxBytes ?? MAX_RESPUESTA_PUBLICA_BYTES, MAX_RESPUESTA_PUBLICA_BYTES);
  const truncar = p.truncar === true;
  return new Promise<{ estado: number; cuerpo: string; encabezados: Record<string, string> }>((resolve, reject) => {
    let terminado = false;
    let req: ClientRequest | undefined;
    let respuesta: IncomingMessage | undefined;
    const partes: Buffer[] = [];
    const fallar = (mensaje: string) => {
      if (terminado) return;
      terminado = true;
      clearTimeout(timer);
      partes.length = 0;
      respuesta?.destroy();
      req?.destroy();
      // Nunca propagar mensajes de DNS/TLS/URL que puedan contener secretos.
      reject(new Error(mensaje));
    };
    const timer = setTimeout(() => fallar('El proveedor no contestó dentro del plazo permitido.'), timeoutMs);
    const lookup: LookupFunction = (hostname, options, callback) => {
      dns.lookup(hostname, { all: true, family: options.family, hints: options.hints }, (error, direcciones) => {
        if (terminado) return; // DNS tardío nunca reanima el socket cancelado.
        if (error || !direcciones?.length || direcciones.some(d => !esIpPublica(d.address) || isIP(d.address) !== d.family)) {
          callback(new Error('El destino DNS del proveedor no es público.'), '');
          return;
        }
        if (options.all) callback(null, direcciones);
        else callback(null, direcciones[0].address, direcciones[0].family);
      });
    };
    try {
      const headers: Record<string, string> = {};
      for (const [clave, valor] of Object.entries(p.encabezados ?? {})) {
        // Host/SNI siempre corresponden al destino validado; no heredar encoding.
        if (!['host', 'accept-encoding'].includes(clave.toLowerCase())) headers[clave] = valor;
      }
      headers['accept-encoding'] = 'identity';
      const hostname = url.hostname.replace(/^\[|\]$/g, '');
      const opciones = {
        hostname, path: url.pathname + url.search, method: p.metodo, headers, lookup, agent: false as const,
      };
      const alResponder = (r: IncomingMessage) => {
        respuesta = r;
        r.on('error', () => fallar('No se pudo leer la respuesta del proveedor.'));
        r.on('aborted', () => fallar('El proveedor interrumpió la respuesta.'));
        if (terminado) { r.destroy(); return; }
        const encoding = r.headers['content-encoding'];
        if (encoding && encoding.trim().toLowerCase() !== 'identity') {
          fallar('El proveedor devolvió una codificación de respuesta no admitida.');
          return;
        }
        const encabezados: Record<string, string> = {};
        for (const [clave, valor] of Object.entries(r.headers)) {
          if (valor !== undefined) encabezados[clave.toLowerCase()] = Array.isArray(valor) ? valor.join(', ') : valor;
        }
        const entregar = (cuerpo: string) => {
          if (terminado) return;
          terminado = true;
          clearTimeout(timer);
          resolve({ estado: r.statusCode ?? 0, cuerpo, encabezados });
        };
        if (p.aceptar && !p.aceptar(r.statusCode ?? 0, encabezados)) {
          entregar('');
          r.destroy();
          return;
        }
        const longitud = Number(r.headers['content-length']);
        if (!truncar && Number.isFinite(longitud) && longitud > maxBytes) {
          fallar(`La respuesta del proveedor supera el límite de ${maxBytes / (1024 * 1024)} MiB.`);
          return;
        }
        let total = 0;
        r.on('data', (chunk: Buffer) => {
          if (terminado) return;
          if (total + chunk.byteLength > maxBytes) {
            if (!truncar) {
              fallar(`La respuesta del proveedor supera el límite de ${maxBytes / (1024 * 1024)} MiB.`);
              return;
            }
            // Recorte esperado (páginas web): se entrega lo que cabe y se corta
            // la conexión — el resto nunca se lee a memoria.
            const cabe = maxBytes - total;
            if (cabe > 0) { partes.push(chunk.subarray(0, cabe)); total += cabe; }
            entregar(Buffer.concat(partes, total).toString('utf8'));
            r.destroy();
            return;
          }
          total += chunk.byteLength;
          partes.push(chunk);
        });
        r.on('end', () => entregar(Buffer.concat(partes, total).toString('utf8')));
      };
      req = esHttp
        ? http.request({ ...opciones, protocol: 'http:', port: url.port || 80 }, alResponder)
        : https.request({
            ...opciones, protocol: 'https:', port: url.port || 443, rejectUnauthorized: true,
            servername: isIP(hostname) ? undefined : hostname,
          }, alResponder);
      req.on('error', () => fallar('No se pudo conectar de forma segura con el proveedor.'));
      req.end(p.cuerpo);
    } catch {
      fallar('No se pudo conectar de forma segura con el proveedor.');
    }
  });
}
