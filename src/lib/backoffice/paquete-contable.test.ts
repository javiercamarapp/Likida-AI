import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CUENTAS_PROPUESTAS } from './cuentas';
import type { Candado } from './fiscal';
import { armarBalanza, comprobacionesLibro, estadoDeResultados, invertir } from './libro';
import { armarLibro, cobro, gastoNube } from './libro_fixtures';
import {
  armarDiot, armarPaquete, balanzaCsv, campoCsv, cruzarContraCierre, marcaDeSoporte, movimientosDe, movimientosSinCfdi, pesosCsv, polizasCsv, resumenIva,
  type EntradaPaquete,
} from './paquete-contable';
import type { GastoMes } from './tipos';

const CUENTAS = CUENTAS_PROPUESTAS.map((c) => ({ ...c }));
const CON_RFC: Candado = { bloqueado: false, rfc: 'ABC010101AB1' };
const SIN_RFC: Candado = { bloqueado: true, motivo: 'sin_rfc' };
const PERIODO = '2026-10-01';

const gasto = (extra: Partial<GastoMes> = {}): GastoMes => ({
  id: 'g1', proveedorId: 'p1', proveedor: 'Proveedor Uno', fecha: '2026-10-05', periodo: PERIODO, concepto: 'Hosting', moneda: 'MXN', totalCent: 11600,
  subtotalCent: 10000, ivaAcreditableCent: 1600, cfdiUuid: 'UUID-1', comprobante: 'cfdi', cuentaContable: '5100', conciliado: false, ...extra,
});

const libroDelMes = () => armarLibro([
  { fecha: '2026-10-05', lineas: cobro(100000), soporte: 'cfdi' },
  { fecha: '2026-10-09', lineas: gastoNube(30000), soporte: 'ninguno', descripcion: 'Gasto sin factura' },
]);

function entrada(extra: Partial<EntradaPaquete> = {}): EntradaPaquete {
  const asientos = libroDelMes();
  return {
    periodo: PERIODO, candado: CON_RFC, asientos, cuentas: CUENTAS, comprobaciones: comprobacionesLibro(asientos, CUENTAS),
    gastos: [gasto()], rfcPorProveedor: { p1: 'ABC010101AB1' }, cierre: { periodo: PERIODO, ingresosCent: 100000, costosYGastosCent: 30000 }, ivaTrasladadoCent: 16000, ...extra,
  };
}

describe('CSV genérico', () => {
  it('pesosCsv trabaja con enteros: sin coma flotante ni localización', () => {
    expect(pesosCsv(123456)).toBe('1234.56');
    expect(pesosCsv(5)).toBe('0.05');
    expect(pesosCsv(0)).toBe('0.00');
    expect(pesosCsv(-250)).toBe('-2.50');
    expect(pesosCsv(100000000)).toBe('1000000.00');
  });

  it('campoCsv entrecomilla lo que trae coma o comillas y neutraliza fórmulas de hoja de cálculo', () => {
    expect(campoCsv('Hosting')).toBe('Hosting');
    expect(campoCsv('a,b')).toBe('"a,b"');
    expect(campoCsv('dijo "hola"')).toBe('"dijo ""hola"""');
    expect(campoCsv('=SUMA(A1)')).toBe("'=SUMA(A1)");
    expect(campoCsv(null)).toBe('');
  });

  it('la balanza en CSV trae encabezado, una fila por cuenta y la suma de debe y haber', () => {
    const csv = balanzaCsv(armarBalanza(libroDelMes(), CUENTAS)).split('\n');
    expect(csv[0]).toBe('cuenta,nombre,tipo,naturaleza,debe,haber,saldo');
    expect(csv).toContain('1110,Bancos,A,D,1000.00,300.00,700.00');
    expect(csv[csv.length - 1]).toBe('TOTAL,,,,1300.00,1300.00,');
  });

  it('un movimiento sin CFDI sale marcado «SIN CFDI — no incluir sin revisión»; con CFDI, sin marca', () => {
    expect(marcaDeSoporte('ninguno')).toBe('SIN CFDI — no incluir sin revisión');
    expect(marcaDeSoporte('cfdi')).toBe('');
    expect(marcaDeSoporte('invoice_extranjero')).toContain('Invoice extranjero');
    const movs = movimientosDe(libroDelMes());
    expect(movimientosSinCfdi(movs)).toBe(2); // las dos líneas del gasto sin factura
    const filas = polizasCsv(movs, new Map([['id-2', 'A-0002']])).split('\n');
    expect(filas[0]).toBe('folio,fecha,cuenta,debe,haber,concepto,soporte,marca');
    const sinCfdi = filas.filter((f) => f.includes('SIN CFDI'));
    expect(sinCfdi).toHaveLength(2);
    expect(sinCfdi[0].startsWith('A-0002,2026-10-09,5100,300.00,0.00')).toBe(true);
    expect(filas.filter((f) => f.includes(',cfdi,'))[0].endsWith(',cfdi,')).toBe(true);
  });
});

