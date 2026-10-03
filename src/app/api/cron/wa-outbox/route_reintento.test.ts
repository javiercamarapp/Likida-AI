// ═══════════════════════════════════════════════════════════════════════════
// REINTENTO DE SALIDA (P0-B): lo que el cron del outbox hace con cada respuesta
// de Meta. El contrato que cuida los duplicados:
//   · el payload reclamado viaja IDÉNTICO (plantilla con botones incluida);
//   · aceptado (wamid) → finalizar con el id; nunca se reenvía;
//   · «vuelve más tarde» (429, bloqueo) → `retryable:` (vuelve a la cola con backoff);
//   · rechazo de verdad (131047, 132001) → `terminal:` (muere, NO se reintenta);
//   · sin wamid → `sin_wamid:` (muerta para revisión: reenviar duplicaría);
//   · red caída → error crudo (queda pendiente con el retraso del claim);
//   · un lease perdido (finalizar ok:false) NO cuenta como enviado.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/likida/interruptores', () => ({ leerInterruptor: async () => 'encendido' }));
const { logger } = vi.hoisted(() => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/logger', () => ({ logger }));
vi.mock('@/lib/admin/salud', () => ({
  registrarLatido: vi.fn(async () => {}),
  puertaCron: async () => null,
}));
const alertarOperador = vi.hoisted(() => vi.fn(async (..._a: unknown[]) => {}));
vi.mock('@/lib/observability/alerta', () => ({ alertarOperador }));


/** El sondeo del token (auditoría ola 1, #27) se controla desde la prueba; por omisión sirve. */
const sondeoToken = vi.hoisted(() => ({ estado: { estado: 'ok' } as Record<string, unknown> }));
vi.mock('@/lib/meta/client', async (importar) => ({
  ...(await importar<typeof import('@/lib/meta/client')>()),
  sondearTokenWhatsApp: async () => sondeoToken.estado,
}));

const PAYLOAD_PLANTILLA = {
  messaging_product: 'whatsapp', to: '525512345678', type: 'template',
  template: {
    name: 'conductor_recordatorio_1_v1', language: { code: 'es_MX' },
    components: [
      { type: 'body', parameters: [{ type: 'text', text: 'Juan' }] },
      { type: 'button', sub_type: 'quick_reply', index: '0', parameters: [{ type: 'payload', payload: 'recordatorio_registrar:v-1' }] },
    ],
  },
};
let salidas: Array<{ id: string; payload: unknown; intentos: number; leaseToken: string }> = [];
const finalizar = vi.hoisted(() => vi.fn(async (..._a: unknown[]) => ({ ok: true, muerta: false })));
vi.mock('@/lib/likida/wa_outbox', () => ({
  reconciliarReceiptsWhatsApp: async () => 0,
  purgarReceiptsWhatsApp: async () => 0,
  reclamarSalidasWhatsApp: async () => salidas,
  finalizarSalidaWhatsApp: (...a: unknown[]) => finalizar(...a),
}));
vi.mock('@/lib/likida/lotes', () => ({
  conPool: async <T,>(xs: T[], _n: number, f: (x: T) => Promise<void>) => { for (const x of xs) await f(x); },
}));

const { GET } = await import('./route');
const llamar = () => GET(new Request('https://likida.ai/api/cron/wa-outbox', { headers: { authorization: 'Bearer x' } }));
const meta = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const salida = (id = 'out-1') => ({ id, payload: PAYLOAD_PLANTILLA, intentos: 1, leaseToken: `tok-${id}` });

beforeEach(() => {
  vi.clearAllMocks();
  process.env.WHATSAPP_ACCESS_TOKEN = 'tok'; process.env.WHATSAPP_PHONE_NUMBER_ID = '999';
  salidas = [salida()];
  sondeoToken.estado = { estado: 'ok' };
  finalizar.mockResolvedValue({ ok: true, muerta: false });
});

describe('cron wa-outbox: cada respuesta de Meta', () => {
  it('aceptado: el payload sale IDÉNTICO (plantilla con botones) y se finaliza con el wamid', async () => {
    const f = vi.fn(async (..._a: unknown[]) => meta(200, { messages: [{ id: 'wamid.OK' }] }));
    vi.stubGlobal('fetch', f);
    const res = await llamar();
    expect(await res.json()).toMatchObject({ enviadas: 1, fallidas: 0 });
    expect(JSON.parse(String((f.mock.calls[0][1] as RequestInit).body))).toEqual(PAYLOAD_PLANTILLA);
    expect(finalizar).toHaveBeenCalledWith(expect.objectContaining({ id: 'out-1' }), 'wamid.OK', undefined);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it.each([
    [429, { error: { code: 130429 } }, 'retryable:'],
    [400, { error: { code: 131056 } }, 'retryable:'],
    [500, {}, 'retryable:'],
    [400, { error: { code: 131047 } }, 'terminal:'],
    [400, { error: { code: 132001 } }, 'terminal:'],
    [400, { error: { code: 131030 } }, 'terminal:'],
  ])('HTTP %i %j → %s', async (status, cuerpo, prefijo) => {
    vi.stubGlobal('fetch', vi.fn(async () => meta(status, cuerpo)));
    const res = await llamar();
    expect(await res.json()).toMatchObject({ enviadas: 0, fallidas: 1 });
    expect(finalizar).toHaveBeenCalledWith(expect.anything(), undefined, expect.stringContaining(prefijo));
  });

  it('190 (token vencido) en el envío NO es terminal: vuelve a la cola (retryable:) — se arregla renovando el token', async () => {
    const f = vi.fn(async (..._a: unknown[]) => meta(400, { error: { code: 190, message: 'Error validating access token' } }));
    vi.stubGlobal('fetch', f);
    await llamar();
    expect(finalizar).toHaveBeenCalledWith(expect.objectContaining({ id: 'out-1' }), undefined, expect.stringMatching(/^retryable:/));
  });

  it('200 sin wamid: queda muerta para revisión manual (reenviar duplicaría) y NO cuenta como enviada', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => meta(200, { messages: [] })));
    const res = await llamar();
    expect(await res.json()).toMatchObject({ enviadas: 0, fallidas: 1 });
    expect(finalizar).toHaveBeenCalledWith(expect.anything(), undefined, 'sin_wamid:out-1');
  });

  it('red caída/timeout: se finaliza con el error crudo (vuelve a la cola) y no lanza', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('socket hang up'); }));
    const res = await llamar();
    expect(await res.json()).toMatchObject({ enviadas: 0, fallidas: 1 });
    expect(finalizar).toHaveBeenCalledWith(expect.anything(), undefined, 'socket hang up');
  });

  it('lease perdido (otro worker ya la finalizó): NO cuenta como enviada', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => meta(200, { messages: [{ id: 'wamid.OK' }] })));
    finalizar.mockResolvedValue({ ok: false, muerta: false });
    const res = await llamar();
    expect(await res.json()).toMatchObject({ enviadas: 0, fallidas: 1 });
  });

  it('una salida que agota sus reintentos avisa al operador (no se pierde en silencio)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => meta(400, { error: { code: 131047 } })));
    finalizar.mockResolvedValue({ ok: true, muerta: true });
    await llamar();
    expect(alertarOperador).toHaveBeenCalledWith('cron.wa_outbox', expect.objectContaining({ codigo: 'salida_muerta' }));
  });

  it('dos salidas distintas con el mismo contenido son dos envíos (el dedupe es de la llave en la base, no del cron)', async () => {
    salidas = [salida('out-1'), salida('out-2')];
    const f = vi.fn(async (..._a: unknown[]) => meta(200, { messages: [{ id: `wamid.${f.mock.calls.length}` }] }));
    vi.stubGlobal('fetch', f);
    const res = await llamar();
    expect(await res.json()).toMatchObject({ tomadas: 2, enviadas: 2 });
    expect(finalizar.mock.calls.map((c) => (c[0] as { id: string }).id)).toEqual(['out-1', 'out-2']);
  });

  it('un fallo en una salida no impide las demás del lote', async () => {
    salidas = [salida('out-1'), salida('out-2')];
    let n = 0;
    vi.stubGlobal('fetch', vi.fn(async () => (++n === 1 ? meta(429, { error: { code: 130429 } }) : meta(200, { messages: [{ id: 'wamid.2' }] }))));
    const res = await llamar();
    expect(await res.json()).toMatchObject({ tomadas: 2, enviadas: 1, fallidas: 1 });
  });
});
