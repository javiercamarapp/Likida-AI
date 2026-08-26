import { describe, it, expect, vi, beforeEach } from 'vitest';

const claim = vi.hoisted(() => vi.fn());
const complete = vi.hoisted(() => vi.fn());
const fail = vi.hoisted(() => vi.fn());
const renew = vi.hoisted(() => vi.fn());
vi.mock('./tool-idempotency', () => ({ claimMutation: claim, completeMutation: complete, failMutation: fail, renewMutation: renew }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { executeTool, registerTool } = await import('./tool-executor');

/**
 * AGEN-19C2-2 (CRÍTICO) — un fallo de CONTABILIDAD no puede tener la misma voz
 * que un fallo del EFECTO.
 *
 * `guardar_liquidacion` commitea en UNA transacción la fila de `liquidacion` y
 * `viaje.estatus = 'liquidado'` (0013), y los triggers 0036/0037 lo vuelven
 * irreversible. El sello del fencing (`completeMutation`) corre DESPUÉS, y
 * lanza en dos casos: si la RPC devuelve error —y `acotada()` convierte un tope
 * de 8 s en un error POR VALOR— o si otro worker se llevó el token.
 *
 * Estaba dentro del mismo `try` que decide el éxito de la tool, así que ese
 * throw caía en el `catch` y la tool respondía `success: false`. Lo que queda
 * entonces: el viaje liquidado en la base, `processor.ts:2698` con
 * `closed = false`, el PDF sin mandarse, el jefe sin aviso, y el modelo
 * explicándole al chofer que su liquidación no se pudo cerrar — sobre un viaje
 * que ya no admite un solo comprobante más.
 *
 * El camino de ERROR ya protegía `failMutation` con su propio try/catch
 * (`tool-executor.ts:208-209`). El de éxito era el que no lo tenía.
 */
describe('el sello del fencing no puede convertir un efecto committeado en un fallo', () => {
  beforeEach(() => { claim.mockReset(); complete.mockReset(); fail.mockReset(); renew.mockReset(); });

  const registrar = (nombre: string) => {
    registerTool(nombre, {
      isMutation: true,
      schema: { type: 'function', function: { name: nombre, parameters: { type: 'object', properties: {} } } },
      handler: async () => ({ pdfUrl: 'https://likida/liq/V-2026-0847.pdf', total: 12345.67 }),
    });
  };

  it('la RPC de sello se pasa del tope de 8 s y la tool sigue reportando éxito', async () => {
    claim.mockResolvedValueOnce({ kind: 'execute', token: 'token-847' });
    // Lo que `acotada()` produce cuando la base va cargada: un error por valor
    // que `completeMutation` convierte en throw.
    complete.mockRejectedValueOnce(new Error('completeMutation: sin respuesta en 8000 ms'));
    registrar('cierre_con_sello_lento');

    const r = await executeTool('cierre_con_sello_lento', {}, { tenantId: 't', viajeId: 'V-2026-0847', runId: 'r' });

    expect(r.success).toBe(true);
    expect(r.result).toEqual({ pdfUrl: 'https://likida/liq/V-2026-0847.pdf', total: 12345.67 });
    expect(r.error).toBeUndefined();
  });

  it('el fencing token perdido tampoco borra un cierre que ya committeó', async () => {
    claim.mockResolvedValueOnce({ kind: 'execute', token: 'token-848' });
    complete.mockRejectedValueOnce(new Error('completeMutation: se perdió el fencing token'));
    registrar('cierre_con_token_perdido');

    const r = await executeTool('cierre_con_token_perdido', {}, { tenantId: 't', viajeId: 'V-2026-0848', runId: 'r' });

    expect(r.success).toBe(true);
    expect(r.result).toMatchObject({ total: 12345.67 });
  });

  it('un fallo del HANDLER sigue siendo un fallo: el arreglo no ablanda el camino de error', async () => {
    claim.mockResolvedValueOnce({ kind: 'execute', token: 'token-849' });
    fail.mockResolvedValueOnce(undefined);
    registerTool('cierre_que_revienta', {
      isMutation: true,
      schema: { type: 'function', function: { name: 'cierre_que_revienta', parameters: { type: 'object', properties: {} } } },
      handler: async () => { throw new Error('el anticipo no cuadra'); },
    });

    const r = await executeTool('cierre_que_revienta', {}, { tenantId: 't', viajeId: 'V-2026-0849', runId: 'r' });

    expect(r.success).toBe(false);
    expect(complete).not.toHaveBeenCalled();
    expect(fail).toHaveBeenCalled();
  });
});
