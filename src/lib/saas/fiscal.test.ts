import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// LOS DATOS FISCALES SE VALIDAN ANTES DE COBRAR, NO DESPUÉS.
//
// En México el cobro NO cierra la operación: la cierra el CFDI 4.0 timbrado, y
// eso lo emite un PAC, no Stripe. El CFDI exige del receptor cinco datos, y
// todos se validan aquí porque el momento de descubrir que están mal es el
// único barato.
//
// EL MODO DE FALLA ES DE ORDEN, no de excepción: si se cobra primero y se
// valida después, ya tienes el dinero de una flota a la que no le puedes
// facturar, y su contador no tiene con qué deducir la mensualidad. Eso no se
// arregla con un reintento; se arregla devolviendo dinero.
// ═══════════════════════════════════════════════════════════════════════════

const update = vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) }));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({ from: () => ({ update }) }),
}));

const { guardarDatosFiscales, estanCompletos, validarDatosFiscales, REGIMENES, USOS_CFDI } = await import('./fiscal');

// RFC con dígito verificador VÁLIDO, el mismo que ya usan las pruebas de CFDI
// del repo. No inventado: uno inventado casi nunca pasa el verificador.
const RFC_OK = 'GMX0902279I1';

const BASE = {
  rfc: RFC_OK,
  razonSocial: 'FLOTA DEMO SA DE CV',
  regimenFiscal: '601',
  codigoPostal: '97000',
  usoCfdi: 'G03',
};

describe('estanCompletos — se puede facturar o no, no hay a medias', () => {
  it('los cinco datos', () => {
    expect(estanCompletos({
      rfc: RFC_OK, razonSocial: 'X SA', regimenFiscal: '601', codigoPostal: '97000', usoCfdi: 'G03',
      // El correo NO entra en `estanCompletos`: sin él se timbra igual, solo
      // que el papel no le llega a nadie (DAT-33). Aquí va nulo a propósito.
      email: null,
    })).toBe(true);
  });

  it('falta uno y NO se puede facturar', () => {
    expect(estanCompletos({
      rfc: RFC_OK, razonSocial: 'X SA', regimenFiscal: '601', codigoPostal: null, usoCfdi: 'G03', email: null,
    })).toBe(false);
    expect(estanCompletos(null)).toBe(false);
  });
});

describe('guardarDatosFiscales', () => {
  beforeEach(() => update.mockClear());

  it('guarda los cinco, con el RFC normalizado a mayúsculas', async () => {
    await guardarDatosFiscales('t-1', { ...BASE, rfc: ' gmx0902279i1 ' });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      rfc: RFC_OK,
      regimen_fiscal: '601',
      codigo_postal_fiscal: '97000',
      uso_cfdi: 'G03',
    }));
  });

  it('RECHAZA un RFC con dígito verificador malo', async () => {
    // El costo aquí es peor que en el alta: el PAC rechaza el timbrado cuando
    // ya hay pagos cobrados.
    await expect(guardarDatosFiscales('t-1', { ...BASE, rfc: 'GMX0902279I9' }))
      .rejects.toThrow(/dígito verificador/);
    expect(update).not.toHaveBeenCalled();
  });

  it('NO recorta ni "arregla" la razón social más allá de espacios', async () => {
    // El SAT la compara contra lo registrado para ese RFC. Nosotros no sabemos
    // mejor que su Constancia de Situación Fiscal.
    await guardarDatosFiscales('t-1', { ...BASE, razonSocial: '  Flota Demo S.A. de C.V.  ' });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      razon_social: 'Flota Demo S.A. de C.V.',
    }));
  });

  it('rechaza un código postal que no sean 5 dígitos', async () => {
    await expect(guardarDatosFiscales('t-1', { ...BASE, codigoPostal: '9700' })).rejects.toThrow(/5 dígitos/);
    await expect(guardarDatosFiscales('t-1', { ...BASE, codigoPostal: 'CP970' })).rejects.toThrow(/5 dígitos/);
  });

  it('rechaza claves fuera del catálogo del SAT', async () => {
    // Una clave inventada la rechaza el PAC, o peor: la acepta y emite un
    // comprobante que el contador del cliente no puede usar.
    await expect(guardarDatosFiscales('t-1', { ...BASE, regimenFiscal: '999' })).rejects.toThrow(/régimen fiscal/);
    await expect(guardarDatosFiscales('t-1', { ...BASE, usoCfdi: 'ZZZ' })).rejects.toThrow(/uso de CFDI/);
  });

  it('los catálogos que ofrece la pantalla son los que la base acepta', () => {
    // 0056 + 0170 (624 Coordinados). Si divergen, el formulario ofrece una
    // opción que el insert rechaza.
    expect(REGIMENES.map((r) => r.clave)).toEqual(['601', '603', '612', '621', '624', '626']);
    expect(USOS_CFDI.map((u) => u.clave)).toEqual(['G03', 'G01', 'I04']);
  });

  it('624 Coordinados entra al receptor CFDI 4.0 (RFA 2.9)', async () => {
    await guardarDatosFiscales('t-1', { ...BASE, regimenFiscal: '624' });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ regimen_fiscal: '624' }));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA PROD (22-ago-2026) · DAT-40 — EL RFC GENÉRICO PASABA COMO CUALQUIERA.
//
// XAXX010101000 ("público en general") tiene dígito verificador correcto, así
// que entraba tal cual. Un CFDI a ese RFC NO LO PUEDE DEDUCIR NADIE: el cliente
// paga su mensualidad, recibe un papel válido ante el SAT y sin valor para su
// contabilidad — y lo descubre en la declaración, meses después.
// ═══════════════════════════════════════════════════════════════════════════

describe('validarDatosFiscales — el RFC genérico no es el de un cliente', () => {
  it('rechaza XAXX010101000 (público en general) y XEXX010101000 (extranjero)', () => {
    expect(() => validarDatosFiscales({ ...BASE, rfc: 'XAXX010101000' })).toThrow(/genérico/i);
    expect(() => validarDatosFiscales({ ...BASE, rfc: 'XEXX010101000' })).toThrow(/genérico/i);
  });

  it('el correo del CFDI es opcional pero se valida si viene (ahí llega el papel)', () => {
    expect(validarDatosFiscales({ ...BASE }).email_facturacion).toBeNull();
    expect(validarDatosFiscales({ ...BASE, email: ' pagos@flota.mx ' }).email_facturacion).toBe('pagos@flota.mx');
    expect(() => validarDatosFiscales({ ...BASE, email: 'pagos@flota' })).toThrow(/correo/i);
  });
});
