// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 5 · CRÍTICO — `src/app/` entero no tenía una sola prueba.
//
// Cuatro mutaciones, cuatro veces 628 verde. Dos son de esta ruta:
//
//   M17 · `route.ts:45` — la ruta deja de validar la firma HMAC
//         (`if (false && !verifySignature(...))`). Cualquiera que conozca la URL
//         inyecta mensajes como si fueran de Meta: gastos falsos, cierres de
//         liquidación, consumo de OCR contra el tenant del demo.
//   M18 · `route.ts:106` — `extractMessages` descarta TODAS las fotos entrantes.
//         Ningún gasto vuelve a entrar al sistema jamás, y el webhook sigue
//         devolviendo 200. Es el producto entero apagado en silencio.
//
// "Ningún test importa nada de `src/app/**`" (verificado por el auditor con dos
// búsquedas). La causa raíz declarada: "decisión implícita de que las rutas son
// pegamento". El pegamento aquí lleva HMAC, filtro por tenant, rate limit y el
// parseo del que depende que una foto llegue al motor.
//
// Aquí se ejercita el POST REAL con `verifySignature` REAL —solo se sustituyen
// el procesador (para no tocar red ni base) y `after()`, que fuera de una
// petición de Next lanza—. `acuses.test.ts`, del mismo hallazgo, cubre los acuses
// de entrega y por eso mockea la firma; esta cubre justo lo que aquella no.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';

const SECRETO = 'app-secret-de-prueba';
process.env.WHATSAPP_APP_SECRET = SECRETO;

const processInbound = vi.fn(async () => {});
vi.mock('@/lib/likida/processor', () => ({ processInbound }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

// AUDITORÍA 6 · operabilidad — el flush de Sentry existía, con ocho pruebas
// unitarias, y el único `after()` del repo no lo llamaba. Se espía aquí porque
// el defecto no estaba en la función: estaba en el cable.
const flushObservabilidad = vi.fn(async () => {});
vi.mock('@/lib/observability/sentry', () => ({ flushObservabilidad }));

// `after()` fuera de una petición de Next lanza ("called outside a request
// scope"). Se recogen las tareas y se corren a mano: así se puede AFIRMAR qué
// llegó al procesador, que es lo que M18 rompe.
const pendientes: Array<() => unknown> = [];
vi.mock('next/server', async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return { ...real, after: (fn: () => unknown) => { pendientes.push(fn); } };
});

const { POST } = await import('./route');

const firmar = (body: string, secreto = SECRETO) =>
  'sha256=' + crypto.createHmac('sha256', secreto).update(body).digest('hex');

/** Un POST a la ruta. `firma` a `null` = sin cabecera de firma. */
async function postear(body: string, firma: string | null) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (firma !== null) headers['x-hub-signature-256'] = firma;
  const res = await POST(new Request('https://likidaai.vercel.app/api/webhook/whatsapp', {
    method: 'POST', headers, body,
  }) as never);
  // Se drenan las tareas de `after()` para poder mirar qué se procesó.
  while (pendientes.length) await pendientes.shift()!();
  return res;
}

/**
 * Un payload de Meta con un mensaje. El TELÉFONO se pasa siempre distinto entre
 * pruebas: el rate limit vive en memoria del módulo y es por teléfono, así que
 * reusar el mismo número acopla las pruebas entre sí.
 */
const payload = (from: string, mensaje: Record<string, unknown>) => JSON.stringify({
  object: 'whatsapp_business_account',
  entry: [{ id: '1395114249160000', changes: [{ field: 'messages', value: {
    messaging_product: 'whatsapp',
    messages: [{ from, ...mensaje }],
  } }] }],
});

beforeEach(() => {
  processInbound.mockReset(); processInbound.mockImplementation(async () => {});
  flushObservabilidad.mockReset(); flushObservabilidad.mockImplementation(async () => {});
  pendientes.length = 0;
});

// ═══ M17 — la firma ═══════════════════════════════════════════════════════
describe('el webhook exige la firma de Meta', () => {
  const cuerpo = payload('5219990000001', { id: 'wamid.A', type: 'text', text: { body: 'hola' } });

  it('un cuerpo SIN firma no pasa: 401 y nada se procesa (M17)', async () => {
    const res = await postear(cuerpo, null);
    expect(res.status).toBe(401);
    expect(processInbound).not.toHaveBeenCalled();
  });

  it('una firma inventada no pasa', async () => {
    const res = await postear(cuerpo, 'sha256=' + '0'.repeat(64));
    expect(res.status).toBe(401);
    expect(processInbound).not.toHaveBeenCalled();
  });

  it('una firma de OTRO secreto no pasa', async () => {
    const res = await postear(cuerpo, firmar(cuerpo, 'secreto-del-atacante'));
    expect(res.status).toBe(401);
    expect(processInbound).not.toHaveBeenCalled();
  });

  // La propiedad de fondo: la firma ata el CUERPO. Sin esto, capturar una firma
  // legítima y editar el payload bastaría para inyectar gastos.
  it('una firma legítima reusada sobre OTRO cuerpo no pasa', async () => {
    const firmaLegitima = firmar(cuerpo);
    const editado = payload('5219990000002', { id: 'wamid.B', type: 'text', text: { body: 'ya cerré el viaje' } });
    const res = await postear(editado, firmaLegitima);
    expect(res.status).toBe(401);
    expect(processInbound).not.toHaveBeenCalled();
  });

  // CONTROL. Sin esta prueba, "arreglar" la ruta devolviendo 401 siempre dejaría
  // las cuatro de arriba verdes y el producto muerto.
  it('con la firma correcta SÍ pasa (si no, lo de arriba no prueba nada)', async () => {
    const c = payload('5219990000003', { id: 'wamid.C', type: 'text', text: { body: 'hola' } });
    const res = await postear(c, firmar(c));
    expect(res.status).toBe(200);
    expect(processInbound).toHaveBeenCalledTimes(1);
  });
});

