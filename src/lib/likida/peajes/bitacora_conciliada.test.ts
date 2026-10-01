import { describe, it, expect, vi, beforeEach } from 'vitest';
import { crearDbFalsa, type DbFalsa, type Fila } from './db_falsa.test.util';

let db: DbFalsa;
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => db.cliente }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { bitacoraConciliada, bitacoraConciliadaACsv, celdaCsvSegura, ENCABEZADOS_CSV_CONCILIADA } = await import('./bitacora_conciliada');

const T = 'flota-1';
const linea = (o: Fila): Fila => ({
  tenant_id: T, desglose_id: 'd1', fecha: '2026-08-05', hora: '10:30:00', caseta: 'Caseta Ejemplo Norte', monto: 189, tag: 'IMDM 10000001',
  estatus: 'sin_contraparte', diferencia: null, detalle: null, viaje_id: null, unidad_id: null, caseta_id: null,
  gps_veredicto: null, gps_distancia_m: null, gps_detalle: null, ...o,
});

beforeEach(() => {
  db = crearDbFalsa({
    desglose_peaje: [{ id: 'd1', tenant_id: T, proveedor: 'PASE', periodo_desde: '2026-08-05', periodo_hasta: '2026-08-07' }],
    unidad: [{ id: 'u1', tenant_id: T, numero_economico: 'C2-08', placas: null }],
    viaje: [{ id: 'v1', tenant_id: T, folio: 'V-100' }],
    peaje_caseta: [{ id: 'c1', tenant_id: T, nombre: 'Caseta Ejemplo Norte', nombre_norm: 'caseta ejemplo norte', alias: [], lat: 19.5, lng: -99.2, radio_m: 300, activa: true }],
    desglose_peaje_linea: [
      linea({ indice: 0, estatus: 'cuadra', viaje_id: 'v1', unidad_id: 'u1', caseta_id: 'c1', diferencia: 0, detalle: { gastoId: 'g1' }, gps_veredicto: 'confirma', gps_distancia_m: 111.2, gps_detalle: { via: 'muestra', muestras: 3 } }),
      linea({ indice: 1, estatus: 'cuadra', viaje_id: 'v1', gps_veredicto: 'no_coincide', gps_distancia_m: 8000, gps_detalle: { muestras: 2 }, monto: 250 }),
      linea({ indice: 2, estatus: 'sin_contraparte', detalle: { motivo: 'sin_gastos_en_ventana', fondo_gastos: 12 }, gps_veredicto: 'sin_datos', gps_detalle: { motivo: 'sin_unidad', muestras: 0 }, monto: 300 }),
      linea({ indice: 3, estatus: 'sin_contraparte', fecha: null, hora: null, detalle: { motivo: 'sin_fecha' }, gps_veredicto: 'sin_datos', gps_detalle: { motivo: 'sin_fecha', muestras: 0 }, monto: 99 }),
      linea({ indice: 4, estatus: 'no_cuadra', detalle: { motivo: 'monto_distinto' }, diferencia: 11.5, monto: 100.5 }),
      // una línea ANTERIOR a la 0375: sin evaluación GPS
      linea({ indice: 5, estatus: 'cuadra', viaje_id: 'v1', monto: 10 }),
      // de OTRA flota: no debe aparecer
      { ...linea({ indice: 0, monto: 7777 }), tenant_id: 'flota-2' },
    ],
  });
});

describe('bitacoraConciliada', () => {
  it('lista TODAS las líneas de la flota, con estado, motivo y datos resueltos', async () => {
    const b = await bitacoraConciliada(T, 'd1');
    expect(b).not.toBeNull();
    expect(b!.filas).toHaveLength(6);
    const por = (i: number) => b!.filas[i];
    expect(por(0)).toMatchObject({ estado: 'cuadra', motivo: 'gasto_y_gps', viaje: 'V-100', unidad: 'C2-08', casetaCatalogo: 'Caseta Ejemplo Norte', gps: 'confirma', gpsDistanciaM: 111.2, hora: '10:30:00' });
    expect(por(1)).toMatchObject({ estado: 'por_verificar', motivo: 'gps_no_coincide', gps: 'no coincide' });
    expect(por(2)).toMatchObject({ estado: 'sin_respaldo', motivo: 'sin_gasto_sin_gps', gps: 'sin datos', gpsNota: expect.stringMatching(/TAG sin dar de alta/) });
    expect(por(3)).toMatchObject({ estado: 'por_verificar', motivo: 'sin_fecha', fecha: '', hora: '' });
    expect(por(4)).toMatchObject({ estado: 'por_verificar', motivo: 'monto_distinto', diferencia: 11.5 });
    expect(por(5)).toMatchObject({ estado: 'cuadra', gps: 'sin evaluar' });
    expect(b!.sinEvaluarGps).toBe(2); // la no_cuadra y la que cuadra, ambas anteriores a la 0375
    expect(b!.filas.some((f) => f.monto === 7777)).toBe(false);
  });

  it('el resumen suma por estado', async () => {
    const b = await bitacoraConciliada(T, 'd1');
    expect(b!.resumen).toMatchObject({ total: 6, cuadra: 2, sinRespaldo: 1, porVerificar: 3, montoCuadra: 199, montoSinRespaldo: 300, montoPorVerificar: 449.5 });
  });

  it('desglose de otra flota o inexistente → null (404 arriba), no datos ajenos', async () => {
    expect(await bitacoraConciliada('flota-2', 'd1')).toBeNull();
    expect(await bitacoraConciliada(T, 'no-existe')).toBeNull();
  });

  it('un error de base LANZA: una bitácora a medias no se exporta', async () => {
    db.fallar('desglose_peaje_linea.select', 'base caída');
    await expect(bitacoraConciliada(T, 'd1')).rejects.toThrow(/base caída/);
  });

  it('TODA lectura lleva el tenant', async () => {
    await bitacoraConciliada(T, 'd1');
    for (const l of db.llamadas) expect(l.filtros.some(([c, o, v]) => c === 'tenant_id' && o === 'eq' && v === T), `${l.tabla}.${l.op}`).toBe(true);
  });
});

