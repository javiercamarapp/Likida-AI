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

describe('A37-A1-liquidaciones-14: más de 2 decimales NO se redondean en silencio', () => {
  const con = (cambio: (r: typeof TMS_PLANA) => void) => {
    const raw = JSON.parse(JSON.stringify(TMS_PLANA)) as typeof TMS_PLANA;
    cambio(raw);
    return () => mapearBitacoraTms(raw, MAPEO_PLANA);
  };
  it('cargo 1250.005 ⇒ error con el campo (el desglose queda en mapeo_invalido, visible), no un redondeo por renglón', () => {
    const f = con((r) => { (r.renglones[0] as { cargo: unknown }).cargo = 1250.005; });
    expect(f).toThrow(CampoInvalido);
    try { f(); } catch (e) { expect((e as CampoInvalido).campo).toBe('renglones[0].cargo'); expect((e as CampoInvalido).message).toMatch(/2 decimales/); }
  });
  it('texto «300.123» también se rechaza; «300.10», «300.1» y «4000» siguen entrando', () => {
    expect(con((r) => { (r.renglones[1] as { cargo: unknown }).cargo = '300.123'; })).toThrow(CampoInvalido);
    expect(con((r) => { (r.renglones[1] as { cargo: unknown }).cargo = '300.10'; })).not.toThrow();
    expect(con((r) => { (r.renglones[1] as { cargo: unknown }).cargo = 300.1; })).not.toThrow();
    expect(con((r) => { (r.renglones[1] as { cargo: unknown }).cargo = 0.07; })).not.toThrow();
  });
  it('decimales con ruido de coma flotante (1.1, 19.99, 0.29) no se confunden con más de 2 decimales', () => {
    for (const v of [1.1, 19.99, 0.29, 1234567.89]) {
      expect(con((r) => { (r.renglones[1] as { cargo: unknown }).cargo = v; })).not.toThrow();
    }
  });
  it('un viático anidado con 3 decimales se rechaza con el campo del detalle', () => {
    const raw = JSON.parse(JSON.stringify(TMS_NODOS)) as typeof TMS_NODOS;
    (raw.percepciones[1]!.detalle![0] as { monto: unknown }).monto = 300.555;
    expect(() => mapearBitacoraTms(raw, MAPEO_NODOS)).toThrow(/detalleViaticos\[0\]\.monto/);
  });
});

describe('A37-A1-liquidaciones-16: las fechas con zona se pasan al día LOCAL de México', () => {
  const con = (inicio: string, fin: string) => {
    const raw = JSON.parse(JSON.stringify(TMS_PLANA)) as typeof TMS_PLANA;
    (raw.cabecera as { inicio: string }).inicio = inicio;
    (raw.cabecera as { fin: string }).fin = fin;
    return mapearBitacoraTms(raw, MAPEO_PLANA).desglose;
  };
  it('fin del día 14 en CDMX como 15T05:59Z ⇒ 14 (no 15); inicio 9 a las 00:00 CDMX como 09T06:00Z ⇒ 9', () => {
    const d = con('2026-10-09T06:00:00Z', '2026-10-15T05:59:00Z');
    expect(d.desde).toBe('2026-10-09');
    expect(d.hasta).toBe('2026-10-14');
  });
  it('con offset explícito −06:00 también', () => {
    expect(con('2026-10-09T00:00:00-06:00', '2026-10-14T23:59:00-06:00')).toMatchObject({ desde: '2026-10-09', hasta: '2026-10-14' });
  });
  it('sin zona se toma el día tal cual (hora local del origen) y la fecha sola no cambia', () => {
    expect(con('2026-10-09T06:00:00', '2026-10-14')).toMatchObject({ desde: '2026-10-09', hasta: '2026-10-14' });
  });
});
