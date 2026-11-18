import { describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => { throw new Error('sin base en esta prueba'); } }));
import { contratoDeFila, exigeEntidad, listarContratos, motivoValido, parsearDiasAviso, parsearPesosACentavos, validarContrato } from './contratos';

const base = { tipo: 'suscripcion', contraparte: 'Vercel' };

describe('validarContrato', () => {
  it('mínimo válido: borrador, sin fecha, aviso de 30 días', () => {
    const r = validarContrato(base);
    expect(r).toMatchObject({ ok: true, valor: { tipo: 'suscripcion', contraparte: 'Vercel', venceEl: null, firmadoEl: null, diasAviso: [30], estado: 'borrador', renovacionAuto: false } });
  });
  it('rechaza tipo, contraparte, fechas, orden de fechas, costo, url y estado inválidos', () => {
    expect(validarContrato({ ...base, tipo: 'x' })).toEqual({ ok: false, error: 'tipo' });
    expect(validarContrato({ ...base, contraparte: '  ' })).toEqual({ ok: false, error: 'contraparte' });
    expect(validarContrato({ ...base, firmadoEl: '2026-02-30' })).toEqual({ ok: false, error: 'firmado_fecha' });
    expect(validarContrato({ ...base, venceEl: 'mañana' })).toEqual({ ok: false, error: 'vence_fecha' });
    expect(validarContrato({ ...base, firmadoEl: '2026-06-01', venceEl: '2026-05-31' })).toEqual({ ok: false, error: 'vence_antes_de_firma' });
    expect(validarContrato({ ...base, costoMensual: '-5' })).toEqual({ ok: false, error: 'costo' });
    expect(validarContrato({ ...base, documentoUrl: 'javascript:alert(1)' })).toEqual({ ok: false, error: 'documento_url' });
    expect(validarContrato({ ...base, estado: 'terminado' })).toEqual({ ok: false, error: 'estado' });
    expect(validarContrato({ ...base, diasAviso: '0' })).toEqual({ ok: false, error: 'dias_aviso' });
  });
  it('vence el mismo día que firma es válido', () => {
    expect(validarContrato({ ...base, firmadoEl: '2026-06-01', venceEl: '2026-06-01' }).ok).toBe(true);
  });
  it('costo en centavos sin errores de coma flotante', () => {
    const r = validarContrato({ ...base, costoMensual: '$1,250.10' });
    expect(r.ok && r.valor.costoMensualCent).toBe(125010);
  });
});

describe('parsearDiasAviso y parsearPesosACentavos', () => {
  it('lista ordenada de mayor a menor y sin repetidos; vacío usa la omisión', () => {
    expect(parsearDiasAviso('30, 60 30')).toEqual([60, 30]);
    expect(parsearDiasAviso('')).toEqual([30]);
    expect(parsearDiasAviso(undefined, [15])).toEqual([15]);
  });
  it('rechaza cero, 366, texto y más de 6 valores', () => {
    for (const t of ['0', '366', 'a', '1,2,3,4,5,6,7', '-3', '1.5']) expect(parsearDiasAviso(t)).toBeNull();
    expect(parsearDiasAviso('365')).toEqual([365]);
  });
  it('pesos a centavos', () => {
    expect(parsearPesosACentavos('0')).toBe(0);
    expect(parsearPesosACentavos('0.1')).toBe(10);
    expect(parsearPesosACentavos('19.99')).toBe(1999);
    expect(parsearPesosACentavos('1.234')).toBeNull();
    expect(parsearPesosACentavos('abc')).toBeNull();
  });
});

describe('candado de entidad: un contrato de cliente no se firma sin RFC propio', () => {
  const cliente = (p: object) => ({ tipo: 'cliente' as const, estado: 'borrador' as const, firmadoEl: null, ...p });
  it('borrador sin firma pasa aunque no haya RFC', () => {
    expect(exigeEntidad(cliente({}), null)).toBeNull();
  });
  it('con fecha de firma o estado vigente y sin RFC: bloqueado', () => {
    expect(exigeEntidad(cliente({ firmadoEl: '2026-11-01' }), null)).toBe('sin_rfc');
    expect(exigeEntidad(cliente({ estado: 'vigente' }), '')).toBe('sin_rfc');
    expect(exigeEntidad(cliente({ estado: 'vigente' }), '   ')).toBe('sin_rfc');
  });
  it('con RFC pasa', () => {
    expect(exigeEntidad(cliente({ estado: 'vigente' }), 'XAXX010101000')).toBeNull();
  });
  it('otros tipos no se bloquean', () => {
    expect(exigeEntidad({ tipo: 'suscripcion', estado: 'vigente', firmadoEl: '2026-01-01' }, null)).toBeNull();
  });
});

describe('motivoValido', () => {
  it('exige al menos 5 caracteres', () => {
    expect(motivoValido('')).toBeNull();
    expect(motivoValido('  no  ')).toBeNull();
    expect(motivoValido(' se canceló ')).toBe('se canceló');
  });
});

describe('lectura', () => {
  it('contratoDeFila convierte pesos a centavos y rellena el aviso por omisión', () => {
    const c = contratoDeFila({ id: 'a', tipo: 'dominio', contraparte: 'x', tenant_id: null, descripcion: null, firmado_el: null, vence_el: null, renovacion_auto: false, dias_aviso: null, responsable: null, costo_mensual_mxn: '12.34', documento_url: null, estado: 'vigente', motivo_terminacion: null, creado_en: '2026-11-01' });
    expect(c.costoMensualCent).toBe(1234);
    expect(c.diasAviso).toEqual([30]);
  });
  it('una base inaccesible es error, no una lista vacía', async () => {
    const r = await listarContratos();
    expect(r.estado).toBe('error');
  });
});
