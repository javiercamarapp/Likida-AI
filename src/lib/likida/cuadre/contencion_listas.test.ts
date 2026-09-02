// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 24 · ARQ-1 (ALTO, 6ª caída por el mismo hueco: 22→23→24).
//
// Cinco listas de tipos de diferencia gobiernan el motor (`NO_DEDUCIBLE_ISR`,
// `POR_CONFIRMAR`, `SIN_IVA_ACREDITABLE`, `SIN_ESTIMULO`, `REVISAR`) y las
// cinco se escribían a mano. TypeScript verifica PERTENENCIA, nunca COBERTURA:
// `rfc_receptor_no_verificable` entró a `POR_CONFIRMAR` en la auditoría 5 y
// nunca a `REVISAR`, así que un CFDI de $11,600 a nombre de un tercero, con el
// RFC de la flota sin capturar, daba `totalDeducible 0 · totalPorConfirmar
// 11,600 · estatus 'cuadrada'`: la misma hoja decía «Cuadrada» en verde arriba
// y «Deducible para ISR: —» abajo.
//
// La regla que este archivo fija: TODO motivo que saque un peso de la cubeta
// deducible merece que una persona mire la liquidación antes de cerrarla. Y
// `REVISAR` ya no se copia: se DERIVA de las cubetas más lo operativo.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import {
  cuadrarViaje,
  NO_DEDUCIBLE_ISR, POR_CONFIRMAR, SIN_IVA_ACREDITABLE, SIN_ESTIMULO, REVISAR, REVISAR_OPERATIVO,
} from './engine';
import type { Gasto, TipoDiferencia } from '@/types/likida';

describe('ARQ-1: las listas del motor se contienen como la ley manda', () => {
  it('todo lo que saca dinero de la cubeta deducible baja la liquidación a revisión', () => {
    const faltan = [...NO_DEDUCIBLE_ISR, ...POR_CONFIRMAR].filter((t) => !REVISAR.includes(t));
    expect(faltan, 'tipos de cubeta que NO están en REVISAR').toEqual([]);
  });

  it('lo que no acredita IVA tampoco acredita el estímulo (SIN_ESTIMULO ⊇ SIN_IVA_ACREDITABLE)', () => {
    const faltan = SIN_IVA_ACREDITABLE.filter((t) => !SIN_ESTIMULO.includes(t));
    expect(faltan).toEqual([]);
  });

  it('lo NO deducible para ISR no acredita IVA (LIVA 5-I: la proporción es cero)', () => {
    const faltan = NO_DEDUCIBLE_ISR.filter((t) => !SIN_IVA_ACREDITABLE.includes(t));
    expect(faltan).toEqual([]);
  });

  it('las dos exclusiones deliberadas siguen fuera de REVISAR, con su porqué escrito', () => {
    // `ieps_no_desglosado` y `permiso_cre_no_verificable` se disparan en casi
    // TODO CFDI de diésel; mandarlos a REVISAR vaciaba la bandeja de
    // significado (ver el comentario de `REVISAR_OPERATIVO`).
    const excluidos: TipoDiferencia[] = ['ieps_no_desglosado', 'permiso_cre_no_verificable'];
    for (const t of excluidos) {
      expect(REVISAR, `${t} entró a REVISAR`).not.toContain(t);
      expect(NO_DEDUCIBLE_ISR).not.toContain(t);
      expect(POR_CONFIRMAR).not.toContain(t);
    }
  });

  it('REVISAR es exactamente la unión de las tres listas, sin repetidos', () => {
    const esperado = new Set<TipoDiferencia>([...NO_DEDUCIBLE_ISR, ...POR_CONFIRMAR, ...REVISAR_OPERATIVO]);
    expect(new Set(REVISAR)).toEqual(esperado);
    expect(REVISAR.length).toBe(esperado.size);
  });
});

// El escenario que la auditoría corrió: fixture de `rfc_no_verificable.test.ts`.
const CFDI_DE_TERCERO: Gasto = {
  id: 'g1', concepto: 'factura', monto: 11600, fecha: '2026-07-27',
  cfdiUuid: 'aaaaaaaa-1111-2222-3333-444444444444', estadoSat: 'vigente',
  rfcReceptor: 'ODM950324V2A', ivaTraslado: 1600, xmlVerificado: true,
};

describe('ARQ-1: $0 deducible y el 100% por confirmar NO es «Cuadrada»', () => {
  for (const rfc of ['XAXX010101000', 'TIN010101AAA']) {
    it(`con empresaRfc ${rfc}, la liquidación sale a revisar`, () => {
      const l = cuadrarViaje({ viajeId: 'v', anticipo: 11_600, politica: [], gastos: [CFDI_DE_TERCERO], empresaRfc: rfc });
      expect(l.totalDeducible).toBe(0);
      expect(l.totalPorConfirmar).toBe(11_600);
      expect(l.estatus).toBe('revisar');
    });
  }
});
