import { describe, it, expect } from 'vitest';
import { CampoInvalido } from '@/lib/http/campos_cuerpo';
import { mapearBitacoraTms, leerRuta, normalizarUnidad, type MapeoTms } from './desglose_mapeo_tms';
import { aLiquidacionExterna } from './desglose_contrato';
import {
  TMS_NODOS, TMS_PLANA, TMS_SIN_DESGLOSE, MAPEO_NODOS, MAPEO_PLANA, MAPEO_SIN_DESGLOSE, DESGLOSE_TMS_ESPERADO_CAB,
} from './desglose_tms.fixture';

const ESPERADO: unknown = {
  ...DESGLOSE_TMS_ESPERADO_CAB,
  percepciones: [
    { concepto: 'Sueldo', monto: 4000 },
    { concepto: 'Taxi', monto: 300 },
    { concepto: 'Talacha', monto: 300 },
    { concepto: 'Lavada', monto: 900.5 },
    { concepto: 'KM. Extra', monto: 4050 },
  ],
  deducciones: [
    { concepto: 'Anticipo Ciudad Ejemplo', monto: 1000, vale: '100001' },
    { concepto: 'Descuento financiero', monto: 4400.5 },
  ],
};

describe('mapearBitacoraTms · tres formas, mismo DesgloseBitacora', () => {
  it('A · nodos separados: viáticos se expanden a su detalle y el renglón en cero se ignora con motivo', () => {
    const r = mapearBitacoraTms(TMS_NODOS, MAPEO_NODOS);
    expect(r.desglose).toEqual(ESPERADO);
    expect(r.ignorados).toEqual([{ donde: 'percepciones[3]', motivo: 'monto en cero o vacío' }]);
  });

  it('B · lista plana cargo/abono: cargo⇒percepción, abono⇒deducción, ambos en cero ⇒ ignorado', () => {
    const r = mapearBitacoraTms(TMS_PLANA, MAPEO_PLANA);
    expect(r.desglose).toEqual(ESPERADO);
    expect(r.ignorados).toEqual([{ donde: 'renglones[7]', motivo: 'cargo y abono en cero' }]);
  });

  it('C · `desglose` vacío, nulo, en blanco o ausente ⇒ cae a la descripción', () => {
    const r = mapearBitacoraTms(TMS_SIN_DESGLOSE, MAPEO_SIN_DESGLOSE);
    expect(r.desglose).toEqual(ESPERADO);
    expect(r.ignorados).toEqual([]);
  });

  it('el resultado pasa la conversión y validación estricta del contrato vigente', () => {
    const { desglose } = mapearBitacoraTms(TMS_PLANA, MAPEO_PLANA);
    const r = aLiquidacionExterna(desglose, { sistemaOrigen: 'tms-sintetico' });
    expect(r.totalOrigen).toBe('origen');
    expect(r.liquidacion.total).toBe(4150);
  });
});

describe('mapearBitacoraTms · viáticos', () => {
  it('renglón tipo V/UV cuyo `desglose` dice «Viáticos» usa la descripción específica, nunca la palabra viático', () => {
    const { desglose } = mapearBitacoraTms(TMS_PLANA, MAPEO_PLANA);
    expect(desglose.percepciones.map((p) => p.concepto)).toEqual(['Sueldo', 'Taxi', 'Talacha', 'Lavada', 'KM. Extra']);
    expect(JSON.stringify(desglose)).not.toMatch(/vi[aá]tic/i);
  });

  it('viático con detalle anidado vacío se queda como un renglón normal', () => {
    const raw = { ...TMS_NODOS, percepciones: [{ desglose: 'Viáticos', descripcion: 'VIATICOS', tipo: 'V', monto: 100, detalle: [] }], deducciones: [] };
    const { desglose } = mapearBitacoraTms(raw, MAPEO_NODOS);
    expect(desglose.percepciones).toEqual([{ concepto: 'Viáticos', monto: 100 }]);
  });
});

describe('mapearBitacoraTms · A37-A1-liquidaciones-13', () => {
  it('un viático cuyo detalle no suma el monto padre se rechaza con el campo (no se elige uno en silencio)', () => {
    const raw = { ...TMS_NODOS, percepciones: [{ desglose: 'Viáticos', descripcion: 'VIATICOS', tipo: 'V', monto: 1200, detalle: [{ descripcion: 'Taxi', monto: 300 }, { descripcion: 'Lavada', monto: 650 }] }], deducciones: [] };
    expect(() => mapearBitacoraTms(raw, MAPEO_NODOS)).toThrow(CampoInvalido);
    try { mapearBitacoraTms(raw, MAPEO_NODOS); } catch (e) { expect((e as CampoInvalido).campo).toBe('percepciones[0].detalleViaticos'); }
  });
});

