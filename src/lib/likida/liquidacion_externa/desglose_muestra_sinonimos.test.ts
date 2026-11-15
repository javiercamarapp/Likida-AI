import { describe, it, expect } from 'vitest';
import { advertenciasDeCampos, convertirBitacoraMuestra, MAX_ADVERTENCIAS_BITACORA } from './desglose_muestra_tms';
import { BITACORA_MUESTRA, NETO_MUESTRA_CENTAVOS, PADRON_MUESTRA } from './desglose_muestra_tms.fixture';

// Sinónimos estrictos de monto (Cargo en Percepciones, Abono en Deducciones) y advertencias de campos desconocidos. Datos sintéticos.

const base = { ...BITACORA_MUESTRA } as Record<string, unknown>;
delete base.CampoExtraDesconocido;
const conv = (o: Record<string, unknown>) => convertirBitacoraMuestra({ ...base, ...o }, { padron: PADRON_MUESTRA });
const codigos = (r: { revision: Array<{ codigo: string }> }) => r.revision.map((m) => m.codigo);

describe('muestra-tms · Cargo/Abono como sinónimo de Monto', () => {
  it('Cargo en Percepciones y Abono en Deducciones se leen cuando no viene Monto, con el mismo resultado', () => {
    const r = conv({
      Percepciones: [{ Descripcion: 'Sueldo semanal', Cargo: 4000 }, { Descripcion: 'Bono de puntualidad', Cargo: 500.5 }],
      Deducciones: [{ Descripcion: 'Fonacot', Abono: 200.1 }],
    });
    expect(r.revision).toEqual([]);
    expect(r.desglose?.percepciones.map((p) => p.monto)).toEqual([4000, 500.5]);
    expect(r.desglose?.deducciones.map((d) => d.monto)).toEqual([200.1]);
    expect(r.netoCentavos).toBe(450050 - 20010);
    expect(r.advertencias).toEqual([]);
  });

  it('el signo lo decide el arreglo, no el nombre: Cargo en Deducciones y Abono en Percepciones NO son sinónimos', () => {
    const d = conv({ Percepciones: [{ Descripcion: 'Sueldo semanal', Monto: 100 }], Deducciones: [{ Descripcion: 'Fonacot', Cargo: 50 }] });
    expect(codigos(d)).toEqual(['monto_nulo']);
    expect(d.revision[0].campo).toBe('Deducciones[0].Monto');
    expect(d.advertencias).toEqual([{ codigo: 'campo_desconocido', campo: 'Deducciones[].Cargo' }]);
    const p = conv({ Percepciones: [{ Descripcion: 'Sueldo semanal', Abono: 100 }], Deducciones: [{ Descripcion: 'Fonacot', Monto: 50 }] });
    expect(codigos(p)).toEqual(['monto_nulo']);
    expect(p.advertencias).toEqual([{ codigo: 'campo_desconocido', campo: 'Percepciones[].Abono' }]);
  });

  it('Monto y sinónimo con valores distintos ⇒ monto_ambiguo (revisión, sin sumar ni elegir)', () => {
    const r = conv({ Percepciones: [{ Descripcion: 'Sueldo semanal', Monto: 100, Cargo: 150 }], Deducciones: [{ Descripcion: 'Fonacot', Monto: 50 }] });
    expect(codigos(r)).toEqual(['monto_ambiguo']);
    expect(r.revision[0].campo).toBe('Percepciones[0].Monto');
    expect(r.desglose).toBeNull();
    const a = conv({ Percepciones: [{ Descripcion: 'Sueldo semanal', Monto: 100 }], Deducciones: [{ Descripcion: 'Fonacot', Monto: 50, Abono: 0 }] });
    expect(codigos(a)).toEqual(['monto_ambiguo']);
  });

  it('Monto y sinónimo con el mismo valor se aceptan (usa Monto)', () => {
    const r = conv({ Percepciones: [{ Descripcion: 'Sueldo semanal', Monto: 100, Cargo: 100 }], Deducciones: [{ Descripcion: 'Fonacot', Monto: 50, Abono: 50 }] });
    expect(r.revision).toEqual([]);
    expect(r.desglose?.percepciones).toEqual([{ concepto: 'Sueldo semanal', monto: 100 }]);
    expect(r.advertencias).toEqual([]);
  });

  it('las reglas actuales de monto siguen sobre el sinónimo: negativo, decimales, cero y nulo', () => {
    const neg = conv({ Percepciones: [{ Descripcion: 'Sueldo semanal', Cargo: -1 }], Deducciones: [{ Descripcion: 'Fonacot', Monto: 50 }] });
    expect(codigos(neg)).toEqual(['monto_negativo']);
    expect(neg.revision[0].campo).toBe('Percepciones[0].Cargo');
    const dec = conv({ Percepciones: [{ Descripcion: 'Sueldo semanal', Monto: 10 }], Deducciones: [{ Descripcion: 'Fonacot', Abono: 1.005 }] });
    expect(codigos(dec)).toEqual(['monto_decimales']);
    const cero = conv({ Percepciones: [{ Descripcion: 'Sueldo semanal', Monto: 10 }, { Descripcion: 'Bono de puntualidad', Cargo: 0 }], Deducciones: [] });
    expect(cero.revision).toEqual([]);
    expect(cero.ignorados).toEqual([{ donde: 'Percepciones[1]', motivo: 'monto en cero' }]);
    const nulo = conv({ Percepciones: [{ Descripcion: 'Sueldo semanal', Monto: null, Cargo: null }], Deducciones: [{ Descripcion: 'Fonacot', Monto: 5 }] });
    expect(codigos(nulo)).toEqual(['monto_nulo']);
  });

  it('sin sinónimos todo se comporta igual que antes (muestra actual)', () => {
    const r = conv({});
    expect(r.revision).toEqual([]);
    expect(r.netoCentavos).toBe(NETO_MUESTRA_CENTAVOS);
    expect(r.advertencias).toEqual([]);
    expect(codigos(conv({ Percepciones: [{ Descripcion: 'Sueldo semanal' }], Deducciones: [{ Descripcion: 'Fonacot', Monto: 5 }] }))).toEqual(['monto_nulo']);
  });
});

