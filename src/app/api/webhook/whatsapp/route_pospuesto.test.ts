// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 18 (C4 + A3/A27) — EL WEBHOOK SOLO SELLA LO QUE TERMINÓ.
//
// El `after()` procesaba cada fila durable y sellaba `procesado_en` ante
// cualquier retorno sin excepción. Con `processInbound` devolviendo `void`,
// eso incluía el 'duplicado' de un claim huérfano (la invocación anterior
// murió con el claim tomado) y los `return` de abandono. Y cada mensaje
// arrancaba su presupuesto en su propio `Date.now()`, ignorando lo que la
// invocación ya llevaba gastado en los mensajes anteriores del pool.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';

const SECRETO = 'app-secret-de-prueba-pospuesto';
process.env.WHATSAPP_APP_SECRET = SECRETO;

const processInbound = vi.fn(async (_m: unknown, _o?: unknown): Promise<string | undefined> => 'procesado');
vi.mock('@/lib/likida/processor', () => ({ processInbound: (...a: unknown[]) => processInbound(...(a as [unknown, unknown])) }));

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
vi.mock('@/lib/logger', () => ({ logger }));
vi.mock('@/lib/observability/sentry', () => ({ flushObservabilidad: vi.fn(async () => {}) }));
vi.mock('@/lib/likida/interruptores', () => ({ estaApagado: vi.fn(async () => false) }));

const pendientes: Array<() => unknown> = [];
vi.mock('next/server', async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return { ...real, after: (fn: () => unknown) => { pendientes.push(fn); } };
});

const marcarPendienteProcesado = vi.fn(async (_id: string) => {});
const anotarFalloPendiente = vi.fn(async (_id: string, _err: string) => {});
vi.mock('@/lib/likida/wa_pendientes', () => ({
  guardarEventosPendientes: async (ms: Array<{ waMessageId?: string }>) => {
    const filas = ms.map((m, i) => ({ id: m.waMessageId ?? `f-${i}`, evento: m, guardado: true }));
    return { guardados: filas.length, fallidos: 0, filas };
  },
  reclamarPendiente: async (id: string, _i: number) => ({ id, evento: { waMessageId: id, from: 'x', type: 'text', text: 'hola' }, intentos: 1 }),
  marcarPendienteProcesado: (...a: unknown[]) => marcarPendienteProcesado(...(a as [string])),
  anotarFalloPendiente: (...a: unknown[]) => anotarFalloPendiente(...(a as [string, string])),
}));

const { POST } = await import('./route');

const firmar = (body: string) => 'sha256=' + crypto.createHmac('sha256', SECRETO).update(body).digest('hex');

let n = 0;
function unTexto() {
  n += 1;
  const telefono = `52199900020${String(n).padStart(2, '0')}`;
  return JSON.stringify({ entry: [{ changes: [{ value: { messages: [{ id: `wamid.${n}`, from: telefono, type: 'text', text: { body: 'listo' } }] } }] }] });
}

async function postear(body: string) {
  const res = await POST(new Request('https://likida.ai/api/webhook/whatsapp', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': firmar(body) }, body,
  }) as never);
  while (pendientes.length) await pendientes.shift()!();
  return res;
}

beforeEach(() => { vi.clearAllMocks(); processInbound.mockResolvedValue('procesado'); });

describe('el sello de la fila durable sigue al resultado del motor', () => {
  it('"procesado" sella (control)', async () => {
    await postear(unTexto());
    expect(marcarPendienteProcesado).toHaveBeenCalledTimes(1);
    expect(anotarFalloPendiente).not.toHaveBeenCalled();
  });

  it('"duplicado" (ya completado) también sella: el trabajo existe', async () => {
    processInbound.mockResolvedValue('duplicado');
    await postear(unTexto());
    expect(marcarPendienteProcesado).toHaveBeenCalledTimes(1);
  });

  it.each(['reintentable', 'sin_tiempo', 'en_curso'])('"%s" NO sella: anota el motivo y deja la fila para el cron', async (r) => {
    processInbound.mockResolvedValue(r);
    await postear(unTexto());
    expect(marcarPendienteProcesado).not.toHaveBeenCalled();
    expect(anotarFalloPendiente).toHaveBeenCalledWith(expect.any(String), `pospuesto: ${r}`);
    expect(logger.warn).toHaveBeenCalledWith('wa.pendiente_pospuesto', expect.objectContaining({ resultado: r }));
  });

  it('el contrato viejo (`undefined`) sigue contando como hecho: un mock o un llamador sin resultado no desella nada', async () => {
    processInbound.mockResolvedValue(undefined);
    await postear(unTexto());
    expect(marcarPendienteProcesado).toHaveBeenCalledTimes(1);
  });

  it('le pasa al motor el inicio de la INVOCACIÓN, no el de cada mensaje (C4)', async () => {
    const antes = Date.now();
    await postear(unTexto());
    const opts = processInbound.mock.calls[0][1] as { inicioInvocacionMs: number };
    expect(opts.inicioInvocacionMs).toBeGreaterThanOrEqual(antes);
    expect(opts.inicioInvocacionMs).toBeLessThanOrEqual(Date.now());
  });
});
