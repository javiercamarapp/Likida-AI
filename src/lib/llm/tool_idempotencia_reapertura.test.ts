// ═══════════════════════════════════════════════════════════════════════════
// D.21 (frente de escala) — LA IDEMPOTENCIA DE `guardar_liquidacion` VENCE
// CON LA CORRIDA, NO CON EL VIAJE.
//
// El bug: `mutationEffectKey` era (tool, tenant, viaje, operador) — sin
// `runId`. La fila `succeeded` de `agente_mutacion_idempotencia` no vence
// nunca, así que un viaje REABIERTO (`reabrirViaje`) no se podía volver a
// liquidar JAMÁS: el segundo cierre recibía `cached` con el PDF y las cifras
// del cierre ANTERIOR, en silencio.
//
// Las DOS propiedades se prueban juntas a propósito, porque arreglar una
// rompiendo la otra es el error obvio aquí:
//   1. un viaje reabierto (corrida NUEVA) se vuelve a liquidar — el handler
//      corre de verdad y el resultado es el fresco;
//   2. un reintento de la MISMA corrida NO cobra dos veces — el handler corre
//      UNA vez y el segundo llamado sirve el resultado durable.
//
// El almacén durable se simula fiel al contrato de `claim_agente_mutacion`
// (0188): un mapa por `effect_key` con `running`/`succeeded` y fencing token.
// Así las pruebas son sensibles a la LLAVE: si alguien le quita el `runId`,
// truena la 1; si la vuelve aleatoria por llamada, truena la 2.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect, vi, beforeEach } from 'vitest';

const claim = vi.hoisted(() => vi.fn());
const complete = vi.hoisted(() => vi.fn());
const fail = vi.hoisted(() => vi.fn());
const renew = vi.hoisted(() => vi.fn());
vi.mock('./tool-idempotency', () => ({ claimMutation: claim, completeMutation: complete, failMutation: fail, renewMutation: renew }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { executeTool, registerTool } = await import('./tool-executor');

interface FilaDurable { status: 'running' | 'succeeded'; sello: string; result?: unknown }

describe('D.21 — reapertura de viaje vs reintento del mismo run', () => {
  const almacen = new Map<string, FilaDurable>();
  let tokens = 0;

  beforeEach(() => {
    almacen.clear();
    tokens = 0;
    claim.mockReset(); complete.mockReset(); fail.mockReset(); renew.mockReset();
    claim.mockImplementation(async (_tenant: string, effectKey: string) => {
      const fila = almacen.get(effectKey);
      if (fila?.status === 'succeeded') return { kind: 'cached', result: fila.result };
      const sello = `tok-${++tokens}`;
      almacen.set(effectKey, { status: 'running', sello });
      return { kind: 'execute', token: sello };
    });
    complete.mockImplementation(async (_tenant: string, effectKey: string, selloDelClaim: string, result: unknown) => {
      const fila = almacen.get(effectKey);
      // Igualdad simple a propósito: es el fencing del MOCK, no criptografía.
      const esElDueno = fila !== undefined && fila.sello === selloDelClaim;
      if (!esElDueno) throw new Error('completeMutation: se perdió el fencing token');
      almacen.set(effectKey, { status: 'succeeded', sello: selloDelClaim, result });
    });
  });

  const ctxBase = { tenantId: 'tenant-1', viajeId: 'viaje-9', operadorId: 'op-3' } as const;

  function registrarCierre(nombre: string) {
    let cierres = 0;
    registerTool(nombre, {
      isMutation: true,
      schema: { type: 'function', function: { name: nombre, parameters: { type: 'object', properties: {} } } },
      handler: async () => ({ cierre: ++cierres }),
    });
    return () => cierres;
  }

  it('un reintento de la MISMA corrida no cobra dos veces: el handler corre una vez y el segundo llamado es el resultado durable', async () => {
    const cierres = registrarCierre('cerrar_viaje_mismo_run');
    const ctx = { ...ctxBase, runId: 'run-1' };

    const primero = await executeTool('cerrar_viaje_mismo_run', {}, ctx);
    const reintento = await executeTool('cerrar_viaje_mismo_run', {}, ctx);

    expect(primero.success).toBe(true);
    expect(reintento.success).toBe(true);
    expect(cierres()).toBe(1);                       // el efecto ocurrió UNA vez
    expect(reintento.result).toEqual({ cierre: 1 }); // y el reintento sirve ESE resultado
    // El claim usó la MISMA llave las dos veces — es lo que hace posible el `cached`.
    expect(claim.mock.calls[0][1]).toBe(claim.mock.calls[1][1]);
  });

  it('un viaje REABIERTO (corrida nueva) se vuelve a liquidar: el handler corre otra vez y el resultado es el fresco, no el PDF viejo', async () => {
    const cierres = registrarCierre('cerrar_viaje_reabierto');

    // Corrida 1: el cierre original queda `succeeded` en el almacén durable.
    const original = await executeTool('cerrar_viaje_reabierto', {}, { ...ctxBase, runId: 'run-1' });
    expect(original.success).toBe(true);
    expect(original.result).toEqual({ cierre: 1 });

    // El jefe reabre el viaje (reabrirViaje archiva la liquidación); días — o
    // minutos — después el chofer vuelve a cerrar: es OTRA corrida.
    const trasReabrir = await executeTool('cerrar_viaje_reabierto', {}, { ...ctxBase, runId: 'run-2' });

    expect(trasReabrir.success).toBe(true);
    expect(cierres()).toBe(2);                          // el handler CORRIÓ de nuevo
    expect(trasReabrir.result).toEqual({ cierre: 2 });  // resultado FRESCO, no el cacheado
    // Y la razón: la llave del efecto cambia con la corrida.
    expect(claim.mock.calls[0][1]).not.toBe(claim.mock.calls[1][1]);
  });

  it('ctx.mutationKey sigue mandando por encima de todo (el escape hatch no se rompió)', async () => {
    registrarCierre('cerrar_con_override');
    await executeTool('cerrar_con_override', {}, { ...ctxBase, runId: 'run-1', mutationKey: 'llave-explicita' });
    expect(claim).toHaveBeenCalledWith('tenant-1', 'llave-explicita', 'cerrar_con_override');
  });
});
