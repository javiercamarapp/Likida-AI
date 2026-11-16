import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const dobles = vi.hoisted(() => ({ requireSuperadmin: vi.fn(), listarContratos: vi.fn(), leerRfcEntidad: vi.fn() }));
vi.mock('@/lib/auth/guard', () => ({ requireSuperadmin: dobles.requireSuperadmin }));
vi.mock('@/lib/backoffice/contratos', async (importar) => ({
  ...(await importar<typeof import('@/lib/backoffice/contratos')>()),
  listarContratos: dobles.listarContratos,
  leerRfcEntidad: dobles.leerRfcEntidad,
}));
vi.mock('./acciones', () => ({ accionGuardarContrato: vi.fn(), accionTerminarContrato: vi.fn() }));
vi.mock('@/lib/formato', async (importar) => ({ ...(await importar<typeof import('@/lib/formato')>()), hoyMx: () => '2026-11-15' }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock('next/link', () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));

import ContratosPage from './page';

const contrato = (p: Record<string, unknown> = {}) => ({
  id: 'c1', tipo: 'suscripcion', contraparte: 'Vercel', tenantId: null, descripcion: null, firmadoEl: null, venceEl: '2026-11-20', renovacionAuto: false,
  diasAviso: [30], responsable: 'Javier', costoMensualCent: 200000, documentoUrl: null, estado: 'vigente', motivoTerminacion: null, creadoEn: '2026-11-01', ...p,
});
const ok = <T,>(dato: T) => ({ estado: 'ok' as const, dato });
const html = async () => renderToStaticMarkup(await ContratosPage({ searchParams: Promise.resolve({}) }));

beforeEach(() => {
  dobles.requireSuperadmin.mockReset().mockResolvedValue({ userId: 'u1' });
  dobles.listarContratos.mockReset().mockResolvedValue(ok([contrato()]));
  dobles.leerRfcEntidad.mockReset().mockResolvedValue(ok(null));
});

describe('/admin/back-office/contratos', () => {
  it('llama su propia puerta de superadmin en el render', async () => {
    await html();
    expect(dobles.requireSuperadmin).toHaveBeenCalledTimes(1);
  });

  it('si la puerta rechaza, la página no se sirve', async () => {
    dobles.requireSuperadmin.mockRejectedValue(new Error('NEXT_REDIRECT'));
    await expect(html()).rejects.toThrow('NEXT_REDIRECT');
    expect(dobles.listarContratos).not.toHaveBeenCalled();
  });

  it('con la tabla ausente dice «No disponible. No es cero.» y no pinta ceros ni «sin contratos»', async () => {
    dobles.listarContratos.mockResolvedValue({ estado: 'no_disponible' });
    const h = await html();
    expect(h).toContain('No disponible ahora. No es cero.');
    expect(h).not.toContain('Sin contratos registrados');
    expect(h).not.toContain('0 clientes con contrato vivo');
    expect(h).not.toMatch(/rv-kpi__valor[^>]*>0</);
  });

  it('un fallo de lectura se dice como «no se pudo leer», no como lista vacía', async () => {
    dobles.listarContratos.mockResolvedValue({ estado: 'error', mensaje: 'timeout' });
    const h = await html();
    expect(h).toContain('No se pudo leer los contratos');
    expect(h).not.toContain('Sin contratos registrados');
  });

  it('sin contratos: 0 clientes con contrato vivo es un estado real y hay un solo vacío', async () => {
    dobles.listarContratos.mockResolvedValue(ok([]));
    const h = await html();
    expect(h).toContain('0 clientes con contrato vivo');
    expect(h).toContain('Sin contratos registrados');
  });

  it('un contrato sin fecha dice «Sin fecha declarada» y jamás «Vigente»', async () => {
    dobles.listarContratos.mockResolvedValue(ok([contrato({ venceEl: null })]));
    const h = await html();
    expect(h).toContain('Sin fecha declarada');
    expect(h).not.toContain('Vigente, ');
  });

  it('dentro de ventana aparece en «Por atender» con los días; vencido dice hace cuántos', async () => {
    dobles.listarContratos.mockResolvedValue(ok([contrato(), contrato({ id: 'c2', contraparte: 'Dominio', tipo: 'dominio', venceEl: '2026-11-10' })]));
    const h = await html();
    expect(h).toContain('Vence en 5 días');
    expect(h).toContain('Vencido hace 5 días');
  });

  it('un contrato de Mifiel con créditos y sin fecha dice «No vence»', async () => {
    dobles.listarContratos.mockResolvedValue(ok([contrato({ tipo: 'creditos', contraparte: 'Mifiel', venceEl: null })]));
    const h = await html();
    expect(h).toContain('No vence');
  });

  it('sin RFC de la entidad muestra el candado; con RFC no', async () => {
    expect(await html()).toContain('Likida aún no tiene razón social ni RFC propios');
    dobles.leerRfcEntidad.mockResolvedValue(ok('XAXX010101000'));
    expect(await html()).not.toContain('Likida aún no tiene razón social ni RFC propios');
  });

  it('tabla de entidad ausente también bloquea (no se asume que hay RFC)', async () => {
    dobles.leerRfcEntidad.mockResolvedValue({ estado: 'no_disponible' });
    expect(await html()).toContain('Likida aún no tiene razón social ni RFC propios');
  });

  it('sin h1 propio ni style en línea', async () => {
    const h = await html();
    expect(h.match(/<h1/g)?.length ?? 0).toBeLessThanOrEqual(1);
    // Los únicos `style=` permitidos vienen de piezas COMPARTIDAS de ui-v2 (el `flex-grow` de la barra segmentada de `Cifra` y el color de marca del
    // monograma de proveedor, usados igual en el dashboard): ningún estilo en línea propio de la página.
    const permitidos = [/^style="flex-grow:\d+"$/, /^style="background:var\(--marca\);color:var\(--marca-fg\)"$/];
    expect(h.match(/style="[^"]*"/g)?.filter((x) => !permitidos.some((r) => r.test(x))) ?? []).toEqual([]);
  });
});
