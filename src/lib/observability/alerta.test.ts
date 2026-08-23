import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// Auditoría 4, D1 · El canal de alerta al operador del sistema.
//
// Lo que estas pruebas fijan es el CONTRATO del canal, no el correo bonito:
//
//   1. Sin `ALERTA_EMAIL` no se manda nada y NO es un error — es un canal
//      opcional, como Sentry sin DSN.
//   2. Con ella, sale UN correo por evento por hora. Un cron horario que falla
//      siempre mandaría 24 correos iguales al día, que es cómo se enseña a
//      ignorar el canal (mismo piso que `PISO_ENTRE_AVISOS_MS`).
//   3. Un fallo del envío NUNCA propaga al cron que estaba avisando.
//
// `enviarCorreo` se mockea: aquí se prueba el canal, no Resend.
// ═══════════════════════════════════════════════════════════════════════════

const enviarCorreo = vi.fn();
const correoConfigurado = vi.fn(() => true);
vi.mock('@/lib/correo/enviar', () => ({
  enviarCorreo: (...a: unknown[]) => enviarCorreo(...a),
  correoConfigurado: () => correoConfigurado(),
}));

const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
// `redactarTexto` de a mentiras pero con la forma real: lo que se prueba es que
// alerta.ts PASA el detalle por el redactor, no el redactor mismo (ese tiene
// sus pruebas en logger.test.ts).
vi.mock('@/lib/logger', () => ({
  logger,
  redactarTexto: (s: string) => s.replace(/\b\d{10}\b/g, '[TEL]'),
}));

type Correo = { asunto: string; datos?: Array<[string, string]> };

async function cargar() {
  // Módulo fresco por prueba: el rate limit y el "avisado una vez" viven en
  // memoria del módulo, y una prueba no debe heredar el estado de otra.
  vi.resetModules();
  return import('./alerta');
}

