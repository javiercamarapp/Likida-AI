// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 23 · FIS-1 (CRÍTICO) — LA REGRESIÓN DE FIS-C3: `'99'` NO ES UN
// MEDIO DE PAGO, ES «TODAVÍA NO SE PAGÓ».
//
// La 22 cerró un hueco real (la lista del primer párrafo de la LISR 27-III es
// CERRADA, y el motor la aplicaba solo a combustible) y al hacerlo metió
// `'99 Por definir'` en el mismo saco que `'06' Dinero electrónico`. No es lo
// mismo, y el propio `engine.ts` lo tiene escrito dos veces:
//
//   engine.ts:127-128  «'99 Por definir' = la contraprestación no se ha pagado
//                       (RMF 2.7.1.29 fr. II).»
//   engine.ts:148-152  «**'99' devuelve false.** No es un medio distinto: es que
//                       NO se pagó. Ese caso lo juzga la regla de pago efectivo,
//                       no esta…»
//
// `medioNoAdmitidoCombustible` respeta esa frontera (`:156`). La rama nueva de
// FIS-C3 (`:594-595`) no la replicó: juzgaba `g.formaPago` crudo.
//
// ── LO QUE COSTABA ────────────────────────────────────────────────────────
// `MetodoPago: 'PPD'` / `FormaPago: '99'` es la forma NORMAL de una compra a
// crédito en México. Desde FIS-C3, todo comprobante a crédito por encima de
// $2,000 salía del deducible, perdía su IVA, bajaba la liquidación a `revisar`
// e imprimía una frase falsa por partida doble: «se pagó con la forma «99»»
// —no se pagó— «que no está en la lista de la LISR 27-III» —cuando el REP
// prueba que se pagó por transferencia, que sí está en la lista—.
//
// Y mataba la FASE 7 (mig. 0199) entera: el complemento de pago se ingiere
// precisamente para recuperar ese IVA, y dejó de servir para todo comprobante
// que supere $2,000, que son todos los que importan.
//
// La suite de la 22 no lo vio por dos razones, las dos verificadas:
//   · `iva_rep_liberado.test.ts` usa $1,160 y $580 — los dos POR DEBAJO del
//     tope de $2,000, así que ninguno entra a la rama de FIS-C3.
//   · `medio_pago_lisr27.test.ts` afirmaba `'99' → medio_pago_no_admitido`
//     como comportamiento deseado, sin un solo caso con REP.
//
// ── LO QUE SE ARREGLA, Y LO QUE NO ────────────────────────────────────────
// El arreglo NO es «sacar el '99' de la rama»: eso dejaría pasar un CFDI a
// crédito que el REP dice haberse pagado con `'06' Dinero electrónico`, que es
// justo el hueco que FIS-C3 vino a cerrar. Se juzga la forma EFECTIVA, la misma
// idea que `formaPagoEfectiva` (`engine.ts:1397`) ya aplica al IVA, al peaje
// electrónico y al IEPS del diésel:
//
//   · '99' sin REP  → no se ha pagado: esta regla no opina (la juzga la regla
//                     de pago efectivo, como dice :150).
//   · '99' con REP  → se juzga `pagadoForma`, el medio con el que DE VERDAD se
//                     pagó, no el '99' del comprobante.
//   · '99' con REP sin `FormaDePagoP` legible → desconocido no es «medio
//                     distinto» (mismo criterio que :592-593 y que `causasDe`).
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { cuadrarViaje, cubetaDe, type PoliticaGasto } from './engine';
import type { Gasto } from '@/types/likida';

const politica: PoliticaGasto[] = [{ concepto: 'hospedaje', topeMonto: 100_000 }];
const EST = { peajeFactor: 0.5, viaticosTopeFiscalDiarioMxn: 750, efectivoTopeMxn: 2000, clavesDieselIeps: [] };

/** $58,000 = SubTotal $50,000 + IVA $8,000. Muy por encima del tope de $2,000. */
const gasto = (extra: Partial<Gasto>): Gasto => ({
  id: 'g1', concepto: 'hospedaje', monto: 58_000, folio: 'A1', fecha: '2026-05-01',
  ocrConfianza: 0.95, cfdiUuid: 'u-g1', xmlVerificado: true, rfcReceptor: 'REC010101AA1',
  formaPago: '99', ivaTraslado: 8_000, subTotal: 50_000,
  ...extra,
});

