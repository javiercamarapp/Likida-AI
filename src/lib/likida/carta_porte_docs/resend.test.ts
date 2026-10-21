import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_ADJUNTO_BYTES } from './correo_entrante';

// ── EL TRANSPORTE DE RED: `httpsPublico`, no `fetch` (AUDITORÍA ADVERSARIAL ───
// MEDIO, A3-SSRF) ───────────────────────────────────────────────────────────
// `descargadorResend` ya no llama a `fetch()` directo para los dos adjuntos de
// Resend: pasa por `httpsPublico` (el mismo wrapper anti-SSRF de
// `peajes/pull.ts`, `conectores/tms/sincronizar.ts` y, desde la auditoría A9,
// `correo/entrante/route.ts`). El doble de abajo imita el SUBCONJUNTO real que
// esta función usa — `aceptar` y el tope (`maxBytes`) — para que las pruebas
// de tamaño sigan ejercitando la MISMA clasificación (tope de archivo vs.
// fallo de red) que corre en producción, no una reimplementación aparte.
vi.mock('@/lib/http/https_publico', () => ({ httpsPublico: vi.fn() }));
const { httpsPublico } = await import('@/lib/http/https_publico');
const { descargadorResend } = await import('./resend');

interface RespSim { estado?: number; headers?: Record<string, string>; cuerpo?: string; bytes?: Uint8Array; lanzar?: boolean }
type PeticionSim = {
  url: string;
  metodo?: string;
  encabezados?: Record<string, string>;
  maxBytes?: number;
  maxBytesAbsoluto?: number;
  aceptar?: (estado: number, encabezados: Record<string, string>) => boolean;
};

function stubHttp(resolver: (url: string, timeoutMs: number, p: PeticionSim) => RespSim) {
  vi.mocked(httpsPublico).mockImplementation(async (p: PeticionSim, timeoutMs: number) => {
    const r = resolver(p.url, timeoutMs, p);
    if (r.lanzar) throw new Error('simulado: la conexión se interrumpió');
    const estado = r.estado ?? 200;
    const encabezados = r.headers ?? {};
    if (p.aceptar && !p.aceptar(estado, encabezados)) {
      return { estado, cuerpo: '', bytes: new Uint8Array(0), encabezados };
    }
    const bytes = r.bytes ?? new TextEncoder().encode(r.cuerpo ?? '');
    const techo = Math.max(1, p.maxBytesAbsoluto ?? 8 * 1024 * 1024);
    const maxBytes = Math.min(p.maxBytes ?? techo, techo);
    const declarado = Number(encabezados['content-length'] ?? 0) || 0;
    if ((declarado > 0 && declarado > maxBytes) || bytes.length > maxBytes) {
      throw new Error(`La respuesta del proveedor supera el límite de ${maxBytes / (1024 * 1024)} MiB.`);
    }
    return { estado, cuerpo: r.cuerpo ?? Buffer.from(bytes).toString('utf8'), bytes, encabezados };
  });
}

afterEach(() => { vi.clearAllMocks(); });

describe('descargadorResend', () => {
  it('pide los metadatos con la llave y baja el binario de la URL firmada', async () => {
    const llamadas: Array<[string, PeticionSim]> = [];
    stubHttp((url, _timeoutMs, p) => {
      llamadas.push([url, p]);
      return new URL(url).hostname === 'api.resend.com'
        ? { cuerpo: JSON.stringify({ download_url: 'https://cdn.resend.test/x' }) }
        : { bytes: new Uint8Array([1, 2, 3]) };
    });
    const r = await descargadorResend('re_llave', () => 60_000)('em 1', 'a/1');
    expect(r).toEqual({ ok: true, bytes: new Uint8Array([1, 2, 3]) });
    expect(llamadas[0][0]).toBe('https://api.resend.com/emails/em%201/attachments/a%2F1');
    expect(llamadas[0][1].encabezados?.Authorization).toBe('Bearer re_llave');
  });

  it('404 = permanente; 5xx, 429, red caída y sin tiempo = transitorio', async () => {
    const casos: Array<[(url: string) => RespSim, boolean]> = [
      [() => ({ estado: 404 }), false], [() => ({ estado: 500 }), true], [() => ({ estado: 429 }), true],
      [() => ({ lanzar: true }), true],
    ];
    for (const [f, transitorio] of casos) {
      stubHttp((url) => f(url));
      expect(await descargadorResend('k', () => 60_000)('e', 'a')).toEqual({ ok: false, transitorio });
    }
    stubHttp(() => ({ cuerpo: '{}' }));
    expect(await descargadorResend('k', () => 0)('e', 'a')).toEqual({ ok: false, transitorio: true });
  });

  it('una URL sin https o ausente se trata como transitoria (no se sigue un esquema raro)', async () => {
    for (const url of [undefined, 'http://inseguro.test/x', 'file:///etc/passwd']) {
      stubHttp(() => ({ cuerpo: JSON.stringify({ download_url: url }) }));
      expect(await descargadorResend('k', () => 60_000)('e', 'a')).toEqual({ ok: false, transitorio: true });
    }
  });

  it('el tamaño se comprueba DECLARADO y REAL: pasarse es permanente', async () => {
    stubHttp((url) => (new URL(url).hostname === 'api.resend.com'
      ? { cuerpo: JSON.stringify({ download_url: 'https://cdn.test/x' }) }
      : { bytes: new Uint8Array(10), headers: { 'content-length': String(MAX_ADJUNTO_BYTES + 1) } }));
    expect(await descargadorResend('k', () => 60_000)('e', 'a')).toEqual({ ok: false, transitorio: false });
    stubHttp((url) => (new URL(url).hostname === 'api.resend.com'
      ? { cuerpo: JSON.stringify({ download_url: 'https://cdn.test/x' }) }
      : { bytes: new Uint8Array(MAX_ADJUNTO_BYTES + 5) }));
    expect(await descargadorResend('k', () => 60_000)('e', 'a')).toEqual({ ok: false, transitorio: false });
  });
});
