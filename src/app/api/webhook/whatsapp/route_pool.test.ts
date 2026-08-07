// ═══════════════════════════════════════════════════════════════════════════
// CRÍTICO — NADA ACOTABA CUÁNTOS MENSAJES PROCESA UNA INVOCACIÓN.
//
// `Promise.all(permitidos.map(processInbound))`. Meta puede entregar la ráfaga
// entera en UN POST: un chofer fotografía sus ~22 tickets en la gasolinera y los
// manda de golpe. Las 22 arrancaban a la vez y se repartían los 120 s de UNA
// invocación, cada una pidiendo su tope de 25 s de OCR como si fuera suyo.
//
// Y cuando Vercel mata la invocación por tope, el final es el peor que tiene
// este producto: no sale nada, el `finally` del intake no corre (el `+1` de la
// barrera queda escrito), el claim de `wa_mensaje_procesado` queda tomado, y
// Meta —que ya recibió su 200— NO reintenta. Veintidós comprobantes perdidos sin
// una línea de log.
//
// Esta prueba mide la CONCURRENCIA REAL de la ruta: cuántos `processInbound` hay
// en vuelo a la vez. Se rompe quitando el pool (volviendo a `Promise.all`) y se
// pone roja al instante — verificado antes de dejarla.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';

const SECRETO = 'app-secret-de-prueba-pool';
process.env.WHATSAPP_APP_SECRET = SECRETO;

/** Cuántos `processInbound` corren a la vez, y el pico. */
let enVuelo = 0;
let pico = 0;
const atendidos: string[] = [];

const processInbound = vi.fn(async (m: { waMessageId?: string }) => {
  enVuelo += 1;
  pico = Math.max(pico, enVuelo);
  // Un tick real: sin esperar, cada llamada terminaría antes de que arranque la
  // siguiente y el pico sería 1 con o sin pool — la prueba no mediría nada.
  await new Promise((r) => setTimeout(r, 5));
  atendidos.push(m.waMessageId ?? '?');
  enVuelo -= 1;
});

vi.mock('@/lib/likida/processor', () => ({ processInbound: (m: unknown) => processInbound(m as { waMessageId?: string }) }));

/** Lo que la ruta le manda al operador. `verifySignature` se deja REAL. */
const enviados: Array<{ to: string; texto: string }> = [];
vi.mock('@/lib/meta/client', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  sendText: vi.fn(async (to: string, texto: string) => { enviados.push({ to, texto }); return 'wamid.x'; }),
}));

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
vi.mock('@/lib/logger', () => ({ logger }));
vi.mock('@/lib/observability/sentry', () => ({ flushObservabilidad: vi.fn(async () => {}) }));

const pendientes: Array<() => unknown> = [];
vi.mock('next/server', async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return { ...real, after: (fn: () => unknown) => { pendientes.push(fn); } };
});

const { POST } = await import('./route');

const firmar = (body: string) =>
  'sha256=' + crypto.createHmac('sha256', SECRETO).update(body).digest('hex');

/** Una ráfaga de `n` fotos del MISMO teléfono, como las entrega Meta. */
function rafaga(n: number, telefono: string) {
  return JSON.stringify({
    entry: [{
      changes: [{
        value: {
          messages: Array.from({ length: n }, (_, i) => ({
            id: `wamid.${telefono}.${i}`, from: telefono, type: 'image', image: { id: `media${i}` },
          })),
        },
      }],
    }],
  });
}

async function postear(body: string) {
  const res = await POST(new Request('https://likida.ai/api/webhook/whatsapp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-hub-signature-256': firmar(body) },
    body,
  }) as never);
  while (pendientes.length) await pendientes.shift()!();
  return res;
}

beforeEach(() => {
  enVuelo = 0; pico = 0; atendidos.length = 0; enviados.length = 0;
  processInbound.mockClear();
  logger.info.mockClear(); logger.warn.mockClear(); logger.error.mockClear();
});

