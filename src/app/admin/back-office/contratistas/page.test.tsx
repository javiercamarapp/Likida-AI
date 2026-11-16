import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const dobles = vi.hoisted(() => ({ requireSuperadmin: vi.fn(), listarContratistas: vi.fn(), listarContratos: vi.fn() }));
vi.mock('@/lib/auth/guard', () => ({ requireSuperadmin: dobles.requireSuperadmin }));
vi.mock('@/lib/backoffice/contratistas', async (importar) => ({
  ...(await importar<typeof import('@/lib/backoffice/contratistas')>()),
  listarContratistas: dobles.listarContratistas,
}));
vi.mock('@/lib/backoffice/contratos', async (importar) => ({
  ...(await importar<typeof import('@/lib/backoffice/contratos')>()),
  listarContratos: dobles.listarContratos,
}));
vi.mock('./acciones', () => ({ accionCrearContratista: vi.fn(), accionDesactivarContratista: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }));

import ContratistasPage from './page';

const persona = (p: Record<string, unknown> = {}) => ({
  id: 'p1', nombre: 'Ana', rol: 'Ventas', esquema: 'comision', rfc: null, cfdiHonorariosVigente: null, constanciaSituacionFiscalEn: null,
  contratoId: null, vendedorId: null, activo: true, nota: null, ...p,
});
const ok = <T,>(dato: T) => ({ estado: 'ok' as const, dato });
const html = async () => renderToStaticMarkup(await ContratistasPage());

beforeEach(() => {
  dobles.requireSuperadmin.mockReset().mockResolvedValue({ userId: 'u1' });
  dobles.listarContratistas.mockReset().mockResolvedValue(ok([]));
  dobles.listarContratos.mockReset().mockResolvedValue(ok([]));
});

describe('/admin/back-office/contratistas', () => {
  it('llama su propia puerta y, si rechaza, no lee nada', async () => {
    dobles.requireSuperadmin.mockRejectedValue(new Error('NEXT_REDIRECT'));
    await expect(html()).rejects.toThrow('NEXT_REDIRECT');
    expect(dobles.listarContratistas).not.toHaveBeenCalled();
  });

  it('siempre trae el aviso fijo: la nómina se compra, no se construye', async () => {
    const h = await html();
    expect(h).toContain('La nómina se compra (Runa HR u otro), no se construye. Aquí solo hay registro; no se calcula ni se timbra nómina.');
  });

  it('el candado de caja hoy dice No permitido con los insumos que faltan (no es cero)', async () => {
    const h = await html();
    expect(h).toContain('No permitido');
    expect(h).toContain('Falta el neto mensual');
    expect(h).toContain('Falta la caja disponible');
    expect(h).toContain('71,500');
  });

  it('con la tabla ausente dice «No disponible. No es cero.» y no «sin contratistas»', async () => {
    dobles.listarContratistas.mockResolvedValue({ estado: 'no_disponible' });
    const h = await html();
    expect(h).toContain('No disponible ahora. No es cero.');
    expect(h).not.toContain('Sin contratistas registrados');
  });

  it('un fallo de lectura es «no se pudo leer», no lista vacía', async () => {
    dobles.listarContratistas.mockResolvedValue({ estado: 'error', mensaje: 'x' });
    const h = await html();
    expect(h).toContain('No se pudo leer los contratistas');
  });

  it('un comisionista sin CFDI de honorarios se marca como ausente', async () => {
    dobles.listarContratistas.mockResolvedValue(ok([persona()]));
    const h = await html();
    expect(h).toContain('Ausente');
  });

  it('un CFDI vencido se marca como vencido', async () => {
    dobles.listarContratistas.mockResolvedValue(ok([persona({ cfdiHonorariosVigente: false })]));
    expect(await html()).toContain('Vencido');
  });

  it('sin contratistas dice que se registran al contratar', async () => {
    expect(await html()).toContain('Sin contratistas registrados');
  });
});
