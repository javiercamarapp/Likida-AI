import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEMO_CONFIG } from '@/lib/likida/config';

// PRU-02 / OP40-10 (cierre100, ola 10): `/dashboard/configuracion` ordenaba `viaje` por `creado_en`, columna que NO existe (la
// tabla solo tiene `created_at`): el 42703 caía en el `catch` mudo y la pantalla culpaba «a nosotros» en TODAS las flotas.
// Esta base falsa se porta como Postgres: pedir una columna que no existe devuelve error, no filas.
const COLUMNAS_VIAJE = new Set(['id', 'tenant_id', 'folio', 'km_recorridos', 'created_at', 'fecha_inicio', 'estatus']);
const d = vi.hoisted(() => ({ ordenes: [] as string[], logs: [] as unknown[][], filas: [{ km_recorridos: 412 }] }));
vi.mock('@/lib/auth/tenant-efectivo', () => ({ resolverTenantEfectivo: async () => ({ tenantId: 't-1', rol: 'flota_admin', userId: 'u' }) }));
vi.mock('next/navigation', () => ({ redirect: (u: string) => { throw new Error(`REDIRECT ${u}`); }, useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: (...a: unknown[]) => { d.logs.push(a); } } }));
vi.mock('@/lib/likida/config', async (orig) => ({ ...await orig<typeof import('@/lib/likida/config')>(), getConfig: async () => DEMO_CONFIG }));
vi.mock('@/lib/likida/contabilidad/catalogo', async (orig) => ({ ...await orig<typeof import('@/lib/likida/contabilidad/catalogo')>(), cuentasDeclaradas: async () => null }));
vi.mock('@/lib/supabase/admin', () => {
  const q: Record<string, unknown> = {};
  for (const m of ['from', 'select', 'eq', 'not', 'limit']) q[m] = () => q;
  q.order = (columna: string) => { d.ordenes.push(columna); return q; };
  q.maybeSingle = async () => (d.ordenes.every((c) => COLUMNAS_VIAJE.has(c))
    ? { data: d.filas[0], error: null }
    : { data: null, error: { message: `column viaje.${d.ordenes.find((c) => !COLUMNAS_VIAJE.has(c))} does not exist` } });
  return { supabaseAdmin: () => q };
});

import ConfiguracionPage from './page';
const sp = { searchParams: Promise.resolve({}) };
beforeEach(() => { d.ordenes.length = 0; d.logs.length = 0; });

describe('OP40-10: el viaje de ejemplo se ordena por una columna que EXISTE', () => {
  it('ordena por created_at y la pantalla ya no falla en todas las flotas', async () => {
    const html = renderToStaticMarkup(await ConfiguracionPage(sp));
    expect(d.ordenes).toEqual(['created_at']);
    expect(html).not.toContain('la lectura falló');
    expect(html).not.toContain('No se pudo leer un viaje');
    expect(d.logs).toEqual([]);
  });

  it('si la lectura sí falla, deja un warn con la causa (no un catch mudo)', async () => {
    d.filas = [{ km_recorridos: 412 }];
    const orig = COLUMNAS_VIAJE.delete('created_at');
    expect(orig).toBe(true);
    try {
      const html = renderToStaticMarkup(await ConfiguracionPage(sp));
      expect(html).toContain('la lectura falló');
      expect(d.logs.some(([ev, extra]) => ev === 'configuracion.viaje_ejemplo_no_leido' && /does not exist/.test(String((extra as { error?: string }).error)))).toBe(true);
    } finally { COLUMNAS_VIAJE.add('created_at'); }
  });
});
