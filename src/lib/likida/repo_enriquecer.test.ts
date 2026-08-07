import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// B13 — El merge y el claim viven en SQL, no en la app.
//
// Hacerlo desde JS era read-modify-write: las fotos de una ráfaga de WhatsApp
// corren en paralelo, así que se mezclaba contra el `ocr_extra` LEÍDO, no
// contra el de la tabla. La última escritura borraba lo que otra foto hubiera
// añadido en medio, y sin claim el segundo acercamiento pisaba el folio del
// primero — el folio que la oficina teclea en el portal para timbrar.
//
// Estos casos fijan el contrato con la mig. 0017.
// ═══════════════════════════════════════════════════════════════════════════
const rpc = vi.fn();
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ rpc: (...a: unknown[]) => rpc(...a) }) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { enriquecerGastoConCodigo } = await import('./repo');
const gasto = { id: 'g1', concepto: 'diesel' as const, monto: 300, ocrExtra: { montoDiscrepante: true } };

describe('enriquecerGastoConCodigo', () => {
  beforeEach(() => { rpc.mockReset(); rpc.mockResolvedValue({ data: true, error: null }); });

  it('manda SOLO lo que salió del código, no el ocr_extra completo', async () => {
    // Reenviar el objeto entero es justo lo que causaba el lost update: lo que
    // se manda es el parche, y el `||` de SQL conserva lo demás.
    await enriquecerGastoConCodigo('t1', gasto, { folioPortal: 'F-30', codigoBarras: 'B1' });
    expect(rpc).toHaveBeenCalledWith('enriquecer_gasto_codigo', expect.objectContaining({
      p_gasto: 'g1', p_tenant: 't1', p_extra: { folioPortal: 'F-30', codigoBarras: 'B1' },
    }));
    expect(rpc.mock.calls[0][1].p_extra).not.toHaveProperty('montoDiscrepante');
  });

  it('omite del parche lo que el código no traía', async () => {
    await enriquecerGastoConCodigo('t1', gasto, { folioPortal: 'F-30' });
    expect(rpc.mock.calls[0][1].p_extra).toEqual({ folioPortal: 'F-30' });
  });

  it('devuelve true cuando de verdad enriqueció', async () => {
    expect(await enriquecerGastoConCodigo('t1', gasto, { folioPortal: 'F' })).toBe(true);
  });

  it('devuelve false —sin lanzar— cuando alguien llegó primero', async () => {
    // "Ya estaba tomado" no es un error: es la respuesta correcta del claim.
    rpc.mockResolvedValue({ data: false, error: null });
    expect(await enriquecerGastoConCodigo('t1', gasto, { folioPortal: 'F' })).toBe(false);
  });

  it('un error de verdad SÍ se lanza', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'function does not exist' } });
    await expect(enriquecerGastoConCodigo('t1', gasto, { folioPortal: 'F' })).rejects.toThrow(/does not exist/);
  });

  it('sin cfdiUuid manda null, no undefined', async () => {
    // undefined se serializa fuera del JSON y el RPC recibiría menos argumentos
    // de los que declara.
    await enriquecerGastoConCodigo('t1', gasto, { folioPortal: 'F' });
    expect(rpc.mock.calls[0][1].p_cfdi_uuid).toBeNull();
  });
});
