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
