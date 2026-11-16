import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const dobles = vi.hoisted(() => ({
  requireSuperadmin: vi.fn(), leerVistaCierre: vi.fn(), cobradoDelMesAnterior: vi.fn(), leerEntidad: vi.fn(), leerUpdateInversionistas: vi.fn(),
}));

vi.mock('@/lib/auth/guard', () => ({ requireSuperadmin: dobles.requireSuperadmin }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: vi.fn() }));
vi.mock('@/lib/saas/transferencia', () => ({ listarFacturasSaas: vi.fn(), TECHO_FACTURAS_SAAS: 2000 }));
vi.mock('@/lib/admin/negocio', () => ({ costoIaVentana: vi.fn() }));
vi.mock('@/lib/admin/acciones_riesgo', () => ({ pasoExtraSuperadmin: vi.fn(), anotarAccionAdmin: vi.fn(), AVISO_SIN_BITACORA: ' (sin bitácora)' }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/backoffice/cierre', async (importar) => ({
  ...(await importar<typeof import('@/lib/backoffice/cierre')>()),
  leerVistaCierre: dobles.leerVistaCierre,
  cobradoDelMesAnterior: dobles.cobradoDelMesAnterior,
}));
vi.mock('@/lib/backoffice/entidad', async (importar) => ({
  ...(await importar<typeof import('@/lib/backoffice/entidad')>()),
  leerEntidad: dobles.leerEntidad,
}));
vi.mock('@/lib/backoffice/reporte', async (importar) => ({
  ...(await importar<typeof import('@/lib/backoffice/reporte')>()),
  leerUpdateInversionistas: dobles.leerUpdateInversionistas,
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }), usePathname: () => '/admin/back-office/cierre', useSearchParams: () => new URLSearchParams() }));
vi.mock('next/link', () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));

import CierrePage from './page';
import { armarCierre, comprobaciones, type CierreGuardado, type FacturaInsumo, type InsumosCierre, type VistaCierre } from '@/lib/backoffice/cierre';
import { NO_DISPONIBLE, OK } from '@/lib/backoffice/lectura';

const P = '2024-03-01';
const fac: FacturaInsumo = {
  id: 'f1', tenantId: 't1', tenantNombre: 'Flota Uno', estado: 'pagada', periodoInicio: P, totalCent: 116000, subtotalCent: 100000, ivaCent: 16000,
  creadaEn: '2024-03-01T12:00:00Z', pagadaEn: '2024-03-15T16:00:00Z', conciliadaEn: '2024-03-15T16:00:00Z', referenciaBanco: 'SPEI 1',
};
const insumos = (o: Partial<InsumosCierre> = {}): InsumosCierre => ({
  periodo: P, facturas: OK([fac]), facturasTruncadas: false, cobradoSql: OK(116000), costoIa: OK({ totalUsd: 0, porTenantUsd: [] }), tipoCambio: 17,
  gastos: OK([]), comisiones: OK({ periodo: P, devengadoCent: 0, clawbackCent: 0, pagadoCent: 0 }), movimientos: NO_DISPONIBLE, ...o,
});
const guardado = (o: Partial<CierreGuardado> = {}): CierreGuardado => ({
  periodo: P, estado: 'abierto', netoCent: 100000, tipoCambio: 17, snapshot: null, cerradoPor: null, cerradoEn: null, actualizadoEn: '2024-04-02T12:00:00Z', ...o,
});
const vista = (i: InsumosCierre = insumos(), o: Partial<VistaCierre> = {}): VistaCierre => {
  const cierre = armarCierre(i, P);
  return { periodo: P, guardado: OK(guardado()), origen: 'en_vivo', cierre, comprobaciones: comprobaciones(cierre, i, { netoCent: 100000 }), ...o };
};
const html = async (v: VistaCierre) => {
  dobles.leerVistaCierre.mockResolvedValue(v);
  return renderToStaticMarkup(await CierrePage({ searchParams: Promise.resolve({ mes: P }) }));
};

beforeEach(() => {
  dobles.requireSuperadmin.mockReset().mockResolvedValue({ userId: 'u1', rol: 'superadmin' });
  dobles.leerVistaCierre.mockReset();
  dobles.cobradoDelMesAnterior.mockReset().mockResolvedValue(null);
  dobles.leerEntidad.mockReset().mockResolvedValue(NO_DISPONIBLE);
  dobles.leerUpdateInversionistas.mockReset().mockResolvedValue(OK(null));
});

