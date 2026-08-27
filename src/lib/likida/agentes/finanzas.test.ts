import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// LOS 4 AGENTES FINANCIEROS (0215) — los contratos que el código sostiene:
//  · CERO modelo: cada cifra del parte la calculó el sistema — el agente no
//    puede alucinar porque no hay quién alucine.
//  · Fail closed y DICHO: una lectura caída ⇒ corrida en fallo y NINGÚN
//    parte — jamás un parte de $0 sobre una base ciega.
//  · Un parte por periodo: el pre-check corta; el índice único de la 0215 es
//    el árbitro real y su rebote se trata como «ya existía», no como fallo.
//  · Los ROJOS (U1 de costos, runway < 3 meses) van al operador YA, sin
//    esperar a que alguien abra la bandeja.
//  · NULL ≠ 0 en todos lados: sin viajes no hay costo unitario; sin saldo
//    declarado no hay runway; churn sin base es SIN DATO.
// ═══════════════════════════════════════════════════════════════════════════

// Una cola de respuestas por tabla: cada elemento es la respuesta COMPLETA
// ({ data, error } o { count, error }) que la siguiente consulta a esa tabla
// se lleva. Vacía ⇒ éxito sin filas (y conteo 0), para no fallar por omisión.
const respuestas = new Map<string, Array<Record<string, unknown>>>();
function responderDe(tabla: string) {
  const cola = respuestas.get(tabla);
  return cola && cola.length > 0 ? cola.shift()! : { data: [], count: 0, error: null };
}
function builder(tabla: string) {
  const b: Record<string, unknown> = {};
  Object.assign(b, {
    select: () => b, eq: () => b, is: () => b, gte: () => b, lt: () => b,
    in: () => b, limit: () => b, maybeSingle: () => b, order: () => b,
    then: (res: (x: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve().then(() => responderDe(tabla)).then(res, rej),
  });
  return b;
}
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: (t: string) => builder(t) }) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const registrarCorrida = vi.fn(async (..._a: unknown[]) => undefined);
vi.mock('./corridas', () => ({ registrarCorrida: (...a: unknown[]) => registrarCorrida(...a) }));
const encolarPieza = vi.fn(async (..._a: unknown[]) => 'pieza-1');
vi.mock('./cola', () => ({ encolarPieza: (...a: unknown[]) => encolarPieza(...a) }));
const alertarOperador = vi.fn(async (..._a: unknown[]) => undefined);
vi.mock('@/lib/observability/alerta', () => ({ alertarOperador: (...a: unknown[]) => alertarOperador(...a) }));

// El modelo esperado por rol, fijo en la prueba — lo que models.ts resuelva
// en el entorno de CI no puede decidir si U1 pasa o truena.
vi.mock('@/lib/llm/models', () => ({ modelFor: (rol: string) => `modelo-${rol}` }));

const RESUMEN_VACIO = {
  costoIaUsd: 0, viajesProcesados: 0, porDia: [] as Array<{ dia: string; costoUsd: number; tokens: number }>,
  tendenciaCosto: null as number | null,
};
const getResumenNegocio = vi.fn(async (..._a: unknown[]): Promise<unknown> => RESUMEN_VACIO);
const getCostoPorFaseModelo = vi.fn(async (): Promise<unknown[]> => []);
const getConteosPlataforma = vi.fn(async (): Promise<unknown> => ({
  operadores: 0, liquidaciones: 0, conversacionesWa: 0, usuarios: 0, usuariosPorRol: [],
}));
const costoIaMesActual = vi.fn(async () => ({ mesUsd: 0, llamadas: 0, etiquetaMes: 'agosto' }));
const costoIaVentana = vi.fn(async (..._a: unknown[]) => ({
  totales: { n: 0, costoUsd: 0, tokensIn: 0, tokensOut: 0 },
  porFase: [], porTenant: [],
}));
vi.mock('@/lib/admin/negocio', () => ({
  getResumenNegocio: (...a: unknown[]) => getResumenNegocio(...a),
  getCostoPorFaseModelo: () => getCostoPorFaseModelo(),
  getConteosPlataforma: () => getConteosPlataforma(),
  costoIaMesActual: () => costoIaMesActual(),
  costoIaVentana: (...a: unknown[]) => costoIaVentana(...a),
}));
const getPorCobrar = vi.fn(async (): Promise<Array<{ monto: number }>> => []);
vi.mock('@/lib/saas/transferencia', () => ({ getPorCobrar: () => getPorCobrar() }));
const getPlanes = vi.fn(async (): Promise<unknown[]> => []);
vi.mock('@/lib/saas/suscripcion', () => ({ getPlanes: () => getPlanes() }));

