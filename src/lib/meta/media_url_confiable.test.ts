import { describe, it, expect, vi, beforeEach } from 'vitest';

// CT-SEG-25 · el `url` del media viene de una respuesta de red: antes de mandarle el token del negocio hay que comprobar el host.
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
vi.mock('@/lib/logger', () => ({ logger }));

const { downloadMediaAsDataUrl, downloadMediaAsText, urlDeMediaConfiable } = await import('./client');

const resp = (cuerpo: unknown) => ({ ok: true, status: 200, text: async () => 'x', json: async () => cuerpo, arrayBuffer: async () => new ArrayBuffer(4) }) as unknown as Response;

beforeEach(() => {
  logger.warn.mockReset();
  process.env.WHATSAPP_ACCESS_TOKEN = 'EAA-secreto';
  process.env.WHATSAPP_PHONE_NUMBER_ID = '1285225531334385';
});

describe('urlDeMediaConfiable', () => {
  it('admite los hosts de Meta por https y rechaza todo lo demas', () => {
    for (const ok of ['https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1', 'https://scontent.xx.fbcdn.net/a', 'https://mmg.whatsapp.net/a', 'https://graph.facebook.com/v21.0/1']) {
      expect(urlDeMediaConfiable(ok)).toBe(true);
    }
    for (const mal of [
      'http://lookaside.fbsbx.com/a', 'https://evil.example/a', 'https://fbsbx.com.evil.example/a', 'https://evilfbsbx.com/a',
      'https://lookaside.fbsbx.com@evil.example/a', 'https://user:pw@lookaside.fbsbx.com/a', 'https://lookaside.fbsbx.com:8443/a',
      'no es url', '', undefined, null, 42,
    ]) expect(urlDeMediaConfiable(mal)).toBe(false);
  });
});

describe('las descargas no mandan el token a un host ajeno', () => {
  for (const [nombre, descargar] of [['downloadMediaAsDataUrl', downloadMediaAsDataUrl], ['downloadMediaAsText', downloadMediaAsText]] as const) {
    it(`${nombre}: un url ajeno no recibe ninguna peticion y se devuelve null`, async () => {
      const f = vi.fn().mockResolvedValueOnce(resp({ url: 'https://evil.example/robar', mime_type: 'image/jpeg' }));
      vi.stubGlobal('fetch', f);
      expect(await descargar('m-1')).toBeNull();
      expect(f).toHaveBeenCalledTimes(1); // solo los metadatos a Graph; el binario NUNCA se pidio al host ajeno
      expect(logger.warn).toHaveBeenCalledWith('wa.media_url_no_confiable', { mediaId: 'm-1', host: 'evil.example' });
      expect(JSON.stringify(f.mock.calls)).not.toContain('evil.example');
    });

    it(`${nombre}: un url de Meta si se descarga con el token`, async () => {
      const f = vi.fn()
        .mockResolvedValueOnce(resp({ url: 'https://lookaside.fbsbx.com/a', mime_type: 'image/jpeg' }))
        .mockResolvedValueOnce(resp({}));
      vi.stubGlobal('fetch', f);
      expect(await descargar('m-2')).not.toBeNull();
      expect(f).toHaveBeenCalledTimes(2);
      expect((f.mock.calls[1][1] as { headers: Record<string, string> }).headers.Authorization).toBe('Bearer EAA-secreto');
    });
  }
});
