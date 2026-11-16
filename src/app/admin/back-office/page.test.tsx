import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const dobles = vi.hoisted(() => ({ requireSuperadmin: vi.fn(), leerTablero: vi.fn() }));

vi.mock('@/lib/auth/guard', () => ({ requireSuperadmin: dobles.requireSuperadmin }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: vi.fn() }));
vi.mock('@/lib/saas/transferencia', () => ({ listarFacturasSaas: vi.fn(), TECHO_FACTURAS_SAAS: 2000 }));
vi.mock('@/lib/admin/negocio', () => ({ costoIaVentana: vi.fn() }));
vi.mock('@/lib/backoffice/tablero', async (importar) => ({
  ...(await importar<typeof import('@/lib/backoffice/tablero')>()),
  leerTablero: dobles.leerTablero,
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }), usePathname: () => '/admin/back-office', useSearchParams: () => new URLSearchParams() }));
vi.mock('next/link', () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));

import BackOfficePage from './page';
import { armarTablero, AREAS, type DatosTablero } from '@/lib/backoffice/tablero';
import { NO_DISPONIBLE, OK } from '@/lib/backoffice/lectura';
import type { FacturaInsumo } from '@/lib/backoffice/cierre';

const P = '2026-11-01';
const HOY = '2026-11-16';
const sinTablas: DatosTablero = {
  periodo: P, hoy: HOY, entidad: NO_DISPONIBLE, facturas: NO_DISPONIBLE, gastos: NO_DISPONIBLE, comisiones: NO_DISPONIBLE,
  contratos: NO_DISPONIBLE, obligaciones: NO_DISPONIBLE, cierres: NO_DISPONIBLE,
};
const fac = (o: Partial<FacturaInsumo> = {}): FacturaInsumo => ({
  id: 'f', tenantId: 't1', tenantNombre: 'Flota Uno', estado: 'pagada', periodoInicio: P, totalCent: 116000, subtotalCent: 100000, ivaCent: 16000,
  creadaEn: '2026-11-01T12:00:00Z', pagadaEn: '2026-11-10T16:00:00Z', conciliadaEn: '2026-11-10T16:00:00Z', referenciaBanco: 'SPEI 1', ...o,
});
const html = async (datos: DatosTablero) => {
  dobles.leerTablero.mockResolvedValue(armarTablero(datos));
  return renderToStaticMarkup(await BackOfficePage());
};

beforeEach(() => {
  dobles.requireSuperadmin.mockReset().mockResolvedValue({ userId: 'u1', rol: 'superadmin' });
  dobles.leerTablero.mockReset();
});

describe('Back-office · Tablero', () => {
  it('la puerta va en el render: sin superadmin no se lee ni se pinta nada', async () => {
    dobles.requireSuperadmin.mockRejectedValue(new Error('NEXT_REDIRECT'));
    await expect(BackOfficePage()).rejects.toThrow('NEXT_REDIRECT');
    expect(dobles.leerTablero).not.toHaveBeenCalled();
  });

  it('con ninguna tabla: «No disponible. No es cero.», contabilidad bloqueada por la entidad, nómina «Compra, no construye» y el candado fijo', async () => {
    const h = await html(sinTablas);
    expect(h).toContain('No disponible. No es cero.');
    expect(h).toContain('Bloqueada: falta entidad');
    expect(h).toContain('Compra, no construye');
    expect(h).toContain('Likida aún no tiene razón social ni RFC propios');
    // Nada se convierte en un cero que parezca medición.
    expect(h).not.toContain('$0.00');
  });

  it('pinta las ocho áreas, cada una con su enlace', async () => {
    const h = await html(sinTablas);
    for (const t of ['Facturación y cobro', 'Contabilidad y fiscal', 'Gastos y proveedores', 'Pagos a vendedores', 'Nómina y contratistas', 'Legal y contratos', 'Compliance', 'Reporting']) {
      expect(h, t).toContain(t);
    }
    expect(AREAS).toHaveLength(8);
    for (const href of ['/admin/cobranza', '/admin/costos-facturacion', '/admin/facturas', '/admin/back-office/contabilidad', '/admin/back-office/gastos', '/admin/back-office/comisiones', '/admin/back-office/contratistas', '/admin/back-office/contratos', '/admin/compliance', '/admin/back-office/cierre']) {
      expect(h, href).toContain(`href="${href}"`);
    }
    // Un solo marco de página y el título es el nombre de la entrada del menú.
    expect(h.match(/<h1/g)).toHaveLength(1);
    expect(h).toContain('Tablero');
  });

  it('con facturas leídas: cobrado y por cobrar con su dinero, y las áreas operativas', async () => {
    const h = await html({
      ...sinTablas,
      facturas: OK({ filas: [fac(), fac({ id: 'p', estado: 'pendiente', pagadaEn: null, conciliadaEn: null, referenciaBanco: null })], truncada: false }),
    });
    expect(h).toContain('$1,160.00');
    expect(h).toContain('Operativa');
    expect(h).toContain('Cobrado del mes');
  });

  it('sin cobros no hay DSO: dice que no se reporta, no 0 días', async () => {
    const h = await html({ ...sinTablas, facturas: OK({ filas: [], truncada: false }) });
    expect(h).toContain('Sin cobros: no se reporta');
    expect(h).not.toContain('0 días ·');
  });

  it('una lista recortada no se presenta como completa', async () => {
    const h = await html({ ...sinTablas, facturas: OK({ filas: [fac()], truncada: true }) });
    expect(h).toContain('La lista llegó recortada');
  });

  it('las métricas dicen «No medido» donde no se mide y el % de automatización declara su método y su corte', async () => {
    const h = await html(sinTablas);
    expect(h).toContain('No medido');
    expect(h).toContain('Estimado al corte 2026-08-15');
    expect(h).toContain('No aplica: se compra');
  });

  it('con RFC propio el candado desaparece y contabilidad sigue a su fuente', async () => {
    const h = await html({
      ...sinTablas, obligaciones: OK([{ clave: 'iva', estado_catalogo: 'pendiente_de_contador' }]),
      entidad: OK({ razonSocial: 'Likida SAPI', rfc: 'LIK261101ABA', regimenFiscal: null, domicilioFiscalCp: null, constituidaEl: null, actualizadaPor: null, actualizadaEn: null }),
    });
    expect(h).not.toContain('Likida aún no tiene razón social ni RFC propios');
    expect(h).not.toContain('Bloqueada: falta entidad');
  });
});
