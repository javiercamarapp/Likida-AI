import { beforeEach, describe, expect, it, vi } from 'vitest';

const dobles = vi.hoisted(() => ({
  supabaseAdmin: vi.fn(),
  listarFacturasSaas: vi.fn(),
  getGastosDelMes: vi.fn(),
  leerComisionesDelMes: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: dobles.supabaseAdmin }));
vi.mock('@/lib/saas/transferencia', () => ({ listarFacturasSaas: dobles.listarFacturasSaas, TECHO_FACTURAS_SAAS: 2000 }));
vi.mock('@/lib/admin/negocio', () => ({ costoIaVentana: vi.fn() }));
vi.mock('./gastos', () => ({ getGastosDelMes: dobles.getGastosDelMes }));
vi.mock('./comisiones', () => ({ leerComisionesDelMes: dobles.leerComisionesDelMes }));
vi.mock('./contabilidad', () => ({ leerMovimientosDelMes: vi.fn() }));

import {
  AREAS, AUTOMATIZACION_POR_AREA, armarTablero, leerTablero, resumenCierres, resumenContratos, resumenFacturacion, resumenGastos, resumenObligaciones,
  type DatosTablero,
} from './tablero';
import type { CierreGuardado, FacturaInsumo } from './cierre';
import { NO_DISPONIBLE, OK } from './lectura';

const P = '2026-11-01';
const HOY = '2026-11-16';

const fac = (o: Partial<FacturaInsumo> = {}): FacturaInsumo => ({
  id: 'f', tenantId: 't1', tenantNombre: 'Flota Uno', estado: 'pagada', periodoInicio: '2026-11-01', totalCent: 116000, subtotalCent: 100000, ivaCent: 16000,
  creadaEn: '2026-11-01T12:00:00Z', pagadaEn: '2026-11-10T16:00:00Z', conciliadaEn: '2026-11-10T16:00:00Z', referenciaBanco: 'SPEI 1', ...o,
});
const sinPago = { pagadaEn: null, conciliadaEn: null, referenciaBanco: null };

describe('resumenFacturacion', () => {
  const facturas = [
    fac({ id: 'a' }), // cobrada en noviembre, emitida el 1 y pagada el 10: 9 días
    fac({ id: 'b', periodoInicio: '2026-10-01', totalCent: 58000, creadaEn: '2026-10-01T12:00:00Z', pagadaEn: '2026-10-12T16:00:00Z', conciliadaEn: '2026-10-12T16:00:00Z' }), // 11 días
    fac({ id: 'c', estado: 'pendiente', ...sinPago }),
    fac({ id: 'd', estado: 'fallida', periodoInicio: '2026-10-01', creadaEn: '2026-10-01T12:00:00Z', ...sinPago }),
    fac({ id: 'e', referenciaBanco: null, conciliadaEn: null }), // «pagada» sin evidencia de banco
    fac({ id: 'x', estado: 'cancelada', ...sinPago }),
  ];

  it('cobrado del mes con evidencia de banco, por cobrar y su factura más vieja', () => {
    const r = resumenFacturacion(facturas, false, P, HOY);
    expect(r.cobradoMesCent).toBe(116000);
    expect(r.nCobradasMes).toBe(1);
    expect(r.porCobrarCent).toBe(232000);
    expect(r.nPorCobrar).toBe(2);
    // La fallida del 1 de octubre lleva 46 días a hoy (16-nov).
    expect(r.masViejaDias).toBe(46);
  });

  it('serie de seis meses con ceros reales y el mes en curso al final', () => {
    const r = resumenFacturacion(facturas, false, P, HOY);
    expect(r.serieCobrado?.map((s) => s.periodo)).toEqual(['2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01', '2026-10-01', '2026-11-01']);
    expect(r.serieCobrado?.map((s) => s.cent)).toEqual([0, 0, 0, 0, 58000, 116000]);
  });

  it('las mensualidades del mes por estado: la «pagada» sin evidencia va aparte y la cancelada no cuenta', () => {
    expect(resumenFacturacion(facturas, false, P, HOY).estadosMes).toEqual({ cobradas: 1, pagadasSinEvidencia: 1, pendientes: 1, fallidas: 0 });
  });

  it('DSO: promedio de días de emisión a cobro; con cero cobros NO se reporta (null, no 0)', () => {
    const r = resumenFacturacion(facturas, false, P, HOY);
    expect(r.dsoDias).toBe(10);
    expect(r.nParaDso).toBe(2);
    const sin = resumenFacturacion([fac({ id: 'c', estado: 'pendiente', ...sinPago })], false, P, HOY);
    expect(sin.dsoDias).toBeNull();
    expect(sin.nParaDso).toBe(0);
    expect(sin.cobradoMesCent).toBe(0);
  });

  it('con la lista recortada no se presentan por cobrar, serie ni la más vieja como completos', () => {
    const r = resumenFacturacion(facturas, true, P, HOY);
    expect(r.porCobrarCent).toBeNull();
    expect(r.nPorCobrar).toBeNull();
    expect(r.serieCobrado).toBeNull();
    expect(r.masViejaDias).toBeNull();
  });

  it('un mes sin facturas: cero real, sin más vieja', () => {
    const r = resumenFacturacion([], false, P, HOY);
    expect(r.cobradoMesCent).toBe(0);
    expect(r.porCobrarCent).toBe(0);
    expect(r.masViejaDias).toBeNull();
  });
});

