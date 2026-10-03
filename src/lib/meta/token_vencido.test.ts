import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA OLA 1, #27 — el token de WhatsApp vencido (Meta 190) no puede matar
// el canal en silencio: se AVISA al operador, la salida se ENCOLA (no se tira) y
// un sondeo barato lo detecta antes de que cientos de envíos fallen.
// ═══════════════════════════════════════════════════════════════════════════

const { logger } = vi.hoisted(() => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
const encolar = vi.hoisted(() => vi.fn(async (..._a: unknown[]) => {}));
const alertar = vi.hoisted(() => vi.fn(async (..._a: unknown[]) => {}));
vi.mock('@/lib/logger', () => ({ logger }));
vi.mock('@/lib/likida/wa_outbox', () => ({
  encolarSalidaWhatsApp: encolar, encolarSalidaWhatsAppDedupe: vi.fn(), RETRASO_AMBIGUO_SEGUNDOS: 300,
}));
vi.mock('@/lib/observability/alerta', () => ({ alertarOperador: alertar }));

const {
  esTokenMetaInvalido, esReintentableMeta, enviarTexto, sendTemplate, enviarBotones, enviarSolicitudUbicacion,
  sondearTokenWhatsApp, olvidarSondeoToken, RETRASO_TOKEN_SEGUNDOS,
} = await import('./client');

const respuesta = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const TOKEN_VENCIDO = () => respuesta(400, { error: { message: 'Error validating access token: Session has expired', type: 'OAuthException', code: 190 } });
let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  process.env.WHATSAPP_ACCESS_TOKEN = 'tok-vencido';
  process.env.WHATSAPP_PHONE_NUMBER_ID = '999';
  vi.clearAllMocks();
  olvidarSondeoToken();
  fetchSpy = vi.fn(async () => TOKEN_VENCIDO());
  vi.stubGlobal('fetch', fetchSpy);
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('esTokenMetaInvalido', () => {
  it('190 es token inválido; un 401 SIN código también; otros no', () => {
    expect(esTokenMetaInvalido(190, 400)).toBe(true);
    expect(esTokenMetaInvalido(190)).toBe(true);
    expect(esTokenMetaInvalido(undefined, 401)).toBe(true);
    expect(esTokenMetaInvalido(131047, 400)).toBe(false);
    expect(esTokenMetaInvalido(130429, 429)).toBe(false);
    expect(esTokenMetaInvalido(undefined, 500)).toBe(false);
    expect(esTokenMetaInvalido(undefined, undefined)).toBe(false);
    // un 401 CON otro código de Meta no es el token
    expect(esTokenMetaInvalido(10, 401)).toBe(false);
  });
  it('190 NO es "reintentable" a secas (esa lista sigue siendo la de rate limits): se maneja aparte', () => {
    expect(esReintentableMeta(190, 400)).toBe(false);
  });
});

describe('un envío con el token vencido ya no se pierde: avisa y se encola con retraso largo', () => {
  it('enviarTexto', async () => {
    const r = await enviarTexto('5219993700779', 'hola');
    expect(r).toMatchObject({ ok: false, codigo: 190, status: 400 });
    expect(encolar).toHaveBeenCalledTimes(1);
    expect(encolar.mock.calls[0][2]).toBe(RETRASO_TOKEN_SEGUNDOS);
    expect(String(encolar.mock.calls[0][1])).toMatch(/^token:/);
    expect(alertar).toHaveBeenCalledTimes(1);
    expect(alertar).toHaveBeenCalledWith('whatsapp.token_vencido', expect.objectContaining({ codigo: '190', origen: 'envio' }));
    expect(String((alertar.mock.calls[0][1] as { error: string }).error)).toMatch(/WHATSAPP_ACCESS_TOKEN/);
  });

  it('sendTemplate', async () => {
    const r = await sendTemplate('5219993700779', 'recordatorio_cierre', { parametros: ['Juan', 'F-1'] });
    expect(r.ok).toBe(false);
    expect(encolar).toHaveBeenCalledTimes(1);
    expect(alertar).toHaveBeenCalledTimes(1);
  });

  it('enviarBotones y la solicitud de ubicación', async () => {
    await enviarBotones('5219993700779', '¿Cierro?', [{ id: 'a', titulo: 'Sí' }, { id: 'b', titulo: 'No' }]);
    await enviarSolicitudUbicacion('5219993700779', '¿Dónde estás?');
    expect(encolar).toHaveBeenCalledTimes(2);
    expect(alertar).toHaveBeenCalledTimes(2);
  });

  it('un 429 normal sigue yendo por el camino de siempre (sin alerta de token, reintento inmediato)', async () => {
    fetchSpy.mockResolvedValue(respuesta(429, { error: { code: 130429 } }));
    await enviarTexto('5219993700779', 'hola');
    expect(alertar).not.toHaveBeenCalled();
    expect(encolar).toHaveBeenCalledTimes(1);
    expect(encolar.mock.calls[0].length).toBe(2); // sin retraso extra
  });

  it('un rechazo terminal NO relacionado con el token (131047) no se encola ni alerta', async () => {
    fetchSpy.mockResolvedValue(respuesta(400, { error: { code: 131047 } }));
    await enviarTexto('5219993700779', 'hola');
    expect(alertar).not.toHaveBeenCalled();
    expect(encolar).not.toHaveBeenCalled();
  });
});

describe('sondearTokenWhatsApp', () => {
  it('sin configuración no llama a Meta', async () => {
    delete process.env.WHATSAPP_ACCESS_TOKEN;
    expect(await sondearTokenWhatsApp()).toEqual({ estado: 'sin_config' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('token bueno: ok, y pregunta con la lectura barata del phone-number-id', async () => {
    fetchSpy.mockResolvedValue(respuesta(200, { id: '999' }));
    expect(await sondearTokenWhatsApp()).toEqual({ estado: 'ok' });
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://graph.facebook.com/v21.0/999?fields=id');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok-vencido');
  });

  it('190 (o un 401 sin código): vencido', async () => {
    expect(await sondearTokenWhatsApp()).toMatchObject({ estado: 'vencido', codigo: 190 });
    olvidarSondeoToken();
    fetchSpy.mockResolvedValue(respuesta(401, {}));
    expect(await sondearTokenWhatsApp()).toMatchObject({ estado: 'vencido', status: 401 });
  });

  it('un 5xx, un 403 de permisos del recurso o una caída de red son INDETERMINADOS (no se confunden con token vencido)', async () => {
    fetchSpy.mockResolvedValue(respuesta(503, {}));
    expect((await sondearTokenWhatsApp()).estado).toBe('indeterminado');
    fetchSpy.mockResolvedValue(respuesta(403, { error: { code: 200 } }));
    expect((await sondearTokenWhatsApp()).estado).toBe('indeterminado');
    fetchSpy.mockRejectedValue(new Error('ECONNRESET'));
    expect(await sondearTokenWhatsApp()).toEqual({ estado: 'indeterminado', detalle: 'ECONNRESET' });
  });

  it('cachea 5 minutos el veredicto firme (ok/vencido), y NO cachea el indeterminado', async () => {
    fetchSpy.mockResolvedValue(respuesta(200, { id: '999' }));
    const t0 = 1_000_000;
    await sondearTokenWhatsApp(t0);
    await sondearTokenWhatsApp(t0 + 60_000);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    await sondearTokenWhatsApp(t0 + 6 * 60_000); // vencida la caché
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    olvidarSondeoToken();
    fetchSpy.mockClear();
    fetchSpy.mockResolvedValue(respuesta(503, {}));
    await sondearTokenWhatsApp(t0);
    await sondearTokenWhatsApp(t0 + 1000);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('renovar el token se nota tras olvidar la caché (o pasados 5 min)', async () => {
    expect((await sondearTokenWhatsApp()).estado).toBe('vencido');
    fetchSpy.mockResolvedValue(respuesta(200, { id: '999' }));
    olvidarSondeoToken();
    expect((await sondearTokenWhatsApp()).estado).toBe('ok');
  });

  it('el token no se filtra al log ni al aviso', async () => {
    await sondearTokenWhatsApp();
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('tok-vencido');
  });
});
