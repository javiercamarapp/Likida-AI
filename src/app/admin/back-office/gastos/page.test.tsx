import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Cadena de supabase-js que responde SIEMPRE lo mismo (la tabla no existe, o filas fijas): lo que se prueba es lo que la PÁGINA hace con ello.
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

import GastosPage from './page';

const tablaAusente = { code: '42P01', message: 'relation "bo_gasto" does not exist' };
const html = async (mes?: string) => renderToStaticMarkup(await GastosPage({ searchParams: Promise.resolve(mes ? { mes } : {}) }));

beforeEach(() => {
  base.requireSuperadmin.mockReset().mockResolvedValue({ userId: 'u1', rol: 'superadmin' });
  base.respuesta = { data: null, error: tablaAusente };
  base.porTabla = {};
});

describe('/admin/back-office/gastos', () => {
  it('lleva la puerta propia del superadmin en el render', async () => {
    await html();
    expect(base.requireSuperadmin).toHaveBeenCalledTimes(1);
  });

  it('si no es superadmin, la página no pinta nada (la puerta rechaza)', async () => {
    base.requireSuperadmin.mockRejectedValue(new Error('NEXT_REDIRECT'));
    await expect(html()).rejects.toThrow('NEXT_REDIRECT');
  });

  it('con las tablas ausentes dice «No disponible. No es cero.» y NO pinta ceros', async () => {
    const h = await html();
    expect(h).toContain('No disponible ahora. No es cero.');
    expect(h).not.toContain('$0.00');
    expect(h).not.toContain('0 de 0');
    expect(h).toContain('migración 1009');
  });

  it('avisa del candado de entidad y de la captura manual', async () => {
    const h = await html();
    expect(h).toContain('aún no tiene razón social ni RFC propios');
    expect(h).toContain('Captura manual; el buzón automático espera dominio verificado.');
  });

  it('no pone un h1 propio (lo pone el marco), ni style en línea, ni emojis', async () => {
    const fuente = readFileSync(join(process.cwd(), 'src/app/admin/back-office/gastos/page.tsx'), 'utf8');
    expect(fuente).not.toContain('<h1');
    expect(fuente).not.toContain('style={{');
    expect(await html()).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it('con gastos reales: los muestra con «deducible en forma: no evaluable» y la frase del RFC propio', async () => {
    base.respuesta = { data: [], error: null };
    base.porTabla.bo_gasto = {
      data: [{
        id: 'g1', proveedor_id: 'p1', fecha: '2026-11-03', periodo: '2026-11-01', concepto: 'Plan Pro', moneda: 'USD', monto_original: '20.00', tipo_cambio: '20.5000',
        subtotal_mxn: null, iva_acreditable_mxn: null, total_mxn: '410.00', cfdi_uuid: null, comprobante_estado: 'sin_comprobante', deducible_en_forma: 'no_evaluable',
        cuenta_contable: null, conciliado_en: null, referencia_banco: null, bo_proveedor: { nombre: 'Vercel' },
      }],
      // `traerTodo` falla CERRADO sin el conteo exacto (no puede demostrar que leyó todo): el stub lo entrega, como PostgREST con count: 'exact'.
      count: 1,
      error: null,
    } as { data: unknown; error: unknown };
    const h = await html();
    expect(h).toContain('Vercel');
    expect(h).toContain('Plan Pro');
    expect(h).toContain('Deducible en forma: no evaluable');
    expect(h).toContain('Sin RFC propio, ningún comprobante es evaluable.');
    expect(h).toContain('tipo de cambio 20.5');
    expect(h).toContain('Conciliar');
  });
});
