import { describe, it, expect } from 'vitest';
import { cuadrarViaje } from './cuadre/engine';
import { derivoLaConfig } from './analytics';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 6 · CRÍTICO de frontend — EL PANEL CONTRADICE AL PDF ARCHIVADO.
//
// `cuadrarDesdeDB` llama a `getConfig` fresco en cada carga, así que el detalle
// recalcula la deducibilidad con la política, el RFC y las vigencias de HOY. El
// único portón de `reconstruir` comparaba `totalComprobado`, que es una suma de
// montos y no lee NI UNA clave de `config`. O sea: el portón siempre pasaba
// justo cuando lo que había cambiado era lo que mueve las cubetas.
//
// Este archivo fija las dos mitades:
//   1) que un cambio de config mueve las cubetas SIN mover `totalComprobado`
//      — la premisa del hallazgo, medida con el motor real;
//   2) que el portón nuevo (los TIPOS de `diferencias` persistidos) sí lo ve.
// ═══════════════════════════════════════════════════════════════════════════

const CFDI_DIESEL = {
  id: 'g1',
  concepto: 'diesel' as const,
  monto: 5800,
  fecha: '2026-05-01',
  formaPago: '03',
  cfdiUuid: 'a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d',
  rfcEmisor: 'PEM850101AAA',
  rfcReceptor: 'TRA850101AB1',
  xmlVerificado: true,
  tipoComprobante: 'I',
};

const base = { viajeId: 'v1', anticipo: 6000, politica: [], gastos: [CFDI_DIESEL] };

describe('la premisa del hallazgo: la config mueve las cubetas y no el comprobado', () => {
  // Al cerrar: el tenant todavía no capturó su RFC (estado normal el día uno).
  const alCerrar = cuadrarViaje({ ...base, empresaRfc: undefined });
  // Al reabrir: ya se capturó el RFC de la flota, y NO es el receptor del CFDI.
  const alReabrir = cuadrarViaje({ ...base, empresaRfc: 'MAT9012159X6' });

  it('totalComprobado no se mueve un centavo', () => {
    expect(alReabrir.totalComprobado).toBe(alCerrar.totalComprobado);
    expect(Math.abs(alCerrar.totalComprobado - alReabrir.totalComprobado)).toBeLessThan(0.015);
  });

  it('pero el desglose sí: lo que era deducible pasa a por confirmar', () => {
    expect(alCerrar.totalDeducible).toBeGreaterThan(0);
    expect(alReabrir.totalDeducible).not.toBe(alCerrar.totalDeducible);
  });

  it('y aparece un motivo de diferencia que antes no estaba', () => {
    const tipos = (l: { diferencias: Array<{ tipo?: string }> }) =>
      new Set(l.diferencias.map((d) => d.tipo));
    expect(tipos(alReabrir).size).not.toBe(tipos(alCerrar).size);
  });
});

describe('el portón nuevo mira los tipos de diferencia, que sí cambian', () => {
  // AUDITORÍA 7 · CRÍTICO del rubro de pruebas: aquí vivía una REIMPLEMENTACIÓN
  // de `derivoLaConfig` escrita dentro de este mismo archivo. Probaba "el
  // criterio", no la función, así que la de producción podía romperse entera y
  // estos cuatro casos seguían verdes — verificado: cambiando el `return true`
  // de `analytics.ts` por `return false`, las 7 pruebas pasaban igual. El
  // arreglo del CRÍTICO de frontend de la ronda 6 estaba sin anclar.
  //
  // La copia además NO era fiel: le faltaba la guarda `!Array.isArray`, así que
  // ni siquiera probaba el mismo criterio que decía probar.
  const derivo = (a: Array<{ tipo?: string }>, b: Array<{ tipo?: string }>) =>
    derivoLaConfig(a, b);

  it('detecta el motivo nuevo del escenario real', () => {
    expect(derivo(
      [{ tipo: 'anticipo' }],
      [{ tipo: 'rfc_receptor_no_verificable' }, { tipo: 'anticipo' }],
    )).toBe(true);
  });

  it('detecta también un motivo que DESAPARECE', () => {
    // Subir un tope de política puede borrar un `efectivo_sobre_tope`.
    expect(derivo([{ tipo: 'efectivo_sobre_tope' }, { tipo: 'anticipo' }], [{ tipo: 'anticipo' }])).toBe(true);
  });

  it('un cambio de monto o de texto NO se cuenta como deriva', () => {
    // Si saltara por esto, el desglose quedaría apagado siempre y el arreglo
    // costaría la función que el contralor viene a ver.
    expect(derivo(
      [{ tipo: 'anticipo', monto: 200 } as { tipo: string }],
      [{ tipo: 'anticipo', monto: 200.01 } as { tipo: string }],
    )).toBe(false);
  });

  it('el mismo conjunto en otro orden no es deriva', () => {
    expect(derivo(
      [{ tipo: 'anticipo' }, { tipo: 'sin_cfdi' }],
      [{ tipo: 'sin_cfdi' }, { tipo: 'anticipo' }],
    )).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 8 · CRÍTICO de frontend — MISMO BUG, PUERTA DEL TOPE DE VIÁTICOS.
//
// El portón de arriba compara el CONJUNTO de tipos, no el monto. Si alguien
// ajusta `estimulos.viaticosTopeFiscalDiarioMxn` del tenant (config editable,
// igual que el RFC del hallazgo original) entre el cierre y la reapertura, el
// motor sigue emitiendo el MISMO tipo ('viatico_excede_fiscal') aunque el
// `totalDeducible` real se mueva cientos de pesos — y `derivoLaConfig` decía
// que no había deriva.
//
// Medido con el motor real (frontend.md, auditoría 8): tope 750 → deducible
// 1050; tope 400 → deducible 700. `totalComprobado` no se mueve, los TIPOS
// tampoco, pero el `esperado` de la diferencia sí (750 → 400) — y ese campo ya
// se persiste, solo no se estaba mirando.
// ═══════════════════════════════════════════════════════════════════════════
describe('el portón también ve un tope fiscal que cambió, aunque el tipo se repita', () => {
  const derivo = (a: Array<{ tipo?: string; esperado?: number }>, b: Array<{ tipo?: string; esperado?: number }>) =>
    derivoLaConfig(a, b);

  it('detecta que el tope de alimentación cambió, mismo tipo, distinto esperado', () => {
    expect(derivo(
      [{ tipo: 'viatico_excede_fiscal', esperado: 750 }],
      [{ tipo: 'viatico_excede_fiscal', esperado: 400 }],
    )).toBe(true);
  });

  it('el mismo tope, mismo esperado, no es deriva', () => {
    expect(derivo(
      [{ tipo: 'viatico_excede_fiscal', esperado: 750 }],
      [{ tipo: 'viatico_excede_fiscal', esperado: 750 }],
    )).toBe(false);
  });

  it('sin esperado en ninguno de los dos lados, se conserva el criterio de solo-tipo', () => {
    expect(derivo([{ tipo: 'anticipo' }], [{ tipo: 'anticipo' }])).toBe(false);
  });
});
