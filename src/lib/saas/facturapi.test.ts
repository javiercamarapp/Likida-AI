import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  facturapiConfigurado, modoFacturapi, timbrarMensualidad,
  CLAVE_PROD_SERV_SOFTWARE, CLAVE_UNIDAD_SERVICIO, FORMA_PAGO_TRANSFERENCIA, METODO_PAGO_UNA_EXHIBICION,
} from './facturapi';

// ═══════════════════════════════════════════════════════════════════════════
// EL TIMBRADO — donde un reintento cuesta dinero del CLIENTE, no del sistema.
//
// Cada timbrado exitoso crea un CFDI REAL ante el SAT y consume un folio.
// Timbrar dos veces la misma mensualidad obliga a cancelar uno, y una
// cancelación fuera de plazo se le queda al cliente en su contabilidad. Por eso
// aquí no hay reintento automático y el llamador comprueba el UUID antes.
//
// Y por eso falla cerrado: sin llave NO se finge una factura. Que el cliente
// crea que tiene su comprobante y no lo tenga se descubre en la declaración,
// meses después, cuando ya no se puede arreglar bien.
// ═══════════════════════════════════════════════════════════════════════════

const RECEPTOR = {
  rfc: 'GMX0902279I1',
  razonSocial: 'TRANSPORTES INNOVATIVOS SA DE CV',
  regimenFiscal: '601',
  codigoPostal: '45615',
  usoCfdi: 'G03',
};

afterEach(() => { delete process.env.FACTURAPI_SECRET_KEY; vi.restoreAllMocks(); });

describe('configuración', () => {
  it('sin llave no está configurado — la pantalla dice "sin timbrar"', () => {
    expect(facturapiConfigurado()).toBe(false);
    expect(modoFacturapi()).toBeNull();
  });

  it('distingue prueba de producción: un CFDI de sandbox NO existe para el SAT', () => {
    process.env.FACTURAPI_SECRET_KEY = 'sk_test_abc';
    expect(modoFacturapi()).toBe('prueba');
    process.env.FACTURAPI_SECRET_KEY = 'sk_live_abc';
    expect(modoFacturapi()).toBe('produccion');
  });
});

describe('timbrarMensualidad', () => {
  it('manda las claves del SAT correctas y el IVA por fuera', async () => {
    process.env.FACTURAPI_SECRET_KEY = 'sk_test_abc';
    let cuerpo: Record<string, unknown> = {};
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: RequestInit) => {
      cuerpo = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ id: 'inv_1', uuid: 'AAAA-BBBB', total: 5684 }), { status: 200 });
    }));

    await timbrarMensualidad({
      receptor: RECEPTOR, subtotal: 4900,
      periodoInicio: '2026-08-01', periodoFin: '2026-08-31', referencia: 'LKABCD202608',
    });

    const item = (cuerpo.items as Array<{ product: Record<string, unknown> }>)[0];
    expect(item.product.product_key).toBe(CLAVE_PROD_SERV_SOFTWARE);
    expect(item.product.unit_key).toBe(CLAVE_UNIDAD_SERVICIO);
    expect(item.product.price).toBe(4900);
    // `tax_included: false` — Facturapi suma el IVA encima. Al revés produce una
    // factura por un total distinto al que se cobró.
    expect(item.product.tax_included).toBe(false);
    expect(cuerpo.payment_form).toBe(FORMA_PAGO_TRANSFERENCIA);   // 03 = transferencia
    expect(cuerpo.payment_method).toBe(METODO_PAGO_UNA_EXHIBICION); // PUE
    expect((cuerpo.customer as Record<string, unknown>).tax_id).toBe(RECEPTOR.rfc);
    expect(cuerpo.external_id).toBe('LKABCD202608');
  });

  it('rechaza timbrar $0 y datos fiscales incompletos', async () => {
    process.env.FACTURAPI_SECRET_KEY = 'sk_test_abc';
    await expect(timbrarMensualidad({ receptor: RECEPTOR, subtotal: 0, periodoInicio: 'a', periodoFin: 'b' }))
      .rejects.toThrow(/\$0/);
    await expect(timbrarMensualidad({
      receptor: { ...RECEPTOR, codigoPostal: '' }, subtotal: 100, periodoInicio: 'a', periodoFin: 'b',
    })).rejects.toThrow(/datos fiscales/);
  });

  it('un rechazo del SAT se enseña VERBATIM: es lo único que dice qué corregir', async () => {
    process.env.FACTURAPI_SECRET_KEY = 'sk_test_abc';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ message: 'El RFC del receptor no está registrado en el SAT' }), { status: 400 },
    )));
    await expect(timbrarMensualidad({ receptor: RECEPTOR, subtotal: 100, periodoInicio: 'a', periodoFin: 'b' }))
      .rejects.toThrow(/no está registrado en el SAT/);
  });

  it('sin llave configurada NO inventa una factura', async () => {
    await expect(timbrarMensualidad({ receptor: RECEPTOR, subtotal: 100, periodoInicio: 'a', periodoFin: 'b' }))
      .rejects.toThrow(/FACTURAPI_SECRET_KEY/);
  });
});

describe('el candado de producción', () => {
  afterEach(() => { delete process.env.VERCEL_ENV; });

  it('en PRODUCCIÓN con llave de prueba NO timbra — un CFDI de sandbox no existe para el SAT', async () => {
    // Sin esto, una sk_test pegada por error en producción llenaría la base de
    // folios fiscales inexistentes con forma de válidos, y el cliente lo
    // descubriría en su declaración meses después.
    process.env.FACTURAPI_SECRET_KEY = 'sk_test_abc';
    process.env.VERCEL_ENV = 'production';
    const llamo = vi.fn();
    vi.stubGlobal('fetch', llamo);

    await expect(timbrarMensualidad({ receptor: RECEPTOR, subtotal: 100, periodoInicio: 'a', periodoFin: 'b' }))
      .rejects.toThrow(/sk_live/);
    // Y no se gastó una llamada.
    expect(llamo).not.toHaveBeenCalled();
  });

  it('en producción con sk_live sí timbra', async () => {
    process.env.FACTURAPI_SECRET_KEY = 'sk_live_abc';
    process.env.VERCEL_ENV = 'production';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ id: 'inv_1', uuid: 'AAAA-BBBB', total: 116 }), { status: 200 },
    )));
    const r = await timbrarMensualidad({ receptor: RECEPTOR, subtotal: 100, periodoInicio: 'a', periodoFin: 'b' });
    expect(r.uuid).toBe('AAAA-BBBB');
  });

  it('fuera de producción, la llave de prueba sí timbra (es para lo que sirve)', async () => {
    process.env.FACTURAPI_SECRET_KEY = 'sk_test_abc';
    process.env.VERCEL_ENV = 'preview';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ id: 'inv_2', uuid: 'CCCC-DDDD', total: 116 }), { status: 200 },
    )));
    const r = await timbrarMensualidad({ receptor: RECEPTOR, subtotal: 100, periodoInicio: 'a', periodoFin: 'b' });
    expect(r.uuid).toBe('CCCC-DDDD');
  });
});
