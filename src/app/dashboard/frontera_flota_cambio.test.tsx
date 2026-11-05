import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

// R4 — prueba de COMPORTAMIENTO de la frontera de FlotaCambioError (MX-002). Antes solo había pruebas estáticas del
// boundary de /dashboard. Aquí el error se PRODUCE de verdad (una acción atada a una flota cuya cookie ya apunta a otra),
// se serializa como lo hace Next en producción (sin nombre ni mensaje, solo el `digest`) y se pinta con CADA error boundary
// que puede atraparlo en el árbol de /dashboard. El repo no corre un DOM (vitest en node), así que, como el resto de pruebas
// de pantalla, se mira lo que el render pinta.

vi.mock('../editorial', () => ({
  Kicker: ({ children }: { children: unknown }) => <span>{children as string}</span>,
  TituloEditorial: ({ children }: { children: unknown }) => <h1>{children as string}</h1>,
  Pildora: ({ children }: { children: unknown }) => <button>{children as string}</button>,
  serifEditorial: { variable: 'serif' },
}));

const getSessionTenant = vi.fn();
vi.mock('@/lib/auth/session', () => ({ getSessionTenant: () => getSessionTenant() }));
const resolverTenantEfectivo = vi.fn();
vi.mock('@/lib/auth/tenant-efectivo', () => ({ resolverTenantEfectivo: (...a: unknown[]) => resolverTenantEfectivo(...a) }));

const { resolverTenantAtadoOLanza, FlotaCambioError } = await import('@/lib/auth/tenant-atado');
const { MENSAJE_FLOTA_CAMBIO, DIGEST_FLOTA_CAMBIO } = await import('@/lib/auth/flota_cambio');
const { default: ErrorDashboard } = await import('./error');
const { default: ErrorAgentes } = await import('./agentes/error');

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const escapar = (t: string) => t.replace(/&/g, '&amp;').replace(/'/g, '&#x27;').replace(/</g, '&lt;');

/** Lo que el boundary recibe en PRODUCCIÓN: Next borra nombre y mensaje del error de servidor y conserva solo el `digest` ya puesto. */
function comoLlegaAlClienteEnProduccion(e: unknown): Error & { digest?: string } {
  const original = e as { digest?: string };
  return Object.assign(new Error('An error occurred in the Server Components render.'), { digest: original.digest });
}

async function errorRealDeUnaAccionAtada(): Promise<unknown> {
  process.env.LIKIDA_FLOTA_COOKIE_LLAVE = 'llave-de-prueba-0123456789';
  getSessionTenant.mockResolvedValue({ rol: 'superadmin', tenantId: A, userId: 'u1' });
  // La pantalla pintó la flota A; la cookie compartida (otra pestaña) ya apunta a B.
  resolverTenantEfectivo.mockResolvedValue({ rol: 'superadmin', tenantId: B, userId: 'u1' });
  try {
    await resolverTenantAtadoOLanza('/dashboard/x', undefined, A);
  } catch (e) {
    return e;
  }
  throw new Error('la acción atada debía lanzar FlotaCambioError');
}

beforeEach(() => { getSessionTenant.mockReset(); resolverTenantEfectivo.mockReset(); });

describe('frontera FlotaCambioError — comportamiento de extremo a extremo (MX-002)', () => {
  it('una acción atada con la cookie en otra flota LANZA FlotaCambioError con el digest de la casa', async () => {
    const e = await errorRealDeUnaAccionAtada();
    expect(e).toBeInstanceOf(FlotaCambioError);
    expect((e as { digest?: string }).digest).toBe(DIGEST_FLOTA_CAMBIO);
  });

  it('control: con la cookie en la MISMA flota la acción no lanza', async () => {
    process.env.LIKIDA_FLOTA_COOKIE_LLAVE = 'llave-de-prueba-0123456789';
    getSessionTenant.mockResolvedValue({ rol: 'superadmin', tenantId: A, userId: 'u1' });
    resolverTenantEfectivo.mockResolvedValue({ rol: 'superadmin', tenantId: A, userId: 'u1' });
    await expect(resolverTenantAtadoOLanza('/dashboard/x', undefined, A)).resolves.toMatchObject({ tenantId: A });
  });

  for (const [nombre, Frontera] of [['/dashboard', ErrorDashboard], ['/dashboard/agentes', ErrorAgentes]] as const) {
    it(`${nombre}: el error ya serializado como en producción se pinta «cambiaste de flota», con salida de recargar y sin «Reintentar»`, async () => {
      const llegado = comoLlegaAlClienteEnProduccion(await errorRealDeUnaAccionAtada());
      expect(llegado.message).not.toContain('flota'); // el mensaje original NO sobrevive: lo único que queda es el digest
      const html = renderToStaticMarkup(<Frontera error={llegado} reset={() => {}} />);
      expect(html).toContain('Cambiaste de flota');
      expect(html).toContain(escapar(MENSAJE_FLOTA_CAMBIO));
      expect(html).toContain('Recargar');
      expect(html).not.toContain('Reintentar');
      expect(html).not.toContain('Código del incidente');
    });

    it(`${nombre}: un error cualquiera sigue siendo el genérico con su código de incidente (no se traga otros fallos)`, () => {
      const html = renderToStaticMarkup(<Frontera error={Object.assign(new Error('x'), { digest: '4471093821' })} reset={() => {}} />);
      expect(html).not.toContain('Cambiaste de flota');
      expect(html).toContain('Reintentar');
      expect(html).toContain('4471093821');
    });
  }

  it('el error sin serializar (desarrollo: solo nombre y mensaje) también se reconoce', () => {
    const html = renderToStaticMarkup(<ErrorAgentes error={new FlotaCambioError()} reset={() => {}} />);
    expect(html).toContain('Cambiaste de flota');
  });
});
