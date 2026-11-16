import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const base = vi.hoisted(() => ({ respuesta: { data: null as unknown, error: null as unknown }, porTabla: {} as Record<string, { data: unknown; error: unknown }>, requireSuperadmin: vi.fn() }));
function cadena(tabla: string): unknown {
  const c: unknown = new Proxy(() => undefined, {
    get: (_t, prop) => (prop === 'then' ? (res: (v: unknown) => unknown) => res(base.porTabla[tabla] ?? base.respuesta) : () => c),
    apply: () => c,
  });
  return c;
}
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: (tabla: string) => cadena(tabla) }) }));
vi.mock('@/lib/auth/guard', () => ({ requireSuperadmin: base.requireSuperadmin }));
vi.mock('@/lib/formato', async (importar) => ({ ...(await importar<typeof import('@/lib/formato')>()), hoyMx: () => '2026-11-15' }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock('next/link', () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));

import ComisionesPage from './page';

const tablaAusente = { code: '42P01', message: 'relation "bo_comision_mov" does not exist' };
const html = async () => renderToStaticMarkup(await ComisionesPage({ searchParams: Promise.resolve({}) }));

beforeEach(() => {
  base.requireSuperadmin.mockReset().mockResolvedValue({ userId: 'u1', rol: 'superadmin' });
  base.respuesta = { data: null, error: tablaAusente };
  base.porTabla = {};
});

describe('/admin/back-office/comisiones', () => {
  it('lleva la puerta propia del superadmin en el render y la respeta', async () => {
    await html();
    expect(base.requireSuperadmin).toHaveBeenCalledTimes(1);
    base.requireSuperadmin.mockRejectedValue(new Error('NEXT_REDIRECT'));
    await expect(html()).rejects.toThrow('NEXT_REDIRECT');
  });

  it('con las tablas ausentes dice «No disponible. No es cero.» y no pinta una comisión en cero', async () => {
    const h = await html();
    expect(h).toContain('No disponible ahora. No es cero.');
    expect(h).toContain('migración 1010');
    expect(h).not.toContain('$0.00');
  });

  it('enseña la regla desde las constantes, la base «subtotal sin IVA» y «vigencia no definida»', async () => {
    const h = await html();
    expect(h).toContain('50 %');
    expect(h).toContain('20 %');
    expect(h).toContain('subtotal sin IVA');
    expect(h).toContain('no definida');
  });

  it('dice que el sistema nunca genera una orden de transferencia ni escribe al vendedor', async () => {
    const h = await html();
    expect(h).toMatch(/nunca genera una orden de transferencia ni escribe al vendedor|ningún prospecto ganado tiene flota/);
  });

  it('con tablas legibles y sin clientes cerrados el resultado esperado es «0 cobrados y 0 de comisión», dicho con la regla', async () => {
    base.respuesta = { data: [], error: null };
    const h = await html();
    expect(h).toContain('0 cobrados y 0 de comisión');
    expect(h).toContain('Sin vendedores');
  });

  it('con un vendedor y sin cobros muestra su fila con cero REAL y sin porcentaje', async () => {
    base.respuesta = { data: [], error: null };
    base.porTabla.app_user = { data: [{ id: 'v1', nombre: 'Ana Vendedora', email: 'ana@example.test' }], error: null };
    const h = await html();
    expect(h).toContain('Ana Vendedora');
    expect(h).toContain('ana@example.test');
    expect(h).toContain('$0.00');
    expect(readFileSync(join(process.cwd(), 'src/app/admin/back-office/comisiones/page.tsx'), 'utf8')).not.toContain('<h1');
  });
});