describe('muestra-tms · advertencias de campos desconocidos', () => {
  it('un nombre mal escrito no cambia la aceptación pero se avisa, sin valores', () => {
    const r = conv({ 'Póliza': 'SECRETO-123', Poliza: undefined });
    expect(r.revision).toEqual([]);
    expect(r.advertencias).toEqual([{ codigo: 'campo_desconocido', campo: 'Póliza' }]);
    expect(JSON.stringify(r.advertencias)).not.toMatch(/SECRETO/);
  });

  it('avisa campos anidados con ruta estable y sin duplicados; NumeroLiquidacion documentado no se avisa', () => {
    const a = advertenciasDeCampos({
      ...base, NumeroLiquidacion: 'L1', Extra: 1,
      Fecha: { Inicia: 'x', Termina: 'y', Zona: 'z' },
      Percepciones: [{ Descripcion: 'a', Monto: 1, Nota: 'v1' }, { Descripcion: 'b', Monto: 2, Nota: 'v2' }],
    });
    expect(a).toEqual([
      { codigo: 'campo_desconocido', campo: 'Extra' },
      { codigo: 'campo_desconocido', campo: 'Fecha.Zona' },
      { codigo: 'campo_desconocido', campo: 'Percepciones[].Nota' },
    ]);
  });

  it('tope de 10 por bitácora, nombres recortados y sin caracteres de control', () => {
    const raros: Record<string, unknown> = {};
    for (let i = 0; i < 25; i++) raros[`Campo${i}`] = i;
    const a = advertenciasDeCampos({ ...base, ...raros });
    expect(a).toHaveLength(MAX_ADVERTENCIAS_BITACORA);
    expect(a[0].campo).toBe('Campo0');
    const largo = advertenciasDeCampos({ ...base, ['X\n' + 'y'.repeat(100)]: 1 });
    expect(largo[0].campo).toHaveLength(40);
    expect(largo[0].campo).not.toMatch(/\n/);
  });

  it('una bitácora que no es objeto no rompe', () => {
    const r = convertirBitacoraMuestra(7, { padron: PADRON_MUESTRA });
    expect(r.advertencias).toEqual([]);
    expect(codigos(r)).toEqual(['fila_invalida']);
  });
});