beforeEach(() => {
  enviarCorreo.mockReset().mockResolvedValue({ ok: true, id: 'correo-1' });
  correoConfigurado.mockReset().mockReturnValue(true);
  logger.info.mockClear();
  logger.warn.mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('alertaConfigurada', () => {
  it('false sin ALERTA_EMAIL, aunque el correo esté listo', async () => {
    // Vacía explícita: así la prueba no depende de lo que traiga la shell.
    vi.stubEnv('ALERTA_EMAIL', '');
    const { alertaConfigurada } = await cargar();
    expect(alertaConfigurada()).toBe(false);
  });

  it('false con ALERTA_EMAIL pero sin Resend: la alerta no tendría por dónde salir', async () => {
    vi.stubEnv('ALERTA_EMAIL', 'javier@likida.ai');
    correoConfigurado.mockReturnValue(false);
    const { alertaConfigurada } = await cargar();
    expect(alertaConfigurada()).toBe(false);
  });

  it('true con las dos piezas', async () => {
    vi.stubEnv('ALERTA_EMAIL', 'javier@likida.ai');
    const { alertaConfigurada } = await cargar();
    expect(alertaConfigurada()).toBe(true);
  });
});

describe('alertarOperador — sin ALERTA_EMAIL', () => {
  it('no manda nada, no lanza, y lo dice UNA vez a nivel info', async () => {
    vi.stubEnv('ALERTA_EMAIL', '');
    const { alertarOperador } = await cargar();

    await expect(alertarOperador('cron.purgar', { error: 'x' })).resolves.toBeUndefined();
    await alertarOperador('cron.purgar', { error: 'x' });

    expect(enviarCorreo).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
    const sinConfigurar = logger.info.mock.calls.filter((c) => c[0] === 'alerta.sin_configurar');
    expect(sinConfigurar).toHaveLength(1);
  });
});

describe('alertarOperador — el piso de una hora por evento', () => {
  it('manda la primera; la segunda del MISMO evento dentro de la hora NO', async () => {
    vi.stubEnv('ALERTA_EMAIL', 'javier@likida.ai');
    const { alertarOperador } = await cargar();

    await alertarOperador('cron.purgar', { error: 'relation does not exist', codigo: '42P01' });
    await alertarOperador('cron.purgar', { error: 'relation does not exist', codigo: '42P01' });

    expect(enviarCorreo).toHaveBeenCalledTimes(1);
    expect(enviarCorreo.mock.calls[0][0]).toBe('javier@likida.ai');
    expect((enviarCorreo.mock.calls[0][1] as Correo).asunto).toBe('[Likida] Falló cron.purgar');
  });

  it('pasada la hora, el mismo evento vuelve a avisar', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-14T09:00:00Z'));
    vi.stubEnv('ALERTA_EMAIL', 'javier@likida.ai');
    const { alertarOperador, PISO_ALERTA_MS } = await cargar();

    await alertarOperador('cron.purgar', { error: 'x' });
    vi.setSystemTime(new Date(Date.now() + PISO_ALERTA_MS + 1));
    await alertarOperador('cron.purgar', { error: 'x' });

    expect(enviarCorreo).toHaveBeenCalledTimes(2);
  });

  it('eventos DISTINTOS no comparten el piso: cada cron tiene su propio canal', async () => {
    vi.stubEnv('ALERTA_EMAIL', 'javier@likida.ai');
    const { alertarOperador } = await cargar();

    await alertarOperador('cron.purgar', { error: 'x' });
    await alertarOperador('cron.facturar', { error: 'y' });

    expect(enviarCorreo).toHaveBeenCalledTimes(2);
  });
});

describe('alertarOperador — el canal nunca tumba al cron', () => {
  it('si enviarCorreo revienta, no propaga: queda un warn y se sigue', async () => {
    vi.stubEnv('ALERTA_EMAIL', 'javier@likida.ai');
    enviarCorreo.mockRejectedValue(new Error('fetch failed'));
    const { alertarOperador } = await cargar();

    await expect(alertarOperador('cron.escalar', { error: 'x' })).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith('alerta.fallo', expect.objectContaining({ evento: 'cron.escalar' }));
  });

  it('si Resend rechaza (resultado !ok), queda constancia sin lanzar', async () => {
    vi.stubEnv('ALERTA_EMAIL', 'javier@likida.ai');
    enviarCorreo.mockResolvedValue({ ok: false, motivo: 'rechazado', detalle: 'HTTP 422' });
    const { alertarOperador } = await cargar();

    await expect(alertarOperador('cron.escalar', { error: 'x' })).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith('alerta.no_salio', expect.objectContaining({ motivo: 'rechazado' }));
  });
});

describe('alertarOperador — el detalle viaja redactado', () => {
  it('un teléfono en el detalle no llega crudo a Resend', async () => {
    vi.stubEnv('ALERTA_EMAIL', 'javier@likida.ai');
    const { alertarOperador } = await cargar();

    await alertarOperador('cron.escalar', { error: 'no se pudo avisar al 9993700779' });

    const correo = enviarCorreo.mock.calls[0][1] as Correo;
    const datos = JSON.stringify(correo.datos);
    expect(datos).not.toContain('9993700779');
    expect(datos).toContain('[TEL]');
  });
});

// AUDITORÍA PROD (22-ago-2026), RES-17: el piso de una hora vivía en un Map
// por instancia. Con N instancias calientes, N correos iguales por hora. Ahora
// la reserva es un `SET NX PX` en Upstash —atómico y compartido— y el Map es
// el respaldo cuando Redis no contesta.
describe('alertarOperador — el piso vive en Redis, compartido entre instancias', () => {
  function redisFalso() {
    const llaves = new Map<string, number>();
    const cuerpos: unknown[] = [];
    const fn = vi.fn(async (_url: string, init: RequestInit) => {
      const cmd = JSON.parse(String(init.body)) as [string, string, string, string, number, string];
      cuerpos.push(cmd);
      const [verbo, llave, , px, ms, nx] = cmd;
      expect(verbo).toBe('SET'); expect(px).toBe('PX'); expect(nx).toBe('NX');
      const viva = (llaves.get(llave) ?? 0) > Date.now();
      if (viva) return new Response(JSON.stringify({ result: null }), { status: 200 });
      llaves.set(llave, Date.now() + ms);
      return new Response(JSON.stringify({ result: 'OK' }), { status: 200 });
    });
    return { fn, cuerpos };
  }

  it('dos "instancias" (módulos frescos) con el mismo evento: sale UN correo', async () => {
    vi.stubEnv('ALERTA_EMAIL', 'javier@likida.ai');
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://fake.upstash.io');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'tok');
    const { fn } = redisFalso();
    vi.stubGlobal('fetch', fn);

    const a = await cargar();
    await a.alertarOperador('cron.purgar', { error: 'x' });
    const b = await cargar(); // otra instancia: Map vacío
    await b.alertarOperador('cron.purgar', { error: 'x' });

    expect(enviarCorreo).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledTimes(2);
    // La llave lleva el evento y el TTL es el piso.
    const cmd = JSON.parse(String((fn.mock.calls[0] as [string, RequestInit])[1].body)) as unknown[];
    expect(cmd[1]).toBe('likida:alerta:cron.purgar');
    expect(cmd[4]).toBe(a.PISO_ALERTA_MS);
  });

  it('si Redis no contesta, cae al Map local y el correo sale igual (nunca silencio, nunca lanza)', async () => {
    vi.stubEnv('ALERTA_EMAIL', 'javier@likida.ai');
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://fake.upstash.io');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'tok');
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('fetch failed'); }));
    const { alertarOperador } = await cargar();

    await alertarOperador('cron.purgar', { error: 'x' });
    await alertarOperador('cron.purgar', { error: 'x' });

    expect(enviarCorreo).toHaveBeenCalledTimes(1); // el Map sigue poniendo el piso
    expect(logger.warn).toHaveBeenCalledWith('alerta.piso_redis_fallo', expect.objectContaining({ evento: 'cron.purgar' }));
  });

  it('sin credenciales no toca la red: el piso es el Map de siempre', async () => {
    vi.stubEnv('ALERTA_EMAIL', 'javier@likida.ai');
    vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');
    const fn = vi.fn();
    vi.stubGlobal('fetch', fn);
    const { alertarOperador } = await cargar();
    await alertarOperador('cron.purgar', { error: 'x' });
    expect(fn).not.toHaveBeenCalled();
    expect(enviarCorreo).toHaveBeenCalledTimes(1);
  });
});
