// ═══════════════════════════════════════════════════════════════════════════
// EL BOTÓN DE UNA PLANTILLA — la respuesta rápida que llega fuera de la ventana
// de 24 h.
//
// Cuando Likida INICIA la conversación con una plantilla (la liquidación
// externa, 0370), el chofer contesta apretando un botón de RESPUESTA RÁPIDA, y
// Meta lo entrega como `type: 'button'` —no `interactive`— con el `payload` que
// pusimos al enviar la plantilla. Hasta ahora ese tipo caía en `other`: el chofer
// apretaba «Recibida» y nadie contestaba nunca.
//
// Entra como TEXTO con el payload por cuerpo, igual que el `button_reply` de
// sesión (`boton_apretado.test.ts`): el payload es el dato —lo elegimos
// nosotros—, `text` es el rótulo que vio el chofer y no se usa.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';

const SECRETO = 'app-secret-de-prueba';
process.env.WHATSAPP_APP_SECRET = SECRETO;

const processInbound = vi.fn(async () => {});
// Solo el mensaje: el segundo argumento de `processInbound` es el reloj de la
// invocación (auditoría 18, C4) y lo prueba `route_pospuesto.test.ts`; aquí se
// afirma QUÉ mensaje llega, no cuándo arrancó la invocación.
vi.mock('@/lib/likida/processor', () => ({ processInbound: (m: unknown) => (processInbound as (m: unknown) => Promise<void>)(m) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/observability/sentry', () => ({ flushObservabilidad: vi.fn(async () => {}) }));

// El webhook consulta el interruptor global antes de despachar (mig. 0110,
// cableado el 15-ago-2026). Sin este mock corre el real, que falla CERRADO
// —una base ilegible cuenta como apagado— y estas pruebas verían cero
// mensajes procesados por una razón que no es la que están midiendo.
// AUDITORÍA 24 · AGEN-7: la ruta lee `leerInterruptor` (distingue «apagado»
// de «no pude leer la palanca»); `estaApagado` se conserva para el resto.
vi.mock('@/lib/likida/interruptores', () => ({
  estaApagado: vi.fn(async () => false),
  leerInterruptor: vi.fn(async () => 'encendido' as const),
}));

// `after()` fuera de una petición de Next lanza. Se recogen las tareas y se
// corren a mano para poder AFIRMAR qué llegó al procesador.
const pendientes: Array<() => unknown> = [];
vi.mock('next/server', async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return { ...real, after: (fn: () => unknown) => { pendientes.push(fn); } };
});


// El inbox durable GENERAL (16-ago-2026): todo permitido se persiste antes
// del 200 y se procesa reclamando su fila — el doble minimo que deja pasar
// el flujo feliz sin base real.
const { bandejaInbox } = vi.hoisted(() => ({ bandejaInbox: new Map<string, unknown>() }));
vi.mock('@/lib/likida/wa_pendientes', () => ({
  // DAT-34: la deduplicación previa al rate limit. Vacío = ninguno de estos
  // wamids estaba ya en la bandeja, que es el caso de una entrega normal.
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

const firmar = (body: string) => 'sha256=' + crypto.createHmac('sha256', SECRETO).update(body).digest('hex');

async function postear(body: string) {
  const res = await POST(new Request('https://app.likida.ai/api/webhook/whatsapp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-hub-signature-256': firmar(body) },
    body,
  }) as never);
  while (pendientes.length) await pendientes.shift()!();
  return res;
}


const payloadBoton = (from: string, waMessageId: string, button: Record<string, unknown> | undefined) =>
  JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [{
      id: '1395114249160000',
      changes: [{
        field: 'messages',
        value: {
          messaging_product: 'whatsapp',
          metadata: { display_phone_number: '5215500000000', phone_number_id: '123456789' },
          contacts: [{ profile: { name: 'Pablo Morales' }, wa_id: from }],
          messages: [{
            from, id: waMessageId, timestamp: '1714510003', type: 'button',
            // El `context` que Meta agrega a la respuesta a una plantilla: no se usa.
            context: { from: '5215500000000', id: 'wamid.PLANTILLA' },
            ...(button ? { button } : {}),
          }],
        },
      }],
    }],
  });

const LIQ = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

beforeEach(() => {
  processInbound.mockReset(); processInbound.mockImplementation(async () => {});
  pendientes.length = 0;
});

describe('un botón de plantilla llega al procesador como texto con su payload', () => {
  it('el payload es el text que recibe el procesador', async () => {
    const res = await postear(payloadBoton('5219990002001', 'wamid.TPL1', { payload: `liqext_ok:${LIQ}`, text: 'Recibida' }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ received: 1 });
    expect(processInbound).toHaveBeenCalledWith({
      from: '5219990002001', waMessageId: 'wamid.TPL1', timestampMs: 1714510003000, type: 'text', text: `liqext_ok:${LIQ}`,
    });
  });

  it('es el payload, NO el rótulo (`text`) lo que viaja: decidir por la copy sería decidir por lo que el chofer VE', async () => {
    await postear(payloadBoton('5219990002002', 'wamid.TPL2', { payload: `liqext_no:${LIQ}`, text: 'No coincide' }));
    const [msg] = processInbound.mock.calls[0] as unknown as [{ text: string }];
    expect(msg.text).toBe(`liqext_no:${LIQ}`);
    expect(msg.text).not.toBe('No coincide');
  });

  it('conserva el waMessageId (de ahí cuelga la idempotencia del procesador)', async () => {
    await postear(payloadBoton('5219990002003', 'wamid.TPL3', { payload: `liqext_ok:${LIQ}`, text: 'Recibida' }));
    const [msg] = processInbound.mock.calls[0] as unknown as [{ waMessageId: string }];
    expect(msg.waMessageId).toBe('wamid.TPL3');
  });

  it('sin firma válida el botón tampoco entra', async () => {
    const res = await POST(new Request('https://app.likida.ai/api/webhook/whatsapp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=' + '0'.repeat(64) },
      body: payloadBoton('5219990002004', 'wamid.TPL4', { payload: `liqext_ok:${LIQ}`, text: 'Recibida' }),
    }) as never);
    expect(res.status).toBe(401);
    expect(processInbound).not.toHaveBeenCalled();
  });
});