describe('la ráfaga de un POST se procesa con techo de concurrencia', () => {
  it('22 fotos en un POST NO arrancan 22 OCR a la vez', async () => {
    // El teléfono cambia por prueba: el rate limit vive en memoria del módulo.
    await postear(rafaga(22, '5219990001001'));
    expect(processInbound).toHaveBeenCalledTimes(22);
    expect(pico, `arrancaron ${pico} a la vez: el pool no está puesto`).toBeLessThanOrEqual(5);
  });

  it('y aun así se procesan TODAS: acotar no puede ser descartar', async () => {
    await postear(rafaga(22, '5219990001002'));
    expect(atendidos).toHaveLength(22);
    expect(new Set(atendidos).size).toBe(22);   // ninguna repetida, ninguna perdida
  });

  it('el pool se llena de verdad (no degrada a serie)', async () => {
    await postear(rafaga(22, '5219990001003'));
    // Con `await` por mensaje en vez de pool, el pico sería 1 y la ráfaga
    // tardaría 22 turnos en vez de 5 — el remedio peor que la enfermedad.
    expect(pico, 'se procesó en serie: 22 fotos no caben en el presupuesto').toBeGreaterThan(1);
  });

  it('un mensaje que revienta no cancela a los demás', async () => {
    processInbound.mockImplementationOnce(async () => { throw new Error('boom'); });
    await postear(rafaga(8, '5219990001004'));
    expect(processInbound).toHaveBeenCalledTimes(8);
    expect(atendidos).toHaveLength(7);   // el que reventó no llegó al final
  });

  it('un lote de 3 no espera turnos de más', async () => {
    await postear(rafaga(3, '5219990001005'));
    expect(pico).toBe(3);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// LO QUE PASA DEL TECHO SE APLAZA — NO SE DESCARTA (4-ago-2026).
//
// Estos mensajes YA pasaron el HMAC: son de Meta y de un chofer dado de alta.
// La ruta contestaba 200 y los tiraba, y un 200 le dice a Meta que quedaron
// entregados: cada exceso era un comprobante perdido para siempre. La cola que
// hacía falta no había que construirla — es la reentrega de Meta, y usarla solo
// pide no mentirle con un 200. Reentregar es seguro porque `claimMessage` ya
// deduplica por `waMessageId`.
// ═══════════════════════════════════════════════════════════════════════════
describe('el rate limit aplaza con 429 en vez de descartar con 200', () => {
  it('EL FALLO: un 200 le dice a Meta que no lo reintente — ahora contesta 429', async () => {
    // 41 en un POST contra un tope de 40/min: el último no cabe en esta
    // invocación, así que la respuesta entera pide reentrega.
    const res = await postear(rafaga(41, '5219990002001'));
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ received: 40, diferidos: 1 });
  });

  it('deja el waMessageId en el log: si Meta acaba rindiéndose, es el único rastro', async () => {
    await postear(rafaga(41, '5219990002002'));
    const aplazados = logger.warn.mock.calls.filter((c) => c[0] === 'wa.ratelimit_diferido');
    expect(aplazados).toHaveLength(1);
    expect(aplazados[0][1]).toMatchObject({ id: 'wamid.5219990002002.40', tipo: 'image' });
  });

  it('lo que SÍ cabía se procesa igual: el 429 no puede volverse un lote que nunca avanza', async () => {
    // Si se devolviera el lote entero sin tocar, un POST con más mensajes que
    // el techo volvería a excederlo en CADA reentrega, para siempre. Avanzando
    // lo que cabe, cada entrega deja menos por hacer.
    await postear(rafaga(45, '5219990002003'));
    expect(atendidos).toHaveLength(40);
  });

  it('y al operador ya no se le pide que reenvíe: sus fotos vuelven solas', async () => {
    // El aviso viejo describía una pérdida que ya no ocurre, y reenviar el fajo
    // es justo lo que vuelve a llenar la ventana del limitador.
    await postear(rafaga(45, '5219990002004'));
    expect(enviados).toHaveLength(0);
  });

  it('CONTROL — una ráfaga que cabe contesta 200 y no aplaza nada', async () => {
    const res = await postear(rafaga(22, '5219990002005'));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ received: 22 });
    expect(enviados).toHaveLength(0);
    expect(logger.warn).not.toHaveBeenCalledWith('wa.ratelimit_diferido', expect.anything());
  });
});
