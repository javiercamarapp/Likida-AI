import { describe, it, expect } from 'vitest';
import { cuadrarViaje, NO_DEDUCIBLE_ISR } from './engine';
import { DEMO_CONFIG } from '../config';
import type { Gasto } from '@/types/likida';

// ═══════════════════════════════════════════════════════════════════════════
// FISCAL (rescatado de `rutina-fiscal-wip`, rama huérfana del 21-ago-2026,
// nunca mergeada) — LA FRASE Y EL DINERO NO COINCIDÍAN.
//
// Un comprobante fechado en un ejercicio fiscal anterior levantaba
// `fecha_sospechosa` con la nota "un gasto de otro ejercicio no se deduce en
// este" — pero ese tipo NO estaba en `NO_DEDUCIBLE_ISR` ni en `POR_CONFIRMAR`,
// así que `cubetaDe` caía al default: con un CFDI válido, `totalDeducible` lo
// sumaba de todas formas. El PDF le decía al contralor una cosa y le cobraba
// dinero por la otra.
//
// El arreglo separa el caso en su propio tipo (`gasto_otro_ejercicio`, en
// `NO_DEDUCIBLE_ISR`) del caso genuinamente distinto de "fecha fuera del rango
// del viaje pero dentro del ejercicio" (`fecha_sospechosa`, que sigue sin
// excluirse sola — puede ser un simple error de captura del viaje, no un
// hecho fiscal consumado).
// ═══════════════════════════════════════════════════════════════════════════

const g = (over: Partial<Gasto> = {}): Gasto => ({
  id: 'g1', viajeId: 'v1', concepto: 'peaje', monto: 1000,
  cfdiUuid: 'aa5cb2f5-3e2b-4c1a-9c1a-000000000001',
  rfcReceptor: 'GMX0902279I1', forma_pago: '04',
  ...over,
} as Gasto);

const cuadre = (gasto: Gasto) => cuadrarViaje({
  viajeId: 'v1', anticipo: 3000, gastos: [gasto],
  politica: DEMO_CONFIG.politica, estimulos: DEMO_CONFIG.estimulos,
  hidrocarburos: DEMO_CONFIG.hidrocarburos,
  empresaRfc: 'GMX0902279I1', hoy: '2026-08-01',
});

describe('un comprobante de otro ejercicio no se cuenta como deducible en este', () => {
  it('levanta gasto_otro_ejercicio, no fecha_sospechosa', () => {
    const r = cuadre(g({ fecha: '2025-08-01' }));
    const dif = r.diferencias ?? [];
    expect(dif.some((d) => d.tipo === 'gasto_otro_ejercicio')).toBe(true);
    expect(dif.some((d) => d.tipo === 'fecha_sospechosa')).toBe(false);
  });

  it('ANTES DEL ARREGLO esto habría entrado a totalDeducible pese a la nota — ahora no', () => {
    const r = cuadre(g({ fecha: '2025-08-01' }));
    // El único gasto del viaje es del ejercicio pasado: si el motor lo contara
    // como deducible, totalDeducible sería 1000. La cifra correcta es 0.
    expect(r.totalDeducible).toBe(0);
    expect(r.totalNoDeducible).toBe(1000);
  });

  it('gasto_otro_ejercicio vive en NO_DEDUCIBLE_ISR', () => {
    expect(NO_DEDUCIBLE_ISR).toContain('gasto_otro_ejercicio');
  });

  it('un comprobante DENTRO del ejercicio se sigue deduciendo como siempre (control)', () => {
    const r = cuadre(g({ fecha: '2026-08-01' }));
    expect(r.totalDeducible).toBe(1000);
    expect((r.diferencias ?? []).some((d) => d.tipo === 'gasto_otro_ejercicio')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA FABLE CICLO 1 (90-A) — el arreglo de arriba quedó A MEDIAS.
//
// `gasto_otro_ejercicio` entró a NO_DEDUCIBLE_ISR pero no a
// SIN_ACREDITAMIENTO: un diésel del ejercicio pasado con CFDI válido y XML
// verificado salía con totalDeducible $0... y aun así acreditaba su IVA
// completo, su peaje y sus litros. LIVA 5-I (que el propio bloque de
// acreditamiento cita) exige acreditar "en la proporción en que las
// erogaciones sean deducibles" — y la proporción aquí es CERO.
// ═══════════════════════════════════════════════════════════════════════════

describe('el IVA y los estímulos de un gasto de otro ejercicio tampoco se acreditan (90-A)', () => {
  const conIva = (fecha: string): Gasto => g({
    concepto: 'diesel', fecha, monto: 1160,
    subTotal: 1000, ivaTraslado: 160,
    xmlVerificado: true, formaPago: '04',
    clave_prod_serv: '15101505',
  } as Partial<Gasto>);

  it('el caso reproducido por el auditor: diésel 2025 con hoy 2026 → ivaAcreditable 0', () => {
    const r = cuadre(conIva('2025-08-01'));
    expect(r.totalDeducible).toBe(0);
    expect(r.ivaAcreditable).toBe(0);
  });

  it('control: el mismo comprobante DENTRO del ejercicio acredita sus $160', () => {
    const r = cuadre(conIva('2026-08-01'));
    expect(r.ivaAcreditable).toBe(160);
  });

  it('el peaje de otro ejercicio tampoco genera estímulo del 50%', () => {
    // El estímulo exige elegibilidad declarada (perfil) — se declara en ambos
    // casos para que la ÚNICA variable sea el ejercicio del comprobante.
    const caseta = (fecha: string) => cuadrarViaje({
      viajeId: 'v1', anticipo: 3000, elegiblePeaje: true,
      gastos: [g({ concepto: 'caseta', fecha, monto: 500, subTotal: 431.03, ivaTraslado: 68.97, xmlVerificado: true, formaPago: '04' } as Partial<Gasto>)],
      politica: DEMO_CONFIG.politica, estimulos: DEMO_CONFIG.estimulos,
      hidrocarburos: DEMO_CONFIG.hidrocarburos,
      empresaRfc: 'GMX0902279I1', hoy: '2026-08-01',
    });
    expect(caseta('2025-08-01').peajeAcreditable).toBe(0);
    expect(caseta('2026-08-01').peajeAcreditable).toBeGreaterThan(0);
  });
});
