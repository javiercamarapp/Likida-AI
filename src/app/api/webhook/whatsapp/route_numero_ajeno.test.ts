// A37-S12-05 — el webhook ignoraba value.metadata.phone_number_id: lo que
// llega para OTRO número de la misma app de Meta (sandbox, otro producto)
// entraba al motor de Likida. Se descarta con log lo que no coincide con
// WHATSAPP_PHONE_NUMBER_ID; sin metadata o sin variable, no se bloquea.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';

const SECRETO = 'app-secret-de-prueba-ts';
process.env.WHATSAPP_APP_SECRET = SECRETO;

const processInbound = vi.fn(async (_m: unknown) => {});
vi.mock('@/lib/likida/processor', () => ({ processInbound: (m: unknown) => (processInbound as (m: unknown) => Promise<void>)(m) }));
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
vi.mock('@/lib/logger', () => ({ logger }));
vi.mock('@/lib/observability/sentry', () => ({ flushObservabilidad: vi.fn(async () => {}) }));
vi.mock('@/lib/likida/interruptores', () => ({
  estaApagado: vi.fn(async () => false),
  leerInterruptor: vi.fn(async () => 'encendido' as const),
}));

const pendientes: Array<() => unknown> = [];
vi.mock('next/server', async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return { ...real, after: (fn: () => unknown) => { pendientes.push(fn); } };
});

const { bandejaInbox } = vi.hoisted(() => ({ bandejaInbox: new Map<string, unknown>() }));
vi.mock('@/lib/likida/wa_pendientes', () => ({
  pendientesYaConocidos: async () => new Set<string>(),
  guardarEventosPendientes: async (ms: Array<{ waMessageId?: string }>) => {
    const filas = ms.map((m, i) => {
      const id = m.waMessageId ?? `f-${i}`;
      bandejaInbox.set(id, m);
      return { id, evento: m, guardado: true };
    });
    return { guardados: filas.length, fallidos: 0, filas };
  },
  reclamarPendiente: async (id: string) =>
    (bandejaInbox.has(id) ? { id, evento: bandejaInbox.get(id), intentos: 1 } : null),
  marcarPendienteProcesado: async () => undefined,
  anotarFalloPendiente: async () => undefined,
}));

const { POST } = await import('./route');

const firmar = (body: string) =>
  'sha256=' + crypto.createHmac('sha256', SECRETO).update(body).digest('hex');

async function postear(body: string) {
  const res = await POST(new Request('https://likidaai.vercel.app/api/webhook/whatsapp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-hub-signature-256': firmar(body) },
    body,
  }) as never);
  while (pendientes.length) await pendientes.shift()!();
  return res;
}


const payload = (phoneId: string | undefined, id: string) => JSON.stringify({
  object: 'whatsapp_business_account',
  entry: [{ id: '1395114249160000', changes: [{ field: 'messages', value: {
    messaging_product: 'whatsapp',
    ...(phoneId ? { metadata: { display_phone_number: '15550001111', phone_number_id: phoneId } } : {}),
    messages: [{ from: '5219991110009', id, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: 'hola' } }],
  } }] }],
});

beforeEach(() => {
  processInbound.mockReset(); processInbound.mockImplementation(async () => {});
  pendientes.length = 0;
  logger.warn.mockReset();
  process.env.WHATSAPP_PHONE_NUMBER_ID = '111222333';
});

describe('A37-S12-05 · phone_number_id del webhook', () => {
  it('un mensaje dirigido a OTRO número no entra al motor y se registra', async () => {
    expect((await postear(payload('999888777', 'wamid.AJENO'))).status).toBe(200);
    expect(processInbound).not.toHaveBeenCalled();
    expect(logger.warn.mock.calls.some((c) => c[0] === 'webhook.numero_ajeno')).toBe(true);
  });
  it('el número propio sigue entrando', async () => {
    await postear(payload('111222333', 'wamid.PROPIO'));
    expect(processInbound).toHaveBeenCalledTimes(1);
  });
  it('sin metadata (o sin la variable configurada) no se bloquea nada', async () => {
    await postear(payload(undefined, 'wamid.SINMETA'));
    expect(processInbound).toHaveBeenCalledTimes(1);
    processInbound.mockClear();
    delete process.env.WHATSAPP_PHONE_NUMBER_ID;
    await postear(payload('999888777', 'wamid.SINVAR'));
    expect(processInbound).toHaveBeenCalledTimes(1);
  });
});
