import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 21, MEDIO: "Las fotos que llegan por WhatsApp entran al OCR sin
// tope de tamaño ni redimensionar".
//
// `downloadMediaAsDataUrl` descargaba el binario de Meta y lo convertía a
// data-URL base64 SIN NINGÚN tope — a diferencia de `MAX_DATAURL` del lado
// del panel (`dashboard/ingesta/limites.ts`, RES-20). WhatsApp Cloud API
// admite imágenes hasta 5 MB; una foto de ese tamaño entraba entera al OCR y,
// de ahí, al cuerpo JSON de la llamada a OpenRouter, sin que nadie lo midiera.
//
// Estas pruebas verifican el candado nuevo: `MAX_IMAGEN_WHATSAPP_BYTES` y
// `ImagenDemasiadoPesadaError`.
// ═══════════════════════════════════════════════════════════════════════════

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
vi.mock('@/lib/logger', () => ({ logger }));

const {
  downloadMediaAsDataUrl, ImagenDemasiadoPesadaError, MAX_IMAGEN_WHATSAPP_BYTES,
} = await import('./client');

const metaResp = (mimeType: string, fileSize?: number) => ({
  ok: true, status: 200,
  json: async () => ({ url: 'https://lookaside.fb/x', mime_type: mimeType, ...(fileSize !== undefined ? { file_size: fileSize } : {}) }),
  text: async () => '',
}) as unknown as Response;

const binResp = (bytes: number) => ({
  ok: true, status: 200,
  arrayBuffer: async () => new ArrayBuffer(bytes),
  text: async () => '',
}) as unknown as Response;

beforeEach(() => {
  logger.error.mockReset(); logger.warn.mockReset();
  process.env.WHATSAPP_ACCESS_TOKEN = 'EAA-lo-que-sea';
  process.env.WHATSAPP_PHONE_NUMBER_ID = '1285225531334385';
});

describe('el tope de tamaño de una imagen de WhatsApp antes del OCR', () => {
  it('una foto normal (bien por debajo del tope) sigue funcionando igual que antes', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(metaResp('image/jpeg', 800_000))
      .mockResolvedValueOnce(binResp(800_000));
    vi.stubGlobal('fetch', fetchMock);

    const r = await downloadMediaAsDataUrl('media-normal');
    expect(r).toMatch(/^data:image\/jpeg;base64,/);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('rechaza ANTES de descargar el binario cuando Meta ya reporta un file_size sobre el tope', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(metaResp('image/jpeg', MAX_IMAGEN_WHATSAPP_BYTES + 1));
    vi.stubGlobal('fetch', fetchMock);

    await expect(downloadMediaAsDataUrl('media-pesada')).rejects.toBeInstanceOf(ImagenDemasiadoPesadaError);
    // Un solo fetch: el de metadatos. El binario nunca se pidió.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith('wa.imagen_demasiado_pesada', expect.objectContaining({ etapa: 'metadatos' }));
  });

  it('también rechaza cuando Meta no reporta file_size pero el binario ya descargado excede el tope', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(metaResp('image/jpeg', undefined))
      .mockResolvedValueOnce(binResp(MAX_IMAGEN_WHATSAPP_BYTES + 1));
    vi.stubGlobal('fetch', fetchMock);

    await expect(downloadMediaAsDataUrl('media-pesada-2')).rejects.toBeInstanceOf(ImagenDemasiadoPesadaError);
    expect(logger.warn).toHaveBeenCalledWith('wa.imagen_demasiado_pesada', expect.objectContaining({ etapa: 'binario' }));
  });

  it('un mime distinto de imagen (nota de voz) NO se topa aquí: el candado es solo para fotos del OCR', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(metaResp('audio/ogg', MAX_IMAGEN_WHATSAPP_BYTES + 5_000_000))
      .mockResolvedValueOnce(binResp(MAX_IMAGEN_WHATSAPP_BYTES + 5_000_000));
    vi.stubGlobal('fetch', fetchMock);

    const r = await downloadMediaAsDataUrl('media-audio');
    expect(r).toMatch(/^data:audio\/ogg;base64,/);
  });

  it('la excepción de "no se pudo descargar" (401, 404, red) sigue devolviendo null como siempre', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: false, status: 401, text: async () => '{}' } as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);

    const r = await downloadMediaAsDataUrl('media-401');
    expect(r).toBeNull();
  });
});
