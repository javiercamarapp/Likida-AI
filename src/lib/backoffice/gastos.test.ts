import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => { throw new Error('esta prueba es pura'); } }));

import {
  gastoDuplicado, gastoPorMes, gastoPorProveedor, normalizarGasto, proveedoresSinGastoReciente, resumirGastos, totalGastosCent, totalMxnCent, type EntradaGasto, type GastoFila,
} from './gastos';
import type { Proveedor } from './proveedores';
import { ErrorBo } from './utiles-c';

const HOY = '2026-11-15';
const base: EntradaGasto = { proveedorId: 'p1', fecha: '2026-11-03', concepto: 'Plan Pro', moneda: 'MXN', montoOriginal: 116, comprobante: 'sin_comprobante' };
const clave = (e: () => unknown): string | null => { try { e(); return null; } catch (x) { return x instanceof ErrorBo ? x.clave : `otro:${String(x)}`; } };

describe('normalizarGasto', () => {
  it('MXN: el periodo es el mes de la fecha y el total son los centavos exactos', () => {
    const g = normalizarGasto(base, HOY);
    expect(g).toMatchObject({ periodo: '2026-11-01', moneda: 'MXN', totalCent: 11600, tipoCambio: null, subtotalCent: null, ivaAcreditableCent: null });
  });

  it('USD sin tipo de cambio se rechaza; con él se convierte a MXN', () => {
    expect(clave(() => normalizarGasto({ ...base, moneda: 'USD', montoOriginal: 20 }, HOY))).toBe('gastos.err_sin_tipo_cambio');
    expect(clave(() => normalizarGasto({ ...base, moneda: 'USD', montoOriginal: 20, tipoCambio: 0 }, HOY))).toBe('gastos.err_sin_tipo_cambio');
    const g = normalizarGasto({ ...base, moneda: 'USD', montoOriginal: 20, tipoCambio: 20.5 }, HOY);
    expect(g).toMatchObject({ moneda: 'USD', montoOriginalCent: 2000, tipoCambio: 20.5, totalCent: 41000 });
  });

  it('redondea a centavos: medio centavo sube', () => {
    expect(totalMxnCent('USD', 1, 0.5)).toBe(1);
    expect(totalMxnCent('USD', 3, 0.5)).toBe(2);
    expect(totalMxnCent('MXN', 1234, null)).toBe(1234);
    expect(totalMxnCent('USD', 100, null)).toBeNull();
  });

  it('IVA: solo un CFDI lo declara; subtotal = total − IVA; sin declarar no es cero', () => {
    const u = 'AAAAAAAA-0000-4000-8000-000000000001';
    const g = normalizarGasto({ ...base, comprobante: 'cfdi', cfdiUuid: u, ivaAcreditable: 16 }, HOY);
    expect(g).toMatchObject({ totalCent: 11600, ivaAcreditableCent: 1600, subtotalCent: 10000, cfdiUuid: u.toLowerCase() });
    expect(normalizarGasto({ ...base, comprobante: 'cfdi', cfdiUuid: u }, HOY)).toMatchObject({ ivaAcreditableCent: null, subtotalCent: null });
    expect(clave(() => normalizarGasto({ ...base, ivaAcreditable: 16 }, HOY))).toBe('gastos.err_iva_sin_cfdi');
    expect(clave(() => normalizarGasto({ ...base, comprobante: 'cfdi', cfdiUuid: u, ivaAcreditable: 500 }, HOY))).toBe('gastos.err_iva_mayor');
  });

  it('valida el comprobante y el UUID', () => {
    expect(clave(() => normalizarGasto({ ...base, comprobante: 'cfdi' }, HOY))).toBe('gastos.err_uuid');
    expect(clave(() => normalizarGasto({ ...base, comprobante: 'cfdi', cfdiUuid: 'no-es-uuid' }, HOY))).toBe('gastos.err_uuid');
    expect(clave(() => normalizarGasto({ ...base, cfdiUuid: 'AAAAAAAA-0000-4000-8000-000000000001' }, HOY))).toBe('gastos.err_uuid_sin_cfdi');
    expect(clave(() => normalizarGasto({ ...base, comprobante: 'recibo' }, HOY))).toBe('gastos.err_comprobante');
  });

  it('rechaza fecha futura o rota, concepto vacío, moneda rara y monto inválido', () => {
    expect(clave(() => normalizarGasto({ ...base, fecha: '2026-11-16' }, HOY))).toBe('gastos.err_fecha_futura');
    expect(clave(() => normalizarGasto({ ...base, fecha: '15/11/2026' }, HOY))).toBe('gastos.err_fecha');
    expect(clave(() => normalizarGasto({ ...base, concepto: '  ' }, HOY))).toBe('gastos.err_concepto');
    expect(clave(() => normalizarGasto({ ...base, moneda: 'EUR' }, HOY))).toBe('gastos.err_moneda');
    expect(clave(() => normalizarGasto({ ...base, montoOriginal: -1 }, HOY))).toBe('gastos.err_monto');
    expect(clave(() => normalizarGasto({ ...base, montoOriginal: Number.NaN }, HOY))).toBe('gastos.err_monto');
  });

  it('31-dic en México sigue siendo diciembre (el mes no sale de UTC)', () => {
    expect(normalizarGasto({ ...base, fecha: '2026-12-31' }, '2026-12-31').periodo).toBe('2026-12-01');
  });
});