describe('resumenGastos', () => {
  const g = (o: Record<string, unknown>) => ({
    id: 'g', proveedorId: null, proveedor: null, fecha: '2026-11-02', periodo: P, concepto: null, moneda: 'MXN' as const, totalCent: 1000, subtotalCent: null,
    ivaAcreditableCent: null, cfdiUuid: null, comprobante: 'sin_comprobante' as const, cuentaContable: null, conciliado: false, ...o,
  });
  it('total, conteos y «conciliados» como n de m', () => {
    const r = resumenGastos([g({}), g({ conciliado: true, comprobante: 'cfdi' }), g({ totalCent: 500, comprobante: 'invoice_extranjero' })]);
    expect(r).toEqual({ totalCent: 2500, n: 3, conciliados: 1, sinComprobante: 1 });
  });
  it('sin gastos es un cero real de un mes leído, con n = 0', () => {
    expect(resumenGastos([])).toEqual({ totalCent: 0, n: 0, conciliados: 0, sinComprobante: 0 });
  });
});

describe('resumenContratos', () => {
  it('cuenta los que vencen en 30 días (hoy incluido), los vencidos y los sin fecha; no cuenta los terminados', () => {
    const r = resumenContratos([
      { vence_el: '2026-11-16', estado: 'vigente' }, // hoy: 0 días
      { vence_el: '2026-12-16', estado: 'por_renovar' }, // 30 días justos
      { vence_el: '2026-12-17', estado: 'vigente' }, // 31: fuera de ventana
      { vence_el: '2026-11-15', estado: 'vigente' }, // vencido ayer
      { vence_el: null, estado: 'vigente' }, // sin fecha: nunca «vigente por defecto»
      { vence_el: '2026-11-20', estado: 'terminado' },
      { vence_el: null, estado: 'terminado' },
    ], HOY);
    expect(r).toEqual({ vivos: 5, vencenEn30: 2, vencidos: 1, sinFecha: 1, total: 7 });
  });
  it('sin contratos todo es 0 con total 0 (la tabla existe y está vacía)', () => {
    expect(resumenContratos([], HOY)).toEqual({ vivos: 0, vencenEn30: 0, vencidos: 0, sinFecha: 0, total: 0 });
  });
  it('una fecha con hora se lee por su día', () => {
    expect(resumenContratos([{ vence_el: '2026-11-20T00:00:00+00:00', estado: 'vigente' }], HOY).vencenEn30).toBe(1);
  });
});

describe('resumenObligaciones', () => {
  it('las que aún esperan al contador son las de catálogo pendiente (o sin catálogo declarado)', () => {
    expect(resumenObligaciones([
      { clave: 'iva', estado_catalogo: 'pendiente_de_contador' },
      { clave: 'isr', estado_catalogo: 'confirmada' },
      { clave: 'diot', estado_catalogo: null },
    ])).toEqual({ catalogadas: 3, pendientesDeContador: 2 });
  });
});

