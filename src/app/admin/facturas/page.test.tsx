import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';

// /admin/facturas — la lista de mensualidades de Likida a sus flotas. Lo que se vigila: la base vacía dice qué falta (no «0»), una base
// caída NO se pinta como «ninguna factura», una lista recortada no suma un total parcial, y lo que la fila no tiene se dice.
const dobles = vi.hoisted(() => ({ requireSuperadmin: vi.fn(), listar: vi.fn() }));
vi.mock('@/lib/auth/guard', () => ({ requireSuperadmin: dobles.requireSuperadmin }));
vi.mock('@/lib/saas/transferencia', async (importar) => ({ ...(await importar<typeof import('@/lib/saas/transferencia')>()), listarFacturasSaas: dobles.listar }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock('./acciones', () => ({ accionExportarFacturas: vi.fn() }));

import FacturasPage from './page';

const FILA = (n: number, extra: Record<string, unknown> = {}) => ({
  id: `f-${n}`, tenantId: 't', tenantNombre: `Flota ${n}`, periodoInicio: '2026-10-01', periodoFin: '2026-10-31', monto: 1160, subtotal: 1000, iva: 160, moneda: 'MXN',
  estado: 'pagada', referencia: `R${n}`, metodoCobro: 'transferencia', referenciaBanco: `MOV-${n}`, pagadaEn: '2026-11-02T15:00:00Z', conciliadaEn: null,
  cfdiUuid: 'a1b2c3d4-0000-0000-0000-000000000000', timbradaEn: null, cfdiCanceladoEn: null, cfdiXmlUrl: null, cfdiVerificacionUrl: 'https://verificacfdi.facturaelectronica.sat.gob.mx/x',
  creadaEn: '2026-10-31T00:00:00Z', ...extra,
});
const render = async (sp?: Record<string, string>) => renderToStaticMarkup(await FacturasPage({ searchParams: Promise.resolve(sp ?? {}) }));

beforeEach(() => {
  vi.clearAllMocks();
  dobles.requireSuperadmin.mockResolvedValue({ userId: 'u-1', rol: 'superadmin', tenantId: null });
  dobles.listar.mockResolvedValue({ filas: [], total: 0, truncado: false });
});

it('con la base vacía dice qué falta y cómo se llena — sin tabla y sin cifras de relleno', async () => {
  const html = await render();
  expect(html).toContain('Aún no hay facturas');
  expect(html).toContain('Planes y cobro');
  expect(html).toContain('Facturado');
  expect(html).toContain('<h1');
  expect((html.match(/<h1/g) ?? []).length).toBe(1);
});

it('una base caída NO se pinta como «ninguna factura»', async () => {
  dobles.listar.mockRejectedValue(new Error('caída'));
  const html = await render();
  expect(html).toContain('No se pudieron leer las facturas');
  expect(html).not.toContain('Aún no hay facturas');
  expect(html).toContain('No disponible ahora');
});

it('las cifras separan lo facturado, lo cobrado y lo por cobrar, y no cuentan las canceladas como facturado', async () => {
  dobles.listar.mockResolvedValue({ total: 3, truncado: false, filas: [
    FILA(1, { monto: 1000 }),
    FILA(2, { monto: 500, estado: 'pendiente', pagadaEn: null, cfdiUuid: null, referenciaBanco: null }),
    FILA(3, { monto: 9999, estado: 'cancelada', pagadaEn: null, cfdiUuid: null }),
  ] });
  const html = await render();
  expect(html).toContain('$1,500.00'); // facturado = 1000 + 500
  expect(html).not.toContain('$11,499.00');
  expect(html).toContain('2 facturas, sin contar canceladas');
});

it('una pagada sin CFDI se marca «Sin timbrar» y cuenta como pagada sin CFDI', async () => {
  dobles.listar.mockResolvedValue({ total: 1, truncado: false, filas: [FILA(1, { cfdiUuid: null })] });
  const html = await render();
  expect(html).toContain('Sin timbrar');
  expect(html).toContain('Pagadas sin CFDI');
});

it('un CFDI timbrado enseña el UUID corto y la liga de verificación del SAT; uno cancelado lo dice', async () => {
  dobles.listar.mockResolvedValue({ total: 2, truncado: false, filas: [FILA(1), FILA(2, { cfdiCanceladoEn: '2026-11-05T00:00:00Z' })] });
  const html = await render();
  expect(html).toContain('a1b2c3d4…');
  expect(html).toContain('Verificar en el SAT');
  expect(html).toContain('CFDI cancelado');
});

it('una factura sin desglose lo dice: no se puede timbrar', async () => {
  dobles.listar.mockResolvedValue({ total: 1, truncado: false, filas: [FILA(1, { subtotal: null, iva: null })] });
  expect(await render()).toContain('sin desglose: no se puede timbrar');
});

it('con la lista recortada se dice «Se muestran N de M» y las cifras NO suman un total parcial', async () => {
  dobles.listar.mockResolvedValue({ total: 900, truncado: true, filas: [FILA(1)] });
  const html = await render();
  expect(html).toContain('Se muestran 1 de 900 facturas');
  expect(html).toContain('no se suma un total parcial');
});

it('los filtros viajan a la lectura ya validados; un rango al revés se avisa y no se lee', async () => {
  await render({ estado: 'pagada', desde: '2026-01-01', hasta: '2026-03-31' });
  expect(dobles.listar).toHaveBeenCalledWith(expect.objectContaining({ estado: 'pagada', desde: '2026-01-01', hasta: '2026-03-31' }));
  dobles.listar.mockClear();
  const html = await render({ desde: '2026-12-01', hasta: '2026-01-01' });
  expect(html).toContain('El rango está al revés');
  expect(dobles.listar).not.toHaveBeenCalled();
});

it('sin facturas con un filtro puesto, dice que no hay con ese filtro (no «aún no hay»)', async () => {
  const html = await render({ estado: 'fallida' });
  expect(html).toContain('Ninguna factura con ese filtro');
});

it('sin superadmin la página no lee nada', async () => {
  dobles.requireSuperadmin.mockRejectedValueOnce(new Error('REDIRECT:/login'));
  await expect(render()).rejects.toThrow('REDIRECT');
  expect(dobles.listar).not.toHaveBeenCalled();
});
