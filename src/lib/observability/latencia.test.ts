import { describe, it, expect, vi } from 'vitest';
import { medirRuta, tasaDeMuestreo } from './latencia';

// ═══════════════════════════════════════════════════════════════════════════
// medirRuta (E1-A): barato y acotado — muestreo uniforme, nombres estáticos,
// y NUNCA tumba la ruta que mide.
// ═══════════════════════════════════════════════════════════════════════════

vi.mock('@/lib/admin/salud', () => ({ registrarLatencia: vi.fn(async () => {}) }));

function reloj(...marcas: number[]) {
  let i = 0;
  return () => marcas[Math.min(i++, marcas.length - 1)];
}

describe('medirRuta', () => {
  it('con la muestra tomada escribe nombre, duración y ok; la respuesta pasa intacta', async () => {
    const escribir = vi.fn(async () => {});
    const resp = new Response('hola', { status: 200 });
    const r = await medirRuta('health', async () => resp, { tasa: 1, azar: () => 0, reloj: reloj(1000, 1087), escribir });
    expect(r).toBe(resp);
    expect(escribir).toHaveBeenCalledWith('health', 87, true);
  });

  it('un 5xx cuenta como fallo; un 4xx NO (el cliente se equivocó, la ruta respondió)', async () => {
    const escribir = vi.fn(async () => {});
    await medirRuta('x', async () => new Response(null, { status: 503 }), { tasa: 1, azar: () => 0, reloj: reloj(0, 5), escribir });
    await medirRuta('x', async () => new Response(null, { status: 404 }), { tasa: 1, azar: () => 0, reloj: reloj(0, 5), escribir });
    expect(escribir.mock.calls.map((c) => c[2])).toEqual([false, true]);
  });

  it('si la ruta LANZA: anota el fallo y re-lanza la MISMA excepción', async () => {
    const escribir = vi.fn(async () => {});
    const boom = new Error('boom');
    await expect(medirRuta('x', async () => { throw boom; }, { tasa: 1, azar: () => 0, reloj: reloj(0, 9), escribir })).rejects.toBe(boom);
    expect(escribir).toHaveBeenCalledWith('x', 9, false);
  });

  it('fuera de la muestra no escribe nada (el muestreo acota la escritura)', async () => {
    const escribir = vi.fn(async () => {});
    await medirRuta('x', async () => new Response(null), { tasa: 0.1, azar: () => 0.5, escribir });
    await medirRuta('x', async () => new Response(null), { tasa: 0, azar: () => 0, escribir });
    expect(escribir).not.toHaveBeenCalled();
  });

  it('el muestreo es uniforme: NO depende de lo lento (un percentil sesgado a lo lento miente)', async () => {
    const escribir = vi.fn(async () => {});
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