describe('mapearBitacoraTms · errores con campo', () => {
  const con = (cambio: (r: typeof TMS_PLANA) => void) => {
    const raw = JSON.parse(JSON.stringify(TMS_PLANA)) as typeof TMS_PLANA;
    cambio(raw);
    return () => mapearBitacoraTms(raw, MAPEO_PLANA);
  };

  it('monto con coma decimal ⇒ error con el campo', () => {
    const f = con((r) => { (r.renglones[0] as { cargo: unknown }).cargo = '4000,50'; });
    expect(f).toThrow(CampoInvalido);
    try { f(); } catch (e) { expect((e as CampoInvalido).campo).toBe('renglones[0].cargo'); }
  });

  it('monto de texto no numérico ⇒ error con el campo', () => {
    const f = con((r) => { (r.renglones[5] as { abono: unknown }).abono = 'mil pesos'; });
    try { f(); expect.unreachable(); } catch (e) { expect((e as CampoInvalido).campo).toBe('renglones[5].abono'); }
  });

  it('cargo y abono a la vez ⇒ error (no se adivina el lado)', () => {
    const f = con((r) => { (r.renglones[0] as { abono: unknown }).abono = 10; });
    try { f(); expect.unreachable(); } catch (e) { expect((e as CampoInvalido).campo).toBe('renglones[0]'); }
  });

  it('renglón sin `desglose` ni descripción ⇒ error', () => {
    const f = con((r) => { Object.assign(r.renglones[0], { desglose: '', descripcion: '' }); });
    try { f(); expect.unreachable(); } catch (e) { expect((e as CampoInvalido).campo).toBe('renglones[0].descripcion'); }
  });

  it('bitácora faltante o fecha mal formada ⇒ error del contrato interno', () => {
    expect(con((r) => { r.cabecera.bitacora = ''; })).toThrow(CampoInvalido);
    expect(con((r) => { r.cabecera.inicio = '09/10/2026'; })).toThrow(CampoInvalido);
  });

  it('lista que no es lista ⇒ error con el nombre', () => {
    const mapeo: MapeoTms = { ...MAPEO_NODOS, percepciones: 'cabecera' };
    expect(() => mapearBitacoraTms(TMS_NODOS, mapeo)).toThrow(/tiene que ser una lista/);
  });
});

describe('mapearBitacoraTms · cabecera', () => {
  it('póliza ausente ⇒ null (sin_poliza lo resuelve el pull, no el mapeo)', () => {
    const raw = JSON.parse(JSON.stringify(TMS_PLANA)) as typeof TMS_PLANA;
    (raw.cabecera as { poliza: unknown }).poliza = null;
    expect(mapearBitacoraTms(raw, MAPEO_PLANA).desglose.poliza).toBeNull();
  });

  it('sin neto ni enviado en el mapeo no se inventan', () => {
    const { neto, enviado, ...resto } = MAPEO_PLANA;
    void neto; void enviado;
    const d = mapearBitacoraTms(TMS_PLANA, resto).desglose;
    expect(d.neto).toBeUndefined();
    expect(d.enviadoOrigen).toBeUndefined();
  });

  it('neto negativo se conserva (el retenido por neto negativo es otra regla)', () => {
    const raw = JSON.parse(JSON.stringify(TMS_PLANA)) as typeof TMS_PLANA;
    raw.cabecera.neto = -120.5;
    expect(mapearBitacoraTms(raw, MAPEO_PLANA).desglose.neto).toBe(-120.5);
  });

  it('enviado "1" ⇒ true; valor raro ⇒ error', () => {
    const raw = JSON.parse(JSON.stringify(TMS_PLANA)) as typeof TMS_PLANA;
    (raw.cabecera as { enviado: unknown }).enviado = '1';
    expect(mapearBitacoraTms(raw, MAPEO_PLANA).desglose.enviadoOrigen).toBe(true);
    (raw.cabecera as { enviado: unknown }).enviado = 'quizá';
    expect(() => mapearBitacoraTms(raw, MAPEO_PLANA)).toThrow(CampoInvalido);
  });
});

describe('utilidades', () => {
  it('normalizarUnidad: 0526 ⇒ 526, no numéricas intactas, 0000 ⇒ 0', () => {
    expect(normalizarUnidad('0526')).toBe('526');
    expect(normalizarUnidad('526')).toBe('526');
    expect(normalizarUnidad('A-12')).toBe('A-12');
    expect(normalizarUnidad('0000')).toBe('0');
  });

  it('leerRuta: puntos, índices y camino roto', () => {
    const o = { a: { b: [{ c: 7 }] } };
    expect(leerRuta(o, 'a.b[0].c')).toBe(7);
    expect(leerRuta(o, 'a.x.c')).toBeUndefined();
    expect(leerRuta(o, 'a.b[3].c')).toBeUndefined();
    expect(leerRuta(null, 'a')).toBeUndefined();
  });
});
