import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';

const dobles = vi.hoisted(() => ({ requireSuperadmin: vi.fn(), getPorCobrarTodas: vi.fn(), getPiezasDunningPlataforma: vi.fn(), getUltimaCorridaDunningPlataforma: vi.fn() }));
vi.mock('@/lib/auth/guard', () => ({ requireSuperadmin: dobles.requireSuperadmin }));
vi.mock('@/lib/saas/transferencia', async (importar) => ({
  ...(await importar<typeof import('@/lib/saas/transferencia')>()),
  getPorCobrarTodas: dobles.getPorCobrarTodas,
}));
vi.mock('@/lib/likida/repo', async (importar) => ({
  ...(await importar<typeof import('@/lib/likida/repo')>()),
  getPiezasDunningPlataforma: dobles.getPiezasDunningPlataforma,
  getUltimaCorridaDunningPlataforma: dobles.getUltimaCorridaDunningPlataforma,
}));
vi.mock('@/lib/formato', async (importar) => ({ ...(await importar<typeof import('@/lib/formato')>()), hoyMx: () => '2026-09-13' }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('next/link', () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));

import CobranzaPage from './page';

const factura = {
  id: 'f1', tenantId: 't1', tenantNombre: 'Flota Demo', periodoInicio: '2026-09-01', periodoFin: '2026-09-30',
  monto: 11600, subtotal: 10000, iva: 1600, moneda: 'MXN', estado: 'pendiente', referencia: 'LK202609', cfdiUuid: null,
};
const html = async () => renderToStaticMarkup(await CobranzaPage());

beforeEach(() => {
  dobles.requireSuperadmin.mockReset().mockResolvedValue({ nombre: 'Javier' });
  dobles.getPorCobrarTodas.mockReset().mockResolvedValue({ facturas: [factura], total: 1 });
  dobles.getPiezasDunningPlataforma.mockReset().mockResolvedValue([]);
  dobles.getUltimaCorridaDunningPlataforma.mockReset().mockResolvedValue(null);
});

it('ya no dice que el dunning es «por venir»: explica que corre y que produce propuestas, no envíos', async () => {
  const h = await html();
  expect(h).toContain('El dunning de las mensualidades de Likida ya corre');
  expect(h).toContain('no envíos');
  expect(h).not.toContain('cuando exista el dunning');
});

it('muestra el estado real: factura, toques alcanzados y toques sin propuesta', async () => {
  const h = await html();
  expect(h).toContain('Flota Demo');
  expect(h).toContain('D-3 · sin propuesta');
  expect(h).toContain('D+7 · sin propuesta');
  expect(h).toContain('Nunca ha corrido');
});

it('sin facturas dice 0 por cobrar como estado real, no como error', async () => {
  dobles.getPorCobrarTodas.mockResolvedValue({ facturas: [], total: 0 });
  const h = await html();
  expect(h).toContain('0 mensualidades por cobrar');
  expect(h).not.toContain('No se pudo leer todo');
});

it('si no se pudo leer algo, lo dice y NO afirma que no hay facturas ni propuestas', async () => {
  dobles.getPorCobrarTodas.mockRejectedValue(new Error('base caída'));
  dobles.getPiezasDunningPlataforma.mockRejectedValue(new Error('base caída'));
  const h = await html();
  expect(h).toContain('No se pudo leer todo el estado del dunning');
  expect(h).not.toContain('0 mensualidades por cobrar');
  expect(h).not.toContain('· sin propuesta');
});

it('A1: la propia página exige superadmin (no descansa solo en el layout) y sin sesión no lee ningún dato', async () => {
  dobles.requireSuperadmin.mockRejectedValue(new Error('NEXT_REDIRECT'));
  await expect(CobranzaPage()).rejects.toThrow('NEXT_REDIRECT');
  expect(dobles.requireSuperadmin).toHaveBeenCalled();
  expect(dobles.getPorCobrarTodas).not.toHaveBeenCalled();
  expect(dobles.getPiezasDunningPlataforma).not.toHaveBeenCalled();
  expect(dobles.getUltimaCorridaDunningPlataforma).not.toHaveBeenCalled();
});

const muchas = (n: number) => Array.from({ length: n }, (_, i) => ({
  ...factura, id: `f${i}`, referencia: `LK${i}`, tenantNombre: `Flota ${i}`, periodoInicio: '2026-08-01', periodoFin: '2026-08-31', monto: 1000,
}));

it('M4: las cifras cubren TODAS las facturas, la lista se acota a 50 y lo dice', async () => {
  dobles.getPorCobrarTodas.mockResolvedValue({ facturas: muchas(60), total: 60 });
  const h = await html();
  expect(h).toContain('60 · $60,000');
  expect(h).toContain('Mostrando 50 de 60');
  expect(h).toContain('Flota 49');
  expect(h).not.toContain('Flota 50<');
});

it('M4: si la base tiene más de las que se leyeron, el total está marcado como incompleto', async () => {
  dobles.getPorCobrarTodas.mockResolvedValue({ facturas: muchas(60), total: 75 });
  const h = await html();
  expect(h).toContain('Mostrando 50 de 75');
  expect(h).toContain('Incompleto');
});

it('M4: las piezas se piden por los títulos de los toques de las facturas (no «las N más nuevas») y no hay falsos «sin propuesta»', async () => {
  dobles.getPorCobrarTodas.mockResolvedValue({ facturas: muchas(2), total: 2 });
  dobles.getPiezasDunningPlataforma.mockImplementation(async (titulos: string[]) =>
    titulos.map((titulo) => ({ titulo, estado: 'pendiente', enviadoEn: null, creadoEn: '2026-09-01T00:00:00Z' })));
  const h = await html();
  const titulos = dobles.getPiezasDunningPlataforma.mock.calls[0][0] as string[];
  expect(titulos).toContain('Cobranza SaaS — LK0 — D-3');
  expect(titulos).toContain('Cobranza SaaS — LK1 — D+15');
  expect(h).not.toContain('· sin propuesta');
  expect(h).toContain('propuesta pendiente');
});