describe('cruce contra el cierre', () => {
  const resultados = estadoDeResultados(libroDelMes(), CUENTAS);

  it('si cuadra, cuadra; si no, muestra la diferencia y NO ajusta', () => {
    const ok = cruzarContraCierre(resultados, { periodo: PERIODO, ingresosCent: 100000, costosYGastosCent: 30000 });
    expect(ok).toMatchObject({ cuadra: true, ajusta: false });
    const mal = cruzarContraCierre(resultados, { periodo: PERIODO, ingresosCent: 90000, costosYGastosCent: 30000 });
    expect(mal.cuadra).toBe(false);
    expect(mal.ajusta).toBe(false);
    expect(mal.filas[0]).toEqual({ concepto: 'ingresos', libroCent: 100000, cierreCent: 90000, diferenciaCent: 10000, cuadra: false });
    expect(mal.filas[1].cuadra).toBe(true);
  });

  it('sin cierre, o con un componente que el cierre no trae, es «sin dato» (null), nunca cuadra ni no cuadra', () => {
    expect(cruzarContraCierre(resultados, null)).toMatchObject({ cuadra: null, ajusta: false });
    const parcial = cruzarContraCierre(resultados, { periodo: PERIODO, ingresosCent: 100000, costosYGastosCent: null });
    expect(parcial.cuadra).toBeNull();
    expect(parcial.filas[1]).toMatchObject({ cierreCent: null, diferenciaCent: null, cuadra: null });
  });

  it('una diferencia pesa más que un faltante: si algo no cuadra, el veredicto es false', () => {
    const r = cruzarContraCierre(resultados, { periodo: PERIODO, ingresosCent: 1, costosYGastosCent: null });
    expect(r.cuadra).toBe(false);
  });
});

describe('DIOT', () => {
  it('agrupa por RFC del proveedor y suma base e IVA', () => {
    const d = armarDiot([gasto({ id: 'a' }), gasto({ id: 'b', subtotalCent: 5000, ivaAcreditableCent: 800, totalCent: 5800 })], { p1: 'abc010101ab1' });
    expect(d.pendientes).toEqual([]);
    expect(d.renglones).toEqual([{ rfc: 'ABC010101AB1', proveedor: 'Proveedor Uno', operaciones: 2, baseCent: 15000, ivaCent: 2400, totalCent: 17400 }]);
    expect(d.baseTotalCent).toBe(15000);
    expect(d.ivaTotalCent).toBe(2400);
  });

  it('solo entran gastos con RFC de proveedor; los demás quedan pendientes con su motivo', () => {
    const d = armarDiot([
      gasto({ id: 'ok' }),
      gasto({ id: 'sin-rfc', proveedorId: 'p2' }),
      gasto({ id: 'sin-prov', proveedorId: null }),
      gasto({ id: 'rfc-mal', proveedorId: 'p3' }),
      gasto({ id: 'sin-comp', comprobante: 'sin_comprobante', cfdiUuid: null }),
      gasto({ id: 'ext', comprobante: 'invoice_extranjero', cfdiUuid: null }),
      gasto({ id: 'sin-uuid', cfdiUuid: null }),
      gasto({ id: 'sin-desglose', ivaAcreditableCent: null }),
    ], { p1: 'ABC010101AB1', p2: null, p3: 'XX' });
    expect(d.renglones).toHaveLength(1);
    expect(Object.fromEntries(d.pendientes.map((p) => [p.gastoId, p.motivo]))).toEqual({
      'sin-rfc': 'sin_rfc_proveedor', 'sin-prov': 'sin_rfc_proveedor', 'rfc-mal': 'rfc_invalido', 'sin-comp': 'sin_comprobante', ext: 'invoice_extranjero',
      'sin-uuid': 'sin_cfdi_uuid', 'sin-desglose': 'sin_desglose',
    });
  });

  it('sin gastos no hay renglones y los totales son cero reales', () => {
    expect(armarDiot([], {})).toEqual({ renglones: [], pendientes: [], baseTotalCent: 0, ivaTotalCent: 0 });
  });
});

