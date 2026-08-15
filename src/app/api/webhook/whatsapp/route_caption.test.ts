// ═══════════════════════════════════════════════════════════════════════════
// F4 · EL CAPTION DE LA FOTO LLEGA AL PROCESADOR.
//
// Hasta el 14-ago-2026, `extractMessages` tiraba `image.caption`: el rótulo
// con el que el chofer distingue la carta porte ("carta porte sellada") y la
// nota de talacha ("se me ponchó una llanta, son 800") de un comprobante
// cualquiera. Sin el caption, el POD por foto y la talacha con foto son
// FÍSICAMENTE imposibles — el processor no tiene otra señal determinística.
//
// Mismo arnés que route_cableado.test.ts (POST real, firma real); aquí solo
// se fija el contrato nuevo: caption → `text` del InboundMessage de imagen.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';

const SECRETO = 'app-secret-de-prueba';
process.env.WHATSAPP_APP_SECRET = SECRETO;

const processInbound = vi.fn(async (_m: unknown) => {});
vi.mock('@/lib/likida/processor', () => ({ processInbound }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/observability/sentry', () => ({ flushObservabilidad: vi.fn(async () => {}) }));

const pendientes: Array<() => unknown> = [];
vi.mock('next/server', async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return { ...real, after: (fn: () => unknown) => { pendientes.push(fn); } };
});

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

// El teléfono cambia entre pruebas: el rate limit en memoria es por teléfono.
const payload = (from: string, mensaje: Record<string, unknown>) => JSON.stringify({
  object: 'whatsapp_business_account',
  entry: [{ id: '1395114249160000', changes: [{ field: 'messages', value: {
    messaging_product: 'whatsapp',
    messages: [{ from, ...mensaje }],
  } }] }],
});

beforeEach(() => {
  processInbound.mockReset(); processInbound.mockImplementation(async () => {});
  pendientes.length = 0;
});

describe('el caption de la imagen viaja como text', () => {
  it('la foto CON caption llega con su rótulo', async () => {
    const c = payload('5219991110001', {
      id: 'wamid.CAP1', type: 'image', image: { id: 'media-9', caption: 'carta porte sellada' },
    });
    expect((await postear(c)).status).toBe(200);
    expect(processInbound).toHaveBeenCalledWith(expect.objectContaining({
      type: 'image', mediaId: 'media-9', text: 'carta porte sellada',
    }));
  });

  it('la foto SIN caption llega sin text — el camino de comprobante de siempre', async () => {
    const c = payload('5219991110002', {
      id: 'wamid.CAP2', type: 'image', image: { id: 'media-9' },
    });
    expect((await postear(c)).status).toBe(200);
    const msg = processInbound.mock.calls[0][0] as { text?: string };
    expect(msg.text).toBeUndefined();
  });

  it('el caption vacío tampoco se distingue de ninguno', async () => {
    const c = payload('5219991110003', {
      id: 'wamid.CAP3', type: 'image', image: { id: 'media-9', caption: '' },
    });
    expect((await postear(c)).status).toBe(200);
    const msg = processInbound.mock.calls[0][0] as { text?: string };
    expect(msg.text).toBeUndefined();
  });
});
