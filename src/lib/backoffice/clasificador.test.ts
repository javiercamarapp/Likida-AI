import { describe, expect, it } from 'vitest';
import { CUENTA_PROPUESTA, deducibleEnForma, sugerirClasificacion } from './clasificador';

describe('clasificador de gastos: solo SUGIERE', () => {
  it('reconoce a los proveedores fijos y marca esSugerencia', () => {
    const v = sugerirClasificacion({ proveedor: 'Vercel Inc.', concepto: 'Pro' });
    expect(v).toMatchObject({ esSugerencia: true, categoria: 'infraestructura', cuentaContable: CUENTA_PROPUESTA.infraestructura, coincidio: 'vercel' });
    expect(sugerirClasificacion({ proveedor: 'Claude Code' }).categoria).toBe('ia_modelos');
    expect(sugerirClasificacion({ proveedor: 'Mifiel' }).categoria).toBe('legal_firma');
    expect(sugerirClasificacion({ proveedor: 'WhatsApp / Meta' }).categoria).toBe('whatsapp');
    expect(sugerirClasificacion({ proveedor: 'Resend' }).categoria).toBe('correo_observabilidad');
  });

  it('ignora acentos y mayúsculas, y cae al concepto si el proveedor no dice nada', () => {
    expect(sugerirClasificacion({ proveedor: 'Firma Electrónica SA' }).categoria).toBe('legal_firma');
    expect(sugerirClasificacion({ proveedor: null, concepto: 'Plan Supabase Pro' }).categoria).toBe('infraestructura');
  });

  it('sin coincidencia NO inventa: categoría y cuenta nulas', () => {
    const v = sugerirClasificacion({ proveedor: 'Papelería La Esquina', concepto: 'Plumas' });
    expect(v).toEqual({ esSugerencia: true, categoria: null, cuentaContable: null, coincidio: null });
  });
});

describe('deducible EN FORMA', () => {
  it('sin RFC propio nada es evaluable, ni siquiera un CFDI con UUID', () => {
    expect(deducibleEnForma({ rfcPropio: false, comprobante: 'cfdi', cfdiUuid: 'aaaaaaaa-0000-4000-8000-000000000001' })).toBe('no_evaluable');
    expect(deducibleEnForma({ rfcPropio: false, comprobante: 'sin_comprobante', cfdiUuid: null })).toBe('no_evaluable');
  });
  it('con RFC propio: CFDI con UUID es «sí» en forma; lo demás «no»', () => {
    expect(deducibleEnForma({ rfcPropio: true, comprobante: 'cfdi', cfdiUuid: 'aaaaaaaa-0000-4000-8000-000000000001' })).toBe('si');
    expect(deducibleEnForma({ rfcPropio: true, comprobante: 'invoice_extranjero', cfdiUuid: null })).toBe('no');
    expect(deducibleEnForma({ rfcPropio: true, comprobante: 'sin_comprobante', cfdiUuid: null })).toBe('no');
  });
});
