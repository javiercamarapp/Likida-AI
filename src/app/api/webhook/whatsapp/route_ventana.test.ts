// ═══════════════════════════════════════════════════════════════════════════
// VENTANA DE 24 H + IDEMPOTENCIA DEL WEBHOOK (P0-B, mig. 0368).
//
// Cada mensaje entrante firmado registra la ventana del contacto con la hora de
// META; nada de eso puede cambiar el código de respuesta; y las reentregas, los
// duplicados dentro de un POST y los mensajes fuera de orden no procesan dos
// veces ni retroceden la ventana.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';

const SECRETO = 'app-secret-de-prueba-ventana';
process.env.WHATSAPP_APP_SECRET = SECRETO;

const processInbound = vi.fn(async (..._a: unknown[]): Promise<string> => 'procesado');
vi.mock('@/lib/likida/processor', () => ({ processInbound: (...a: unknown[]) => processInbound(...a) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/observability/sentry', () => ({ flushObservabilidad: vi.fn(async () => {}) }));
vi.mock('@/lib/likida/interruptores', () => ({
  estaApagado: vi.fn(async () => false),
  leerInterruptor: vi.fn(async () => 'encendido' as const),
}));

const registrar = vi.hoisted(() => vi.fn(async (..._a: unknown[]) => ({ registrados: 1, fallidos: 0 })));
vi.mock('@/lib/likida/wa_ventana', () => ({ registrarEntrantesWhatsApp: registrar }));

const pendientes: Array<() => unknown> = [];
vi.mock('next/server', async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return { ...real, after: (fn: () => unknown) => { pendientes.push(fn); } };
});

/** Bandeja durable con semántica real: PK por wamid (insert idempotente) y claim de una sola vez. */
const bandeja = new Map<string, { evento: unknown; reclamada: boolean }>();
let persistir = true;
vi.mock('@/lib/likida/wa_pendientes', () => ({
  pendientesYaConocidos: async (ids: string[]) => new Set(ids.filter((i) => bandeja.has(i))),
  guardarEventosPendientes: async (ms: Array<{ waMessageId?: string }>) => {
    if (!persistir) return { guardados: 0, fallidos: ms.length, filas: ms.map((m) => ({ id: m.waMessageId ?? '?', evento: m, guardado: false })) };
    const filas = ms.map((m, i) => {
      const id = m.waMessageId ?? `f-${i}`;
      if (!bandeja.has(id)) bandeja.set(id, { evento: m, reclamada: false });
      return { id, evento: m, guardado: true };
    });
    return { guardados: filas.length, fallidos: 0, filas };
  },
  reclamarPendiente: async (id: string) => {
    const f = bandeja.get(id);
    if (!f || f.reclamada) return null;
    f.reclamada = true;
    return { id, evento: f.evento, intentos: 1 };
  },
  marcarPendienteProcesado: async () => {},
  anotarFalloPendiente: async () => {},
  devolverIntentoPendiente: async () => {},
  iniciarRenovacionLease: () => () => {},
}));

const { POST } = await import('./route');
const firmar = (b: string) => 'sha256=' + crypto.createHmac('sha256', SECRETO).update(b).digest('hex');
type Msg = { id: string; from: string; timestamp?: string; type?: string; text?: { body: string } };
const lote = (msgs: Msg[]) => JSON.stringify({
  entry: [{ changes: [{ value: { messages: msgs.map((m) => ({ type: 'text', text: { body: 'hola' }, timestamp: '1759320000', ...m })) } }] }],
});
async function postear(body: string, firma = firmar(body)) {
  const res = await POST(new Request('https://likida.ai/api/webhook/whatsapp', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': firma }, body,
  }) as never);
  while (pendientes.length) await pendientes.shift()!();
  return res;
}
let seq = 0;
const tel = () => `5219990${String(++seq).padStart(6, '0')}`;

beforeEach(() => {
  vi.clearAllMocks(); bandeja.clear(); persistir = true; pendientes.length = 0;
  registrar.mockResolvedValue({ registrados: 1, fallidos: 0 });
});

describe('la ventana se registra con cada mensaje firmado', () => {
  it('manda a registrar los mensajes con su hora de Meta', async () => {
    const t = tel();
    const res = await postear(lote([{ id: 'wamid.v1', from: t, timestamp: '1759320000' }]));
    expect(res.status).toBe(200);
    expect(registrar).toHaveBeenCalledTimes(1);
    const arg = registrar.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(arg[0]).toMatchObject({ from: t, waMessageId: 'wamid.v1', timestampMs: 1759320000_000 });
  });

  it('firma inválida: NO registra nada (un atacante no puede abrir ventanas)', async () => {
    const res = await postear(lote([{ id: 'wamid.x', from: tel() }]), 'sha256=00');
    expect(res.status).toBe(401);
    expect(registrar).not.toHaveBeenCalled();
  });

  it('un POST sin mensajes (solo acuses) no llama a registrar', async () => {
    const body = JSON.stringify({ entry: [{ changes: [{ value: { statuses: [] } }] }] });
    const res = await postear(body);
    expect(res.status).toBe(200);
    expect(registrar).not.toHaveBeenCalled();
  });

  it('si registrar falla (la base de la caché cae), el webhook contesta igual 200 y procesa', async () => {
    registrar.mockResolvedValue({ registrados: 0, fallidos: 1 });
    const res = await postear(lote([{ id: 'wamid.f1', from: tel() }]));
    expect(res.status).toBe(200);
    expect(processInbound).toHaveBeenCalledTimes(1);
  });

  it('si registrar LANZARA (no debería), no se traga el POST: queda el contrato de nunca lanzar', async () => {
    // El contrato está en wa_ventana.test.ts (nunca lanza); aquí se documenta que
    // la ruta confía en él y no lo envuelve en try/catch redundante.
    registrar.mockRejectedValueOnce(new Error('contrato roto'));
    await expect(postear(lote([{ id: 'wamid.f2', from: tel() }]))).rejects.toThrow('contrato roto');
  });
});

describe('idempotencia y desorden en el webhook', () => {
  it('REENTREGA del mismo POST: una sola fila, un solo procesamiento', async () => {
    const t = tel();
    const body = lote([{ id: 'wamid.dup1', from: t }]);
    await postear(body);
    await postear(body);
    expect(bandeja.size).toBe(1);
    expect(processInbound).toHaveBeenCalledTimes(1);
  });

  it('el MISMO wamid dos veces dentro de un POST: se guarda y se procesa una vez', async () => {
    const t = tel();
    await postear(lote([{ id: 'wamid.dup2', from: t }, { id: 'wamid.dup2', from: t }]));
    expect(bandeja.size).toBe(1);
    expect(processInbound).toHaveBeenCalledTimes(1);
  });

  it('fuera de orden: mensajes con horas desordenadas se registran todos (la SQL conserva el más reciente) y se procesan una vez cada uno', async () => {
    const t = tel();
    await postear(lote([
      { id: 'wamid.o2', from: t, timestamp: '1759320200' },
      { id: 'wamid.o1', from: t, timestamp: '1759320100' },
    ]));
    const arg = registrar.mock.calls[0][0] as Array<{ timestampMs: number }>;
    expect(arg.map((m) => m.timestampMs)).toEqual([1759320200_000, 1759320100_000]);
    expect(processInbound).toHaveBeenCalledTimes(2);
  });

  it('reentrega que trae uno ya procesado + uno nuevo: el viejo NO se reprocesa; el nuevo queda DURABLE para el cron (la cadena se corta, no se pierde)', async () => {
    const t = tel();
    await postear(lote([{ id: 'wamid.a', from: t }]));
    await postear(lote([{ id: 'wamid.a', from: t }, { id: 'wamid.b', from: t }]));
    // `a` ya estaba reclamado: la cadena de ESE chofer se detiene (avanzar rompería
    // el orden). `b` está guardado y sin reclamar: lo drena el cron wa-pendientes.
    expect(processInbound).toHaveBeenCalledTimes(1);
    expect(bandeja.get('wamid.b')).toMatchObject({ reclamada: false });
    expect(bandeja.size).toBe(2);
  });

  it('si la bandeja no puede guardar: 503 para que Meta reentregue (la ventana igual quedó anotada)', async () => {
    persistir = false;
    const res = await postear(lote([{ id: 'wamid.p', from: tel() }]));
    expect(res.status).toBe(503);
    expect(registrar).toHaveBeenCalledTimes(1);
    expect(processInbound).not.toHaveBeenCalled();
  });

  it('timestamp ilegible: se registra sin timestampMs (el módulo usa recibidoMs) y no truena', async () => {
    await postear(lote([{ id: 'wamid.ti', from: tel(), timestamp: 'abc' }]));
    const arg = registrar.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(arg[0].timestampMs).toBeUndefined();
    expect(typeof arg[0].recibidoMs).toBe('number');
  });
});