describe('resumen de IVA', () => {
  it('a pagar = trasladado − acreditable cuando todo está declarado', () => {
    const r = resumenIva({ ivaTrasladadoCent: 16000, gastos: [gasto(), gasto({ id: 'g2', ivaAcreditableCent: 0, subtotalCent: 500, totalCent: 500 })] });
    expect(r).toEqual({ trasladadoCent: 16000, acreditableCent: 1600, aPagarCent: 14400, motivoSinDato: null, gastosSinIva: [] });
  });

  it('saldo a favor: queda negativo, no se trunca a cero', () => {
    expect(resumenIva({ ivaTrasladadoCent: 1000, gastos: [gasto()] }).aPagarCent).toBe(-600);
  });

  it('a pagar es null si algún gasto no declara su IVA acreditable (no se asume cero)', () => {
    const r = resumenIva({ ivaTrasladadoCent: 16000, gastos: [gasto(), gasto({ id: 'g2', ivaAcreditableCent: null })] });
    expect(r.aPagarCent).toBeNull();
    expect(r.motivoSinDato).toBe('gasto_sin_iva');
    expect(r.gastosSinIva).toEqual(['g2']);
  });

  it('a pagar es null sin IVA trasladado o sin gastos leídos', () => {
    expect(resumenIva({ ivaTrasladadoCent: null, gastos: [gasto()] })).toMatchObject({ aPagarCent: null, motivoSinDato: 'sin_trasladado' });
    expect(resumenIva({ ivaTrasladadoCent: 16000, gastos: null })).toMatchObject({ aPagarCent: null, acreditableCent: null, motivoSinDato: 'sin_gastos_leidos' });
  });

  it('solo acredita el IVA de gastos con CFDI', () => {
    const r = resumenIva({ ivaTrasladadoCent: 5000, gastos: [gasto({ comprobante: 'sin_comprobante', ivaAcreditableCent: 1600 })] });
    expect(r.acreditableCent).toBe(0);
    expect(r.aPagarCent).toBe(5000);
  });
});

