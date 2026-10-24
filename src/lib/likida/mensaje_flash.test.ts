import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// A37-S13-08 / A37-S14-07: el aviso o error de una acción NO viaja como texto libre en la URL (cualquiera arma un enlace que
// pinta «Tu sesión venció, llama al…» en el panel del dueño): viaja en una cookie de vida corta que solo el servidor escribe.

const jar = new Map<string, { value: string; opciones: Record<string, unknown> }>();
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (n: string) => (jar.has(n) ? { name: n, value: jar.get(n)!.value } : undefined),
    set: (n: string, value: string, opciones: Record<string, unknown>) => { jar.set(n, { value, opciones }); },
  }),
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { dejarFlash, leerFlash } = await import('./mensaje_flash');

const RUTA = '/dashboard/agentes/liquidacion/configuracion';
beforeEach(() => jar.clear());

describe('mensaje_flash', () => {
  it('lo que una acción deja, la misma ruta lo lee; con cookie de vida corta, solo servidor y acotada a la ruta', async () => {
    await dejarFlash(RUTA, { aviso: 'Configuración guardada.' });
    expect(await leerFlash(RUTA)).toEqual({ aviso: 'Configuración guardada.' });
    const [{ opciones }] = [...jar.values()];
    expect(opciones).toMatchObject({ httpOnly: true, sameSite: 'lax', path: RUTA });
    expect(Number(opciones.maxAge)).toBeLessThanOrEqual(60);
  });

  it('otra ruta no ve el mensaje; sin cookie no hay mensaje', async () => {
    await dejarFlash(RUTA, { error: 'No se pudo.' });
    expect(await leerFlash('/dashboard/agentes/peajes/configuracion')).toEqual({});
    jar.clear();
    expect(await leerFlash(RUTA)).toEqual({});
  });

  it('una cookie manipulada (JSON roto, tipos raros, otra ruta) se ignora; el texto se acota', async () => {
    const nombre = [...(await (async () => { await dejarFlash(RUTA, { aviso: 'x' }); return jar.keys(); })())][0];
    jar.set(nombre, { value: '%7Bno-es-json', opciones: {} });
    expect(await leerFlash(RUTA)).toEqual({});
    jar.set(nombre, { value: encodeURIComponent(JSON.stringify({ r: RUTA, aviso: 5, error: { x: 1 }, detalle: 'd'.repeat(5000) })), opciones: {} });
    const f = await leerFlash(RUTA);
    expect(f.aviso).toBeUndefined();
    expect(f.error).toBeUndefined();
    expect(f.detalle!.length).toBeLessThanOrEqual(700);
    jar.set(nombre, { value: encodeURIComponent(JSON.stringify({ r: '/otra', aviso: 'x' })), opciones: {} });
    expect(await leerFlash(RUTA)).toEqual({});
  });

  it('si no se puede escribir la cookie no revienta la acción', async () => {
    const mod = await import('next/headers');
    const orig = mod.cookies;
    (mod as { cookies: unknown }).cookies = async () => { throw new Error('fuera de solicitud'); };
    await expect(dejarFlash(RUTA, { aviso: 'x' })).resolves.toBeUndefined();
    (mod as { cookies: unknown }).cookies = orig;
  });
});

describe('guarda: las pantallas no pintan texto de la URL como mensaje del sistema', () => {
  const lee = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
  const PAGINAS = [
    'src/app/dashboard/agentes/liquidacion/configuracion/page.tsx',
    'src/app/dashboard/agentes/liquidacion/formato/page.tsx',
    'src/app/dashboard/agentes/peajes/configuracion/page.tsx',
  ];
  it.each(PAGINAS)('%s no lee ?aviso= ni ?error= para pintarlos', (p) => {
    const f = lee(p);
    expect(f).not.toMatch(/sp\.aviso|sp\.error/);
    expect(f).not.toMatch(/aviso=\$\{encodeURIComponent|error=\$\{encodeURIComponent/);
  });
  it('liquidacion/page.tsx no manda el detalle de la importación como ?ext_det= (texto libre)', () => {
    expect(lee('src/app/dashboard/agentes/liquidacion/page.tsx')).not.toMatch(/'ext_det'|sp\.ext_det/);
  });
});
