import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 25, BE-C1a + BE-C1b + DATOS-C1 (CRÍTICO, reincidente de la 24).
//
// `recalcularParaAjuste` prueba el lado del MOTOR: que el override en
// memoria de verdad reemplaza SOLO el monto del comprobante ajustado (el
// resto de sus campos —incluido `sub_total`/`iva_traslado`, el HECHO del
// CFDI— viaja intacto al motor), y que el resultado se traduce a la forma
// EXACTA de `p_recalculo` que `revisar_liquidacion` (mig. 0306) espera.
//
// `regenerarPdfTrasAjuste` prueba el lado del PAPEL: imprime, sube a la ruta
// CANÓNICA (la que el resto del sistema ya asume — `processor.ts`,
// `entregarCierrePendiente`), ARCHIVA el PDF que sustituye (no lo borra) y
// limpia los sellos de entrega — y que un fallo en cualquier paso NUNCA
// lanza: el ajuste ya es un hecho consumado en la base cuando esto corre.
// ═══════════════════════════════════════════════════════════════════════════

const getGastos = vi.fn();
const getViaje = vi.fn();
const getOperador = vi.fn();
const cuadrarDesdeDB = vi.fn();
const generarLiquidacionPDF = vi.fn();
const getDatosFiscales = vi.fn();

vi.mock('./repo', () => ({
  getGastos: (...a: unknown[]) => getGastos(...a),
  getViaje: (...a: unknown[]) => getViaje(...a),
  getOperador: (...a: unknown[]) => getOperador(...a),
}));
vi.mock('./cuadre/desde_db', () => ({ cuadrarDesdeDB: (...a: unknown[]) => cuadrarDesdeDB(...a) }));
vi.mock('./liquidacion/pdf', () => ({ generarLiquidacionPDF: (...a: unknown[]) => generarLiquidacionPDF(...a) }));
vi.mock('@/lib/saas/fiscal', () => ({ getDatosFiscales: (...a: unknown[]) => getDatosFiscales(...a) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('./presupuesto', () => ({ acotada: (q: unknown) => q }));

const copy = vi.fn();
const upload = vi.fn();
const rpc = vi.fn();
const updateCalls: Array<Record<string, unknown>> = [];

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    rpc: (...a: unknown[]) => rpc(...a),
    storage: {
      from: () => ({
        copy: (...a: unknown[]) => copy(...a),
        upload: (...a: unknown[]) => upload(...a),
      }),
    },
    from: () => ({
      update: (v: Record<string, unknown>) => {
        updateCalls.push(v);
        return {
          eq: () => ({
            eq: () => Promise.resolve({ data: null, error: null }),
          }),
        };
      },
    }),
  }),
}));

const { recalcularParaAjuste, regenerarPdfTrasAjuste } = await import('./revision_recalculo');

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

beforeEach(() => {
  vi.clearAllMocks();
  updateCalls.length = 0;
  copy.mockResolvedValue({ data: { path: 'x' }, error: null });
  upload.mockResolvedValue({ data: { path: 'x' }, error: null });
  rpc.mockResolvedValue({ data: null, error: null });
});

function gasto(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: U(3), concepto: 'diesel', monto: 800, subTotal: 6896.55, ivaTraslado: 1103.45,
    cfdiUuid: 'uuid-1', xmlVerificado: true, formaPago: '01',
    ...over,
  };
}

