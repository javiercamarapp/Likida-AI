import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 19, FE-19-1 (CRÍTICO) — LA COMPUERTA DE ONBOARDING SÍ DISPARA.
//
// `redirect()` de Next no "devuelve": LANZA un error `NEXT_REDIRECT` y el
// framework lo atrapa arriba para emitir la respuesta 307. Los docs de Next
// empaquetados en este repo lo dicen con todas sus letras:
//
//   node_modules/next/dist/docs/01-app/03-api-reference/04-functions/redirect.md:53
//   «`redirect` throws an error so it should be called **outside** the `try`
//    block when using `try/catch` statements.»
//
// La compuerta vivía DENTRO de un `try { ... } catch { /* sigue al resumen */ }`
// puesto ahí para que un bache leyendo el perfil no cerrara la puerta. El
// `catch` desnudo no distingue el bache del redirect, así que se tragaba el
// `NEXT_REDIRECT` y el dueño aterrizaba SIEMPRE en el Resumen — con el umbral
// de peaje sin declarar y el motor en fail-open pintando un 50% que quizá no
// le toca. Los cinco call sites que el delta cambió para alimentar la
// compuerta (`&rol=flota_admin`) quedaron sin efecto, y la prueba nueva
// `admin/panel_dueno_href.test.ts` certifica el `href`, no que la puerta corra.
//
// Esta prueba fija las DOS mitades del contrato, que es lo que hace que el
// arreglo no se pueda deshacer a medias:
//  · perfil incompleto → el NEXT_REDIRECT SALE (la puerta cierra);
//  · `getPerfilCrudo` REVIENTA → NO redirige (el bache sigue sin cerrar la
//    puerta: mejor el panel a medias que el dueño encerrado fuera).
// ═══════════════════════════════════════════════════════════════════════════

/** Imita el `redirect` real: lanza con el `digest` que Next reconoce. */
class ErrorDeRedirect extends Error {
  digest: string;
  constructor(destino: string) {
    super('NEXT_REDIRECT');
    this.digest = `NEXT_REDIRECT;replace;${destino};307;`;
  }
}
const redirect = vi.fn((destino: string) => { throw new ErrorDeRedirect(destino); });
vi.mock('next/navigation', () => ({ redirect: (d: string) => redirect(d) }));

const resolverTenantEfectivo = vi.fn(async () => ({
  tenantId: 'tenant-1', tenantNombre: 'Transportes Innovativos',
  nombre: 'Javier', rol: 'flota_admin' as string, tenantExiste: true,
}));
vi.mock('@/lib/auth/tenant-efectivo', () => ({
  resolverTenantEfectivo: (...a: unknown[]) => resolverTenantEfectivo(...(a as [])),
}));

const getPerfilCrudo = vi.fn(async (): Promise<unknown> => ({}));
vi.mock('@/lib/likida/repo', () => ({ getPerfilCrudo: (...a: unknown[]) => getPerfilCrudo(...(a as [])) }));

const onboardingFiscalListo = vi.fn(() => false);
vi.mock('@/lib/likida/perfil/preguntas', () => ({ onboardingFiscalListo: (...a: unknown[]) => onboardingFiscalListo(...(a as [])) }));

vi.mock('./inicio-contenido', () => ({ InicioContenido: () => null }));
vi.mock('./inicio-operacion', () => ({ InicioOperacion: () => null }));
vi.mock('@/lib/auth/visibilidad', () => ({ puedeVerArea: () => true }));

import DashboardInicio from './page';

const SIN_PARAMS = Promise.resolve({});

describe('/dashboard — la compuerta de onboarding (FE-19-1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    onboardingFiscalListo.mockReturnValue(false);
    getPerfilCrudo.mockResolvedValue({});
  });

  it('perfil fiscal incompleto: el NEXT_REDIRECT sale de la página, no se lo traga nadie', async () => {
    // Sin el arreglo, esto NO lanza: el `catch` desnudo se come el redirect
    // y la página devuelve tranquilamente el Resumen del dueño.
    await expect(DashboardInicio({ searchParams: SIN_PARAMS })).rejects.toMatchObject({
      digest: expect.stringContaining('NEXT_REDIRECT'),
    });
    expect(redirect).toHaveBeenCalledWith('/dashboard/onboarding');
  });

  it('conserva el sufijo del superadmin al mandar a onboarding', async () => {
    await expect(
      DashboardInicio({ searchParams: Promise.resolve({ tenant: 't-9' }) }),
    ).rejects.toMatchObject({ digest: expect.stringContaining('NEXT_REDIRECT') });
    expect(redirect).toHaveBeenCalledWith('/dashboard/onboarding?tenant=t-9');
  });

  it('perfil YA completo: no redirige — la puerta solo cierra cuando falta algo', async () => {
    onboardingFiscalListo.mockReturnValue(true);
    await expect(DashboardInicio({ searchParams: SIN_PARAMS })).resolves.toBeTruthy();
    expect(redirect).not.toHaveBeenCalled();
  });

  it('un bache leyendo el perfil NO encierra al dueño fuera de su panel', async () => {
    getPerfilCrudo.mockRejectedValue(new Error('supabase caído'));
    await expect(DashboardInicio({ searchParams: SIN_PARAMS })).resolves.toBeTruthy();
    expect(redirect).not.toHaveBeenCalled();
  });

  it('el encargado no pasa por la compuerta: no es su onboarding', async () => {
    resolverTenantEfectivo.mockResolvedValue({
      tenantId: 'tenant-1', tenantNombre: 'Transportes Innovativos',
      nombre: 'Ana', rol: 'encargado', tenantExiste: true,
    });
    await expect(DashboardInicio({ searchParams: SIN_PARAMS })).resolves.toBeTruthy();
    expect(redirect).not.toHaveBeenCalled();
    expect(getPerfilCrudo).not.toHaveBeenCalled();
  });
});
