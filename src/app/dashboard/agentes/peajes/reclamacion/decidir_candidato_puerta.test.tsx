import { describe, it, expect, vi, beforeEach } from 'vitest';

// T-A2-43: la server action `accionDecidirCandidato` de la reclamación de peajes repite SU PROPIA puerta de perfil
// (una action es un endpoint por POST directo). Si la puerta rebota (flota con perfil que no permite la ruta),
// la acción NO debe llegar a escribir nada.

const redirect = vi.fn((_: string) => { throw new Error('NEXT_REDIRECT'); });
vi.mock('next/navigation', () => ({ redirect: (a: string) => redirect(a) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const requireSessionTenant = vi.fn();
vi.mock('@/lib/auth/guard', () => ({ requireSessionTenant: (...a: unknown[]) => requireSessionTenant(...a) }));
vi.mock('@/lib/auth/tenant-efectivo', () => ({ resolverTenantEfectivo: async () => ({ tenantId: 'tenant-1', rol: 'flota_admin' }) }));
vi.mock('@/lib/likida/peajes/superficie_perfil', () => ({ superficiePeajesDeTenant: async () => ({ gps: true }) }));
vi.mock('@/lib/likida/peajes/revision_cobros', () => ({
  revisionDeDesglose: vi.fn(), cierreMensualDeFlota: vi.fn(), crearReclamoDeCategoria: vi.fn(), marcarReclamoEnviado: vi.fn(),
  registrarNotaDeCredito: vi.fn(), marcarReclamoRechazado: vi.fn(), justificarCruce: vi.fn(), listarReclamos: async () => ({ reclamos: [], resumen: {} }),
}));
vi.mock('@/lib/likida/peajes/bitacora_conciliada', () => ({ reporteReclamacion: vi.fn() }));
vi.mock('@/lib/likida/peajes/datos', () => ({ listarDecisionesCandidatos: vi.fn(), leerMargenLejosM: vi.fn(), guardarMargenLejosM: vi.fn() }));
const ejecutarAccionDeFormulario = vi.fn(async () => ({ ok: true as const, aplicadas: 1, omitidas: 0, reclamos: 0, mensaje: 'hecho' }));
vi.mock('../acciones-candidatos', () => ({ aplicablesDelFiltro: () => [], ejecutarAccionDeFormulario: (...a: unknown[]) => ejecutarAccionDeFormulario(...(a as [])) }));

let propsVista: { extras: { candidatos: { decidir: (fd: FormData) => Promise<void> } } } | null = null;
vi.mock('./vista', () => ({ VistaReclamacionPeajes: (p: never) => { propsVista = p; return null; } }));

const { default: Pagina } = await import('./page');

async function accion() {
  propsVista = null;
  const el = await Pagina({ searchParams: Promise.resolve({}) });
  // Ejecuta el componente-función devuelto para capturar las props que recibe la vista.
  (el as { type: (p: unknown) => unknown }).type((el as { props: unknown }).props);
  return propsVista!.extras.candidatos.decidir;
}
const formulario = () => { const fd = new FormData(); fd.set('desglose', '11111111-1111-4111-8111-111111111111'); return fd; };

beforeEach(() => {
  redirect.mockClear(); requireSessionTenant.mockReset(); ejecutarAccionDeFormulario.mockClear();
  requireSessionTenant.mockResolvedValue({ rol: 'flota_admin', tenantId: 'tenant-1' });
});

describe('accionDecidirCandidato: puerta de perfil propia', () => {
  it('flota con perfil que NO permite la ruta: la puerta rebota y la acción no ejecuta nada', async () => {
    const decidir = await accion();
    requireSessionTenant.mockImplementation(async () => { redirect('/dashboard'); });
    await expect(decidir(formulario())).rejects.toThrow('NEXT_REDIRECT');
    expect(requireSessionTenant).toHaveBeenCalledWith('/dashboard/agentes/peajes/reclamacion');
    expect(ejecutarAccionDeFormulario).not.toHaveBeenCalled();
  });

  it('rol sin acceso al área de dinero: no ejecuta', async () => {
    const decidir = await accion();
    requireSessionTenant.mockResolvedValue({ rol: 'operador', tenantId: 'tenant-1' });
    await expect(decidir(formulario())).rejects.toThrow('NEXT_REDIRECT');
    expect(ejecutarAccionDeFormulario).not.toHaveBeenCalled();
  });

  it('sesión de otra flota: no ejecuta', async () => {
    const decidir = await accion();
    requireSessionTenant.mockResolvedValue({ rol: 'flota_admin', tenantId: 'tenant-2' });
    await expect(decidir(formulario())).rejects.toThrow('NEXT_REDIRECT');
    expect(ejecutarAccionDeFormulario).not.toHaveBeenCalled();
  });

  it('control: sesión de la flota con rol de dinero SÍ ejecuta', async () => {
    const decidir = await accion();
    await expect(decidir(formulario())).rejects.toThrow('NEXT_REDIRECT'); // termina en redirect de volverReclamos
    expect(ejecutarAccionDeFormulario).toHaveBeenCalledTimes(1);
  });
});
