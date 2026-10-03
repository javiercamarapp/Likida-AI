import { describe, it, expect, vi, beforeEach } from 'vitest';
import { medirRuta, tasaDeMuestreo, TOPE_ESCRITURA_MS } from './latencia';

// ═══════════════════════════════════════════════════════════════════════════
// medirRuta (E1-A): barato y acotado — muestreo uniforme, nombres estáticos,
// y NUNCA tumba la ruta que mide.
// ═══════════════════════════════════════════════════════════════════════════

vi.mock('@/lib/admin/salud', () => ({ registrarLatencia: vi.fn(async () => {}) }));
// `after()` solo existe dentro de una petición: por omisión lanza (como fuera de una), y una prueba lo captura.
const after = vi.fn((_f: () => unknown) => { throw new Error('after fuera de una petición'); });
vi.mock('next/server', () => ({ after: (f: () => unknown) => after(f) }));
beforeEach(() => { after.mockReset(); after.mockImplementation(() => { throw new Error('after fuera de una petición'); }); });

function reloj(...marcas: number[]) {
  let i = 0;
  return () => marcas[Math.min(i++, marcas.length - 1)];
}

describe('medirRuta', () => {
  it('con la muestra tomada escribe nombre, duración y ok; la respuesta pasa intacta', async () => {
    const escribir = vi.fn(async (_n: string, _ms: number, _ok: boolean) => {});
    const resp = new Response('hola', { status: 200 });
    const r = await medirRuta('health', async () => resp, { tasa: 1, azar: () => 0, reloj: reloj(1000, 1087), escribir });
    expect(r).toBe(resp);
    expect(escribir).toHaveBeenCalledWith('health', 87, true);
  });

  it('un 5xx cuenta como fallo; un 4xx NO (el cliente se equivocó, la ruta respondió)', async () => {
    const escribir = vi.fn(async (_n: string, _ms: number, _ok: boolean) => {});
    await medirRuta('x', async () => new Response(null, { status: 503 }), { tasa: 1, azar: () => 0, reloj: reloj(0, 5), escribir });
    await medirRuta('x', async () => new Response(null, { status: 404 }), { tasa: 1, azar: () => 0, reloj: reloj(0, 5), escribir });
    expect(escribir.mock.calls.map((c) => c[2])).toEqual([false, true]);
  });

  it('si la ruta LANZA: anota el fallo y re-lanza la MISMA excepción', async () => {
    const escribir = vi.fn(async (_n: string, _ms: number, _ok: boolean) => {});
    const boom = new Error('boom');
    await expect(medirRuta('x', async () => { throw boom; }, { tasa: 1, azar: () => 0, reloj: reloj(0, 9), escribir })).rejects.toBe(boom);
    expect(escribir).toHaveBeenCalledWith('x', 9, false);
  });

  it('fuera de la muestra no escribe nada (el muestreo acota la escritura)', async () => {
    const escribir = vi.fn(async (_n: string, _ms: number, _ok: boolean) => {});
    await medirRuta('x', async () => new Response(null), { tasa: 0.1, azar: () => 0.5, escribir });
    await medirRuta('x', async () => new Response(null), { tasa: 0, azar: () => 0, escribir });
    expect(escribir).not.toHaveBeenCalled();
  });

  it('el muestreo es uniforme: NO depende de lo lento (un percentil sesgado a lo lento miente)', async () => {
    const escribir = vi.fn(async (_n: string, _ms: number, _ok: boolean) => {});
    // misma decisión de azar con una ruta rápida y una lenta
    await medirRuta('r', async () => new Response(null), { tasa: 0.1, azar: () => 0.5, reloj: reloj(0, 1), escribir });
    await medirRuta('r', async () => new Response(null), { tasa: 0.1, azar: () => 0.5, reloj: reloj(0, 9000), escribir });
    expect(escribir).not.toHaveBeenCalled();
  });

  it('un escritor que falla NO tumba la ruta ni cambia su respuesta', async () => {
    const escribir = vi.fn(async () => { throw new Error('base caída'); });
    const resp = new Response('ok');
    await expect(medirRuta('x', async () => resp, { tasa: 1, azar: () => 0, escribir })).resolves.toBe(resp);
  });
});

describe('M1 (ronda 19): la escritura va fuera del camino crítico', () => {
  it('dentro de una petición la escritura se entrega a after() y la respuesta NO la espera', async () => {
    let nunca: (v?: unknown) => void = () => {};
    const escribir = vi.fn(() => new Promise<void>((res) => { nunca = res; })); // un insert que no contesta
    let pendiente: (() => unknown) | undefined;
    after.mockImplementation((f) => { pendiente = f; });
    const resp = new Response('ok');
    // si esperara la escritura, esta promesa no resolvería nunca
    await expect(medirRuta('webhook.whatsapp', async () => resp, { tasa: 1, azar: () => 0, escribir })).resolves.toBe(resp);
    expect(escribir).toHaveBeenCalledTimes(1);
    expect(pendiente).toBeTypeOf('function');
    nunca();
  });

  it('también en el camino de error: se re-lanza la MISMA excepción sin esperar la escritura', async () => {
    const escribir = vi.fn(() => new Promise<void>(() => {}));
    after.mockImplementation(() => undefined);
    const boom = new Error('boom');
    await expect(medirRuta('x', async () => { throw boom; }, { tasa: 1, azar: () => 0, escribir })).rejects.toBe(boom);
    expect(escribir).toHaveBeenCalledWith('x', expect.any(Number), false);
  });

  it('fuera de una petición (after lanza) espera como mucho ~300 ms aunque la escritura cuelgue', async () => {
    const escribir = vi.fn(() => new Promise<void>(() => {}));
    const t0 = Date.now();
    const resp = new Response('ok');
    await expect(medirRuta('x', async () => resp, { tasa: 1, azar: () => 0, escribir })).resolves.toBe(resp);
    expect(Date.now() - t0).toBeLessThan(TOPE_ESCRITURA_MS + 400);
    expect(escribir).toHaveBeenCalledTimes(1);
  });
});

describe('tasaDeMuestreo', () => {
  it('lee LIKIDA_LATENCIA_MUESTREO en 0..1 y vuelve a 0.1 con basura', () => {
    expect(tasaDeMuestreo('0.25')).toBe(0.25);
    expect(tasaDeMuestreo('1')).toBe(1);
    expect(tasaDeMuestreo('0')).toBe(0);
    for (const malo of ['2', '-1', 'abc', '', ' ']) expect(tasaDeMuestreo(malo)).toBe(0.1);
  });
  it('bajo vitest, sin variable, no escribe (determinismo de las pruebas de rutas)', () => {
    expect(tasaDeMuestreo(undefined)).toBe(0);
  });
});
