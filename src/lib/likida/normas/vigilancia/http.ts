// El `fetch` real de la vigilancia: User-Agent genérico y honesto, 12 s por petición, siguiendo redirects como un
// navegador (diputados y el SAT a veces mueven el `www`). Lanza solo ante
// fallos de NUESTRA red (DNS, timeout, conexión); un HTTP 4xx/5xx se devuelve como `status` y lo juzga quien llama.

import type { RespuestaHttp } from './dof';

export const USER_AGENT = 'LikidaVigilancia/1.0 (+https://likida.ai)';
export const TIMEOUT_MS = 12_000;

// OJO (verificado con una llamada real el 14-nov-2026): el SIDOF contesta 406 si el `Accept` es `application/json`; con
// `*/*` (lo que manda curl) contesta 200 con el JSON. Por eso el `Accept` es `*/*` y el cuerpo se parsea a mano.
export async function traerReal(url: string, metodo: 'GET' | 'HEAD'): Promise<RespuestaHttp> {
  const r = await fetch(url, {
    method: metodo,
    redirect: 'follow',
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { 'User-Agent': USER_AGENT, Accept: '*/*' },
  });
  let cuerpo: unknown = null;
  if (metodo === 'GET') {
    try { cuerpo = JSON.parse(await r.text()); } catch { cuerpo = null; }
  }
  return { status: r.status, etag: r.headers.get('etag'), lastModified: r.headers.get('last-modified'), cuerpo };
}

export const pausarReal = (ms: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms); });
