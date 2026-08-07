import { describe, it, expect } from 'vitest';
import { filasDeducibilidad } from './deducibilidad';

// El reparto en tres cubetas es LA cifra por la que el contralor paga: cuánto
// de lo comprobado sobrevive una revisión. El motor lo calculaba y no salía a
// ningún lado. Estos casos fijan qué se imprime y qué no.
const liq = (d: number, p: number, n: number) => ({
  totalDeducible: d, totalPorConfirmar: p, totalNoDeducible: n,
  totalComprobado: d + p + n,
});

describe('filasDeducibilidad', () => {
  it('imprime las tres cubetas en orden: deducible, por confirmar, no deducible', () => {
    const filas = filasDeducibilidad(liq(5000, 1500, 800))!;
    expect(filas.map((f) => f.label)).toEqual(['Deducible para ISR', 'Por confirmar', 'No deducible']);
    expect(filas.map((f) => f.monto)).toEqual([5000, 1500, 800]);
  });

  it('las cubetas en cero NO se imprimen', () => {
    // Un "No deducible: $0.00" gasta espacio vertical —peleadísimo en este PDF—
    // y no le dice nada a nadie.
    const filas = filasDeducibilidad(liq(5000, 0, 0))!;
    expect(filas).toHaveLength(1);
    expect(filas[0].label).toBe('Deducible para ISR');
  });

  it('distingue POR CONFIRMAR de NO DEDUCIBLE con el tono y el pie', () => {
    // No es lo mismo perder la deducción que no haberla timbrado todavía: lo
    // segundo se recupera. Pintarlos igual le cuesta dinero al cliente.
    const filas = filasDeducibilidad(liq(0, 1500, 800))!;
    expect(filas[0].tono).toBe('pendiente');
    expect(filas[0].pie).toMatch(/recuperar/);
    expect(filas[1].tono).toBe('malo');
  });

  it('los renglones suman exactamente el total comprobado', () => {
    const l = liq(5000, 1500, 800);
    const suma = filasDeducibilidad(l)!.reduce((s, f) => s + f.monto, 0);
    expect(suma).toBe(l.totalComprobado);
  });

  it('sin nada comprobado no imprime la sección', () => {
    expect(filasDeducibilidad(liq(0, 0, 0))).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SI EL DESGLOSE NO CUADRA, NO SE IMPRIME.
//
// Visto en el render: una liquidación con las cubetas mal pobladas imprimió
// "Por confirmar $4,812" debajo de "Total comprobado $4,600" — una cubeta más
// grande que su total. El documento se contradice a sí mismo con toda la
// autoridad de un papel fiscal, y nadie lo impidió.
//
// Y no es hipotético: hay liquidaciones GUARDADAS de antes de que las tres
// cubetas existieran. Esas traen ceros o parciales.
//
// Mismo criterio que rige en emparejar.ts y omitidos.ts: ante la duda no se
// enseña. Un desglose ausente deja al contralor donde estaba; uno que no suma
// lo manda a tomar decisiones con cifras falsas.
// ═══════════════════════════════════════════════════════════════════════════
describe('filasDeducibilidad — no publica un desglose que no cuadra', () => {
  it('si las cubetas NO suman el total comprobado, no imprime nada', () => {
    expect(filasDeducibilidad({
      totalDeducible: 0, totalPorConfirmar: 4812, totalNoDeducible: 150,
      totalComprobado: 4600,   // 4962 ≠ 4600
    })).toBeNull();
  });

  it('una cubeta sola mayor que el total tampoco pasa', () => {
    expect(filasDeducibilidad({
      totalDeducible: 0, totalPorConfirmar: 9000, totalNoDeducible: 0,
      totalComprobado: 4600,
    })).toBeNull();
  });

  it('tolera el centavo de redondeo (round2 en tres cubetas puede desviar)', () => {
    // El motor redondea cada cubeta por separado; tres round2 pueden dejar un
    // centavo de diferencia contra el total. Eso no es incoherencia.
    const filas = filasDeducibilidad({
      totalDeducible: 3000.01, totalPorConfirmar: 1000, totalNoDeducible: 600,
      totalComprobado: 4600,
    });
    expect(filas).not.toBeNull();
    expect(filas!).toHaveLength(3);
  });

  it('una liquidación vieja, sin las cubetas pobladas, no imprime desglose', () => {
    // Guardada antes de que el motor repartiera en tres. Enseñar "Deducible $0"
    // sobre un total de $4,600 sería una mentira, no un hueco.
    expect(filasDeducibilidad({
      totalDeducible: 0, totalPorConfirmar: 0, totalNoDeducible: 0,
      totalComprobado: 4600,
    })).toBeNull();
  });
});
