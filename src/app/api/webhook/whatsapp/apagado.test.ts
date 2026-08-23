/**
 * EL BOTÓN DE PÁNICO TIENE QUE APAGAR EL CAMINO DEL CLIENTE, NO SOLO LOS CRONS.
 *
 * `interruptor` (mig. 0110) se construyó para que Javier detenga a los agentes
 * cuando algo va mal. Al revisar el blueprint de construcción (15-ago-2026) se
 * verificó por grep que `estaApagado` tenía SIETE puntos de llamada y los siete
 * vivían en `api/cron/*`: apagar `global` paraba la escalación, la purga y la
 * facturación, y un chofer real le seguía escribiendo al bot, que le seguía
 * contestando y gastando IA.
 *
 * Era el camino que MÁS importa apagar: el único por el que un cliente toca el
 * producto. Estas pruebas existen para que no vuelva a quedarse fuera — y en
 * particular la tercera, que es la que se rompe si alguien "optimiza" poniendo
 * la consulta del interruptor dentro del pool en vez de antes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';

const SECRETO = 'app-secret-de-prueba';
process.env.WHATSAPP_APP_SECRET = SECRETO;

const processInbound = vi.fn(async () => {});
vi.mock('@/lib/likida/processor', () => ({ processInbound }));

const warn = vi.fn();
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn, error: vi.fn() } }));

const flushObservabilidad = vi.fn(async () => {});
vi.mock('@/lib/observability/sentry', () => ({ flushObservabilidad }));

const estaApagado = vi.fn(async () => false);
vi.mock('@/lib/likida/interruptores', () => ({ estaApagado }));

// La bandeja durable (0119, P1 de la auditoría externa): apagado ya no
// descarta — guarda. El doble registra QUÉ se guardó para poder afirmarlo.
const guardados: Array<Record<string, unknown>> = [];
const guardarEventosPendientes = vi.fn(async (ms: Array<Record<string, unknown>>) => {
  guardados.push(...ms);
  return {
    guardados: ms.length, fallidos: 0,
    filas: ms.map((m, i) => ({ id: (m.waMessageId as string) ?? `f-${i}`, evento: m, guardado: true })),
  };
});
vi.mock('@/lib/likida/wa_pendientes', () => ({
  // DAT-34: la deduplicación previa al rate limit. Vacío = ninguno de estos
  // wamids estaba ya en la bandeja, que es el caso de una entrega normal.
  pendientesYaConocidos: async () => new Set<string>(),
  guardarEventosPendientes: (...a: unknown[]) => guardarEventosPendientes(...(a as [never])),
  // El inbox general: el flujo normal reclama la fila para procesarla.
  reclamarPendiente: async (id: string) => {
    const m = guardados.find((x, i) => ((x.waMessageId as string) ?? `f-${i}`) === id);
    return m ? { id, evento: m, intentos: 1 } : null;
  },
  marcarPendienteProcesado: async () => undefined,
  anotarFalloPendiente: async () => undefined,
}));

// `after()` fuera de una petición de Next lanza; se recogen las tareas y se
// corren a mano para poder AFIRMAR qué llegó (o no) al procesador.
const pendientes: Array<() => unknown> = [];
vi.mock('next/server', async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return { ...real, after: (fn: () => unknown) => { pendientes.push(fn); } };
});

const { POST } = await import('./route');

const firmar = (body: string) =>
  'sha256=' + crypto.createHmac('sha256', SECRETO).update(body).digest('hex');

/** El teléfono va distinto en cada prueba: el rate limit es por número y vive
 *  en memoria del módulo, así que reusarlo acopla las pruebas entre sí. */
const payload = (from: string, mensajes: Array<Record<string, unknown>>) => JSON.stringify({
  object: 'whatsapp_business_account',
  entry: [{ id: '1395114249160000', changes: [{ field: 'messages', value: {
    messaging_product: 'whatsapp',
    messages: mensajes.map((m) => ({ from, ...m })),
  } }] }],
});

async function postear(cuerpo: string) {
  const res = await POST(new Request('https://app.likida.ai/api/webhook/whatsapp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-hub-signature-256': firmar(cuerpo) },
    body: cuerpo,
  }) as never);
  while (pendientes.length) await pendientes.shift()!();
  return res;
}

beforeEach(() => {
  processInbound.mockReset(); processInbound.mockImplementation(async () => {});
  flushObservabilidad.mockReset(); flushObservabilidad.mockImplementation(async () => {});
  estaApagado.mockReset(); estaApagado.mockImplementation(async () => false);
  warn.mockReset();
  guardarEventosPendientes.mockClear();
  guardados.length = 0;
  pendientes.length = 0;
});

