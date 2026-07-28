import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Gasto, Liquidacion } from '@/types/cuadra';

// ═══════════════════════════════════════════════════════════════════════════
// LA ESCRITURA DEL DINERO NO TENÍA UN SOLO TEST.
//
// El cálculo está probado a fondo —el motor tiene cientos de casos—, pero
// `addGasto` y `saveLiquidacion`, que son las funciones que de verdad meten el
// dinero en la base, no tenían ninguno. Y son mapeos a mano de camelCase a
// snake_case con ~25 campos cada uno: si uno se escribe mal, el dato se guarda
// como NULL y nadie se entera hasta que el contralor ve un cero.
//
// Lo que se prueba aquí NO es Supabase, es el MAPEO: que cada campo del dominio
// llegue a su columna, y que el 0 y el false no se conviertan en NULL, que es el
// error clásico de `??` mal puesto (`||` lo haría) y el que más caro sale.
// ═══════════════════════════════════════════════════════════════════════════
const insert = vi.fn();
const rpc = vi.fn();
const from = vi.fn(() => ({ insert }));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({ from: (...a: unknown[]) => from(...(a as [])), rpc: (...a: unknown[]) => rpc(...a) }),
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { addGasto, saveLiquidacion } = await import('./repo');

describe('addGasto — el mapeo a columnas', () => {
  beforeEach(() => { insert.mockReset(); insert.mockResolvedValue({ error: null }); from.mockClear(); });

  const gasto: Gasto = {
    id: 'g1', concepto: 'diesel', monto: 4812.5, fecha: '2026-05-01', folio: 'A-1',
    rfcEmisor: 'XAXX010101000', cfdiUuid: 'u-1', ocrConfianza: 0.93,
    formaPago: '04', subTotal: 4148.71, iepsTraslado: 900, ivaTraslado: 663.79,
    xmlVerificado: true, claveProdServ: '15101514',
  };

  it('escribe en la tabla `gasto` con tenant y viaje', async () => {
    await addGasto('t1', 'v1', gasto);
    expect(from).toHaveBeenCalledWith('gasto');
    expect(insert.mock.calls[0][0]).toMatchObject({ tenant_id: 't1', viaje_id: 'v1', id: 'g1' });
  });

  it('traduce cada campo del dominio a su columna', async () => {
    await addGasto('t1', 'v1', gasto);
    expect(insert.mock.calls[0][0]).toMatchObject({
      concepto: 'diesel', monto: 4812.5, fecha: '2026-05-01', folio: 'A-1',
      rfc_emisor: 'XAXX010101000', cfdi_uuid: 'u-1', ocr_confianza: 0.93,
      forma_pago: '04', sub_total: 4148.71, ieps_traslado: 900, iva_traslado: 663.79,
      xml_verificado: true, clave_prod_serv: '15101514',
    });
  });

  it('un 0 NO se guarda como NULL', async () => {
    // El error clásico: `g.iepsTraslado || null` convierte el 0 legítimo en NULL.
    // Un IEPS de 0 (no desglosado) y un IEPS ausente son cosas distintas.
    await addGasto('t1', 'v1', { ...gasto, iepsTraslado: 0, ivaTraslado: 0, subTotal: 0 });
    const fila = insert.mock.calls[0][0];
    expect(fila.ieps_traslado).toBe(0);
    expect(fila.iva_traslado).toBe(0);
    expect(fila.sub_total).toBe(0);
  });

  it('un false NO se guarda como NULL', async () => {
    // `xml_verificado: false` significa "se miró y no está verificado";
    // NULL significa "no se miró". No son lo mismo para el acreditamiento.
    await addGasto('t1', 'v1', { ...gasto, xmlVerificado: false });
    expect(insert.mock.calls[0][0].xml_verificado).toBe(false);
  });

  it('lo ausente sí va como NULL, no como undefined', async () => {
    // `undefined` en un insert de supabase-js se omite de la fila y el DEFAULT
    // de la columna gana en silencio. NULL es explícito.
    await addGasto('t1', 'v1', { id: 'g2', concepto: 'caseta', monto: 100 });
    const fila = insert.mock.calls[0][0];
    for (const c of ['fecha', 'folio', 'rfc_emisor', 'cfdi_uuid', 'forma_pago']) {
      expect(fila[c], `${c} debería ser null explícito`).toBeNull();
    }
  });

  it('un error de la base SÍ se lanza: no se pierde un gasto en silencio', async () => {
    insert.mockResolvedValue({ error: { message: 'boom', code: 'XX000' } });
    await expect(addGasto('t1', 'v1', gasto)).rejects.toThrow(/boom/);
  });
});

describe('saveLiquidacion — el cierre', () => {
  beforeEach(() => { rpc.mockReset(); rpc.mockResolvedValue({ data: 'liq-1', error: null }); });

  const liq: Omit<Liquidacion, 'id' | 'creadaEn'> = {
    viajeId: 'v1', totalComprobado: 4812.5, totalAnticipo: 5000, diferencia: 187.5,
    estatus: 'cuadrada', totalDeducible: 4812.5, totalNoDeducible: 0, totalPorConfirmar: 0,
    diferencias: [], gastos: [], iepsAcreditable: 0, litrosDieselAcreditables: 255,
    ivaAcreditable: 663.79, peajeAcreditable: 240,
  };

  it('cierra por la RPC transaccional, no con un insert suelto', async () => {
    // El insert de la liquidación y el update del viaje TIENEN que ir en la misma
    // transacción: si el segundo falla, el primero debe revertirse. Por eso es
    // una RPC (mig. 0013) y no dos llamadas desde la app.
    await saveLiquidacion('t1', liq);
    expect(rpc).toHaveBeenCalledWith('guardar_liquidacion_tx', expect.any(Object));
  });

  it('manda cada total a su parámetro', async () => {
    await saveLiquidacion('t1', liq);
    expect(rpc.mock.calls[0][1]).toMatchObject({
      p_tenant: 't1', p_viaje: 'v1',
      p_total_comprobado: 4812.5, p_total_anticipo: 5000, p_diferencia: 187.5,
      p_estatus: 'cuadrada', p_iva: 663.79, p_peaje: 240,
    });
  });

  it('devuelve el id que da la RPC', async () => {
    expect(await saveLiquidacion('t1', liq)).toBe('liq-1');
  });

  it('un error de la RPC SÍ se lanza: un cierre perdido no puede pasar callado', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'deadlock detectado' } });
    await expect(saveLiquidacion('t1', liq)).rejects.toThrow(/deadlock/);
  });
});
