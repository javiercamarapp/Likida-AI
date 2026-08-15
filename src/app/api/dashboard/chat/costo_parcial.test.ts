import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 3, TC-A1 (ALTO): el turno del chat que truena (loop-guard,
// timeout, truncamiento) ya pagó hasta 9 completions y su consumo viaja en
// PartialExecutionError — la ruta lo tiraba en el catch y el tope diario de
// $1/tenant quedaba ciego al modo de falla que más gasta. Esta prueba fija:
// turno fallido → fila de costo 'parcial' registrada con los tokens pagados.
// ═══════════════════════════════════════════════════════════════════════════

const registrarCosto = vi.fn(async (..._a: unknown[]) => undefined);
const ejecutarAnalista = vi.fn();

vi.mock('@/lib/auth/session', () => ({
  getSessionTenant: vi.fn(async () => ({ userId: 'u1', tenantId: 't1', rol: 'flota_admin', nombre: 'Ana' })),
}));
vi.mock('./tenant', () => ({
  tenantEfectivoChat: vi.fn(async () => ({ tenantId: 't1', nombreFlota: 'Flota Demo' })),
}));
vi.mock('@/lib/likida/costos', () => ({
  registrarCosto: (...a: unknown[]) => registrarCosto(...a),
  faseDeModelo: vi.fn(() => 'chat'),
}));
vi.mock('@/lib/agents/analista', () => ({
  ejecutarAnalista: (...a: unknown[]) => ejecutarAnalista(...a),
}));
vi.mock('@/lib/likida/chat/conversaciones', () => ({ guardarIntercambio: vi.fn(async () => null) }));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => {
      const b: Record<string, unknown> = {};
      const chain = () => b;
      Object.assign(b, {
        select: chain, eq: chain, gte: chain, order: chain, abortSignal: chain,
        // `traerTodo` pagina con `.range()`: una página vacía es su prueba de
        // término, así que este mock ("no hay gasto hoy") lo satisface igual.
        range: () => Promise.resolve({ data: [], error: null }),
        then: (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(res),
      });
      return b;
    },
  }),
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { POST } = await import('./route');
const { PartialExecutionError } = await import('@/lib/llm/openrouter');

function peticion() {
  const req = new Request('http://likida.test/api/dashboard/chat', {
    method: 'POST',
    body: JSON.stringify({ mensajes: [{ rol: 'usuario', texto: '¿cuánto llevo de diésel?' }] }),
    headers: { 'content-type': 'application/json' },
  }) as unknown as Record<string, unknown>;
  // NextRequest.nextUrl — lo único que la ruta le pide es searchParams.
  req.nextUrl = new URL('http://likida.test/api/dashboard/chat');
  return req as never;
}

async function drenar(res: Response) {
  const lector = res.body?.getReader();
  if (!lector) return;
  while (!(await lector.read()).done) { /* drenar el stream para que start() termine */ }
}

describe('POST /api/dashboard/chat — el turno fallido TAMBIÉN se cobra (TC-A1)', () => {
  beforeEach(() => { registrarCosto.mockClear(); ejecutarAnalista.mockReset(); });

  it('PartialExecutionError registra el costo parcial con los tokens ya pagados', async () => {
    ejecutarAnalista.mockRejectedValue(new PartialExecutionError('loop-guard', null, [], 15_000, 400, 0.0125));
    const res = await POST(peticion());
    await drenar(res as Response);
    expect(registrarCosto).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 't1', modelo: 'parcial', tokensIn: 15_000, tokensOut: 400, costoUsd: 0.0125,
    }));
  });

  it('un error SIN consumo (truena antes de pagar) no inventa una fila de costo', async () => {
    ejecutarAnalista.mockRejectedValue(new PartialExecutionError('abort temprano', null, [], 0, 0, 0));
    const res = await POST(peticion());
    await drenar(res as Response);
    expect(registrarCosto).not.toHaveBeenCalled();
  });
});
