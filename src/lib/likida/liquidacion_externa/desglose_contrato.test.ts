import { describe, it, expect } from 'vitest';
import { CampoInvalido } from '@/lib/http/campos_cuerpo';
import { DESGLOSE_SINTETICO, type RenglonDesglose } from './desglose.fixture';
import {
  aLiquidacionExterna, claveDeBitacora, diasDelPeriodo, validarDesgloseBitacora, type DesgloseBitacora,
} from './desglose_contrato';

const reng = (r: RenglonDesglose) => ({ concepto: r.descripcion, monto: r.monto, ...(r.vale ? { vale: r.vale } : {}) });

function desde(extra: Record<string, unknown> = {}): DesgloseBitacora {
  const f = DESGLOSE_SINTETICO;
  return validarDesgloseBitacora({
    terminal: 'TERM1',
    bitacora: f.bitacora,
    poliza: null,
    operador: { numeroEmpleado: '900001', nombre: f.operador.nombre },
    unidad: f.unidad,
    desde: f.desde,
    hasta: f.hasta,
    percepciones: f.percepciones.map(reng),
    deducciones: f.deducciones.map(reng),
    ...extra,
  });
}

describe('desglose_contrato: conversión al contrato existente', () => {
  it('fixture T-A1-01: 8 + 6 conceptos, claves de anticipos y total 4 850.00 con neto', () => {
    const r = aLiquidacionExterna(desde({ neto: 4850 }), { sistemaOrigen: 'TMS' });
    const perc = r.liquidacion.conceptos.filter((c) => c.tipo === 'percepcion');
    const ded = r.liquidacion.conceptos.filter((c) => c.tipo === 'deduccion');
    expect(perc).toHaveLength(8);
    expect(ded).toHaveLength(6);
    expect(ded.filter((c) => c.clave).map((c) => c.clave)).toEqual(['100001', '100002', '100003']);
    expect(r.liquidacion.total).toBe(4850);
    expect(r.totalOrigen).toBe('origen');
    expect(r.liquidacion.claveExterna).toBe('BIT-TERM1-B-0001');
    expect(r.liquidacion.sistemaOrigen).toBe('TMS');
    expect(r.liquidacion.moneda).toBe('MXN');
    expect(r.liquidacion.viajes).toEqual(['B-0001']);
    expect(r.liquidacion.operador.numeroEmpleado).toBe('900001');
    expect(r.liquidacion.periodo).toEqual({ desde: '2026-10-09', hasta: '2026-10-14' });
  });

  it('sin neto: total calculado y totalOrigen "calculado" (chequeo tautológico señalado)', () => {
    const r = aLiquidacionExterna(desde(), { sistemaOrigen: 'TMS' });
    expect(r.liquidacion.total).toBe(4850);
    expect(r.totalOrigen).toBe('calculado');
  });

  it('neto erróneo: error que nombra la diferencia', () => {
    expect(() => aLiquidacionExterna(desde({ neto: 4900 }), { sistemaOrigen: 'TMS' })).toThrowError(/4900\.00.*4850\.00/s);
    try {
      aLiquidacionExterna(desde({ neto: 4900 }), { sistemaOrigen: 'TMS' });
    } catch (e) {
      expect(e).toBeInstanceOf(CampoInvalido);
      expect((e as CampoInvalido).campo).toBe('total');
    }
  });

  it('vale con asterisco: *257008 → 257008; espacios se descartan', () => {
    const d = desde({ deducciones: [{ concepto: 'Anticipo', monto: 100, vale: '*257008' }, { concepto: 'Anticipo', monto: 50, vale: ' * 25 70 ' }] });
    expect(d.deducciones[0].vale).toBe('257008');
    expect(d.deducciones[1].vale).toBe('2570');
    const r = aLiquidacionExterna({ ...d, percepciones: [{ concepto: 'Sueldo', monto: 200 }] }, { sistemaOrigen: 'TMS' });
    expect(r.liquidacion.conceptos.find((c) => c.clave === '257008')).toBeDefined();
  });

  it('vale de solo asteriscos queda sin vale; vale > 40 se rechaza', () => {
    expect(desde({ deducciones: [{ concepto: 'A', monto: 1, vale: '**' }] }).deducciones[0].vale).toBeUndefined();
    expect(() => desde({ deducciones: [{ concepto: 'A', monto: 1, vale: '1'.repeat(41) }] })).toThrow(CampoInvalido);
  });

  it('días: 9 → 14 oct = 6 si no vienen; si vienen se respetan', () => {
    expect(diasDelPeriodo('2026-10-09', '2026-10-14')).toBe(6);
    expect(aLiquidacionExterna(desde(), { sistemaOrigen: 'TMS' }).dias).toBe(6);
    expect(aLiquidacionExterna(desde({ dias: 5 }), { sistemaOrigen: 'TMS' }).dias).toBe(5);
  });

  it('bitácora con caracteres no válidos: clave saneada, estable y aceptada por el esquema', () => {
    const d = desde({ bitacora: 'B 00/1ñ', terminal: 'Gdl Sur' });
    const a = aLiquidacionExterna(d, { sistemaOrigen: 'TMS' });
    const b = aLiquidacionExterna(d, { sistemaOrigen: 'TMS' });
    expect(a.liquidacion.claveExterna).toBe('BIT-Gdl_Sur-B_00/1_');
    expect(b.liquidacion.claveExterna).toBe(a.liquidacion.claveExterna);
    expect(claveDeBitacora(undefined, 'X-1')).toBe('BIT-X-1');
  });

  it('periodo invertido lo rechaza el esquema vigente', () => {
    expect(() => aLiquidacionExterna(desde({ desde: '2026-10-14', hasta: '2026-10-09' }), { sistemaOrigen: 'TMS' })).toThrow(CampoInvalido);
  });
});