const cuadra = (extra: Partial<Gasto>) =>
  cuadrarViaje({ viajeId: 'v1', anticipo: 58_000, politica, estimulos: EST, gastos: [gasto(extra)] });

describe('FIS-1: una compra a crédito (FormaPago 99) no es «un medio que la LISR 27-III no admite»', () => {
  it('99 + REP que dice transferencia: deducible completo, con su IVA, sin diferencia de medio de pago', () => {
    // Éste es el caso que la regresión rompía: hospedaje subcontratado de
    // $58,000 a crédito, con su complemento de pago ya ingerido diciendo que se
    // liquidó por transferencia. Antes del arreglo salía $0 deducible, $0 de
    // IVA y estatus `revisar`.
    const r = cuadra({ pagadoEn: '2026-08-03', pagadoForma: '03' });

    const d = r.diferencias.find((x) => x.tipo === 'medio_pago_no_admitido');
    expect(
      d,
      `se levantó «medio_pago_no_admitido» sobre un CFDI que el REP dice pagado por transferencia. ` +
      `La nota impresa sería: ${d?.nota}`,
    ).toBeUndefined();

    expect(r.totalDeducible).toBe(58_000);
    expect(r.totalPorConfirmar).toBe(0);
    expect(r.ivaAcreditable).toBe(8_000);
  });

  it('99 SIN REP: esta regla no opina — no se ha pagado, lo juzga la regla de pago efectivo', () => {
    // `engine.ts:148-152`, textual: «'99' devuelve false. No es un medio
    // distinto: es que NO se pagó. Ese caso lo juzga la regla de pago efectivo,
    // no esta». Sin REP el IVA sigue sin acreditarse (`:1398`), que es correcto
    // y no es asunto de esta regla.
    const r = cuadra({});

    const d = r.diferencias.find((x) => x.tipo === 'medio_pago_no_admitido');
    expect(
      d,
      `«medio_pago_no_admitido» sobre un CFDI que todavía NO se ha pagado. La nota diría ` +
      `«se pagó con la forma «99»», que es falsa: la forma 99 significa que no se pagó. ` +
      `Nota impresa: ${d?.nota}`,
    ).toBeUndefined();

    // El IVA sigue cerrado sin el REP — el arreglo NO abre esa puerta.
    expect(r.ivaAcreditable).toBe(0);
  });

  it('99 + REP que dice «06 Dinero electrónico»: el hueco que FIS-C3 cerró SIGUE cerrado', () => {
    // La otra mitad del arreglo, y la razón por la que no basta con sacar el
    // '99' de la rama: si el REP dice que de verdad se pagó con un medio que la
    // lista no admite, la diferencia tiene que levantarse igual.
    const r = cuadra({ pagadoEn: '2026-08-03', pagadoForma: '06' });

    const d = r.diferencias.find((x) => x.tipo === 'medio_pago_no_admitido');
    expect(d, 'un REP que dice «06» tiene que levantar la diferencia igual que un CFDI «06» directo').toBeDefined();
    expect(d!.nota).toContain('«06»');
    expect(cubetaDe(gasto({ pagadoEn: '2026-08-03', pagadoForma: '06' }), r.diferencias.filter((x) => x.gastoId === 'g1')))
      .toBe('por_confirmar');
    expect(r.totalDeducible).toBe(0);
    expect(r.ivaAcreditable).toBe(0);
  });

  it('99 + REP sin FormaDePagoP legible: desconocido no es «medio distinto»', () => {
    // Mismo criterio que `:592-593` («Sin formaPago NO entra: desconocido no es
    // medio distinto») y que `:1394` («si el REP no trajo FormaDePagoP legible,
    // esas puertas siguen cerradas»). Suponerlo inflaría el no-deducible contra
    // la flota.
    const r = cuadra({ pagadoEn: '2026-08-03' });
    expect(r.diferencias.some((x) => x.tipo === 'medio_pago_no_admitido')).toBe(false);
  });
});