const {
  lunesDeSemana, mesAnterior, tocaCerrar,
  evaluarUmbralesCostos, armarParteTesoreria, armarParteMetricas, armarCierreMensual,
  correrAgenteFinanciero, semaforoDeRunway,
} = await import('./finanzas');

beforeEach(() => {
  respuestas.clear();
  vi.clearAllMocks();
  getResumenNegocio.mockResolvedValue(RESUMEN_VACIO);
  getCostoPorFaseModelo.mockResolvedValue([]);
});

const CFG_VACIA = {
  saldoMxn: null, saldoFecha: null, costoVidaMxn: null, fijosMxn: null,
  presupuestoIaMesUsd: null, tipoCambioMxnUsd: null,
};

describe('los periodos (día de México, aritmética pura)', () => {
  it('el lunes ancla la semana: jueves, lunes y domingo caen al mismo lunes… de SU semana', () => {
    expect(lunesDeSemana('2026-08-27')).toBe('2026-08-24'); // jueves
    expect(lunesDeSemana('2026-08-24')).toBe('2026-08-24'); // el propio lunes
    expect(lunesDeSemana('2026-08-30')).toBe('2026-08-24'); // domingo cierra la semana, no la abre
  });
  it('el mes anterior cruza el año', () => {
    expect(mesAnterior('2026-01-15')).toBe('2025-12');
    expect(mesAnterior('2026-08-27')).toBe('2026-07');
  });
  it('el cierre no corre antes del día 3 (aproximación calendario, declarada)', () => {
    expect(tocaCerrar('2026-09-02')).toBe(false);
    expect(tocaCerrar('2026-09-03')).toBe(true);
  });
});