// ═══ M18 — que la foto llegue ═════════════════════════════════════════════
describe('el webhook entrega al procesador lo que Meta manda', () => {
  it('una FOTO llega como image con su mediaId (M18: descartar todas las fotos)', async () => {
    const c = payload('5219990000010', { id: 'wamid.F1', type: 'image', image: { id: 'MEDIA-777' } });
    const res = await postear(c, firmar(c));
    expect(res.status).toBe(200);
    expect(processInbound).toHaveBeenCalledWith({
      from: '5219990000010', waMessageId: 'wamid.F1', type: 'image', mediaId: 'MEDIA-777',
    });
  });

  it('la RÁFAGA de fotos de un mismo POST llega completa, no solo la primera', async () => {
    // Meta entrega varios mensajes en UN POST. Perder las de en medio es perder
    // gastos, y el 200 no lo delata.
    const c = JSON.stringify({
      entry: [{ changes: [{ value: { messages: [
        { from: '5219990000011', id: 'w1', type: 'image', image: { id: 'M1' } },
        { from: '5219990000011', id: 'w2', type: 'image', image: { id: 'M2' } },
        { from: '5219990000011', id: 'w3', type: 'image', image: { id: 'M3' } },
      ] } }] }],
    });
    const res = await postear(c, firmar(c));
    await expect(res.json()).resolves.toMatchObject({ received: 3 });
    expect(processInbound).toHaveBeenCalledTimes(3);
    expect(processInbound.mock.calls.map((c2) => (c2 as unknown as [{ mediaId: string }])[0].mediaId))
      .toEqual(['M1', 'M2', 'M3']);
  });

  it('el XML del CFDI llega como document con su mediaId', async () => {
    const c = payload('5219990000012', { id: 'wamid.D1', type: 'document', document: { id: 'MEDIA-XML' } });
    await postear(c, firmar(c));
    expect(processInbound).toHaveBeenCalledWith({
      from: '5219990000012', waMessageId: 'wamid.D1', type: 'document', mediaId: 'MEDIA-XML',
    });
  });

  it('el texto llega como text con su cuerpo', async () => {
    const c = payload('5219990000013', { id: 'wamid.T1', type: 'text', text: { body: 'ya no tengo más tickets' } });
    await postear(c, firmar(c));
    expect(processInbound).toHaveBeenCalledWith({
      from: '5219990000013', waMessageId: 'wamid.T1', type: 'text', text: 'ya no tengo más tickets',
    });
  });

  it('un tipo que no manejamos (audio) llega como other, no se pierde', async () => {
    // Se procesa igual para poder contestarle al operador "mándamelo en foto".
    const c = payload('5219990000014', { id: 'wamid.A1', type: 'audio', audio: { id: 'MEDIA-AUD' } });
    await postear(c, firmar(c));
    expect(processInbound).toHaveBeenCalledWith({
      from: '5219990000014', waMessageId: 'wamid.A1', type: 'other',
    });
  });

  it('un JSON roto con firma válida devuelve 400, no revienta', async () => {
    const c = '{ esto no es json';
    const res = await postear(c, firmar(c));
    expect(res.status).toBe(400);
    expect(processInbound).not.toHaveBeenCalled();
  });
});

// ── AUDITORÍA 6 · CRÍTICO de operabilidad: el mecanismo sin cable ───────────
//
// `flushObservabilidad` se escribió para sobrevivir al congelamiento de la
// invocación en Vercel, con un comentario que nombra `after()` explícitamente y
// ocho pruebas unitarias. El único `after()` del repo no la llamaba.
//
// Es el mismo modo de falla que `sondearAvisoIntegral` en el rubro legal, y la
// razón por la que la ronda 6 bajó notas aunque los 55 arreglos del día
// anterior fueran correctos por separado: siete agentes en paralelo, cada uno
// cerrando su hallazgo dentro de su territorio, y el cable vive en el de otro.
//
// Por eso esta prueba mira el CABLE, no la función.
describe('la telemetría se vacía antes de que Vercel congele la invocación', () => {
  it('el after() del webhook llama al flush', async () => {
    const c = payload('5219990000020', { id: 'wamid.FL1', type: 'text', text: { body: 'hola' } });
    await postear(c, firmar(c));
    expect(flushObservabilidad).toHaveBeenCalled();
  });

  it('y lo hace DESPUÉS de procesar, no antes', async () => {
    // Vaciar antes de procesar no serviría de nada: los eventos que importan
    // —`agent.fail`, `processInbound.fail`, `pdf.no_entregado`— los produce
    // `processInbound`, así que el flush tiene que verlos ya encolados.
    const orden: string[] = [];
    processInbound.mockImplementation(async () => { orden.push('procesa'); });
    flushObservabilidad.mockImplementation(async () => { orden.push('flush'); });
    const c = payload('5219990000021', { id: 'wamid.FL2', type: 'text', text: { body: 'hola' } });
    await postear(c, firmar(c));
    expect(orden).toEqual(['procesa', 'flush']);
  });

  it('un fallo del procesador no impide vaciar la telemetría de ese fallo', async () => {
    processInbound.mockImplementation(async () => { throw new Error('boom'); });
    const c = payload('5219990000022', { id: 'wamid.FL3', type: 'text', text: { body: 'hola' } });
    await postear(c, firmar(c));
    expect(flushObservabilidad).toHaveBeenCalled();
  });
});
