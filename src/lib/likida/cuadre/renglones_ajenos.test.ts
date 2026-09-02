// ═══════════════════════════════════════════════════════════════════════════
// FISCAL-19C2-6 — un ticket de canasta mixta con partidas ajenas al viaje
// (≥15% del monto) se imprimía "Deducible para ISR" 100% verde y la
// liquidación en `cuadrada`: `renglones_ajenos` empujaba la observación
// (`diferencias.push`) pero no estaba en NINGÚN bucket (`POR_CONFIRMAR`,
// `REVISAR`), así que `cubetaDe` caía al default `'deducible'` y el
// `estatus` nunca bajaba de `cuadrada`. Mismo patrón que `consumo_bar`
// (juicio de un modelo de visión, no medición — solo una persona rechaza el
// gasto; el sistema únicamente pone la cifra a la vista).
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { cuadrarViaje, cubetaDe, type PoliticaGasto } from './engine';
import type { Gasto } from '@/types/likida';

// `hospedaje` a propósito (no `alimentacion`): ese concepto trae sus PROPIAS
// reglas (LISR 28-V: soporte de viaje, tope diario de viáticos) que se
// disparan solas con un monto de $1,000 y contaminarían el estatus —
// enmascarando si el estatus baja POR `renglones_ajenos` o por otra cosa.
const politica: PoliticaGasto[] = [{ concepto: 'hospedaje', topeMonto: 5000 }];
const EST = { peajeFactor: 0.5, viaticosTopeFiscalDiarioMxn: 750, efectivoTopeMxn: 2000, clavesDieselIeps: [] };

const canastaMixta: Gasto = {
  id: 'g1', concepto: 'hospedaje', monto: 1000, folio: 'A1', fecha: '2026-05-01', ocrConfianza: 0.95,
  cfdiUuid: 'u-g1', xmlVerificado: true, rfcReceptor: 'REC010101AA1', formaPago: '04',
  ivaTraslado: 137.93, subTotal: 862.07,
  ocrExtra: {
    renglones: [
      { descripcion: 'Cuarto', importe: 700, ajenoAlViaje: false },
      { descripcion: 'Cargador de celular', importe: 300, ajenoAlViaje: true },
    ],
  },
};

const cuadra = (g: Gasto) => cuadrarViaje({ viajeId: 'v-canasta', anticipo: 1000, politica, estimulos: EST, gastos: [g] });

describe('FISCAL-19C2-6: renglones ajenos al viaje ya no se imprimen 100% deducibles', () => {
  it('30% de partidas ajenas manda a por-confirmar y baja la liquidación a revisar', () => {
    const r = cuadra(canastaMixta);
    const d = r.diferencias.find((x) => x.tipo === 'renglones_ajenos');
    expect(d).toBeDefined();
    expect(d!.nota).toContain('Cargador de celular');
    expect(cubetaDe(canastaMixta, r.diferencias.filter((x) => x.gastoId === 'g1'))).toBe('por_confirmar');
    expect(r.estatus).toBe('revisar');
  });

  // ── AUDITORÍA 22, ARQ-1 / FIS (ALTO) ──────────────────────────────────────
  // El arreglo de FISCAL-19C2-6 metió `renglones_ajenos` en `POR_CONFIRMAR` y
  // en `REVISAR`, pero NO en `SIN_ACREDITAMIENTO`. Las pruebas de arriba miran
  // la cubeta de ISR y el estatus; ninguna miraba el IVA. Resultado: el mismo
  // CFDI salía con `totalDeducible 0` / `totalPorConfirmar 1000` y aun así
  // `ivaAcreditable 137.93`, en verde.
  //
  // LIVA art. 5 fr. I —el artículo que este mismo bloque cita— acredita "en la
  // proporción en la que dichas erogaciones sean deducibles para los fines del
  // impuesto sobre la renta". Un gasto en `por_confirmar` tiene deducible CERO
  // mientras no se confirme, así que la proporción es cero. Es el mismo
  // razonamiento que `engine.ts` ya escribió para `gasto_otro_ejercicio`.
  it('un gasto en por-confirmar no acredita su IVA (LIVA 5-I: la proporción deducible es cero)', () => {
    const r = cuadra(canastaMixta);
    expect(cubetaDe(canastaMixta, r.diferencias.filter((x) => x.gastoId === 'g1'))).toBe('por_confirmar');
    expect(r.totalDeducible).toBe(0);
    expect(r.totalPorConfirmar).toBe(1000);
    // Lo que rompía: 137.93 acreditados sobre una erogación con deducible 0.
    expect(r.ivaAcreditable).toBe(0);
  });

  it('un renglón ajeno de menos del 15% no dispara nada (ruido, no señal)', () => {
    const g: Gasto = {
      ...canastaMixta,
      id: 'g2',
      ocrExtra: {
        renglones: [
          { descripcion: 'Cuarto', importe: 950, ajenoAlViaje: false },
          { descripcion: 'Chicle', importe: 50, ajenoAlViaje: true },
        ],
      },
    };
    const r = cuadrarViaje({ viajeId: 'v-canasta2', anticipo: 1000, politica, estimulos: EST, gastos: [g] });
    expect(r.diferencias.some((x) => x.tipo === 'renglones_ajenos')).toBe(false);
    expect(r.estatus).toBe('cuadrada');
  });
});
