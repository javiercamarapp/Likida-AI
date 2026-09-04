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

// ── AUDITORÍA 6 · el cable, no la función ──────────────────────────────────
//
// La ronda encontró DOS mecanismos correctos, con pruebas unitarias, que nadie
// llamaba: `sondearAvisoIntegral` y `flushObservabilidad`. Sus pruebas pasaban
// porque probaban la función en aislamiento — exactamente lo que el rubro de
// pruebas señaló como el modo de falla dominante del repo.
//
// El comentario de arriba dice que estas pruebas NO llaman a `register()`
// porque dispararía las RPC contra Supabase. Con los módulos mockeados sí se
// puede, y es la única forma de fijar el cable.
describe('register — el arranque llama a todo lo que dice que llama', () => {
  it('sonda el aviso de privacidad, no solo las migraciones', async () => {
    const verificarMigracionesCriticas = vi.fn(async () => {});
    const verificarAvisoDePrivacidad = vi.fn(async () => {});
    const verificarSondeoEscritura0172 = vi.fn(async () => {});
    vi.doMock('@/lib/likida/startup', () => ({ verificarMigracionesCriticas, verificarAvisoDePrivacidad, verificarSondeoEscritura0172 }));
    vi.doMock('@/lib/observability/sentry', () => ({
      avisarObservabilidad: vi.fn(), precargar: vi.fn(async () => {}),
    }));
    vi.doMock('@/lib/observability/arranque', () => ({ avisarConfiguracionSilenciosa: vi.fn() }));
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');

    const { register } = await import('./instrumentation');
    await register();

    expect(verificarMigracionesCriticas).toHaveBeenCalled();
    // ESTE es el hallazgo: la función existía y `register` no la invocaba.
    expect(verificarAvisoDePrivacidad).toHaveBeenCalled();
  });

  // AUDITORÍA 18, BAJO (B11): el sondeo del aviso hace red externa (hasta 10s)
  // y `register()` lo esperaba — la primera petición de una instancia fría
  // pagaba ese tiempo antes del primer 200 a Meta.
  it('el sondeo del aviso de privacidad NO bloquea el arranque', async () => {
    const verificarAvisoDePrivacidad = vi.fn(() => new Promise<void>(() => { /* nunca contesta: el host caído */ }));
    vi.doMock('@/lib/likida/startup', () => ({
      verificarMigracionesCriticas: vi.fn(async () => {}), verificarAvisoDePrivacidad,
      verificarSondeoEscritura0172: vi.fn(async () => {}),
    }));
    vi.doMock('@/lib/observability/sentry', () => ({ avisarObservabilidad: vi.fn(), precargar: vi.fn(async () => {}) }));
    vi.doMock('@/lib/observability/arranque', () => ({ avisarConfiguracionSilenciosa: vi.fn() }));
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');

    const { register } = await import('./instrumentation');
    const carrera = await Promise.race([register().then(() => 'arrancó'), new Promise((r) => setTimeout(() => r('colgado'), 200))]);
    expect(carrera).toBe('arrancó');
    expect(verificarAvisoDePrivacidad).toHaveBeenCalled(); // y sí se dispara
  });

  // ═══════════════════════════════════════════════════════════════════════
  // MEDIO REINCIDENTE (auditoría 24 y 25, `agentico.md`): el sondeo de la
  // 0172 ESCRIBE una fila real en `tenant` y confía en un `finally` que la
  // borra. Disparado con `void` como los diez sondeos de lectura, la
  // instancia de Vercel se congela en cuanto sale el primer 200 con el
  // `delete` de limpieza en vuelo, y la fila `__likida_probe_624__` se queda
  // en la base — `lib/admin/negocio.ts` la cuenta como una flota más. A
  // diferencia del de arriba, ESTE sondeo sí se tiene que esperar.
  // ═══════════════════════════════════════════════════════════════════════
  it('el sondeo de ESCRITURA (0172) SÍ se espera: no queda en vuelo tras el primer 200', async () => {
    let resuelto = false;
    const verificarSondeoEscritura0172 = vi.fn(() => new Promise<void>((r) => {
      setTimeout(() => { resuelto = true; r(); }, 20);
    }));
    vi.doMock('@/lib/likida/startup', () => ({
      verificarMigracionesCriticas: vi.fn(async () => {}),
      verificarAvisoDePrivacidad: vi.fn(async () => {}),
      verificarSondeoEscritura0172,
    }));
    vi.doMock('@/lib/observability/sentry', () => ({ avisarObservabilidad: vi.fn(), precargar: vi.fn(async () => {}) }));
    vi.doMock('@/lib/observability/arranque', () => ({ avisarConfiguracionSilenciosa: vi.fn() }));
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');

    const { register } = await import('./instrumentation');
    await register();

    expect(verificarSondeoEscritura0172).toHaveBeenCalled();
    expect(resuelto).toBe(true);
  });

  it('un sondeo de escritura que LANZA no tumba el arranque', async () => {
    const verificarSondeoEscritura0172 = vi.fn(async () => { throw new Error('sin red'); });
    vi.doMock('@/lib/likida/startup', () => ({
      verificarMigracionesCriticas: vi.fn(async () => {}),
      verificarAvisoDePrivacidad: vi.fn(async () => {}),
      verificarSondeoEscritura0172,
    }));
    vi.doMock('@/lib/observability/sentry', () => ({ avisarObservabilidad: vi.fn(), precargar: vi.fn(async () => {}) }));
    vi.doMock('@/lib/observability/arranque', () => ({ avisarConfiguracionSilenciosa: vi.fn() }));
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');

    const { register } = await import('./instrumentation');
    await expect(register()).resolves.toBeUndefined();
  });

  it('fuera del runtime de Node no arranca nada', async () => {
    const verificarAvisoDePrivacidad = vi.fn(async () => {});
    vi.doMock('@/lib/likida/startup', () => ({
      verificarMigracionesCriticas: vi.fn(async () => {}), verificarAvisoDePrivacidad,
      verificarSondeoEscritura0172: vi.fn(async () => {}),
    }));
    vi.stubEnv('NEXT_RUNTIME', 'edge');

    const { register } = await import('./instrumentation');
    await register();
    expect(verificarAvisoDePrivacidad).not.toHaveBeenCalled();
  });
});
