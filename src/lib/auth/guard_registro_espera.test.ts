import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Reparo de revisión (CT-SEG-11): el evento de página negada / MFA fallido se espera (con tope corto) ANTES del redirect(),
// para que el runtime serverless no congele la función con el INSERT a medias.
const orden: string[] = [];
const redirect = vi.fn((destino: string) => { orden.push(`redirect:${destino}`); throw new Error('NEXT_REDIRECT'); });
vi.mock('next/navigation', () => ({ redirect: (d: string) => redirect(d) }));

const getSessionTenant = vi.fn();
vi.mock('./session', () => ({ getSessionTenant: () => getSessionTenant() }));
vi.mock('./admin-context', () => ({ leerSeleccionFlota: async () => null }));
vi.mock('./perfil_tenant', () => ({ exigirRutaDePerfil: async () => {} }));
const mfaObligatorio = vi.fn(() => false);
vi.mock('./mfa', () => ({ mfaSuperadminObligatorio: () => mfaObligatorio() }));
const veredicto = vi.fn(async () => 'ok');
vi.mock('./superadmin-mfa', () => ({ veredictoMfaDeSesion: () => veredicto() }));

let resolverRegistro: (() => void) | null = null;
let modoRegistro: 'lento' | 'colgado' | 'falla' = 'lento';
function registro(nombre: string) {
  return (..._a: unknown[]) => {
    orden.push(`registro:${nombre}:inicio`);
    if (modoRegistro === 'falla') return Promise.reject(new Error('boom'));
    if (modoRegistro === 'colgado') return new Promise<void>(() => {});
    return new Promise<void>((ok) => { resolverRegistro = () => { orden.push(`registro:${nombre}:fin`); ok(); }; });
  };
}
vi.mock('@/lib/seguridad/registro_acceso', () => ({
  registrarPaginaNegada: registro('pagina_negada'),
  registrarMfaFallido: registro('mfa_fallido'),
}));

const { requireSuperadmin, requireVendedor, exigirVerRuta, TOPE_REGISTRO_ANTES_DE_REDIRECT_MS } = await import('./guard');

beforeEach(() => {
  orden.length = 0;
  resolverRegistro = null;
  modoRegistro = 'lento';
  redirect.mockClear();
  getSessionTenant.mockReset();
  mfaObligatorio.mockReturnValue(false);
  veredicto.mockResolvedValue('ok');
  vi.useFakeTimers();
});
afterEach(() => { vi.useRealTimers(); });

describe('guard: el registro de acceso negado se espera antes del redirect', () => {
  it('requireSuperadmin: un rol ajeno redirige solo DESPUES de que el evento termina', async () => {
    getSessionTenant.mockResolvedValue({ userId: 'u', tenantId: 't', rol: 'flota_admin' });
    const p = requireSuperadmin();
    const resultado = p.catch((e: Error) => e.message);
    await vi.advanceTimersByTimeAsync(10);
    expect(orden).toEqual(['registro:pagina_negada:inicio']);
    expect(redirect).not.toHaveBeenCalled();
    resolverRegistro!();
    expect(await resultado).toBe('NEXT_REDIRECT');
    expect(orden).toEqual(['registro:pagina_negada:inicio', 'registro:pagina_negada:fin', 'redirect:/dashboard']);
  });

  it('requireVendedor y exigirVerRuta esperan igual', async () => {
    getSessionTenant.mockResolvedValue({ userId: 'u', tenantId: 't', rol: 'encargado' });
    const a = requireVendedor().catch((e: Error) => e.message);
    await vi.waitFor(() => expect(resolverRegistro).not.toBeNull());
    expect(redirect).not.toHaveBeenCalled();
    resolverRegistro!();
    expect(await a).toBe('NEXT_REDIRECT');

    orden.length = 0; redirect.mockClear(); resolverRegistro = null;
    const b = exigirVerRuta('/dashboard/rentabilidad').catch((e: Error) => e.message);
    await vi.waitFor(() => expect(resolverRegistro).not.toBeNull());
    expect(redirect).not.toHaveBeenCalled();
    resolverRegistro!();
    expect(await b).toBe('NEXT_REDIRECT');
    expect(orden[0]).toBe('registro:pagina_negada:inicio');
  });

  it('MFA fallido de un superadmin: el evento se espera antes del rebote a Mi perfil', async () => {
    mfaObligatorio.mockReturnValue(true);
    veredicto.mockResolvedValue('sin_factor');
    getSessionTenant.mockResolvedValue({ userId: 'u', tenantId: null, rol: 'superadmin' });
    const p = requireSuperadmin().catch((e: Error) => e.message);
    await vi.advanceTimersByTimeAsync(10);
    expect(orden).toEqual(['registro:mfa_fallido:inicio']);
    resolverRegistro!();
    expect(await p).toBe('NEXT_REDIRECT');
    expect(orden.at(-1)).toBe('redirect:/dashboard/mi-perfil?exige=sin_factor');
  });

  it('un registro colgado no retrasa el rebote mas que el tope', async () => {
    modoRegistro = 'colgado';
    getSessionTenant.mockResolvedValue({ userId: 'u', tenantId: 't', rol: 'flota_admin' });
    const p = requireSuperadmin().catch((e: Error) => e.message);
    await vi.advanceTimersByTimeAsync(TOPE_REGISTRO_ANTES_DE_REDIRECT_MS - 1);
    expect(redirect).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2);
    expect(await p).toBe('NEXT_REDIRECT');
    expect(redirect).toHaveBeenCalledWith('/dashboard');
  });

  it('un registro que falla jamas tumba el rebote', async () => {
    modoRegistro = 'falla';
    getSessionTenant.mockResolvedValue({ userId: 'u', tenantId: 't', rol: 'flota_admin' });
    expect(await requireSuperadmin().catch((e: Error) => e.message)).toBe('NEXT_REDIRECT');
    expect(redirect).toHaveBeenCalledWith('/dashboard');
  });
});