describe('evaluarUmbralesCostos — los umbrales del blueprint, puros', () => {
  const esperado = (rol: string) => `modelo-${rol}`;

  it('U1: una fase corriendo con un modelo distinto del esperado es ROJO con nombre y costo', () => {
    const h = evaluarUmbralesCostos(RESUMEN_VACIO, [
      { fase: 'ocr', modelo: 'modelo-caro-equivocado', n: 40, costoUsd: 1.76 },
      { fase: 'cuadre', modelo: 'modelo-cuadre', n: 10, costoUsd: 0.2 },
    ], CFG_VACIA, esperado, '2026-08-27');
    const u1 = h.filter((x) => x.umbral === 'U1');
    expect(u1).toHaveLength(1);
    expect(u1[0].semaforo).toBe('ROJO');
    expect(u1[0].detalle).toContain('ocr');
    expect(u1[0].detalle).toContain('modelo-caro-equivocado');
  });

  it('U1: fases con su modelo esperado no gritan', () => {
    const h = evaluarUmbralesCostos(RESUMEN_VACIO, [
      { fase: 'ocr', modelo: 'modelo-ocr', n: 40, costoUsd: 0.06 },
    ], CFG_VACIA, esperado, '2026-08-27');
    expect(h.filter((x) => x.umbral === 'U1')).toHaveLength(0);
  });

  it('U2 exige el salto Y el piso de dinero — 30% sobre centavos es ruido, no fuga', () => {
    const porDiaGrande = [{ dia: 'd', costoUsd: 6, tokens: 0 }];
    const conPiso = evaluarUmbralesCostos(
      { ...RESUMEN_VACIO, tendenciaCosto: 35, porDia: porDiaGrande }, [], CFG_VACIA, esperado, '2026-08-27');
    expect(conPiso.some((x) => x.umbral === 'U2')).toBe(true);
    const sinPiso = evaluarUmbralesCostos(
      { ...RESUMEN_VACIO, tendenciaCosto: 35, porDia: [{ dia: 'd', costoUsd: 0.4, tokens: 0 }] },
      [], CFG_VACIA, esperado, '2026-08-27');
    expect(sinPiso.some((x) => x.umbral === 'U2')).toBe(false);
  });

  it('U3: sin viajes NO se divide (null no es 0); con viajes y banda rebasada, ámbar', () => {
    const sinViajes = evaluarUmbralesCostos(
      { ...RESUMEN_VACIO, costoIaUsd: 5, viajesProcesados: 0 }, [], CFG_VACIA, esperado, '2026-08-27');
    expect(sinViajes.some((x) => x.umbral === 'U3')).toBe(false);
    const fueraDeBanda = evaluarUmbralesCostos(
      { ...RESUMEN_VACIO, costoIaUsd: 1, viajesProcesados: 10 }, [], CFG_VACIA, esperado, '2026-08-27');
    expect(fueraDeBanda.some((x) => x.umbral === 'U3' && x.semaforo === 'AMBAR')).toBe(true);
  });

  it('U4: sin presupuesto declarado es NOTA (no se compara contra nada inventado); rebasado es ámbar', () => {
    const porDia = [{ dia: 'd', costoUsd: 10, tokens: 0 }];
    const sinPresupuesto = evaluarUmbralesCostos(
      { ...RESUMEN_VACIO, porDia }, [], CFG_VACIA, esperado, '2026-08-27');
    expect(sinPresupuesto.some((x) => x.umbral === 'U4' && x.semaforo === 'NOTA')).toBe(true);
    const rebasado = evaluarUmbralesCostos(
      { ...RESUMEN_VACIO, porDia }, [], { presupuestoIaMesUsd: 150 }, esperado, '2026-08-27');
    // 10/día × 30 = 300 > 150
    expect(rebasado.some((x) => x.umbral === 'U4' && x.semaforo === 'AMBAR')).toBe(true);
  });

  it('U5 es de calendario: solo la semana del vencimiento del precio intro', () => {
    const en = evaluarUmbralesCostos(RESUMEN_VACIO, [], CFG_VACIA, esperado, '2026-09-02');
    expect(en.some((x) => x.umbral === 'U5')).toBe(true);
    const fuera = evaluarUmbralesCostos(RESUMEN_VACIO, [], CFG_VACIA, esperado, '2026-08-27');
    expect(fuera.some((x) => x.umbral === 'U5')).toBe(false);
  });
});