describe('Back-office · Cierre mensual', () => {
  it('la puerta va en el render: sin superadmin no se lee nada', async () => {
    dobles.requireSuperadmin.mockRejectedValue(new Error('NEXT_REDIRECT'));
    await expect(CierrePage({ searchParams: Promise.resolve({ mes: P }) })).rejects.toThrow('NEXT_REDIRECT');
    expect(dobles.leerVistaCierre).not.toHaveBeenCalled();
  });

  it('con la tabla del cierre ausente: dice «No disponible. No es cero.», sigue mostrando lo calculado y no ofrece botones que no pueden funcionar', async () => {
    const h = await html(vista(insumos(), { guardado: NO_DISPONIBLE }));
    expect(h).toContain('No disponible ahora. No es cero. La tabla del cierre aún no existe');
    expect(h).toContain('El cierre aún no se puede guardar');
    expect(h).not.toContain('Generar borrador');
    expect(h).toContain('$1,000.00');
  });

  it('cifras y neto del mes con sus fórmulas; los bloques salen de la base y el neto es calculado', async () => {
    const h = await html(vista());
    expect(h).toContain('Ingresos cobrados (sin IVA)');
    expect(h).toContain('$160.00'); // IVA trasladado
    expect(h).toContain('Neto del mes');
    expect(h).toContain('Ingresos − COGS − gastos − comisiones');
    expect(h).toContain('Del cobrado al neto');
    expect(h).toContain('Margen por cliente');
  });

  it('un neto que no se puede calcular dice qué falta y NO se pinta como cero', async () => {
    const h = await html(vista(insumos({ gastos: NO_DISPONIBLE }), { comprobaciones: [] }));
    expect(h).toContain('No se puede calcular. Falta: los gastos.');
    expect(h).toContain('Falta: los gastos.');
  });

  it('sin clientes con cobro: «0 clientes» se dice, no se pinta un margen', async () => {
    const h = await html(vista(insumos({ facturas: OK([]), cobradoSql: OK(0) })));
    expect(h).toContain('Sin clientes con cobro en el mes');
    expect(h).toContain('Hay 0 clientes con cobro conciliado');
  });

  it('las dos vías del cobrado que no cuadran: la comprobación falla, muestra la diferencia y «Marcar listo» queda apagado con su razón', async () => {
    const h = await html(vista(insumos({ cobradoSql: OK(100000) })));
    expect(h).toContain('Cobrado, dos vías');
    expect(h).toContain('Falla');
    expect(h).toContain('$160.00');
    expect(h).toMatch(/disabled=""[^>]*>Marcar listo</);
    expect(h).toContain('Hay comprobaciones bloqueantes sin pasar');
  });

  it('con todo en verde y el mes terminado, «Marcar listo» es un formulario real (no un botón apagado)', async () => {
    const h = await html(vista());
    expect(h).not.toMatch(/disabled=""[^>]*>Marcar listo</);
    expect(h).toContain('Marcar listo');
    expect(h).toContain('Guardar tipo de cambio');
  });

  it('un mes cerrado enseña sus cifras congeladas y solo ofrece reabrir, con motivo obligatorio', async () => {
    const h = await html(vista(insumos(), { origen: 'cerrado', guardado: OK(guardado({ estado: 'cerrado', cerradoPor: 'u1', cerradoEn: '2024-04-03T18:00:00Z' })) }));
    expect(h).toContain('Mes cerrado');
    expect(h).toContain('Corrida del cierre');
    expect(h).toContain('Motivo de la reapertura');
    expect(h).toContain('Reabrir');
    expect(h).not.toContain('Generar borrador');
    expect(h).not.toContain('Guardar tipo de cambio');
  });

  it('el update a inversionistas se muestra con el orden fijo, se descarga y nunca se envía', async () => {
    const h = await html(vista());
    expect(h).toContain('Update a inversionistas');
    for (const s of ['TL;DR', 'MÉTRICAS', 'CONSTRUIDO', 'APRENDIDO', 'VIENE', 'ASKS', 'GRACIAS']) expect(h, s).toContain(s);
    expect(h.indexOf('TL;DR')).toBeLessThan(h.indexOf('MÉTRICAS'));
    expect(h.indexOf('ASKS')).toBeLessThan(h.indexOf('GRACIAS'));
    expect(h).toContain('download="update-2024-03.md"');
    expect(h).toContain('nunca se envía desde aquí');
    expect(h).toContain('Guardar borrador');
  });

  it('sin borrador del cierre guardado no ofrece guardar el update', async () => {
    const h = await html(vista(insumos(), { guardado: OK(null) }));
    expect(h).toContain('Para guardarlo, genera primero el borrador del cierre');
    expect(h).toContain('Este mes aún no tiene borrador');
  });

  it('sin RFC propio avisa que es un cierre de negocio, no fiscal', async () => {
    const h = await html(vista());
    expect(h).toContain('Cierre de negocio, no fiscal');
  });

  it('el estado del cierre que no se pudo leer NO se asume abierto ni cerrado', async () => {
    const h = await html(vista(insumos(), { guardado: { estado: 'error', mensaje: 'caída' } }));
    expect(h).toContain('No se pudo leer el estado del cierre');
  });
});
