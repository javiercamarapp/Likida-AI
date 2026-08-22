import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA PROD (22-ago-2026) · RES-16 — el comprobante que no se guarda.
//
// El trato de este módulo no cambia y es correcto: si la subida falla, el
// GASTO ENTRA IGUAL, sin foto. Lo que estaba mal era el silencio alrededor —
// un `logger.warn` entre miles. Con el bucket ausente (la 0039 sin aplicar) o
// la llave sin permiso, TODOS los comprobantes entran sin imagen: el contralor
// pierde la prueba de gastos que sí ocurrieron y nadie se entera hasta que
// alguien abre un gasto viejo y no hay nada que mirar.
//
// Ahora: `error` en vez de `warn`, con el código del fallo, y tres fallos
// SEGUIDOS le escriben al operador del sistema. Una subida buena reinicia.
// ═══════════════════════════════════════════════════════════════════════════

const upload = vi.fn();
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({ storage: { from: () => ({ upload, createSignedUrl: vi.fn() }) } }),
}));
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
vi.mock('@/lib/logger', () => ({ logger, redactarTexto: (s: string) => s }));
const alertarOperador = vi.fn(async (_e: string, _d: Record<string, unknown>) => { void _e; void _d; });
vi.mock('@/lib/observability/alerta', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, alertarOperador: (e: string, d: Record<string, unknown>) => alertarOperador(e, d) };
});

const JPG = 'data:image/jpeg;base64,AAAA';
const { UMBRAL_STORAGE_CAIDO } = await import('./almacen');

// El contador es estado de módulo (por instancia, como en producción): cada
// prueba arranca fresca para medir el umbral y no la cuenta heredada.
async function cargar() {
  vi.resetModules();
  return import('./almacen');
}

beforeEach(() => { upload.mockReset(); alertarOperador.mockClear(); logger.error.mockClear(); });

describe('el fallo de subida se registra como lo que es', () => {
  it('nivel error y con el código del fallo, no un warn pelón', async () => {
    const { subirComprobante } = await cargar();
    upload.mockResolvedValue({ error: Object.assign(new Error('Bucket not found'), { statusCode: '404' }) });
    await expect(subirComprobante('t1', 'v1', 'H', JPG)).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith('comprobante.subida_falló', expect.objectContaining({
      viaje: 'v1', codigo: '404',
    }));
  });
});

describe('el contador de subidas fallidas seguidas', () => {
  it(`${UMBRAL_STORAGE_CAIDO} seguidas avisan al operador; antes del umbral, no`, async () => {
    const { subirComprobante } = await cargar();
    upload.mockResolvedValue({ error: { message: 'Bucket not found', statusCode: '404' } });

    for (let i = 0; i < UMBRAL_STORAGE_CAIDO - 1; i++) await subirComprobante('t1', 'v1', `H${i}`, JPG);
    expect(alertarOperador).not.toHaveBeenCalled();

    await subirComprobante('t1', 'v1', 'Hn', JPG);
    expect(alertarOperador).toHaveBeenCalledWith('storage.comprobantes_caido', expect.objectContaining({
      fallosSeguidos: UMBRAL_STORAGE_CAIDO, codigo: '404',
    }));
  });

  it('una subida buena reinicia la cuenta', async () => {
    const { subirComprobante } = await cargar();
    upload.mockResolvedValue({ error: { message: 'x' } });
    for (let i = 0; i < UMBRAL_STORAGE_CAIDO - 1; i++) await subirComprobante('t1', 'v1', `H${i}`, JPG);

    upload.mockResolvedValue({ error: null });
    expect(await subirComprobante('t1', 'v1', 'Hok', JPG)).toBe('t1/v1/Hok.jpg');

    upload.mockResolvedValue({ error: { message: 'x' } });
    for (let i = 0; i < UMBRAL_STORAGE_CAIDO - 1; i++) await subirComprobante('t1', 'v1', `H${i}b`, JPG);
    expect(alertarOperador).not.toHaveBeenCalled();
  });

  it('el cliente que LANZA (bucket inexistente) cuenta igual y sigue sin propagar', async () => {
    const { subirComprobante } = await cargar();
    upload.mockRejectedValue(new Error('no such bucket'));
    for (let i = 0; i < UMBRAL_STORAGE_CAIDO; i++) {
      await expect(subirComprobante('t1', 'v1', `H${i}`, JPG)).resolves.toBeUndefined();
    }
    expect(alertarOperador).toHaveBeenCalledWith('storage.comprobantes_caido', expect.anything());
  });
});
