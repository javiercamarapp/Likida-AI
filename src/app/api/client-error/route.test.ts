import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 25, ALTO REINCIDENTE — un fallo SOLO-DE-CLIENTE (el layout raíz
// truena después de hidratar) no dejaba rastro en ninguna parte: la réplica a
// Sentry está tras SENTRY_DSN, que en el bundle de cliente es undefined
// (no es NEXT_PUBLIC_*), y onRequestError nunca se entera (no hubo petición
// al servidor). Esta ruta es el destino de `reportarAlServidor` (logger.ts):
// el POST desde el cliente que sí deja una línea en el servidor, con o sin
// Sentry configurado.
// ═══════════════════════════════════════════════════════════════════════════

let permitido = true;
vi.mock('@/lib/ratelimit', () => ({
  rateLimit: async () => permitido,
  clientIp: () => '203.0.113.5',
  bodyExcede: (req: Request, max: number) => {
    const cl = req.headers.get('content-length');
    return cl !== null && Number(cl) > max;
  },
}));

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
vi.mock('@/lib/logger', () => ({ logger }));

const { POST } = await import('./route');

function peticion(cuerpo: unknown, headers: Record<string, string> = {}): Request {
  const crudo = typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo);
  return new Request('https://app.likida.ai/api/client-error', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: crudo,
  });
}

beforeEach(() => {
  permitido = true;
  logger.info.mockClear(); logger.warn.mockClear(); logger.error.mockClear();
});

describe('POST /api/client-error — el rastro de un fallo solo-de-cliente', () => {
  it('un error de cliente deja una línea de log de SERVIDOR con el mismo evento', async () => {
    const r = await POST(peticion({ level: 'error', msg: 'app.global_error', meta: { digest: 'abc123' } }));
    expect(r.status).toBe(200);
    expect(logger.error).toHaveBeenCalledWith('client.app.global_error', expect.objectContaining({
      digest: 'abc123', origen: 'cliente',
    }));
  });

  it('level=warn se registra en logger.warn, no en error', async () => {
    await POST(peticion({ level: 'warn', msg: 'app.algo_no_ideal', meta: {} }));
    expect(logger.warn).toHaveBeenCalledOnce();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('un level fuera de {warn,error} cae a error (fail closed: no se pierde el aviso)', async () => {
    await POST(peticion({ level: 'quien-sabe', msg: 'x', meta: {} }));
    expect(logger.error).toHaveBeenCalledOnce();
  });

  it('meta que no es un objeto plano se descarta, no revienta la ruta', async () => {
    const r = await POST(peticion({ level: 'error', msg: 'x', meta: ['no', 'es', 'objeto'] }));
    expect(r.status).toBe(200);
    expect(logger.error).toHaveBeenCalledWith('client.x', expect.objectContaining({ origen: 'cliente' }));
  });

  it('msg con saltos de línea se sanea: el nombre del evento no se contamina', async () => {
    await POST(peticion({ level: 'error', msg: 'app.x\nInyectado: cosa', meta: {} }));
    const [evento] = logger.error.mock.calls[0] as [string, unknown];
    expect(evento).not.toContain('\n');
    expect(evento.startsWith('client.')).toBe(true);
  });

  it('sin msg: cae a un evento genérico, no truena', async () => {
    const r = await POST(peticion({ level: 'error', meta: {} }));
    expect(r.status).toBe(200);
    expect(logger.error).toHaveBeenCalledWith('client.sin_evento', expect.anything());
  });

  it('JSON inválido: 400, sin loguear nada', async () => {
    const r = await POST(peticion('esto no es json'));
    expect(r.status).toBe(400);
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('rate limit excedido: 429, sin loguear nada', async () => {
    permitido = false;
    const r = await POST(peticion({ level: 'error', msg: 'x' }));
    expect(r.status).toBe(429);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('un cuerpo gigante (content-length de más) se corta con 413, no se parsea', async () => {
    const r = await POST(peticion({ level: 'error', msg: 'x' }, { 'content-length': String(10 * 1024) }));
    expect(r.status).toBe(413);
    expect(logger.error).not.toHaveBeenCalled();
  });
});