describe('armarPaquete', () => {
  it('sin RFC propio devuelve { bloqueado: sin_rfc } y NADA más (no se rellena ningún dato fiscal)', () => {
    const p = armarPaquete(entrada({ candado: SIN_RFC }));
    expect(p).toEqual({ bloqueado: 'sin_rfc' });
  });

  it('una entidad ilegible también bloquea con su causa', () => {
    expect(armarPaquete(entrada({ candado: { bloqueado: true, motivo: 'entidad_no_disponible' } }))).toEqual({ bloqueado: 'entidad_no_disponible' });
  });

  it('con RFC y el libro sano: paquete listo, con balanza, pólizas, cruce, DIOT e IVA', () => {
    const p = armarPaquete(entrada());
    if (p.bloqueado !== false) throw new Error('debía armarse');
    expect(p.listo).toBe(true);
    expect(p.motivosNoListo).toEqual([]);
    expect(p.balanza.cuadra).toBe(true);
    expect(p.cruce).toMatchObject({ cuadra: true, ajusta: false });
    expect(p.diot?.renglones).toHaveLength(1);
    expect(p.iva.aPagarCent).toBe(14400);
    expect(p.movimientosSinCfdi).toBe(2);
    expect(p.advertencias).toEqual(['movimientos_sin_cfdi']);
    expect(p.balanzaCsv.startsWith('cuenta,nombre')).toBe(true);
    expect(p.polizasCsv).toContain('SIN CFDI — no incluir sin revisión');
  });

  it('el cruce que no cuadra advierte pero NO ajusta el libro ni bloquea el paquete', () => {
    const p = armarPaquete(entrada({ cierre: { periodo: PERIODO, ingresosCent: 90000, costosYGastosCent: 30000 } }));
    if (p.bloqueado !== false) throw new Error('debía armarse');
    expect(p.cruce.cuadra).toBe(false);
    expect(p.cruce.ajusta).toBe(false);
    expect(p.advertencias).toContain('cruce_no_cuadra');
    expect(p.listo).toBe(true);
    // el libro del mes sigue igual: el cruce no tocó nada
    expect(p.resultados.ingresosCent).toBe(100000);
  });

  it('sin cierre ni gastos: advertencias honestas, sin ceros inventados', () => {
    const p = armarPaquete(entrada({ cierre: null, gastos: null, ivaTrasladadoCent: null }));
    if (p.bloqueado !== false) throw new Error('debía armarse');
    expect(p.diot).toBeNull();
    expect(p.iva.aPagarCent).toBeNull();
    expect(p.advertencias).toEqual(expect.arrayContaining(['cruce_sin_cierre', 'diot_sin_gastos', 'iva_a_pagar_sin_dato']));
  });

  it('una comprobación bloqueante en rojo o un mes sin movimientos NO están listos', () => {
    const roto = armarLibro([{ fecha: '2026-10-05', lineas: [{ cuenta: '1110', debeCent: 100, haberCent: 0 }, { cuenta: '4100', debeCent: 0, haberCent: 90 }] }]);
    const p = armarPaquete(entrada({ asientos: roto, comprobaciones: comprobacionesLibro(roto, CUENTAS) }));
    if (p.bloqueado !== false) throw new Error('debía armarse');
    expect(p.listo).toBe(false);
    expect(p.motivosNoListo).toContain('comprobacion_bloqueante');
    const vacio = armarPaquete(entrada({ asientos: [], comprobaciones: comprobacionesLibro([], CUENTAS) }));
    if (vacio.bloqueado !== false) throw new Error('debía armarse');
    expect(vacio.listo).toBe(false);
    expect(vacio.motivosNoListo).toEqual(['sin_movimientos']);
  });

  it('una reversa en el mes neutraliza al original en la balanza del paquete', () => {
    const l = armarLibro([
      { fecha: '2026-10-05', lineas: cobro(10000) },
      { fecha: '2026-10-06', lineas: invertir(cobro(10000)), origenTipo: 'reversa', reversaDe: 'id-1' },
    ]);
    const p = armarPaquete(entrada({ asientos: l, comprobaciones: comprobacionesLibro(l, CUENTAS) }));
    if (p.bloqueado !== false) throw new Error('debía armarse');
    expect(p.balanza.filas.every((f) => f.saldoCent === 0)).toBe(true);
  });
});

describe('el módulo no llama al SAT ni a ningún servicio externo', () => {
  const ARCHIVOS = ['fiscal.ts', 'calendario.ts', 'libro.ts', 'cuentas.ts', 'paquete-contable.ts', 'contabilidad.ts', 'insumos-contables.ts'];
  const leer = (f: string) => readFileSync(join(process.cwd(), 'src/lib/backoffice', f), 'utf8');
  const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1');

  it('ninguno hace fetch, abre URLs ni menciona el dominio del SAT en código', () => {
    for (const f of ARCHIVOS) {
      const codigo = sinComentarios(leer(f));
      expect(codigo, f).not.toMatch(/\bfetch\s*\(/);
      expect(codigo, f).not.toMatch(/https?:\/\//);
      expect(codigo, f).not.toMatch(/sat\.gob/i);
      expect(codigo, f).not.toMatch(/\bXMLHttpRequest\b|\baxios\b/);
    }
  });

  it('las piezas puras no dependen en compilación de los lotes A ni C (reciben los insumos por parámetro)', () => {
    for (const f of ['fiscal.ts', 'calendario.ts', 'libro.ts', 'cuentas.ts', 'paquete-contable.ts']) {
      const codigo = sinComentarios(leer(f));
      expect(codigo, f).not.toMatch(/from '\.\/(cierre|gastos|comisiones|tesoreria|entidad|reporte|tablero)'/);
      expect(codigo, f).not.toMatch(/supabase/i);
    }
  });
});