describe('gastoDuplicado', () => {
  const previo = { id: 'g1', proveedorId: 'p1', fecha: '2026-11-03', totalCent: 11600, concepto: 'Plan Pro', cfdiUuid: 'aaaaaaaa-0000-4000-8000-000000000001' };
  it('por UUID de CFDI (sin importar mayúsculas)', () => {
    expect(gastoDuplicado({ proveedorId: 'p2', fecha: '2026-11-09', totalCent: 1, concepto: 'x', cfdiUuid: 'AAAAAAAA-0000-4000-8000-000000000001' }, [previo])).toEqual({ por: 'cfdi_uuid', id: 'g1' });
  });
  it('por llave compuesta (proveedor, fecha, total, concepto sin acentos ni mayúsculas)', () => {
    expect(gastoDuplicado({ proveedorId: 'p1', fecha: '2026-11-03', totalCent: 11600, concepto: ' PLAN pró ', cfdiUuid: null }, [{ ...previo, concepto: 'plan pro' }])).toEqual({ por: 'llave_compuesta', id: 'g1' });
  });
  it('otro proveedor, fecha o total NO es duplicado', () => {
    for (const cambio of [{ proveedorId: 'p9' }, { fecha: '2026-11-04' }, { totalCent: 11601 }]) {
      expect(gastoDuplicado({ proveedorId: 'p1', fecha: '2026-11-03', totalCent: 11600, concepto: 'Plan Pro', cfdiUuid: null, ...cambio }, [{ ...previo, cfdiUuid: null }])).toBeNull();
    }
  });
  it('sin proveedor no hay llave compuesta que comparar', () => {
    expect(gastoDuplicado({ proveedorId: null, fecha: '2026-11-03', totalCent: 11600, concepto: 'Plan Pro', cfdiUuid: null }, [{ ...previo, proveedorId: null, cfdiUuid: null }])).toBeNull();
  });
});

const prov = (o: Partial<Proveedor>): Proveedor => ({ id: 'p1', nombre: 'Vercel', rfc: null, categoria: 'infraestructura', cuentaContable: null, cadencia: 'mensual', activo: true, creadoEn: '2026-01-10T12:00:00Z', ...o });

