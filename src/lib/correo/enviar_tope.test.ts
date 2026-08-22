import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA PROD (22-ago-2026) · RES-5 — el canal de aviso podía matar a quien
// avisaba.
//
// `fetch` a Resend sin `signal` hereda el default de undici: 300 s. Y se
// ESPERA en caminos de 120 s (el `after()` del webhook vía `alertarOperador`,
// los crons vía `interruptores.ts`). Un Resend colgado se llevaba la
// invocación entera —y con ella la liquidación que ya estaba hecha— por no
// poder mandar un correo.
//
// Lo que se fija: la llamada lleva señal con tope, y agotarlo entra por el
// MISMO camino que una red caída (`motivo: 'red'`), sin lanzar.
// ═══════════════════════════════════════════════════════════════════════════

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  redactarTexto: (s: string) => s,
}));

const correo = {
  asunto: 'Falló cron.purgar', avance: 'a', titulo: 't', parrafos: ['p'],
  datos: [] as Array<[string, string]>, tono: 'urgente' as const,
  porQueLoRecibes: 'Recibes esto porque ALERTA_EMAIL apunta a esta dirección.',
};

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('RESEND_API_KEY', 'llave-de-prueba');
  vi.stubEnv('RESEND_EMAIL_DOMAIN', 'mail.likida.ai');
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('enviarCorreo tiene techo', () => {
  it('manda una señal con tope en la petición a Resend', async () => {
    const fetchFalso = vi.fn(async (_u: string, _init: RequestInit) => { void _u; void _init; return new Response(JSON.stringify({ id: 'c1' }), { status: 200 }); });
    vi.stubGlobal('fetch', fetchFalso);
    const { enviarCorreo, TIMEOUT_CORREO_MS } = await import('./enviar');

    const r = await enviarCorreo('javier@likida.ai', correo);
    expect(r.ok).toBe(true);
    const init = fetchFalso.mock.calls[0][1];
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(TIMEOUT_CORREO_MS).toBeLessThanOrEqual(10_000);
  });

  it('un Resend que nunca contesta NO se lleva al que estaba avisando', async () => {
    vi.stubEnv('LIKIDA_TIMEOUT_CORREO_MS', '40');
    // El doble respeta la señal, como hace undici: sin eso la prueba mediría
    // su propio setTimeout y no el tope.
    vi.stubGlobal('fetch', vi.fn((_u: string, init: RequestInit) => new Promise((_res, rej) => {
      init.signal?.addEventListener('abort', () => rej(new DOMException('The operation was aborted.', 'TimeoutError')));
    })));
    const { enviarCorreo } = await import('./enviar');

    const t0 = Date.now();
    const r = await enviarCorreo('javier@likida.ai', correo);
    expect(Date.now() - t0).toBeLessThan(2_000);
    // Mismo camino que una red caída: el llamador no distingue, y no lanza.
    expect(r).toMatchObject({ ok: false, motivo: 'red' });
  });
});
