import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// /admin/techo-ia — la pantalla dice lo medido: el techo que aplica con su origen, el gasto de hoy o «sin
// medir» (jamás un cero inventado), y si la base cae lo dice en vez de pintar una lista vacía.
// ═══════════════════════════════════════════════════════════════════════════

const dobles = vi.hoisted(() => ({ getTechosIa: vi.fn() }));
vi.mock('@/lib/admin/techo_ia', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/admin/techo_ia')>()),
  getTechosIa: dobles.getTechosIa,
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock('./acciones', () => ({ guardarTechoIa: async () => {} }));

import TechoIaPage from './page';

const fila = (sobre: Record<string, unknown> = {}) => ({
  tenantId: '11111111-1111-4111-8111-111111111111', nombre: 'Flota Norte', topeUsd: 40, origen: 'tenant',
  declaradoUsd: 40, usadoHoyUsd: 18, pctUsado: 45, ...sobre,
});
const datos = (filas: unknown[], sobre: Record<string, unknown> = {}) => ({ filas, pisoUsd: 5, truncado: false, gastoIlegible: false, ...sobre });
async function renderizar(sp: { ok?: string; error?: string } = {}) { return renderToStaticMarkup(await TechoIaPage({ searchParams: Promise.resolve(sp) })); }

beforeEach(() => { dobles.getTechosIa.mockReset(); });

describe('/admin/techo-ia', () => {
  it('pinta cada flota con su techo, su origen, el gasto de hoy y un formulario para declararlo', async () => {
    dobles.getTechosIa.mockResolvedValue(datos([fila(), fila({ tenantId: '22222222-2222-4222-8222-222222222222', nombre: 'Flota Sur', origen: 'piso', declaradoUsd: null, topeUsd: 5, usadoHoyUsd: 0, pctUsado: 0 })]));
    const html = await renderizar();
    expect(html).toContain('Flota Norte');
    expect(html).toContain('Declarado');
    expect(html).toContain('Piso global');
    expect(html).toContain('45%');
    expect(html).toContain('name="techoUsd"');
    expect(html).toContain('value="40"');
    expect(html).toContain('Cambiar');
    expect(html).toContain('Fijar');
    expect(html).toContain('Techo diario en dólares para Flota Norte');
  });

  it('gasto ilegible: «sin medir» y el aviso, NO ceros', async () => {
    dobles.getTechosIa.mockResolvedValue(datos([fila({ usadoHoyUsd: null, pctUsado: null })], { gastoIlegible: true }));
    const html = await renderizar();
    expect(html).toContain('sin medir');
    expect(html).toContain('NO significa cero');
  });

  it('base caída: lo dice con todas sus letras y no pinta una lista vacía', async () => {
    dobles.getTechosIa.mockRejectedValue(new Error('caída'));
    const html = await renderizar();
    expect(html).toContain('No se pudo leer la lista de flotas');
    expect(html).not.toContain('Todavía no hay flotas');
  });

  it('sin flotas de verdad: lo dice', async () => {
    dobles.getTechosIa.mockResolvedValue(datos([]));
    expect(await renderizar()).toContain('Todavía no hay flotas');
  });

  it('muestra el resultado de la acción (éxito y error con el motivo)', async () => {
    dobles.getTechosIa.mockResolvedValue(datos([fila()]));
    expect(await renderizar({ ok: 'fijado' })).toContain('Techo guardado');
    expect(await renderizar({ ok: 'quitado' })).toContain('Declaración quitada');
    expect(await renderizar({ error: 'El techo diario va de 0.10 a 1000 USD.' })).toContain('va de 0.10 a 1000 USD');
    // Un `ok` que no es de la lista no se pinta nunca (no hay forma de inyectar texto por la URL).
    const ajeno = await renderizar({ ok: '<img src=x onerror=alert(1)>' });
    expect(ajeno).not.toContain('onerror');
    expect(ajeno).not.toContain('role="status"');
  });

  it('la pantalla está en el menú de /admin', async () => {
    const { TODAS_LAS_RUTAS } = await import('../rutas');
    expect(TODAS_LAS_RUTAS.some((r: { href: string }) => r.href === '/admin/techo-ia')).toBe(true);
  });
});
