import { describe, it, expect, vi, beforeEach } from 'vitest';

// CRÍTICO de la auditoría 5 (operabilidad): "Las descargas de media de Meta
// fallan sin dejar una sola línea."
//
// Los cuatro `if (!res.ok) return null` de las dos descargas estaban FUERA del
// `catch`, así que devolvían `null` mudos. El 28-jul-2026 a las 12:00 caducó el
// token de WhatsApp: a partir de ahí TODAS las fotos de TODOS los operadores
// habrían fallado en silencio absoluto, y el producto le responde al operador
// que reenvíe la foto — un remedio que no puede funcionar nunca, porque el
// problema no está en su foto sino en una credencial del servidor.
//
// Es la misma lección de `fc760c3` (el éxito también deja rastro), que vivía
// treinta líneas más abajo del comentario que la documenta.

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
vi.mock('@/lib/logger', () => ({ logger }));

const { downloadMediaAsDataUrl, downloadMediaAsText } = await import('./client');

const respuesta = (ok: boolean, status: number, cuerpo: string) =>
  ({ ok, status, text: async () => cuerpo, json: async () => JSON.parse(cuerpo || '{}'), arrayBuffer: async () => new ArrayBuffer(0) }) as unknown as Response;

beforeEach(() => {
  logger.error.mockReset(); logger.warn.mockReset();
  process.env.WHATSAPP_ACCESS_TOKEN = 'EAA-lo-que-sea';
  process.env.WHATSAPP_PHONE_NUMBER_ID = '1285225531334385';
});

describe('descargas de media que fallan', () => {
  it('un token vencido deja un error con el status y el cuerpo de Meta', async () => {
    // 401 + código 190 es exactamente lo que Meta devuelve con el token caducado.
    vi.stubGlobal('fetch', vi.fn(async () =>
      respuesta(false, 401, '{"error":{"code":190,"message":"Session has expired"}}')));

    const r = await downloadMediaAsDataUrl('media-123');
    expect(r).toBeNull();
    expect(logger.error).toHaveBeenCalledWith('wa.media_no_descargada', expect.objectContaining({
      paso: 'metadatos', mediaId: 'media-123', status: 401,
    }));
    // El cuerpo es lo que distingue un token vencido de un media caducado: sin
    // él los dos se ven igual y llevan a arreglos distintos.
    const [, meta] = logger.error.mock.calls[0] as [string, { body: string }];
    expect(meta.body).toContain('190');
  });

  it('distingue el paso de metadatos del de contenido', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(respuesta(true, 200, '{"url":"https://lookaside.fb/x","mime_type":"image/jpeg"}'))
      .mockResolvedValueOnce(respuesta(false, 404, 'not found'));
    vi.stubGlobal('fetch', fetchMock);

    expect(await downloadMediaAsDataUrl('media-456')).toBeNull();
    expect(logger.error).toHaveBeenCalledWith('wa.media_no_descargada', expect.objectContaining({
      paso: 'contenido', status: 404,
    }));
  });

  it('el XML del CFDI tiene las mismas dos bocas', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respuesta(false, 401, '{"error":{"code":190}}')));
    expect(await downloadMediaAsText('media-xml')).toBeNull();
    expect(logger.error).toHaveBeenCalledWith('wa.media_no_descargada', expect.objectContaining({
      paso: 'metadatos', mediaId: 'media-xml',
    }));
  });

  // El límite: una descarga que SÍ funciona no debe ensuciar el log de errores.
  it('una descarga correcta no grita', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(respuesta(true, 200, '{"url":"https://lookaside.fb/x","mime_type":"image/jpeg"}'))
      .mockResolvedValueOnce(respuesta(true, 200, '')));
    await downloadMediaAsDataUrl('media-ok');
    expect(logger.error).not.toHaveBeenCalled();
  });
});
