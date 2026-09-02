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

// AUDITORÍA 24 · AGEN-7: la ruta lee `leerInterruptor` y no `estaApagado`,
// porque «apagado» y «no pude leer la palanca» merecen respuestas distintas:
// solo el primero es mantenimiento del que se puede avisar; el segundo es el
// fail-closed de un parpadeo de la base de cinco segundos.
const leerInterruptor = vi.fn(async () => 'encendido' as 'encendido' | 'apagado' | 'ilegible');
const estaApagado = vi.fn(async () => (await leerInterruptor()) !== 'encendido');
vi.mock('@/lib/likida/interruptores', () => ({ estaApagado, leerInterruptor }));

// El aviso de mantenimiento es el único envío que sale de esta ruta.
const salientes: Array<{ to: string; texto: string }> = [];
const sendText = vi.fn(async (to: string, texto: string) => { salientes.push({ to, texto }); return 'wamid.OUT'; });
vi.mock('@/lib/meta/client', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  sendText: (...a: unknown[]) => sendText(...(a as [string, string])),
}));

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
const { olvidarAvisosDeApagado } = await import('./avisos_apagado');

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
  leerInterruptor.mockReset(); leerInterruptor.mockImplementation(async () => 'encendido');
  estaApagado.mockReset(); estaApagado.mockImplementation(async () => false);
  sendText.mockClear(); salientes.length = 0;
  olvidarAvisosDeApagado();
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
    leerInterruptor.mockImplementation(async () => 'apagado');
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
    leerInterruptor.mockImplementation(async () => 'apagado');
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
    leerInterruptor.mockImplementation(async () => 'apagado');
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
    leerInterruptor.mockImplementation(async () => 'apagado');
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
    leerInterruptor.mockImplementation(async () => 'apagado');
    await postear(payload('5219990001005', [{ id: 'wamid.F', type: 'text', text: { body: 'x' } }]));
    expect(flushObservabilidad).toHaveBeenCalled();
  });

  it('se consulta el interruptor GLOBAL, no otro', async () => {
    await postear(payload('5219990001006', [{ id: 'wamid.G', type: 'text', text: { body: 'x' } }]));
    expect(leerInterruptor).toHaveBeenCalledWith('global');
  });

  // ── AUDITORÍA 24 · AGEN-7 (MEDIO): APAGADO NO PUEDE SER MUDO ────────────
  //
  // El interruptor cortaba y conservaba, pero no hablaba: el chofer mandaba
  // cinco fotos y un «listo» a las 11:20, recibía la palomita y NADA durante
  // las tres horas del apagado. Para él el sistema no está apagado: está
  // roto, y llama a la oficina — que tampoco sabe.
  it('apagado: se le dice UNA vez que estamos en mantenimiento y que quedó guardado', async () => {
    leerInterruptor.mockImplementation(async () => 'apagado');
    await postear(payload('5219990002001', [{ id: 'wamid.M1', type: 'text', text: { body: 'listo' } }]));

    expect(salientes).toHaveLength(1);
    expect(salientes[0].to).toBe('5219990002001');
    expect(salientes[0].texto).toMatch(/mantenimiento/i);
    expect(salientes[0].texto, 'lo que de verdad pasa con su mensaje').toMatch(/queda guardado/i);
    expect(processInbound, 'avisar no es procesar').not.toHaveBeenCalled();
  });

  it('una ráfaga de cinco fotos es UN aviso, no cinco', async () => {
    leerInterruptor.mockImplementation(async () => 'apagado');
    await postear(payload('5219990002002', [1, 2, 3, 4, 5].map((i) => ({
      id: `wamid.R${i}`, type: 'image', image: { id: `media-${i}` },
    }))));
    expect(salientes).toHaveLength(1);
  });

  it('y el segundo POST del mismo número tampoco lo repite', async () => {
    leerInterruptor.mockImplementation(async () => 'apagado');
    await postear(payload('5219990002003', [{ id: 'wamid.A1', type: 'text', text: { body: 'hola' } }]));
    await postear(payload('5219990002003', [{ id: 'wamid.A2', type: 'text', text: { body: 'listo' } }]));
    expect(salientes).toHaveLength(1);
  });

  it('ILEGIBLE (el fail-closed de un blip de la base) NO anuncia mantenimiento', async () => {
    // Un parpadeo de cinco segundos de Supabase deja la palanca ilegible y el
    // sistema para —bien—, pero decirle al chofer que hay mantenimiento sería
    // afirmar algo que nadie declaró.
    leerInterruptor.mockImplementation(async () => 'ilegible');
    await postear(payload('5219990002004', [{ id: 'wamid.B1', type: 'text', text: { body: 'x' } }]));
    expect(processInbound, 'seguir parado sí').not.toHaveBeenCalled();
    expect(salientes, 'pero callado').toHaveLength(0);
  });

  it('si el aviso no sale, el mensaje del chofer queda guardado igual', async () => {
    leerInterruptor.mockImplementation(async () => 'apagado');
    sendText.mockRejectedValueOnce(new Error('Meta caída'));
    const res = await postear(payload('5219990002005', [{ id: 'wamid.C1', type: 'text', text: { body: 'x' } }]));
    expect(res.status).toBe(200);
    expect(guardados.map((g) => g.waMessageId)).toContain('wamid.C1');
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