describe('resumenCierres', () => {
  const cierre = (periodo: string, estado: CierreGuardado['estado'], cerradoEn: string | null): CierreGuardado => ({
    periodo, estado, netoCent: null, tipoCambio: null, snapshot: null, cerradoPor: cerradoEn ? 'u' : null, cerradoEn, actualizadoEn: null,
  });

  it('el mes por cerrar es el anterior; el último cierre y los días hábiles salen de los cerrados', () => {
    const r = resumenCierres([
      cierre('2026-10-01', 'cerrado', '2026-11-04T18:00:00Z'),
      cierre('2026-09-01', 'cerrado', '2026-10-02T18:00:00Z'),
      cierre('2026-08-01', 'abierto', null),
    ], P);
    expect(r.mesPorCerrar).toEqual({ periodo: '2026-10-01', estado: 'cerrado' });
    expect(r.ultimoCerrado).toEqual({ periodo: '2026-10-01', dias: 3 });
    expect(r.serieDias).toEqual([{ periodo: '2026-09-01', dias: 2 }, { periodo: '2026-10-01', dias: 3 }]);
  });

  it('sin cierres: el mes por cerrar no tiene borrador (null) y no hay último cierre', () => {
    const r = resumenCierres([], P);
    expect(r.mesPorCerrar).toEqual({ periodo: '2026-10-01', estado: null });
    expect(r.ultimoCerrado).toBeNull();
    expect(r.serieDias).toEqual([]);
  });
});

describe('armarTablero: el estado honesto de las ocho áreas', () => {
  const sinDatos: DatosTablero = {
    periodo: P, hoy: HOY,
    entidad: NO_DISPONIBLE, facturas: NO_DISPONIBLE, gastos: NO_DISPONIBLE, comisiones: NO_DISPONIBLE, contratos: NO_DISPONIBLE, obligaciones: NO_DISPONIBLE, cierres: NO_DISPONIBLE,
  };
  const entidad = (rfc: string | null) => OK({ razonSocial: 'Likida', rfc, regimenFiscal: null, domicilioFiscalCp: null, constituidaEl: null, actualizadaPor: null, actualizadaEn: null });

  it('sin ninguna tabla: «no disponible» (no cero), contabilidad bloqueada por la entidad, nómina se compra, compliance enlaza', () => {
    const t = armarTablero(sinDatos);
    expect(t.estados).toEqual({
      facturacion: 'no_disponible', contabilidad: 'bloqueada_entidad', gastos: 'no_disponible', comisiones: 'no_disponible',
      nomina: 'compra', legal: 'no_disponible', compliance: 'operativa', reporting: 'no_disponible',
    });
    expect(t.candado).toBe('sin_rfc');
    // Nada se convierte en un resumen con ceros: la lectura sigue siendo no_disponible.
    expect(t.gastos).toEqual({ estado: 'no_disponible' });
    expect(t.facturacion).toEqual({ estado: 'no_disponible' });
    expect(t.comisiones).toEqual({ estado: 'no_disponible' });
  });

  it('con RFC propio la contabilidad deja de estar bloqueada y sigue a su fuente', () => {
    const operativa = armarTablero({ ...sinDatos, entidad: entidad('LIK261101ABA'), obligaciones: OK([]) });
    expect(operativa.candado).toBe('con_rfc');
    expect(operativa.estados.contabilidad).toBe('operativa');
    expect(armarTablero({ ...sinDatos, entidad: entidad('LIK261101ABA') }).estados.contabilidad).toBe('no_disponible');
  });

  it('sin RFC (entidad capturada pero sin RFC) la contabilidad sigue bloqueada aunque haya obligaciones', () => {
    expect(armarTablero({ ...sinDatos, entidad: entidad(null), obligaciones: OK([]) }).estados.contabilidad).toBe('bloqueada_entidad');
  });

  it('una entidad que no se pudo leer NO se asume sin RFC ni con RFC: contabilidad en error', () => {
    const t = armarTablero({ ...sinDatos, entidad: { estado: 'error', mensaje: 'caída' }, obligaciones: OK([]) });
    expect(t.candado).toBe('desconocido');
    expect(t.estados.contabilidad).toBe('error');
  });

  it('una fuente leída es operativa; una que falló es error y no «0»', () => {
    const t = armarTablero({
      ...sinDatos, gastos: OK([]), comisiones: { estado: 'error', mensaje: 'x' }, contratos: OK([]), cierres: OK([]),
      facturas: OK({ filas: [], truncada: false }),
    });
    expect(t.estados).toMatchObject({ gastos: 'operativa', comisiones: 'error', legal: 'operativa', reporting: 'operativa', facturacion: 'operativa' });
    expect(t.gastos).toEqual({ estado: 'ok', dato: { totalCent: 0, n: 0, conciliados: 0, sinComprobante: 0 } });
    expect(t.comisiones).toEqual({ estado: 'error', mensaje: 'x' });
  });
});

