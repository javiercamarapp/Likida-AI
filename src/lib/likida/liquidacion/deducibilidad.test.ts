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

// ═══════════════════════════════════════════════════════════════════════════
// A57-FIS-02 (auditoría 57, ALTO): "Deducible para ISR" EN VERDE cuando el
// motor acaba de registrar que un requisito LITERAL de LISR 28-V no se cumple.
//
// La ficha `normas/lisr-28-V.yaml` está `verificado_fuente_primaria` y su texto
// dice, literal, que los gastos de alimentación "sólo serán deducibles [...]
// cuando el contribuyente acompañe el comprobante fiscal [...] que ampare el
// hospedaje o transporte", y que si sólo se acompaña el transporte "la
// deducción [...] sólo procederá cuando el pago se efectúe mediante tarjeta de
// crédito de la persona que realiza el viaje".
//
// El motor levanta esas dos faltas (`engine.ts:1707` y `:1743`) con `monto: 0`
// a propósito: no puede AFIRMAR que no es deducible sin ver la contabilidad
// entera de la flota. Correcto. Pero el monto se queda dentro de
// `totalDeducible`, y el renglón salía con `tono: 'bueno'` — VERDE en el PDF
// (`pdf.ts:355`) y sin pie (`:369`) — afirmando deducibilidad justo del dinero
// cuyo requisito el motor marcó como incumplido.
//
// Es el MISMO caso estructural que `permiso_cre_no_verificable`, que la
// auditoría 9 ya resolvió degradando el tono a `condicionado`. Esta prueba
// extiende esa regla ya decidida a los dos motivos de 28-V.
// ═══════════════════════════════════════════════════════════════════════════
const conDif = (d: number, tipos: string[]) => ({
  ...liq(d, 0, 0),
  diferencias: tipos.map((tipo) => ({ tipo, concepto: 'alimentacion', monto: 0, nota: '' })),
});

describe('filasDeducibilidad — no afirma en verde lo que el motor marcó incumplido (A57-FIS-02)', () => {
  it('alimentacion_sin_soporte degrada el tono y explica LISR 28-V', () => {
    const f = filasDeducibilidad(conDif(5000, ['alimentacion_sin_soporte']) as never)!;
    expect(f[0].tono).toBe('condicionado');
    expect(f[0].tono).not.toBe('bueno');
    expect(f[0].label).toMatch(/28-V/);
    expect(f[0].pie).toMatch(/28-V/);
    expect(f[0].monto).toBe(5000);
  });

  it('alimentacion_transporte_sin_tarjeta_credito hace lo mismo y cita la tarjeta', () => {
    const f = filasDeducibilidad(conDif(3200, ['alimentacion_transporte_sin_tarjeta_credito']) as never)!;
    expect(f[0].tono).toBe('condicionado');
    expect(f[0].pie).toMatch(/tarjeta de crédito/);
  });

  it('sin ninguna de las dos faltas el renglón sigue en verde y sin pie', () => {
    // El guardarraíl del guardarraíl: si esto se pusiera `condicionado` siempre,
    // el renglón dejaría de distinguir y la degradación no diría nada.
    const f = filasDeducibilidad(conDif(5000, ['otra_cosa_cualquiera']) as never)!;
    expect(f[0].tono).toBe('bueno');
    expect(f[0].label).toBe('Deducible para ISR');
    expect(f[0].pie).toBeUndefined();
  });

  it('con CRE y 28-V a la vez, el pie trae LAS DOS razones y ninguna se pierde', () => {
    const f = filasDeducibilidad(conDif(8000, ['permiso_cre_no_verificable', 'alimentacion_sin_soporte']) as never)!;
    expect(f[0].tono).toBe('condicionado');
    expect(f[0].pie).toMatch(/CRE/);
    expect(f[0].pie).toMatch(/28-V/);
  });
});