describe('recalcularParaAjuste', () => {
  it('reemplaza SOLO el monto del comprobante ajustado — sub_total/iva_traslado (el hecho del CFDI) viajan intactos al motor', async () => {
    getGastos.mockResolvedValueOnce([gasto(), gasto({ id: U(4), monto: 500, subTotal: null, ivaTraslado: null })]);
    cuadrarDesdeDB.mockResolvedValueOnce({
      viajeId: U(9), totalComprobado: 8500, totalAnticipo: 9000, diferencia: 500, estatus: 'con_diferencias',
      diferencias: [], gastos: [], totalDeducible: 0, totalNoDeducible: 0, totalPorConfirmar: 0,
      iepsAcreditable: 0, litrosDieselAcreditables: 12, ivaAcreditable: 1103.45, peajeAcreditable: 0,
    });

    const r = await recalcularParaAjuste('t1', U(9), [{ gastoId: U(3), montoNuevo: 8000 }]);

    expect(cuadrarDesdeDB).toHaveBeenCalledTimes(1);
    const [, , override] = cuadrarDesdeDB.mock.calls[0] as [string, string, Array<Record<string, unknown>>];
    expect(override).toHaveLength(2);
    expect(override[0]).toMatchObject({ id: U(3), monto: 8000, subTotal: 6896.55, ivaTraslado: 1103.45 });
    expect(override[1]).toMatchObject({ id: U(4), monto: 500 }); // el gasto NO ajustado, intacto

    expect(r.recalculo).toEqual({
      totalComprobado: 8500, diferencia: 500, estatus: 'con_diferencias', diferencias: [],
      iepsAcreditable: 0, litrosDieselAcreditables: 12, ivaAcreditable: 1103.45, peajeAcreditable: 0,
    });
  });

  it('litrosDieselAcreditables ausente/null se manda como 0 — nunca `undefined` en el jsonb que ve la RPC', async () => {
    getGastos.mockResolvedValueOnce([gasto()]);
    cuadrarDesdeDB.mockResolvedValueOnce({
      viajeId: U(9), totalComprobado: 8000, totalAnticipo: 9000, diferencia: 1000, estatus: 'cuadrada',
      diferencias: [], gastos: [], totalDeducible: 0, totalNoDeducible: 0, totalPorConfirmar: 0,
      iepsAcreditable: 0, litrosDieselAcreditables: undefined, ivaAcreditable: 0, peajeAcreditable: 0,
    });
    const r = await recalcularParaAjuste('t1', U(9), [{ gastoId: U(3), montoNuevo: 8000 }]);
    expect(r.recalculo.litrosDieselAcreditables).toBe(0);
  });

  it('un gastoId que no es de este viaje LANZA antes de gastar el recálculo completo del motor', async () => {
    getGastos.mockResolvedValueOnce([gasto()]);
    await expect(recalcularParaAjuste('t1', U(9), [{ gastoId: U(999), montoNuevo: 100 }]))
      .rejects.toThrow(/999.*no es de este viaje/i);
    expect(cuadrarDesdeDB).not.toHaveBeenCalled();
  });
});