describe('lo que NO es una respuesta no se traga como si lo fuera', () => {
  it('un botón sin payload entra como other (no es una respuesta: un texto vacío llegaría como mensaje en blanco)', async () => {
    await postear(payloadBoton('5219990002010', 'wamid.TPL10', { text: 'Recibida' }));
    const [msg] = processInbound.mock.calls[0] as unknown as [{ type: string; text?: string }];
    expect(msg.type).toBe('other');
    expect(msg.text).toBeUndefined();
  });

  it('un botón con payload vacío entra como other', async () => {
    await postear(payloadBoton('5219990002011', 'wamid.TPL11', { payload: '', text: 'Recibida' }));
    const [msg] = processInbound.mock.calls[0] as unknown as [{ type: string }];
    expect(msg.type).toBe('other');
  });

  it('un mensaje type:button sin objeto button no revienta el parseo', async () => {
    await postear(payloadBoton('5219990002012', 'wamid.TPL12', undefined));
    const [msg] = processInbound.mock.calls[0] as unknown as [{ type: string }];
    expect(msg.type).toBe('other');
  });

  it('el botón de plantilla no pisa al button_reply de sesión: cada uno por su camino', async () => {
    const cuerpo = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [{ id: '1395114249160000', changes: [{ field: 'messages', value: {
        messaging_product: 'whatsapp',
        messages: [
          { from: '5219990002020', id: 'w1', timestamp: '1714510003', type: 'button', button: { payload: `liqext_ok:${LIQ}`, text: 'Recibida' } },
          { from: '5219990002020', id: 'w2', timestamp: '1714510004', type: 'interactive',
            interactive: { type: 'button_reply', button_reply: { id: `liqext_no:${LIQ}`, title: 'No coincide' } } },
        ],
      } }] }],
    });
    const res = await postear(cuerpo);
    await expect(res.json()).resolves.toMatchObject({ received: 2 });
    expect((processInbound.mock.calls[0] as unknown as [{ text: string }])[0].text).toBe(`liqext_ok:${LIQ}`);
    expect((processInbound.mock.calls[1] as unknown as [{ text: string }])[0].text).toBe(`liqext_no:${LIQ}`);
  });
});
