// ═══════════════════════════════════════════════════════════════════════════
// AUD24 · PRU-6 — `rfc_receptor_no_verificable` SÍ tiene que bajar el estatus
// a "revisar".
//
// Esta prueba nació con la afirmación contraria (que quedarse en
// `con_diferencias` era lo correcto), razonando que mandarlo a REVISAR
// pondría en rojo a cualquier flota con su RFC mal capturado. Verificado
// contra `origin/master` antes de esta ronda: el `REVISAR` de
// `engine.ts:1610` era un arreglo LOCAL escrito a mano que EXCLUÍA
// `rfc_receptor_no_verificable` a propósito — y esa exclusión es
// exactamente ARQ-1, el hallazgo que las auditorías 19 a 23 encontraron SEIS
// veces seguidas: una liquidación con $0 deducible y el 100% "por
// confirmar" salía "Cuadrada" (verde) en vez de "Por revisar" (rojo).
//
// El arreglo de `fiscal` en esta ronda corrigió la causa raíz, no el síntoma:
// `REVISAR` dejó de ser una lista copiada a mano y pasó a ser DERIVADA
// (`REVISAR = [...NO_DEDUCIBLE_ISR, ...POR_CONFIRMAR, ...REVISAR_OPERATIVO]`,
// engine.ts:371) — `rfc_receptor_no_verificable` ya vivía en `POR_CONFIRMAR`
// desde antes, así que entra a `REVISAR` por construcción, sin que nadie
// tenga que acordarse de agregarlo a mano una séptima vez.
//
// El escenario de "un RFC mal capturado no debería poner rojo cada
// liquidación" sigue siendo una preocupación válida — pero la resuelve el
// dato real (que la flota capture su RFC correcto), no una excepción en el
// motor. El caso que este archivo cubre (RFC mal formado o ausente en el
// CFDI del receptor) es, por definición, un caso que SÍ necesita que una
// persona lo mire.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { cuadrarViaje } from './engine';
import type { Gasto } from '@/types/likida';

const CFDI_DE_TERCERO: Gasto = {
  id: 'g1', concepto: 'factura', monto: 11600, fecha: '2026-07-27',
  cfdiUuid: 'aaaaaaaa-1111-2222-3333-444444444444', estadoSat: 'vigente',
  rfcReceptor: 'ODM950324V2A',
  ivaTraslado: 1600, xmlVerificado: true,
};

describe('PRU-6: rfc_receptor_no_verificable SÍ baja el estatus a "revisar" (ARQ-1, 6ª y última caída)', () => {
  it('RFC de la flota mal formado: estatus = revisar, no con_diferencias', () => {
    const l = cuadrarViaje({ viajeId: 'v', anticipo: 20_000, politica: [], gastos: [CFDI_DE_TERCERO], empresaRfc: 'TIN010101AAA' });
    expect(l.diferencias.map((d) => d.tipo)).toContain('rfc_receptor_no_verificable');
    expect(l.estatus).toBe('revisar');
  });

  it('RFC de la flota sin capturar (genérico del SAT): mismo estatus, revisar', () => {
    const l = cuadrarViaje({ viajeId: 'v', anticipo: 20_000, politica: [], gastos: [CFDI_DE_TERCERO], empresaRfc: 'XAXX010101000' });
    expect(l.diferencias.map((d) => d.tipo)).toContain('rfc_receptor_no_verificable');
    expect(l.estatus).toBe('revisar');
  });
});