describe('regenerarPdfTrasAjuste', () => {
  const CUADRE = {
    viajeId: U(9), totalComprobado: 8000, totalAnticipo: 9000, diferencia: 1000, estatus: 'con_diferencias' as const,
    diferencias: [], gastos: [], totalDeducible: 0, totalNoDeducible: 0, totalPorConfirmar: 0,
    iepsAcreditable: 0, litrosDieselAcreditables: 0, ivaAcreditable: 1200, peajeAcreditable: 0,
  };

  it('imprime los DOS ejemplares con el cuadre recalculado y el sello de quién ajustó, archiva el PDF viejo y limpia los sellos de entrega', async () => {
    getViaje.mockResolvedValueOnce({ id: U(9), anticipo: 9000, folio: 'F-9', operadorId: U(5) });
    getOperador.mockResolvedValueOnce({ id: U(5), nombre: 'Juan', telefono: '5215500000000' });
    getDatosFiscales.mockResolvedValueOnce({ razonSocial: 'Transportes ACME SA de CV' });
    generarLiquidacionPDF.mockResolvedValue(new Uint8Array([1, 2, 3]));

    const r = await regenerarPdfTrasAjuste('t1', U(9), U(1), CUADRE, 'contralor@flota.mx', '2026-09-03T10:00:00Z');

    expect(r.regenerado).toBe(true);
    // Los dos ejemplares, con el cuadre YA ajustado y el sello de revisión.
    expect(generarLiquidacionPDF).toHaveBeenCalledTimes(2);
    const destinatarios = generarLiquidacionPDF.mock.calls.map((c) => c[4]);
    expect(destinatarios.sort()).toEqual(['contralor', 'operador']);
    for (const call of generarLiquidacionPDF.mock.calls) {
      const liq = call[0] as Record<string, unknown>;
      expect(liq).toMatchObject({
        id: U(1), viajeId: U(9), totalComprobado: 8000, ivaAcreditable: 1200,
        revision: 'ajustada', revisadaPor: 'contralor@flota.mx', revisadaEn: '2026-09-03T10:00:00Z',
      });
    }
    // Archiva ANTES de sobrescribir la ruta canónica.
    expect(copy).toHaveBeenCalledWith(`t1/${U(9)}.pdf`, expect.stringContaining(`t1/${U(9)}-ajustada-`));
    // Sube a las rutas CANÓNICAS — las que `processor.ts`/`entregarCierrePendiente` ya asumen.
    const rutasSubidas = upload.mock.calls.map((c) => c[0]);
    expect(rutasSubidas).toContain(`t1/${U(9)}.pdf`);
    expect(rutasSubidas).toContain(`t1/${U(9)}-operador.pdf`);
    // Limpia los sellos de entrega (0279) — el chofer puede volver a recibirlo.
    expect(updateCalls[0]).toMatchObject({ pdf_url: `t1/${U(9)}.pdf`, entregada_operador_en: null, avisada_oficina_en: null });
    // Y archiva la entrada en pdf_historial vía la RPC dedicada (atómica).
    expect(rpc).toHaveBeenCalledWith('agregar_pdf_historial', expect.objectContaining({ p_tenant: 't1', p_liquidacion: U(1) }));
  });

  it('sin viaje o sin operador, no revienta — se dice `regenerado: false`', async () => {
    getViaje.mockResolvedValueOnce(null);
    const r1 = await regenerarPdfTrasAjuste('t1', U(9), U(1), CUADRE, 'x@y.mx', '2026-01-01T00:00:00Z');
    expect(r1.regenerado).toBe(false);
    expect(generarLiquidacionPDF).not.toHaveBeenCalled();

    getViaje.mockResolvedValueOnce({ id: U(9), anticipo: 9000, operadorId: U(5) });
    getOperador.mockResolvedValueOnce(null);
    const r2 = await regenerarPdfTrasAjuste('t1', U(9), U(1), CUADRE, 'x@y.mx', '2026-01-01T00:00:00Z');
    expect(r2.regenerado).toBe(false);
  });

  it('si el PDF del contralor falla al subir, se dice `regenerado: false` — el vigente se queda con la cifra vieja, y se dice', async () => {
    getViaje.mockResolvedValueOnce({ id: U(9), anticipo: 9000, operadorId: U(5) });
    getOperador.mockResolvedValueOnce({ id: U(5), nombre: 'Juan', telefono: '52155' });
    getDatosFiscales.mockResolvedValueOnce(null);
    generarLiquidacionPDF.mockResolvedValue(new Uint8Array([1]));
    upload.mockImplementation((path: string) => Promise.resolve(
      path.endsWith('-operador.pdf') ? { data: { path }, error: null } : { data: null, error: { message: 'storage caído' } },
    ));

    const r = await regenerarPdfTrasAjuste('t1', U(9), U(1), CUADRE, 'x@y.mx', '2026-01-01T00:00:00Z');
    expect(r.regenerado).toBe(false);
  });

  it('un error inesperado (lectura, generación) nunca se propaga — el ajuste ya es un hecho consumado', async () => {
    getViaje.mockRejectedValueOnce(new Error('la base se cayó'));
    await expect(regenerarPdfTrasAjuste('t1', U(9), U(1), CUADRE, 'x@y.mx', '2026-01-01T00:00:00Z'))
      .resolves.toEqual({ regenerado: false });
  });
});
