import { describe, it, expect } from 'vitest';
import { clasificarVerificacion, resumirVerificacion, textoMotivoGps, type EntradaVerificacion } from './verificacion';

const e = (o: Partial<EntradaVerificacion>): EntradaVerificacion => ({ estatus: 'cuadra', detalle: null, gpsVeredicto: null, ...o });

describe('cuadra', () => {
  it('con gasto y GPS que confirma', () => {
    expect(clasificarVerificacion(e({ gpsVeredicto: 'confirma' }))).toMatchObject({ estado: 'cuadra', motivo: 'gasto_y_gps' });
  });
  it('con gasto y sin datos de GPS: cuadra, y lo dice', () => {
    const v = clasificarVerificacion(e({ gpsVeredicto: 'sin_datos', gpsMotivo: 'sin_caseta' }));
    expect(v).toMatchObject({ estado: 'cuadra', motivo: 'gasto' });
    expect(v.explicacion).toMatch(/GPS no aportó/);
  });
  it('con gasto y SIN evaluación de GPS (línea vieja, null): cuadra', () => {
    expect(clasificarVerificacion(e({})).estado).toBe('cuadra');
  });
});

describe('cuadra con una señal en contra → por_verificar, jamás acusación', () => {
  it('el GPS dice que la unidad estaba lejos', () => {
    expect(clasificarVerificacion(e({ gpsVeredicto: 'no_coincide' }))).toMatchObject({ estado: 'por_verificar', motivo: 'gps_no_coincide' });
  });
  it('el TAG es de otra unidad que la del gasto', () => {
    expect(clasificarVerificacion(e({ detalle: { alerta: 'unidad_distinta' } }))).toMatchObject({ estado: 'por_verificar', motivo: 'unidad_distinta' });
  });
  it('si hay las dos señales gana la del GPS (primera) y sigue siendo por_verificar', () => {
    expect(clasificarVerificacion(e({ gpsVeredicto: 'no_coincide', detalle: { alerta: 'unidad_distinta' } })).estado).toBe('por_verificar');
  });
});

describe('no_cuadra → siempre por_verificar', () => {
  it('monto distinto', () => {
    expect(clasificarVerificacion(e({ estatus: 'no_cuadra', detalle: { motivo: 'monto_distinto' } }))).toMatchObject({ estado: 'por_verificar', motivo: 'monto_distinto' });
  });
  it('ambigua', () => {
    expect(clasificarVerificacion(e({ estatus: 'no_cuadra', detalle: { motivo: 'ambigua_monto_exacto' } }))).toMatchObject({ estado: 'por_verificar', motivo: 'ambigua' });
    expect(clasificarVerificacion(e({ estatus: 'no_cuadra', detalle: null })).motivo).toBe('ambigua');
  });
});

describe('sin_contraparte — «sin respaldo» solo cuando el dato alcanza', () => {
  const sc = (detalle: Record<string, unknown> | null, gpsVeredicto: EntradaVerificacion['gpsVeredicto'] = null, gpsMotivo?: string) =>
    clasificarVerificacion({ estatus: 'sin_contraparte', detalle, gpsVeredicto, gpsMotivo });

  it('sin fecha: no se afirma nada', () => {
    expect(sc({ motivo: 'sin_fecha' })).toMatchObject({ estado: 'por_verificar', motivo: 'sin_fecha' });
  });
  it('su gasto lo usó otra línea idéntica: por verificar (¿duplicado?)', () => {
    expect(sc({ motivo: 'contraparte_ya_reclamada', fondo_gastos: 10 })).toMatchObject({ estado: 'por_verificar', motivo: 'contraparte_reclamada' });
  });
  it('sin NINGÚN ticket cargado en el periodo (fondo 0 o desconocido): la ausencia no dice nada', () => {
    expect(sc({ motivo: 'sin_gastos_en_ventana', fondo_gastos: 0 })).toMatchObject({ estado: 'por_verificar', motivo: 'sin_gastos_cargados' });
    expect(sc({ motivo: 'sin_gastos_en_ventana' })).toMatchObject({ estado: 'por_verificar', motivo: 'sin_gastos_cargados' });
    expect(sc(null)).toMatchObject({ estado: 'por_verificar', motivo: 'sin_gastos_cargados' });
  });
  it('hay tickets en el periodo, ninguno respalda y el GPS no aporta: SIN RESPALDO, nombrando qué falta', () => {
    const v = sc({ motivo: 'sin_gastos_en_ventana', fondo_gastos: 40 }, 'sin_datos', 'sin_unidad');
    expect(v).toMatchObject({ estado: 'sin_respaldo', motivo: 'sin_gasto_sin_gps' });
    expect(v.explicacion).toMatch(/TAG sin dar de alta/);
    expect(v.explicacion).toMatch(/no se afirma que el cobro sea indebido/);
  });
  it('el GPS confirma el paso pero falta el gasto: por verificar (falta el comprobante), NO sin respaldo', () => {
    expect(sc({ motivo: 'sin_gastos_en_ventana', fondo_gastos: 40 }, 'confirma')).toMatchObject({ estado: 'por_verificar', motivo: 'solo_gps' });
  });
  it('sin gasto y el GPS no ubica a la unidad en la caseta: sin respaldo por dos vías', () => {
    expect(sc({ motivo: 'sin_gastos_en_ventana', fondo_gastos: 40 }, 'no_coincide')).toMatchObject({ estado: 'sin_respaldo', motivo: 'sin_gasto_gps_lejos' });
  });
});

describe('textoMotivoGps', () => {
  it('traduce cada motivo y tiene un default honesto', () => {
    expect(textoMotivoGps('sin_hora')).toMatch(/hora/);
    expect(textoMotivoGps('muestras_insuficientes')).toMatch(/no alcanzan/);
    expect(textoMotivoGps(null)).toMatch(/no aportó datos/);
    expect(textoMotivoGps('inventado')).toMatch(/no aportó datos/);
  });
});

describe('resumirVerificacion', () => {
  it('cuenta y suma por estado, redondeando los centavos', () => {
    const r = resumirVerificacion([
      { estado: 'cuadra', monto: 100.1 }, { estado: 'cuadra', monto: 0.2 },
      { estado: 'sin_respaldo', monto: 50 }, { estado: 'por_verificar', monto: 10.005 },
    ]);
    expect(r).toEqual({ total: 4, cuadra: 2, sinRespaldo: 1, porVerificar: 1, montoCuadra: 100.3, montoSinRespaldo: 50, montoPorVerificar: 10.01 });
  });
  it('vacío = ceros', () => {
    expect(resumirVerificacion([]).total).toBe(0);
  });
});
