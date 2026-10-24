import { describe, it, expect, vi, afterEach } from 'vitest';
import { sentryActivo, reportar, sanitizarEventoSentry, tasaTrazas, LLAVES_EXTRA_SEGURAS } from './sentry';

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

  it('acota el muestreo de trazas y elimina contexto sensible', () => {
    vi.stubEnv('SENTRY_TRACES_SAMPLE_RATE', '9');
    expect(tasaTrazas()).toBe(1);
    const limpio = sanitizarEventoSentry({
      request: { url: 'https://app.likida.ai/api/x?token=secreto', headers: { authorization: 'Bearer secreto' }, cookies: 'x', data: 'body' },
      user: { email: 'persona@example.com' },
      breadcrumbs: [{ message: 'ok', data: { telefono: '9991234567' } }],
    }) as { user?: unknown; request: Record<string, unknown>; breadcrumbs: Array<Record<string, unknown>> };
    expect(limpio.user).toBeUndefined();
    expect(limpio.request.url).toBe('https://app.likida.ai/api/x');
    expect(limpio.request.headers).toBeUndefined();
    expect(limpio.request.cookies).toBeUndefined();
    expect(limpio.breadcrumbs[0].data).toBeUndefined();
  });

  // OP3-1 (auditoría E.28): antes esto era `delete salida.extra` sin condición
  // — perdía TODO el contexto de diagnóstico (viaje, tenant, digest) para
  // evitar que se colara un dato personal. La defensa correcta es de dos
  // capas: lista blanca de llaves + `redactarTexto` sobre cada valor
  // permitido, no borrar el campo entero.
  it('extra: filtra a la lista blanca y redacta los valores permitidos, sin dejar pasar datos personales', () => {
    const limpio = sanitizarEventoSentry({
      extra: {
        viajeId: 'id:9f2c1a4b77de',
        tenantId: 'id:0a1b2c3d4e5f',
        digest: '3155718393',
        ruta: '/dashboard/viajes',
        nombreDelCliente: 'Juan Pérez',
        telefono: '5512345678',
        motivo: 'el cliente Juan Pérez se quejó por WhatsApp',
      },
    }) as { extra: Record<string, unknown> };

    // Los identificadores técnicos de la lista blanca sobreviven.
    expect(limpio.extra.viajeId).toBe('id:9f2c1a4b77de');
    expect(limpio.extra.tenantId).toBe('id:0a1b2c3d4e5f');
    expect(limpio.extra.digest).toBe('3155718393');
    expect(limpio.extra.ruta).toBe('/dashboard/viajes');

    // Cualquier llave fuera de la lista blanca se descarta ENTERA, aunque su
    // valor pareciera inocuo o aunque sea la única fuente del dato personal.
    expect(limpio.extra.nombreDelCliente).toBeUndefined();
    expect(limpio.extra.telefono).toBeUndefined();
    expect(limpio.extra.motivo).toBeUndefined();
    expect(JSON.stringify(limpio.extra)).not.toContain('Juan Pérez');
  });

  it('extra: aunque una llave de la lista blanca traiga un valor sensible, se redacta (no se confía en el nombre de la llave)', () => {
    const limpio = sanitizarEventoSentry({
      extra: { tenant: 'XAXX010101000', ruta: '9991234567' },
    }) as { extra: Record<string, unknown> };

    expect(limpio.extra.tenant).toBe('[RFC]');
    expect(limpio.extra.ruta).toBe('[TEL]');
  });

  it('extra: sin ninguna llave de la lista blanca, el campo desaparece igual que antes', () => {
    const limpio = sanitizarEventoSentry({
      extra: { nombreDelCliente: 'Juan Pérez' },
    }) as { extra?: unknown };
    expect(limpio.extra).toBeUndefined();
  });

  // A37-S61-07: el saneador solo limpiaba `extra`, `request`, `spans` y
  // `breadcrumbs[].data`; un evento que llega por una integración automática del
  // SDK (unhandledRejection…) sin pasar por `reportarExcepcion` salía con el
  // texto del error crudo.
  it('A37-S61-07: redacta message, exception.values[].value, breadcrumbs[].message y los valores de tags', () => {
    const limpio = sanitizarEventoSentry({
      message: 'falló el alta de 5512345678',
      exception: { values: [{ type: 'Error', value: 'duplicate key: Key (telefono)=(5219991234567) y rfc XAXX010101000', stacktrace: { frames: [] } }] },
      breadcrumbs: [{ category: 'console', message: 'cliente 5512345678 reintentó', data: { a: 1 } }],
      tags: { runtime: 'node', contacto: '5512345678', rfc: 'XAXX010101000' },
    }) as {
      message: string;
      exception: { values: Array<{ type: string; value: string; stacktrace: unknown }> };
      breadcrumbs: Array<{ message: string; data?: unknown }>;
      tags: Record<string, string>;
    };
    const todo = JSON.stringify(limpio);
    expect(todo).not.toContain('5512345678');
    expect(todo).not.toContain('5219991234567');
    expect(todo).not.toContain('XAXX010101000');
    // Lo útil para depurar se conserva: tipo, forma del mensaje, claves de tags y su valor técnico.
    expect(limpio.exception.values[0].type).toBe('Error');
    expect(limpio.exception.values[0].value).toContain('duplicate key');
    expect(limpio.tags.runtime).toBe('node');
    expect(limpio.breadcrumbs[0].data).toBeUndefined();
  });

  it('A37-S61-07: message como objeto {formatted} y exception sin valores no revientan', () => {
    const limpio = sanitizarEventoSentry({ message: { formatted: 'hola 5512345678', message: 'hola %s' }, exception: {} }) as { message: { formatted: string; message: string } };
    expect(limpio.message.formatted).not.toContain('5512345678');
  });

  it('A37-S61-07: contexts distintos de los técnicos se descartan; trace se conserva sin data', () => {
    const limpio = sanitizarEventoSentry({
      contexts: {
        trace: { trace_id: 'abc', data: { url: 'https://x/?token=1' } },
        runtime: { name: 'node', version: '22' },
        cliente: { nombre: 'Juan Pérez', telefono: '5512345678' },
      },
    }) as { contexts: Record<string, unknown> };
    expect(limpio.contexts.cliente).toBeUndefined();
    expect(limpio.contexts.runtime).toEqual({ name: 'node', version: '22' });
    expect((limpio.contexts.trace as Record<string, unknown>).data).toBeUndefined();
    expect((limpio.contexts.trace as Record<string, unknown>).trace_id).toBe('abc');
  });

  it('LLAVES_EXTRA_SEGURAS no incluye llaves de texto libre (err/error/message/motivo)', () => {
    for (const libre of ['err', 'error', 'message', 'motivo']) {
      expect(LLAVES_EXTRA_SEGURAS.has(libre)).toBe(false);
    }
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
