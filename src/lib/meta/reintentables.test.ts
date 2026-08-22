import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA PROD (22-ago-2026):
//
//  · RES-18 — `sendText` era la ÚNICA de las cuatro funciones de envío que
//    LANZABA ante un fallo de red. `say()` del cierre la llama sin try/catch y
//    el bloque que manda el PDF está DESPUÉS: un timeout en el acuse dejaba la
//    liquidación cerrada, el PDF en Storage y al operador sin nada. Contrato
//    nuevo: `enviarTexto` devuelve `{ok:false,…}` y nunca lanza; `sendText`
//    sigue devolviendo `id|null` — y tampoco lanza.
//
//  · RES-1 — un 429 de Meta no es un veredicto sobre el destinatario.
//    `esReintentableMeta` es lo que impide que un bloqueo de diez minutos
//    queme el tier de cientos de viajes.
// ═══════════════════════════════════════════════════════════════════════════

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { enviarTexto, sendText, esReintentableMeta, CODIGOS_META_REINTENTABLES } = await import('./client');

const fetchMock = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  process.env.WHATSAPP_ACCESS_TOKEN = 'tok';
  process.env.WHATSAPP_PHONE_NUMBER_ID = '123';
  global.fetch = fetchMock as unknown as typeof fetch;
});

const respuesta = (status: number, cuerpo: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => JSON.stringify(cuerpo),
  json: async () => cuerpo,
}) as unknown as Response;

describe('enviarTexto — el contrato de sendTemplate/sendDocument (RES-18)', () => {
  it('éxito: {ok:true} con el wamid', async () => {
    fetchMock.mockResolvedValue(respuesta(200, { messages: [{ id: 'wamid.OK' }] }));
    await expect(enviarTexto('5219991112233', 'hola')).resolves.toEqual({ ok: true, id: 'wamid.OK' });
  });

  it('UN FALLO DE RED NO LANZA: devuelve {ok:false} reintentable', async () => {
    // Este es el caso que dejaba al operador sin su PDF.
    fetchMock.mockRejectedValue(new Error('The operation was aborted due to timeout'));
    const r = await enviarTexto('5219991112233', 'hola');
    expect(r.ok).toBe(false);
    expect(r).toMatchObject({ status: 503 });
    expect(esReintentableMeta(undefined, (r as { status?: number }).status)).toBe(true);
  });

  it('rechazo de Meta: {ok:false} con el código, para que el llamador decida', async () => {
    fetchMock.mockResolvedValue(respuesta(400, { error: { code: 131030, message: 'no está en la lista' } }));
    const r = await enviarTexto('5219991112233', 'hola');
    expect(r).toMatchObject({ ok: false, codigo: 131030, status: 400 });
  });

  it('sendText sigue devolviendo id|null y TAMPOCO lanza', async () => {
    fetchMock.mockResolvedValue(respuesta(200, { messages: [{ id: 'wamid.1' }] }));
    await expect(sendText('5219991112233', 'hola')).resolves.toBe('wamid.1');
    fetchMock.mockRejectedValue(new Error('socket colgado'));
    await expect(sendText('5219991112233', 'hola')).resolves.toBeNull();
  });
});

describe('esReintentableMeta (RES-1)', () => {
  it.each(CODIGOS_META_REINTENTABLES)('el código %i es "vuelve más tarde"', (c) => {
    expect(esReintentableMeta(c)).toBe(true);
  });

  it('los del destinatario NO lo son: el tier se consume y no se reintenta para siempre', () => {
    // 131030 (fuera de la lista), 132001 (plantilla sin aprobar), 190 (token),
    // 131047 (fuera de la ventana de 24 h) son problemas que reintentar no cura.
    for (const c of [131030, 132001, 190, 131047]) expect(esReintentableMeta(c)).toBe(false);
  });

  it('429 y 5xx sin código también: la respuesta ni siquiera fue un veredicto', () => {
    expect(esReintentableMeta(undefined, 429)).toBe(true);
    expect(esReintentableMeta(undefined, 502)).toBe(true);
    expect(esReintentableMeta(undefined, 400)).toBe(false);
  });
});
