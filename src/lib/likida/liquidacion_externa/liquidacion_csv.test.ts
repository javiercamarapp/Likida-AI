import { describe, it, expect } from 'vitest';
import { cuerposDeLiquidacionesCsv, fechaDeCelda, fechaDeSerialExcel } from './liquidacion_csv';

describe('fechas de Excel como número de serie en el convertidor de liquidaciones', () => {
  it('convierte el serie a AAAA-MM-DD (con o sin fracción de hora, punto o coma)', () => {
    expect(fechaDeSerialExcel('46023')).toBe('2026-01-01');
    expect(fechaDeSerialExcel('46023.75')).toBe('2026-01-01');
    expect(fechaDeSerialExcel('46023,5')).toBe('2026-01-01');
    expect(fechaDeSerialExcel('36526')).toBe('2000-01-01');
    expect(fechaDeSerialExcel('73050')).toBe('2099-12-31');
  });

  it('un número fuera de 2000..2099 o con otra forma NO es fecha', () => {
    for (const t of ['36525', '73051', '1500', '460230', '4602', '-46023', '46023abc', '', '2026-01-01']) expect(fechaDeSerialExcel(t)).toBeNull();
  });

  it('fechaDeCelda deja pasar la ISO y el resto tal cual (el validador decide)', () => {
    expect(fechaDeCelda(' 2026-09-01 ')).toBe('2026-09-01');
    expect(fechaDeCelda('46023')).toBe('2026-01-01');
    expect(fechaDeCelda('mañana')).toBe('mañana');
  });

  it('un CSV con serie en el periodo entra; uno con periodo incoherente sigue rechazándose', () => {
    const csv = [
      'clave_externa,numero_empleado,periodo_desde,periodo_hasta,concepto,tipo,monto,total_sistema',
      'A,E1,46023,46029,Sueldo,percepcion,10,10',
      'B,E1,46029,46023,Sueldo,percepcion,10,10',
    ].join('\n');
    const r = cuerposDeLiquidacionesCsv(csv);
    expect(r.cuerpos).toHaveLength(1);
    expect(r.cuerpos[0].periodo).toEqual({ desde: '2026-01-01', hasta: '2026-01-07' });
    expect(r.problemas).toHaveLength(1);
    expect(r.problemas[0]).toMatchObject({ clave: 'B' });
  });
});

describe('A37-S49-06: moneda desconocida y filas contradictorias', () => {
  const ENC = 'clave_externa,numero_empleado,periodo_desde,periodo_hasta,concepto,tipo,monto,total_sistema,moneda';

  it('una moneda que no es MXN ni USD se rechaza (no pasa a MXN en silencio)', () => {
    for (const m of ['US$', 'Dólares', 'EUR']) {
      const r = cuerposDeLiquidacionesCsv([ENC, `A,E1,2026-09-01,2026-09-07,Sueldo,percepcion,10,10,${m}`].join('\n'));
      expect(r.cuerpos, m).toHaveLength(0);
      expect(r.problemas[0].motivo, m).toMatch(/moneda/);
    }
  });

  it('moneda vacía sigue siendo MXN y USD se conserva', () => {
    const r = cuerposDeLiquidacionesCsv([
      ENC,
      'A,E1,2026-09-01,2026-09-07,Sueldo,percepcion,10,10,',
      'B,E2,2026-09-01,2026-09-07,Sueldo,percepcion,10,10,usd',
    ].join('\n'));
    expect(r.cuerpos.map((c) => c.moneda)).toEqual(['MXN', 'USD']);
  });

  it('dos filas de la misma clave con otro empleado, periodo, total o moneda ⇒ se rechaza la clave entera', () => {
    const casos: Array<[string, string]> = [
      ['empleado', 'A,E2,2026-09-01,2026-09-07,Bono,percepcion,5,15,MXN'],
      ['periodo', 'A,E1,2026-09-08,2026-09-07,Bono,percepcion,5,15,MXN'],
      ['total', 'A,E1,2026-09-01,2026-09-07,Bono,percepcion,5,99,MXN'],
      ['moneda', 'A,E1,2026-09-01,2026-09-07,Bono,percepcion,5,15,USD'],
    ];
    for (const [que, fila2] of casos) {
      const r = cuerposDeLiquidacionesCsv([ENC, 'A,E1,2026-09-01,2026-09-07,Sueldo,percepcion,10,15,MXN', fila2].join('\n'));
      expect(r.cuerpos, que).toHaveLength(0);
      expect(r.problemas[0].motivo, que).toMatch(/no coinciden/);
    }
  });

  it('filas coherentes (o con celdas repetidas vacías) de una misma clave siguen entrando', () => {
    const r = cuerposDeLiquidacionesCsv([
      ENC,
      'A,E1,2026-09-01,2026-09-07,Sueldo,percepcion,10,15,MXN',
      'A,,,,Bono,percepcion,5,,',
    ].join('\n'));
    expect(r.problemas).toEqual([]);
    expect(r.cuerpos).toHaveLength(1);
    expect(r.cuerpos[0].total).toBe(15);
  });
});
