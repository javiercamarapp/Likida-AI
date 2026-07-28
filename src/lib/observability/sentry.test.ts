import { describe, it, expect, vi, afterEach } from 'vitest';
import { sentryActivo, reportar } from './sentry';

// La telemetría NUNCA puede costar una liquidación. Estos casos fijan que sin
// DSN no se carga nada y que un fallo interno no sale del módulo.
describe('sentry — opcional y silencioso', () => {
  afterEach(() => { vi.unstubAllEnvs(); });

  it('sin SENTRY_DSN está inactivo', () => {
    vi.stubEnv('SENTRY_DSN', '');
    expect(sentryActivo()).toBe(false);
  });

  it('con SENTRY_DSN se activa', () => {
    vi.stubEnv('SENTRY_DSN', 'https://algo@sentry.io/1');
    expect(sentryActivo()).toBe(true);
  });

  it('reportar sin DSN no lanza ni hace nada', () => {
    vi.stubEnv('SENTRY_DSN', '');
    expect(() => reportar('error', 'algo.falló', { viaje: 'v1' })).not.toThrow();
  });

  it('reportar con DSN inválido tampoco lanza', () => {
    // El paquete puede no estar, el DSN puede ser basura, la red puede fallar.
    // Nada de eso puede propagarse al turno del operador.
    vi.stubEnv('SENTRY_DSN', 'no-es-un-dsn');
    expect(() => reportar('warn', 'algo.raro')).not.toThrow();
  });
});

describe('logger — lo que sale va redactado', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

  it('redacta RFC y teléfono, y huella el UUID, antes de emitir', async () => {
    // El UUID ya no sale como `[UUID]`: eso borraba también las llaves primarias
    // del camino del dinero y dejaba los logs sin forma de reconstruir un fallo
    // (auditoría 5). Sale como huella derivable — ver el bloque de logger.ts.
    const { logger, huellaId } = await import('@/lib/logger');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const uuid = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    logger.error('prueba', {
      rfc: 'XAXX010101000',
      uuid,
      tel: '+525512345678',
    });
    const salida = spy.mock.calls[0][0] as string;
    expect(salida).toContain('[RFC]');
    expect(salida).toContain('[TEL]');
    expect(salida).toContain(huellaId(uuid));
    expect(salida).not.toContain('XAXX010101000');
    expect(salida).not.toContain('525512345678');
    expect(salida).not.toContain(uuid);
  });
});
