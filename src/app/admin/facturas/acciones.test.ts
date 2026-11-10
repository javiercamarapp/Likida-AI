import { beforeEach, describe, expect, it, vi } from 'vitest';

// Exportar para el contador: el archivo se arma EN EL SERVIDOR con los filtros validados, deja su huella en la bitácora ANTES de
// entregarse, y NUNCA se entrega un archivo parcial. Sin sesión de superadmin no se lee nada.
const dobles = vi.hoisted(() => ({ requireSuperadmin: vi.fn(), listar: vi.fn(), anotar: vi.fn() }));
vi.mock('@/lib/auth/guard', () => ({ requireSuperadmin: dobles.requireSuperadmin }));
vi.mock('@/lib/admin/acciones_riesgo', async (importar) => ({ ...(await importar<typeof import('@/lib/admin/acciones_riesgo')>()), anotarAccionAdmin: dobles.anotar }));
vi.mock('@/lib/saas/transferencia', async (importar) => ({ ...(await importar<typeof import('@/lib/saas/transferencia')>()), listarFacturasSaas: dobles.listar }));
vi.mock('@/lib/formato', async (importar) => ({ ...(await importar<typeof import('@/lib/formato')>()), hoyMx: () => '2026-11-10' }));

import { accionExportarFacturas } from './acciones';

const fd = (c: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(c)) f.set(k, v); return f; };
const FILA = {
  id: 'f-1', tenantId: 't', tenantNombre: 'Flota Uno', periodoInicio: '2026-10-01', periodoFin: '2026-10-31', monto: 1160, subtotal: 1000, iva: 160, moneda: 'MXN', estado: 'pagada',
  referencia: 'R', metodoCobro: 'transferencia', referenciaBanco: 'MOV-1', pagadaEn: '2026-11-02T00:00:00Z', conciliadaEn: null, cfdiUuid: 'U-1', timbradaEn: null,
  cfdiCanceladoEn: null, cfdiXmlUrl: null, cfdiVerificacionUrl: null, creadaEn: '2026-10-31T00:00:00Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  dobles.requireSuperadmin.mockResolvedValue({ userId: 'u-1', email: 'a@b.c', rol: 'superadmin', tenantId: null });
  dobles.listar.mockResolvedValue({ filas: [FILA], total: 1, truncado: false });
  dobles.anotar.mockResolvedValue(true);
});

describe('accionExportarFacturas', () => {
  it('sin sesión de superadmin no lee ni asienta nada', async () => {
    dobles.requireSuperadmin.mockRejectedValueOnce(new Error('REDIRECT:/login'));
    await expect(accionExportarFacturas(fd({}))).rejects.toThrow('REDIRECT');
    expect(dobles.listar).not.toHaveBeenCalled();
    expect(dobles.anotar).not.toHaveBeenCalled();
  });

  it('entrega el CSV con los filtros validados y asienta quién, cuántas filas y con qué filtros', async () => {
    const r = await accionExportarFacturas(fd({ estado: 'pagada', desde: '2026-10-01', hasta: '2026-10-31' }));
    expect(r).toMatchObject({ ok: true, filas: 1, nombre: 'facturas-likida-2026-11-10.csv', aviso: null });
    expect(r.ok && r.csv).toContain('Flota Uno');
    expect(dobles.listar).toHaveBeenCalledWith(expect.objectContaining({ estado: 'pagada', desde: '2026-10-01', hasta: '2026-10-31' }));
    expect(dobles.anotar).toHaveBeenCalledWith(expect.objectContaining({
      accion: 'facturas.exportadas', entidad: 'factura_saas', tenantId: null, detalle: { filas: 1, estado: 'pagada', desde: '2026-10-01', hasta: '2026-10-31' },
    }));
  });

  it('un filtro inventado no llega a la base', async () => {
    await accionExportarFacturas(fd({ estado: "pagada' or 1=1", desde: 'ayer' }));
    expect(dobles.listar).toHaveBeenCalledWith(expect.not.objectContaining({ estado: expect.anything() }));
  });

  it('un rango al revés se rechaza sin leer', async () => {
    const r = await accionExportarFacturas(fd({ desde: '2026-12-01', hasta: '2026-01-01' }));
    expect(r.ok).toBe(false);
    expect(dobles.listar).not.toHaveBeenCalled();
  });

  it('si la base tiene más facturas de las que caben, NO entrega un archivo parcial', async () => {
    dobles.listar.mockResolvedValue({ filas: [FILA], total: 9000, truncado: true });
    const r = await accionExportarFacturas(fd({}));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/9000 facturas/);
    expect(dobles.anotar).not.toHaveBeenCalled();
  });

  it('si la base no responde, lo dice y no entrega nada', async () => {
    dobles.listar.mockRejectedValue(new Error('caída'));
    const r = await accionExportarFacturas(fd({}));
    expect(r.ok).toBe(false);
    expect(dobles.anotar).not.toHaveBeenCalled();
  });

  it('si la bitácora no pudo escribir, el archivo se entrega pero SE DICE', async () => {
    dobles.anotar.mockResolvedValue(false);
    const r = await accionExportarFacturas(fd({}));
    expect(r.ok && r.aviso).toMatch(/bitácora/);
  });

  it('una exportación vacía es un archivo con solo el encabezado, no un error', async () => {
    dobles.listar.mockResolvedValue({ filas: [], total: 0, truncado: false });
    const r = await accionExportarFacturas(fd({}));
    expect(r).toMatchObject({ ok: true, filas: 0 });
  });
});