describe('armarParteTesoreria — el runway honesto', () => {
  const base = { hoy: '2026-08-27', cobradoMesMxn: 0, porCobrar: 0, porCobrarMonto: 0, costoIaMesUsd: 2 };

  it('sin saldo declarado NO hay runway — y el parte dice qué declarar', () => {
    const { cuerpo, semaforo, runwayMeses } = armarParteTesoreria({ ...base, cfg: CFG_VACIA }, '2026-08-24');
    expect(semaforo).toBe('SIN_SALDO');
    expect(runwayMeses).toBeNull();
    expect(cuerpo).toContain('SIN SALDO DECLARADO');
    expect(cuerpo).toContain('finanzas_config');
    expect(cuerpo).not.toMatch(/RUNWAY: \d/);
  });

  it('con todo declarado calcula la quema, el runway y el semáforo — y el ROJO es < 3 meses', () => {
    const cfg = {
      saldoMxn: 150_000, saldoFecha: '2026-08-25', costoVidaMxn: 65_000,
      fijosMxn: 6_500, presupuestoIaMesUsd: null, tipoCambioMxnUsd: 18.5,
    };
    const { semaforo, runwayMeses, cuerpo } = armarParteTesoreria({ ...base, cfg }, '2026-08-24');
    // quema = 6500 + 65000 + 37 − 0 = 71,537 → 150,000/71,537 ≈ 2.1 meses
    expect(runwayMeses).toBe(2.1);
    expect(semaforo).toBe('ROJO');
    expect(cuerpo).toContain('una factura emitida no es caja');
  });

  it('el saldo viejo (> 10 días) se advierte en la primera parte del parte', () => {
    const cfg = {
      saldoMxn: 500_000, saldoFecha: '2026-08-01', costoVidaMxn: 65_000,
      fijosMxn: 6_500, presupuestoIaMesUsd: null, tipoCambioMxnUsd: 18.5,
    };
    const { cuerpo } = armarParteTesoreria({ ...base, cfg }, '2026-08-24');
    expect(cuerpo).toContain('26 días');
  });

  it('quema ≤ 0 no es «runway infinito»: es el mes en positivo, con la serie pendiente', () => {
    const cfg = {
      saldoMxn: 100_000, saldoFecha: '2026-08-25', costoVidaMxn: 0,
      fijosMxn: 0, presupuestoIaMesUsd: null, tipoCambioMxnUsd: 18.5,
    };
    const { cuerpo, runwayMeses } = armarParteTesoreria({ ...base, cfg, cobradoMesMxn: 9_500 }, '2026-08-24');
    expect(runwayMeses).toBeNull();
    expect(cuerpo).toContain('POSITIVO');
    // La frase explica que NO se declara infinito; lo que no puede existir es
    // un runway numérico afirmado sobre un solo mes bueno.
    expect(cuerpo).not.toMatch(/RUNWAY: \d/);
  });

  it('los cortes del semáforo son 9/6/3', () => {
    expect(semaforoDeRunway(9.5)).toBe('VERDE');
    expect(semaforoDeRunway(7)).toBe('AMARILLO');
    expect(semaforoDeRunway(4)).toBe('AMBAR');
    expect(semaforoDeRunway(2.9)).toBe('ROJO');
  });
});

describe('armarParteMetricas — cifra + absoluto + fuente, y el $0 verdadero', () => {
  it('con base cero: MRR $0 real (no placeholder) y churn SIN DATO (no 0%)', () => {
    const parte = armarParteMetricas({
      activas: 0, mrrMxn: 0, activasSinPrecio: 0,
      pipeline: [{ estado: 'nuevo', n: 829 }, { estado: 'cerrado', n: 0 }],
      conteos: { operadores: 0, liquidaciones: 0, conversacionesWa: 0, usuarios: 3, usuariosPorRol: [] },
      costoIaUsd: 12.34, viajesProcesados: 0, porCobrar: 0, porCobrarMonto: 0,
    }, '2026-08-24');
    expect(parte).toContain('MRR: $0 — 0 suscripciones activas');
    expect(parte).toContain('Churn: SIN DATO');
    expect(parte).toContain('DESCONOCIDA — cero cerrados');
    expect(parte).not.toContain('Churn: 0%');
  });

  it('activas sin precio configurado ⇒ el MRR se declara incompleto, no se inventa', () => {
    const parte = armarParteMetricas({
      activas: 2, mrrMxn: null, activasSinPrecio: 1,
      pipeline: [], conteos: { operadores: 0, liquidaciones: 0, conversacionesWa: 0, usuarios: 0, usuariosPorRol: [] },
      costoIaUsd: 0, viajesProcesados: 0, porCobrar: 0, porCobrarMonto: 0,
    }, '2026-08-24');
    expect(parte).toContain('SIN CIFRA COMPLETA');
    expect(parte).toContain('sin precio configurado');
  });
});

