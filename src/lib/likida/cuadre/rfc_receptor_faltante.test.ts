import { describe, it, expect } from 'vitest';
import { cuadrarViaje } from './engine';
import type { Gasto } from '@/types/likida';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 8 · CRÍTICO fiscal — AL-6 por la puerta que quedó abierta.
//
// Las dos validaciones de receptor (rfcEmpresaInservible / rfcsOk) exigen
// `g.rfcReceptor` truthy. El esquema de visión NO tiene campo de receptor: solo
// lee el UUID del QR de un CFDI impreso, y el prompt le pide EXPRESAMENTE al
// modelo el RFC del EMISOR, "no el del cliente". Si el receptor no se pudo leer
// (QR dañado, o el XML no trae Receptor@Rfc), ninguna de las dos ramas corre y
// el gasto cae en 'deducible' — el mismo daño de AL-6 y del CRÍTICO de la
// ronda 5, por una tercera puerta.
//
// Medido con el motor real (fiscal.md, auditoría 8): la MISMA factura de
// $11,600 con $1,600 de IVA se vuelve deducible + acreditable, en verde, según
// si el QR se decodificó o no.
// ═══════════════════════════════════════════════════════════════════════════

const CFDI_SIN_RECEPTOR: Gasto = {
  id: 'g1', concepto: 'factura', monto: 11600, fecha: '2026-07-27',
  cfdiUuid: 'aaaaaaaa-1111-2222-3333-444444444444', estadoSat: 'vigente',
  // rfcReceptor: AUSENTE a propósito — el QR no lo trae, la visión no lo lee.
  ivaTraslado: 1600, xmlVerificado: true,
};

const cuadrar = () => cuadrarViaje({
  viajeId: 'v', anticipo: 20_000, politica: [], gastos: [CFDI_SIN_RECEPTOR],
  empresaRfc: 'EMP010101AA2', // RFC de empresa VÁLIDO, capturado correctamente.
});

describe('CFDI sin RFC receptor: no se puede confirmar NI descartar', () => {
  it('NO se cuenta como deducible', () => {
    const l = cuadrar();
    expect(l.totalDeducible).toBe(0);
    expect(l.totalPorConfirmar).toBe(11600);
  });

  it('su IVA NO se acredita', () => {
    expect(cuadrar().ivaAcreditable).toBe(0);
  });

  it('lo dice en el informe: rfc_receptor_no_verificable', () => {
    const tipos = (cuadrar().diferencias ?? []).map((d) => d.tipo);
    expect(tipos).toContain('rfc_receptor_no_verificable');
  });

  // Control: con receptor presente y válido, la factura SÍ se acredita — sin
  // esto, el arreglo de arriba podría estar apagando el camino bueno también.
  it('control: con receptor presente y correcto, sí es deducible', () => {
    const l = cuadrarViaje({
      viajeId: 'v', anticipo: 20_000, politica: [],
      gastos: [{ ...CFDI_SIN_RECEPTOR, rfcReceptor: 'EMP010101AA2' }],
      empresaRfc: 'EMP010101AA2',
    });
    expect(l.totalDeducible).toBe(11600);
    expect(l.ivaAcreditable).toBe(1600);
  });
});