describe('desglose_contrato: validación estricta', () => {
  it('campo desconocido (raíz, operador, renglón) → CampoInvalido', () => {
    expect(() => desde({ totl: 1 })).toThrow(CampoInvalido);
    expect(() => desde({ operador: { numeroEmpleado: '1', telefono: '2' } })).toThrow(CampoInvalido);
    expect(() => desde({ percepciones: [{ concepto: 'A', monto: 1, tipo: 'x' }] })).toThrow(CampoInvalido);
  });

  it('monto ≤ 0, ausente o con 3 decimales → rechazo con motivo', () => {
    expect(() => desde({ percepciones: [{ concepto: 'A', monto: 0 }] })).toThrowError(/mayor que cero/);
    expect(() => desde({ percepciones: [{ concepto: 'A', monto: -5 }] })).toThrowError(/mayor que cero/);
    expect(() => desde({ percepciones: [{ concepto: 'A' }] })).toThrowError(/obligatorio/);
    expect(() => desde({ percepciones: [{ concepto: 'A', monto: 1.234 }] })).toThrow(CampoInvalido);
  });

  it('texto con saltos de línea o control → rechazo', () => {
    expect(() => desde({ percepciones: [{ concepto: 'A\nB', monto: 1 }] })).toThrowError(/control/);
    expect(() => desde({ bitacora: 'B\u0007' })).toThrowError(/control/);
    expect(() => desde({ operador: { numeroEmpleado: '1', nombre: 'X\r\nY' } })).toThrowError(/control/);
  });

  it('obligatorios: bitácora, operador.numeroEmpleado, fechas, algún renglón', () => {
    expect(() => desde({ bitacora: '' })).toThrow(CampoInvalido);
    expect(() => desde({ operador: {} })).toThrow(CampoInvalido);
    expect(() => desde({ desde: '2026-10-09T10:00:00Z' })).toThrow(CampoInvalido);
    expect(() => desde({ percepciones: [], deducciones: [] })).toThrow(CampoInvalido);
  });

  it('tipoOperador fuera del enum y no-objeto → rechazo; enum válido pasa', () => {
    expect(() => desde({ tipoOperador: 'otro' })).toThrow(CampoInvalido);
    expect(desde({ tipoOperador: 'local' }).tipoOperador).toBe('local');
    expect(() => validarDesgloseBitacora('texto')).toThrow(CampoInvalido);
  });
});
