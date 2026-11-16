import { describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => { throw new Error('sin base en esta prueba'); } }));
import { estadoCfdiHonorarios, hallazgosContratista, validarContratista, type Contratista } from './contratistas';

const c = (p: Partial<Contratista> = {}): Contratista => ({
  id: '1', nombre: 'Persona', rol: null, esquema: 'comision', rfc: 'XAXX010101000', cfdiHonorariosVigente: true,
  constanciaSituacionFiscalEn: '2026-10-01', contratoId: null, vendedorId: null, activo: true, nota: null, ...p,
});

describe('CFDI de honorarios', () => {
  it('true vigente, false vencido, null ausente; sueldo fijo y proveedor de nómina no aplican', () => {
    expect(estadoCfdiHonorarios(c())).toBe('vigente');
    expect(estadoCfdiHonorarios(c({ cfdiHonorariosVigente: false }))).toBe('vencido');
    expect(estadoCfdiHonorarios(c({ cfdiHonorariosVigente: null }))).toBe('ausente');
    expect(estadoCfdiHonorarios(c({ esquema: 'honorarios', cfdiHonorariosVigente: null }))).toBe('ausente');
    expect(estadoCfdiHonorarios(c({ esquema: 'sueldo_fijo', cfdiHonorariosVigente: null }))).toBe('no_aplica');
    expect(estadoCfdiHonorarios(c({ esquema: 'proveedor_nomina' }))).toBe('no_aplica');
  });
  it('hallazgos: comisión con CFDI vencido o ausente se marca; en orden no hay ninguno', () => {
    expect(hallazgosContratista(c())).toEqual([]);
    expect(hallazgosContratista(c({ cfdiHonorariosVigente: false }))).toEqual(['cfdi_vencido']);
    expect(hallazgosContratista(c({ cfdiHonorariosVigente: null, rfc: null, constanciaSituacionFiscalEn: null }))).toEqual(['cfdi_ausente', 'sin_rfc', 'sin_constancia']);
  });
  it('un contratista inactivo o de sueldo fijo no genera hallazgos de CFDI', () => {
    expect(hallazgosContratista(c({ activo: false, cfdiHonorariosVigente: false }))).toEqual([]);
    expect(hallazgosContratista(c({ esquema: 'sueldo_fijo', cfdiHonorariosVigente: null, rfc: null }))).toEqual([]);
  });
});

describe('validarContratista', () => {
  it('mínimo válido: CFDI sin dato (null)', () => {
    expect(validarContratista({ nombre: ' Ana ', esquema: 'comision' })).toMatchObject({ ok: true, valor: { nombre: 'Ana', cfdiHonorariosVigente: null, rfc: null } });
  });
  it('rechaza nombre, esquema, RFC con dígito verificador malo, cfdi y fecha inválidos', () => {
    expect(validarContratista({ nombre: '', esquema: 'comision' })).toEqual({ ok: false, error: 'nombre' });
    expect(validarContratista({ nombre: 'a', esquema: 'nomina' })).toEqual({ ok: false, error: 'esquema' });
    expect(validarContratista({ nombre: 'a', esquema: 'comision', rfc: 'ABC' })).toEqual({ ok: false, error: 'rfc' });
    expect(validarContratista({ nombre: 'a', esquema: 'comision', cfdiVigente: 'quiza' })).toEqual({ ok: false, error: 'cfdi' });
    expect(validarContratista({ nombre: 'a', esquema: 'comision', constanciaEn: '2026-13-01' })).toEqual({ ok: false, error: 'constancia' });
  });
  it('RFC genérico se normaliza a mayúsculas; si/no se vuelve booleano', () => {
    const r = validarContratista({ nombre: 'a', esquema: 'honorarios', rfc: 'xaxx010101000', cfdiVigente: 'no' });
    expect(r).toMatchObject({ ok: true, valor: { rfc: 'XAXX010101000', cfdiHonorariosVigente: false } });
  });
});