describe('el interruptor global apaga el WhatsApp entrante', () => {
  it('con el sistema ENCENDIDO, el mensaje llega al procesador', async () => {
    const cuerpo = payload('5219990001001', [{ id: 'wamid.ON', type: 'text', text: { body: 'hola' } }]);
    await postear(cuerpo);
    expect(processInbound).toHaveBeenCalledTimes(1);
  });

  it('con el sistema APAGADO, NINGÚN mensaje llega al procesador — y TODOS quedan GUARDADOS', async () => {
    estaApagado.mockImplementation(async () => true);
    const cuerpo = payload('5219990001002', [{ id: 'wamid.OFF', type: 'text', text: { body: 'hola' } }]);
    const res = await postear(cuerpo);

    expect(processInbound).not.toHaveBeenCalled();
    // A Meta se le sigue contestando 200 — y desde la 0119 ese 200 es VERDAD:
    // el mensaje quedó persistido en wa_evento_pendiente (P1 de la auditoría
    // externa: antes se acusaba y se tiraba, porque Meta no reintenta lo
    // acusado). El cron wa-pendientes lo procesa al subir la palanca.
    expect(res.status).toBe(200);
    expect(guardarEventosPendientes).toHaveBeenCalledTimes(1);
    expect(guardados.map((g) => g.waMessageId)).toEqual(['wamid.OFF']);
  });

  it('apagado, una RÁFAGA entera queda guardada — ningún mensaje se descarta', async () => {
    estaApagado.mockImplementation(async () => true);
    const cuerpo = payload('5219990001007', [
      { id: 'wamid.G1', type: 'image', image: { id: 'media-1' } },
      { id: 'wamid.G2', type: 'image', image: { id: 'media-2' } },
    ]);
    await postear(cuerpo);
    expect(processInbound).not.toHaveBeenCalled();
    expect(guardados.map((g) => g.waMessageId)).toEqual(['wamid.G1', 'wamid.G2']);
  });

  it('ENCENDIDO, se persiste ANTES del 200 (inbox general) Y se procesa', async () => {
    await postear(payload('5219990001008', [{ id: 'wamid.VIVO', type: 'text', text: { body: 'x' } }]));
    expect(processInbound).toHaveBeenCalledTimes(1);
    // Inbox durable GENERAL (16-ago-2026): también con la palanca ARRIBA se
    // persiste ANTES del 200 — el 200 significa "recibido y guardado".
    expect(guardarEventosPendientes).toHaveBeenCalledTimes(1);
  });

  it('apagado, NI SIQUIERA el primero de una ráfaga se procesa', async () => {
    // Esta es la que importa. Si alguien mueve la consulta del interruptor
    // DENTRO del pool —o la pone por mensaje en vez de antes del lote— el caso
    // de un solo mensaje sigue pasando y éste no: el primero se colaría antes
    // de que la comprobación corriera.
    estaApagado.mockImplementation(async () => true);
    const cuerpo = payload('5219990001003', [
      { id: 'wamid.R1', type: 'image', image: { id: 'media-1' } },
      { id: 'wamid.R2', type: 'image', image: { id: 'media-2' } },
      { id: 'wamid.R3', type: 'image', image: { id: 'media-3' } },
    ]);
    await postear(cuerpo);
    expect(processInbound).not.toHaveBeenCalled();
  });

  it('apagado, deja rastro con los ids para poder cruzarlos después', async () => {
    // El mensaje no se pierde —Meta reintenta lo que no confirmamos— pero el
    // log es lo único que dice QUÉ entró mientras estaba apagado.
    estaApagado.mockImplementation(async () => true);
    const cuerpo = payload('5219990001004', [{ id: 'wamid.LOG', type: 'text', text: { body: 'x' } }]);
    await postear(cuerpo);

    const linea = warn.mock.calls.find(([evento]) => evento === 'wa.entrante_apagado');
    expect(linea, 'debe registrarse wa.entrante_apagado').toBeTruthy();
    expect(linea![1].ids).toContain('wamid.LOG');
  });

  it('apagado, el flush de observabilidad SÍ corre', async () => {
    // Vercel congela la invocación en cuanto la promesa de `after()` termina.
    // Sin el flush, el propio `wa.entrante_apagado` se queda dentro y nunca
    // sale — o sea que el rastro del punto anterior no existiría.
    estaApagado.mockImplementation(async () => true);
    await postear(payload('5219990001005', [{ id: 'wamid.F', type: 'text', text: { body: 'x' } }]));
    expect(flushObservabilidad).toHaveBeenCalled();
  });

  it('se consulta el interruptor GLOBAL, no otro', async () => {
    await postear(payload('5219990001006', [{ id: 'wamid.G', type: 'text', text: { body: 'x' } }]));
    expect(estaApagado).toHaveBeenCalledWith('global');
  });

  it('si NI GUARDAR se pudo, se contesta 503 — jamás un 200 mentiroso (la cola durable es la de Meta)', async () => {
    guardarEventosPendientes.mockResolvedValueOnce({
      guardados: 0, fallidos: 1,
      filas: [{ id: 'wamid.H', evento: {}, guardado: false }],
    });
    const res = await postear(payload('5219990001007', [{ id: 'wamid.H', type: 'text', text: { body: 'x' } }]));
    expect(res.status).toBe(503);
    expect(processInbound).not.toHaveBeenCalled();
  });
});