describe('armarCierreMensual — el cierre que también cierra un mes de $0', () => {
  it('lista lo que no se pudo cerrar (pagadas sin fecha, config sin declarar) y marca al piloto', () => {
    const cierre = armarCierreMensual({
      mes: '2026-07', cobradoMxn: 0, cobradasN: 0, pagadasSinFecha: 2,
      pendientes: 1, pendientesMonto: 9_500, costoIaMesUsd: 3.5, llamadasIa: 120,
      porFase: [{ fase: 'ocr', n: 100, costoUsd: 3 }],
      porTenant: [{ nombre: 'Flota Demo', costoUsd: 3.5, cobradoMxn: 0 }],
      fijosMxn: null, tipoCambio: null,
    });
    expect(cierre).toContain('NO SE PUDO CERRAR:');
    expect(cierre).toContain('conciliación incompleta');
    expect(cierre).toContain('fijos_mxn');
    expect(cierre).toContain('[piloto/demo — cobrado $0]');
    expect(cierre).toContain('NO SE PRORRATEA');
    expect(cierre).toContain('pendiente de firma');
  });

  it('con todo declarado arma el neto con su desglose', () => {
    const cierre = armarCierreMensual({
      mes: '2026-07', cobradoMxn: 9_500, cobradasN: 1, pagadasSinFecha: 0,
      pendientes: 0, pendientesMonto: 0, costoIaMesUsd: 10, llamadasIa: 50,
      porFase: [], porTenant: [], fijosMxn: 6_500, tipoCambio: 18.5,
    });
    expect(cierre).toContain('nada — lista vacía');
    // 9500 − 185 − 6500 = 2815
    expect(cierre).toContain('$2,815.00');
  });
});