describe('proveedoresSinGastoReciente (alerta de fijos)', () => {
  const ref = '2026-11-01';
  it('un fijo mensual sin gasto en los dos meses completos previos alerta, con cuántos lleva', () => {
    const r = proveedoresSinGastoReciente([prov({})], [{ proveedorId: 'p1', periodo: '2026-08-01' }], ref, 2);
    expect(r).toHaveLength(1);
    expect(r[0].mesesSinGasto).toBe(2);
  });
  it('con gasto en el mes anterior no alerta', () => {
    expect(proveedoresSinGastoReciente([prov({})], [{ proveedorId: 'p1', periodo: '2026-10-01' }], ref, 2)).toEqual([]);
  });
  it('un gasto de hace dos meses basta para el primero pero no cuenta como «seguidos»: alerta de 1 mes no se emite', () => {
    expect(proveedoresSinGastoReciente([prov({})], [{ proveedorId: 'p1', periodo: '2026-09-01' }], ref, 2)).toEqual([]);
  });
  it('no alerta a inactivos, anuales ni a los dados de alta hace menos de la ventana', () => {
    expect(proveedoresSinGastoReciente([prov({ activo: false })], [], ref, 2)).toEqual([]);
    expect(proveedoresSinGastoReciente([prov({ cadencia: 'anual' })], [], ref, 2)).toEqual([]);
    expect(proveedoresSinGastoReciente([prov({ creadoEn: '2026-10-20T12:00:00Z' })], [], ref, 2)).toEqual([]);
  });
});

const fila = (o: Partial<GastoFila>): GastoFila => ({
  id: 'g', proveedorId: 'p1', proveedor: 'Vercel', fecha: '2026-11-03', periodo: '2026-11-01', concepto: 'x', moneda: 'MXN', totalCent: 10000, subtotalCent: null, ivaAcreditableCent: null,
  cfdiUuid: null, comprobante: 'sin_comprobante', cuentaContable: null, conciliado: false, montoOriginalCent: 10000, tipoCambio: null, deducibleEnForma: 'no_evaluable', conciliadoEn: null, referenciaBanco: null, ...o,
});

describe('resumen y gráficas', () => {
  it('resumirGastos: IVA sin declarar es null, no cero', () => {
    const r = resumirGastos([fila({}), fila({ id: 'g2', comprobante: 'cfdi', conciliado: true })]);
    expect(r).toMatchObject({ n: 2, totalCent: 20000, sinComprobante: 1, conciliados: 1, ivaAcreditableCent: null, conIvaDeclarado: 0 });
    expect(resumirGastos([fila({ ivaAcreditableCent: 1600 }), fila({ id: 'g2', ivaAcreditableCent: 400 }), fila({ id: 'g3' })])).toMatchObject({ ivaAcreditableCent: 2000, conIvaDeclarado: 2 });
  });
  it('totalGastosCent suma centavos enteros', () => {
    expect(totalGastosCent([{ totalCent: 1 }, { totalCent: 2 }])).toBe(3);
    expect(totalGastosCent([])).toBe(0);
  });
  it('gastoPorMes deja SIN dato (null) el mes sin capturas', () => {
    const m = gastoPorMes([{ periodo: '2026-11-01', totalCent: 500 }, { periodo: '2026-09-01', totalCent: 300 }], '2026-11-01', 4);
    expect(m.map((x) => x.periodo)).toEqual(['2026-08-01', '2026-09-01', '2026-10-01', '2026-11-01']);
    expect(m.map((x) => x.totalCent)).toEqual([null, 300, null, 500]);
  });
  it('gastoPorProveedor ordena y agrupa los sin proveedor', () => {
    const r = gastoPorProveedor([
      { proveedorId: 'a', proveedor: 'A', totalCent: 100 }, { proveedorId: 'b', proveedor: 'B', totalCent: 900 },
      { proveedorId: null, proveedor: null, totalCent: 50 }, { proveedorId: 'a', proveedor: 'A', totalCent: 100 },
    ], 'Sin proveedor');
    expect(r.map((x) => [x.etiqueta, x.totalCent])).toEqual([['B', 900], ['A', 200], ['Sin proveedor', 50]]);
  });
});
