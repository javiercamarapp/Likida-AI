import { afterEach, describe, expect, it, vi } from 'vitest';
import { descargadorResend } from './resend';
import { MAX_ADJUNTO_BYTES } from './correo_entrante';

const respuesta = (cuerpo: unknown, init: ResponseInit = {}) => new Response(typeof cuerpo === 'string' || cuerpo instanceof Uint8Array ? (cuerpo as BodyInit) : JSON.stringify(cuerpo), { status: 200, ...init });

afterEach(() => { vi.unstubAllGlobals(); });

describe('descargadorResend', () => {
  it('pide los metadatos con la llave y baja el binario de la URL firmada', async () => {
    const llamadas: Array<[string, RequestInit | undefined]> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      llamadas.push([url, init]);
      return url.includes('api.resend.com') ? respuesta({ download_url: 'https://cdn.resend.test/x' }) : respuesta(new Uint8Array([1, 2, 3]));
    }));
    const r = await descargadorResend('re_llave', () => 60_000)('em 1', 'a/1');
    expect(r).toEqual({ ok: true, bytes: new Uint8Array([1, 2, 3]) });
    expect(llamadas[0][0]).toBe('https://api.resend.com/emails/em%201/attachments/a%2F1');
    expect((llamadas[0][1]?.headers as Record<string, string>).Authorization).toBe('Bearer re_llave');
  });

  it('404 = permanente; 5xx, 429, red caída y sin tiempo = transitorio', async () => {
    const casos: Array<[() => Promise<Response>, boolean]> = [
      [async () => respuesta('', { status: 404 }), false], [async () => respuesta('', { status: 500 }), true], [async () => respuesta('', { status: 429 }), true],
      [async () => { throw new Error('ECONNRESET'); }, true],
    ];
    for (const [f, transitorio] of casos) {
      vi.stubGlobal('fetch', vi.fn(f));
      expect(await descargadorResend('k', () => 60_000)('e', 'a')).toEqual({ ok: false, transitorio });
    }
    vi.stubGlobal('fetch', vi.fn(async () => respuesta({})));
    expect(await descargadorResend('k', () => 0)('e', 'a')).toEqual({ ok: false, transitorio: true });
  });

  it('una URL sin https o ausente se trata como transitoria (no se sigue un esquema raro)', async () => {
    for (const url of [undefined, 'http://inseguro.test/x', 'file:///etc/passwd']) {
      vi.stubGlobal('fetch', vi.fn(async () => respuesta({ download_url: url })));
      expect(await descargadorResend('k', () => 60_000)('e', 'a')).toEqual({ ok: false, transitorio: true });
    }
  });

  it('el tamaño se comprueba DECLARADO y REAL: pasarse es permanente', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (url.includes('api.resend.com')
      ? respuesta({ download_url: 'https://cdn.test/x' })
      : respuesta(new Uint8Array(10), { headers: { 'content-length': String(MAX_ADJUNTO_BYTES + 1) } }))));
    expect(await descargadorResend('k', () => 60_000)('e', 'a')).toEqual({ ok: false, transitorio: false });
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (url.includes('api.resend.com')
      ? respuesta({ download_url: 'https://cdn.test/x' })
      : respuesta(new Uint8Array(MAX_ADJUNTO_BYTES + 5)))));
    expect(await descargadorResend('k', () => 60_000)('e', 'a')).toEqual({ ok: false, transitorio: false });
  });
});
