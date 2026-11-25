import { describe, it, expect } from 'vitest';
import { advertenciasDeCampos, convertirBitacoraMuestra, valeDeReferencia } from './desglose_muestra_tms';
import { BITACORA_MUESTRA, PADRON_MUESTRA } from './desglose_muestra_tms.fixture';

// `Referencia` por renglón = número de vale (acuerdo con la fuente, 25-nov-2026). Datos sintéticos; la forma es la del envío real.

const base = { ...BITACORA_MUESTRA } as Record<string, unknown>;
delete base.CampoExtraDesconocido;
const conv = (o: Record<string, unknown>) => convertirBitacoraMuestra({ ...base, ...o }, { padron: PADRON_MUESTRA });

// Misma forma que el JSON que compartió la fuente: Referencia en cada renglón, null salvo en Gastos de Viaje; Poliza numérica.
const FORMA_REAL = {
  Fecha: { Inicia: '2026-11-21 00:00:00', Termina: '2026-11-25 00:00:00' },
  Percepciones: [
    { Descripcion: 'Bono C.D', Monto: 150.0, Referencia: null },
    { Descripcion: 'Bono Pos', Monto: 150.0, Referencia: null },
    { Descripcion: 'Sueldo x Vuelta', Monto: 4994.0, Referencia: null },
  ],
  Deducciones: [
    { Descripcion: 'Gastos de Viaje', Monto: 1000.0, Referencia: '1A185946' },
    { Descripcion: 'IMSS', Monto: 145.64, Referencia: null },
    { Descripcion: 'ISPT', Monto: 397.05, Referencia: null },
  ],
  Folio: '1027',
  TipoOperador: 'foraneo',
  Poliza: 214323,
  NumeroPago: null,
  Neto: 3751.31,
};

describe('muestra-tms · Referencia como número de vale', () => {
  it('la forma real se acepta sin revisión y sin avisos, y el vale queda en su renglón', () => {
    const r = conv(FORMA_REAL);
    expect(r.revision).toEqual([]);
    expect(r.advertencias).toEqual([]);
    expect(r.desglose?.deducciones).toEqual([
      { concepto: 'Gastos de Viaje', monto: 1000, vale: '1A185946' },
      { concepto: 'IMSS', monto: 145.64 },
      { concepto: 'ISPT', monto: 397.05 },
    ]);
    expect(r.desglose?.percepciones.every((p) => p.vale === undefined)).toBe(true);
  });

  it('sin Referencia todo sigue igual que antes', () => {
    const sin = conv({ ...FORMA_REAL, Deducciones: FORMA_REAL.Deducciones.map(({ Descripcion, Monto }) => ({ Descripcion, Monto })) });
    expect(sin.revision).toEqual([]);
    expect(sin.desglose?.deducciones.every((d) => d.vale === undefined)).toBe(true);
  });

  it('Referencia ya no se avisa como campo desconocido', () => {
    expect(advertenciasDeCampos({ Percepciones: [{ Descripcion: 'x', Monto: 1, Referencia: 'A1' }], Deducciones: [{ Descripcion: 'y', Monto: 1, Referencia: null }] })).toEqual([]);
  });

  it('limpia asteriscos y espacios; número entero se acepta como texto; vacío o null = sin vale', () => {
    expect(valeDeReferencia('*257008')).toEqual({ vale: '257008', descartada: false });
    expect(valeDeReferencia(' 1A 18 ')).toEqual({ vale: '1A18', descartada: false });
    expect(valeDeReferencia(185946)).toEqual({ vale: '185946', descartada: false });
    expect(valeDeReferencia('')).toEqual({ descartada: false });
    expect(valeDeReferencia(null)).toEqual({ descartada: false });
    expect(valeDeReferencia(undefined)).toEqual({ descartada: false });
  });

  it('una Referencia inservible no rechaza la bitácora: el renglón sigue sin vale y se avisa la ruta', () => {
    expect(valeDeReferencia({ a: 1 }).descartada).toBe(true);
    expect(valeDeReferencia(1.5).descartada).toBe(true);
    expect(valeDeReferencia('X'.repeat(41)).descartada).toBe(true);
    const r = conv({ ...FORMA_REAL, Deducciones: [{ Descripcion: 'Gastos de Viaje', Monto: 1000, Referencia: 'X'.repeat(41) }, ...FORMA_REAL.Deducciones.slice(1)] });
    expect(r.revision).toEqual([]);
    expect(r.desglose?.deducciones[0]).toEqual({ concepto: 'Gastos de Viaje', monto: 1000 });
    expect(r.advertencias).toEqual([{ codigo: 'referencia_descartada', campo: 'Deducciones[0].Referencia' }]);
  });
});