describe('bitacoraConciliadaACsv', () => {
  it('leyenda primero con «#», resumen, encabezados y una fila por línea con estados en español', async () => {
    const csv = bitacoraConciliadaACsv((await bitacoraConciliada(T, 'd1'))!);
    const lineas = csv.split('\n');
    expect(lineas[0]).toMatch(/^# Bitácora conciliada/);
    expect(csv).toContain('no afirma que el cobro sea indebido'.replace('no afirma', 'NO afirma'));
    expect(csv).toMatch(/# Resumen: 6 líneas · cuadra 2 \(\$199\.00\) · sin respaldo 1 \(\$300\.00\) · por verificar 3 \(\$449\.50\)/);
    expect(csv).toMatch(/# Aviso: 2 líneas no tienen evaluación GPS/);
    const i = lineas.indexOf(ENCABEZADOS_CSV_CONCILIADA.join(','));
    expect(i).toBeGreaterThan(0);
    const filas = lineas.slice(i + 1).filter(Boolean);
    expect(filas).toHaveLength(6);
    expect(filas[0]).toMatch(/^1,2026-08-05,10:30:00,Caseta Ejemplo Norte,Caseta Ejemplo Norte,IMDM 10000001,C2-08,189,cuadra,gasto_y_gps,/);
    expect(filas[2]).toContain(',sin respaldo,');
    expect(filas[3]).toContain(',por verificar,');
  });

  it('la leyenda NUNCA queda fuera: ni con el desglose vacío', async () => {
    db.tablas.desglose_peaje_linea = [];
    const csv = bitacoraConciliadaACsv((await bitacoraConciliada(T, 'd1'))!);
    expect(csv).toMatch(/^# Bitácora conciliada/);
    expect(csv).toMatch(/El desglose no tiene líneas/);
  });

  it('INYECCIÓN DE FÓRMULAS: texto del proveedor que empieza con = + - @ se neutraliza; los números no', async () => {
    db.tablas.desglose_peaje_linea = [linea({ indice: 0, caseta: '=HYPERLINK("http://x","clic")', tag: '+cmd|calc', monto: -50 })];
    const csv = bitacoraConciliadaACsv((await bitacoraConciliada(T, 'd1'))!);
    const fila = csv.split('\n').filter(Boolean).pop()!;
    expect(fila).toContain(`"'=HYPERLINK(""http://x"",""clic"")"`);
    expect(fila).toContain(`,'+cmd|calc,`);
    expect(fila).toContain(',-50,'); // el monto negativo es número, no fórmula
    for (const l of csv.split('\n').filter((x) => x && !x.startsWith('#'))) expect(l).not.toMatch(/(^|,)[=+@]/);
  });

  it('un salto de línea en la leyenda de un proveedor no rompe el encabezado «#»', async () => {
    db.tablas.desglose_peaje[0].proveedor = 'PASE\nmalicioso,=1+1';
    const csv = bitacoraConciliadaACsv((await bitacoraConciliada(T, 'd1'))!);
    const cab = csv.split('\n').filter((l) => l.startsWith('# Desglose'));
    expect(cab).toHaveLength(1);
    expect(csv.split('\n').filter((l) => !l.startsWith('#') && l.includes('malicioso'))).toEqual([]);
  });
});

describe('celdaCsvSegura', () => {
  it('casos', () => {
    expect(celdaCsvSegura(null)).toBe('');
    expect(celdaCsvSegura(undefined)).toBe('');
    expect(celdaCsvSegura(12.5)).toBe('12.5');
    expect(celdaCsvSegura(NaN)).toBe('');
    expect(celdaCsvSegura('hola, mundo')).toBe('"hola, mundo"');
    expect(celdaCsvSegura('di "x"')).toBe('"di ""x"""');
    expect(celdaCsvSegura('=1+1')).toBe("'=1+1");
    expect(celdaCsvSegura('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(celdaCsvSegura('\t=1')).toBe("'\t=1");
    expect(celdaCsvSegura('-5 pesos')).toBe("'-5 pesos");
    expect(celdaCsvSegura('normal')).toBe('normal');
  });
});