describe('automatización por área', () => {
  it('cubre las ocho áreas en el mismo orden; nómina es «no aplica» (se compra) y no un cero', () => {
    expect(AUTOMATIZACION_POR_AREA.map((a) => a.id)).toEqual([...AREAS]);
    expect(AUTOMATIZACION_POR_AREA.find((a) => a.id === 'nomina')?.pct).toBeNull();
    for (const a of AUTOMATIZACION_POR_AREA.filter((x) => x.id !== 'nomina')) {
      expect(a.pct).toBeGreaterThan(0);
      expect(a.pct).toBeLessThanOrEqual(100);
    }
  });
});

describe('leerTablero', () => {
  beforeEach(() => {
    dobles.supabaseAdmin.mockReset().mockImplementation(() => { throw new Error('Supabase service-role no configurado'); });
    dobles.listarFacturasSaas.mockReset().mockRejectedValue(new Error('listarFacturasSaas: sin conexión'));
    dobles.getGastosDelMes.mockReset().mockRejectedValue(new Error('gastos: sin conexión'));
    dobles.leerComisionesDelMes.mockReset().mockRejectedValue(new Error('Cannot find module ./comisiones'));
  });

  it('nunca lanza: con todo caído, cada fuente dice «error» o «no disponible» por su lado, jamás cero', async () => {
    const t = await leerTablero(new Date('2026-11-16T18:00:00Z'));
    expect(t.periodo).toBe('2026-11-01');
    expect(t.candado).toBe('desconocido');
    expect(t.estados).toMatchObject({ facturacion: 'error', gastos: 'error', comisiones: 'no_disponible', legal: 'error', reporting: 'error', contabilidad: 'error', nomina: 'compra' });
    expect(t.gastos.estado).toBe('error');
    expect(t.comisiones.estado).toBe('no_disponible');
  });

  it('con datos reales arma los resúmenes del mes de México (no el de UTC)', async () => {
    // 2026-12-01T00:30:00Z = 30-nov 18:30 en México: sigue siendo noviembre.
    dobles.listarFacturasSaas.mockReset().mockResolvedValue({ filas: [], total: 0, truncado: false });
    dobles.getGastosDelMes.mockReset().mockResolvedValue(OK([]));
    dobles.leerComisionesDelMes.mockReset().mockResolvedValue(OK({ periodo: P, devengadoCent: 0, clawbackCent: 0, pagadoCent: 0 }));
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'limit', 'order']) q[m] = vi.fn(() => q);
    q.maybeSingle = vi.fn(async () => ({ data: null, error: null }));
    q.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(res);
    dobles.supabaseAdmin.mockReset().mockReturnValue({ from: () => q });
    const t = await leerTablero(new Date('2026-12-01T00:30:00Z'));
    expect(t.periodo).toBe('2026-11-01');
    expect(t.estados).toMatchObject({ facturacion: 'operativa', gastos: 'operativa', comisiones: 'operativa', legal: 'operativa', reporting: 'operativa', contabilidad: 'bloqueada_entidad' });
    expect(t.facturacion).toMatchObject({ estado: 'ok', dato: { cobradoMesCent: 0, nCobradasMes: 0, dsoDias: null } });
  });
});