describe('las corridas — fail closed, idempotencia y el ROJO que no espera', () => {
  it('una lectura caída ⇒ corrida en FALLO y ningún parte (jamás $0 sobre base ciega)', async () => {
    getResumenNegocio.mockRejectedValueOnce(new Error('resumen_costo_ia: base caída'));
    await expect(correrAgenteFinanciero('control_costos', 'cron', '2026-08-27')).rejects.toThrow('base caída');
    expect(encolarPieza).not.toHaveBeenCalled();
    expect(registrarCorrida).toHaveBeenCalledWith(null, 'control_costos',
      expect.objectContaining({ estado: 'fallo' }));
  });

  it('el parte del periodo ya en bandeja ⇒ no fabrica otro y la corrida lo dice', async () => {
    respuestas.set('cola_aprobacion', [{ count: 1, error: null }]);
    const r = await correrAgenteFinanciero('control_costos', 'cron', '2026-08-27');
    expect(r.piezas).toBe(0);
    expect(r.motivo).toContain('ya está en la bandeja');
    expect(encolarPieza).not.toHaveBeenCalled();
    expect(registrarCorrida).toHaveBeenCalledWith(null, 'control_costos',
      expect.objectContaining({ estado: 'ok', resumen: expect.objectContaining({ parte: 'ya_existia' }) }));
  });

  it('si la bandeja no se puede LEER, no se fabrica (fail closed del pre-check)', async () => {
    respuestas.set('cola_aprobacion', [{ count: null, error: { message: 'timeout' } }]);
    await expect(correrAgenteFinanciero('control_costos', 'cron', '2026-08-27')).rejects.toThrow('timeout');
    expect(encolarPieza).not.toHaveBeenCalled();
  });

  it('U1 dispara la alerta al operador ADEMÁS del parte — y la corrida cuenta el rojo', async () => {
    respuestas.set('cola_aprobacion', [{ count: 0, error: null }]);
    respuestas.set('finanzas_config', [{ data: null, error: null }]);
    getCostoPorFaseModelo.mockResolvedValueOnce([
      { fase: 'ocr', modelo: 'otro-modelo', n: 10, costoUsd: 0.5 },
    ]);
    const r = await correrAgenteFinanciero('control_costos', 'cron', '2026-08-27');
    expect(r.piezas).toBe(1);
    expect(alertarOperador).toHaveBeenCalledWith('finanzas.control_costos',
      expect.objectContaining({ codigo: 'finanzas_u1_modelo_inesperado' }));
    expect(encolarPieza).toHaveBeenCalledWith(expect.objectContaining({
      tipo: 'parte_costos', agente: 'control_costos', titulo: 'Costos — 2026-08-27',
    }));
    expect(registrarCorrida).toHaveBeenCalledWith(null, 'control_costos',
      expect.objectContaining({ estado: 'ok', resumen: expect.objectContaining({ rojos: 1 }) }));
  });

  it('la carrera del periodo la gana la base: el rebote del índice único se trata como «ya existía»', async () => {
    respuestas.set('cola_aprobacion', [{ count: 0, error: null }]);
    respuestas.set('finanzas_config', [{ data: null, error: null }]);
    encolarPieza.mockRejectedValueOnce(new Error(
      'encolarPieza: duplicate key value violates unique constraint "cola_parte_por_periodo"'));
    const r = await correrAgenteFinanciero('control_costos', 'cron', '2026-08-27');
    expect(r.piezas).toBe(0);
    expect(r.motivo).toContain('otra corrida ganó el periodo');
    expect(registrarCorrida).toHaveBeenCalledWith(null, 'control_costos',
      expect.objectContaining({ estado: 'ok' }));
  });

  it('el cierre no corre antes del día 3 — sin corrida y sin pieza, con el motivo dicho', async () => {
    const r = await correrAgenteFinanciero('cierre_mensual', 'cron', '2026-09-02');
    expect(r.piezas).toBe(0);
    expect(r.motivo).toContain('día 3');
    expect(registrarCorrida).not.toHaveBeenCalled();
    expect(encolarPieza).not.toHaveBeenCalled();
  });

  it('tesorería con runway ROJO alerta al operador sin esperar al lunes', async () => {
    respuestas.set('cola_aprobacion', [{ count: 0, error: null }]);
    respuestas.set('finanzas_config', [{
      data: {
        saldo_mxn: 100_000, saldo_fecha: '2026-08-25', costo_vida_mxn: 65_000,
        fijos_mxn: 6_500, presupuesto_ia_mes_usd: null, tipo_cambio_mxn_usd: 18.5,
      },
      error: null,
    }]);
    respuestas.set('factura_saas', [
      { data: [], error: null },          // cobradas del mes
      { count: 0, error: null },          // pagadas sin fecha
    ]);
    const r = await correrAgenteFinanciero('tesoreria', 'cron', '2026-08-27');
    expect(r.piezas).toBe(1);
    expect(alertarOperador).toHaveBeenCalledWith('finanzas.tesoreria',
      expect.objectContaining({ codigo: 'finanzas_runway_rojo' }));
  });

  it('el analista arma su parte con la base en cero — cifras reales, no placeholders', async () => {
    respuestas.set('cola_aprobacion', [{ count: 0, error: null }]);
    respuestas.set('suscripcion', [{ data: [], error: null }]);
    respuestas.set('prospecto', [
      { count: 3, error: null }, { count: 0, error: null }, { count: 0, error: null },
      { count: 0, error: null }, { count: 0, error: null }, { count: 0, error: null },
    ]);
    const r = await correrAgenteFinanciero('analista_metricas', 'cron', '2026-08-27');
    expect(r.piezas).toBe(1);
    const pieza = encolarPieza.mock.calls[0][0] as { titulo: string; cuerpo: string };
    expect(pieza.titulo).toBe('Métricas — semana del 2026-08-24');
    expect(pieza.cuerpo).toContain('MRR: $0');
    expect(pieza.cuerpo).toContain('nuevo 3');
  });

  it('el cierre del día 3 arma el mes anterior y lo encola una vez', async () => {
    respuestas.set('cola_aprobacion', [{ count: 0, error: null }]);
    respuestas.set('finanzas_config', [{ data: null, error: null }]);
    respuestas.set('factura_saas', [
      { data: [{ tenant_id: 't-1', monto: 9500, pagada_en: '2026-08-15' }], error: null },
      { count: 0, error: null },
    ]);
    respuestas.set('tenant', [{ data: [{ id: 't-1', nombre: 'Flota Uno' }], error: null }]);
    const r = await correrAgenteFinanciero('cierre_mensual', 'cron', '2026-09-03');
    expect(r.piezas).toBe(1);
    const pieza = encolarPieza.mock.calls[0][0] as { titulo: string; cuerpo: string };
    expect(pieza.titulo).toBe('Cierre — 2026-08');
    expect(pieza.cuerpo).toContain('Flota Uno');
    expect(pieza.cuerpo).toContain('$9,500.00');
  });
});
