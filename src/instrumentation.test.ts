import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// Auditoría 5 · CRÍTICO «No hay observabilidad en producción», punto 3:
// «No hay `Sentry.init` en `src/instrumentation.ts` […], no hay export
// `onRequestError` […]. Una excepción no atrapada en un Server Component del
// panel o en la ruta de export no llega nunca.»
//
// Y el ALTO del error boundary: `src/app/` no importa el `logger` en ninguna
// parte salvo el webhook, así que las tres superficies web fallan sin registrar.
// `onRequestError` es el único punto que las cubre a todas sin tocar `src/app/`.
//
// Estas pruebas NO llaman a `register()`: eso corre las RPC de migraciones
// contra Supabase de verdad. `onRequestError` es independiente.
// ═══════════════════════════════════════════════════════════════════════════

beforeEach(() => { vi.resetModules(); });
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('onRequestError — el fallo de una superficie web deja línea', () => {
  it('registra ruta, tipo y digest de un fallo de Server Component', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { onRequestError } = await import('./instrumentation');

    const e = Object.assign(new Error('supabase se cayó'), { digest: '3155718393' });
    await onRequestError(
      e,
      { path: '/dashboard/abc', method: 'GET', headers: {} },
      { routerKind: 'App Router', routePath: '/dashboard/[id]', routeType: 'render' },
    );

    const linea = String(spy.mock.calls[0][0]);
    expect(linea).toContain('request.fail');
    expect(linea).toContain('/dashboard/[id]');
    expect(linea).toContain('3155718393'); // el hash que el usuario ve en pantalla
    expect(linea).toContain('supabase se cayó');
  });

  it('el identificador del fallo va redactado como el resto de los logs', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { onRequestError } = await import('./instrumentation');
    const { huellaId } = await import('@/lib/logger');

    const uuid = '11111111-1111-1111-1111-111111111111';
    await onRequestError(
      new Error(`tenant ${uuid} sin config`),
      { path: `/dashboard/${uuid}`, method: 'GET', headers: {} },
      { routerKind: 'App Router', routePath: '/dashboard/[id]', routeType: 'render' },
    );

    const linea = String(spy.mock.calls[0][0]);
    expect(linea).not.toContain(uuid);
    expect(linea).toContain(huellaId(uuid));
  });

  it('nunca lanza: un fallo del reporte no puede sumarse al fallo original', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { onRequestError } = await import('./instrumentation');
    // Argumentos deformes a propósito (Next puede cambiar la forma del contexto).
    await expect(
      onRequestError('no soy un Error', undefined as never, undefined as never),
    ).resolves.toBeUndefined();
  });
});
