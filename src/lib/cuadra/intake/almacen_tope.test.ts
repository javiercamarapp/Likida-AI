// ═══════════════════════════════════════════════════════════════════════════
// LA SUBIDA A STORAGE ERA LA ÚNICA LLAMADA DEL CAMINO SIN TECHO.
//
// `acotada` (presupuesto.ts) le puso tope a cada consulta y RPC de Supabase
// porque `supabaseAdmin()` construye el cliente sin `fetch` propio y todas
// heredaban el default de undici: 300 000 ms. Ésta se quedó fuera —no pasa por
// `repo.ts`— y es justo la del payload más grande.
//
// El costo: Vercel mata la función a los 120 s, o sea 180 s ANTES de que ese
// fetch se rinda. Y con la ráfaga corriendo en el MISMO `after()`, un cuelgue
// aquí no se lleva una foto: se lleva la invocación entera y con ella las otras
// veintiuna. Meta ya recibió su 200 y no reintenta.
//
// Se mide contra una subida que ACEPTA Y CALLA —el caso que midió la nota de
// `TOPE_CONSULTA_MS`, donde `fetch` seguía bloqueado a los 20 s sin síntoma—.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi, beforeEach } from 'vitest';

// El tope se lee del entorno AL CARGAR el módulo. Se baja a 50 ms para que la
// prueba mida el mecanismo y no el reloj.
process.env.CUADRA_TOPE_CONSULTA_MS = '50';

const upload = vi.fn();
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({ storage: { from: () => ({ upload, createSignedUrl: vi.fn() }) } }),
}));
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
vi.mock('@/lib/logger', () => ({ logger }));

const { subirComprobante } = await import('./almacen');
const { TOPE_CONSULTA_MS } = await import('../presupuesto');

const JPG = 'data:image/jpeg;base64,AAAA';

beforeEach(() => { upload.mockReset(); logger.warn.mockReset(); logger.error.mockReset(); });

describe('subirComprobante tiene techo', () => {
  it('el tope de prueba está puesto (si no, esto mediría 300 s de undici)', () => {
    expect(TOPE_CONSULTA_MS).toBe(50);
  });

  it('una subida que nunca contesta NO se lleva la invocación', async () => {
    upload.mockImplementation(() => new Promise(() => {}));   // acepta y calla
    const t0 = Date.now();
    const r = await subirComprobante('t1', 'v1', 'H', JPG);
    const tardo = Date.now() - t0;

    expect(r, 'sin ruta, el gasto entra sin foto — que es el trato de este módulo').toBeUndefined();
    // Tope (50) + gracia de `acotada` (1 500). Sin techo esto nunca resolvería.
    expect(tardo, `tardó ${tardo} ms: la subida sigue sin tope`).toBeLessThan(5_000);
  });

  it('y agotar el tope entra por el MISMO camino que un error de storage', async () => {
    upload.mockImplementation(() => new Promise(() => {}));
    await subirComprobante('t1', 'v1', 'H', JPG);
    // El contrato del módulo no cambia: un warn y `undefined`, nunca un throw.
    expect(logger.warn).toHaveBeenCalledWith('comprobante.subida_falló', expect.anything());
  });

  it('CONTROL — una subida normal sigue devolviendo su ruta', async () => {
    upload.mockResolvedValue({ error: null });
    await expect(subirComprobante('t1', 'v1', 'H', JPG)).resolves.toBe('t1/v1/H.jpg');
  });
});
