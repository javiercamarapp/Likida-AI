import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { sinComentarios } from '@/lib/pruebas/codigo';

// ═══════════════════════════════════════════════════════════════════════════
// LA FOTO DEL TICKET SE GUARDA — Y NUNCA A COSTA DEL GASTO. 1-ago-2026.
//
// Encontrado mirando producción: 22 gastos, 19 con hash de imagen y CERO con
// `imagen_url`. La foto se bajaba de Meta, se hasheaba, se le pagaba la visión
// y se tiraba. No era un bug: `ocr.ts` ponía `imagenUrl: undefined` y no había
// ningún sitio que la subiera.
//
// Al meter una subida en el camino del intake aparece un riesgo nuevo y peor
// que el problema: que un fallo de storage tumbe el registro de un gasto que el
// operador sí hizo. Por eso lo que se prueba aquí no es que suba, sino que
// FALLE BIEN.
// ═══════════════════════════════════════════════════════════════════════════

const upload = vi.fn();
const createSignedUrl = vi.fn();
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({ storage: { from: () => ({ upload, createSignedUrl }) } }),
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const { subirComprobante, ligaComprobante } = await import('./almacen');

const JPG = 'data:image/jpeg;base64,AAAA';

describe('subirComprobante', () => {
  beforeEach(() => { upload.mockReset(); createSignedUrl.mockReset(); });

  it('devuelve la RUTA, no una URL: la firmada caduca y no se puede renovar', async () => {
    upload.mockResolvedValue({ error: null });
    const r = await subirComprobante('t1', 'v1', 'HASH', JPG);
    expect(r).toBe('t1/v1/HASH.jpg');
    expect(r, 'una URL guardada en la base nace caducando').not.toMatch(/^https?:/);
  });

  it('el nombre es el HASH: reenviar la misma foto reescribe su objeto', async () => {
    upload.mockResolvedValue({ error: null });
    await subirComprobante('t1', 'v1', 'HASH', JPG);
    // Sin `upsert`, el segundo intento falla con 409 y el gasto se queda sin
    // imagen por un motivo que no es un error.
    expect(upload.mock.calls[0][2]).toMatchObject({ upsert: true });
  });

  it('un error de storage NO lanza: devuelve undefined y el gasto entra sin foto', async () => {
    upload.mockResolvedValue({ error: { message: 'bucket not found' } });
    await expect(subirComprobante('t1', 'v1', 'H', JPG)).resolves.toBeUndefined();
  });

  it('y si el cliente LANZA —la 0039 sin aplicar— tampoco se propaga', async () => {
    upload.mockRejectedValue(new Error('no such bucket'));
    await expect(subirComprobante('t1', 'v1', 'H', JPG)).resolves.toBeUndefined();
  });

  it('respeta el tipo real: un png no se guarda como .jpg', async () => {
    upload.mockResolvedValue({ error: null });
    expect(await subirComprobante('t1', 'v1', 'H', 'data:image/png;base64,AAAA')).toBe('t1/v1/H.png');
  });
});

describe('ligaComprobante', () => {
  beforeEach(() => { createSignedUrl.mockReset(); });

  it('firma con una hora, igual que los PDF', async () => {
    createSignedUrl.mockResolvedValue({ data: { signedUrl: 'https://x/firmada' }, error: null });
    expect(await ligaComprobante('t1/v1/H.jpg')).toBe('https://x/firmada');
    expect(createSignedUrl).toHaveBeenCalledWith('t1/v1/H.jpg', 3600);
  });

  it('si no se puede firmar, el panel pinta un guion en vez de reventar', async () => {
    createSignedUrl.mockResolvedValue({ data: null, error: { message: 'nope' } });
    expect(await ligaComprobante('t1/v1/H.jpg')).toBeUndefined();
  });
});

describe('el bucket es privado, y eso no puede aflojarse por descuido', () => {
  it('la migración lo crea con public=false', () => {
    // Un bucket público no falla ruidosamente: SIRVE. El panel se ve bien y el
    // expediente de gastos de la flota queda accesible para quien adivine un
    // nombre de archivo. El bloque 22 de `verificaciones.sql` lo comprueba
    // contra la base; esto comprueba lo que se versionó.
    const sql = readFileSync('supabase/migrations/0039_bucket_comprobantes.sql', 'utf8');
    expect(sql).toMatch(/values\s*\(\s*'comprobantes',\s*'comprobantes',\s*false\s*\)/);
  });

  it('y nadie sirve el comprobante por URL pública desde el código', () => {
    const fuente = sinComentarios(readFileSync('src/lib/cuadra/intake/almacen.ts', 'utf8'));
    expect(fuente, 'getPublicUrl expondría el ticket sin firma').not.toContain('getPublicUrl');
  });
});
