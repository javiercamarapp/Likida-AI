// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 5 · ALTO — el requisito de MEDIO DE PAGO del estímulo de diésel no
// tenía prueba.
//
// MUTACIÓN M6 (`engine.ts:583`):
//
//     - const pagoElectronico = !!g.formaPago && g.formaPago !== '01';
//     + const pagoElectronico = true;
//
// **628 verdes.** Con esa mutación, el diésel pagado EN EFECTIVO entra a
// `litrosDieselAcreditables`.
//
// El requisito es del 4º párrafo de la LIF 2026 art. 20, ap. A, fr. IV: el pago
// tiene que ser con monedero electrónico autorizado, tarjeta, cheque nominativo o
// transferencia. Y —como el propio comentario del motor explica— NO tiene la
// válvula del 15% que la RFA 2026 regla 2.9 sí concede para ISR: la facilidad
// salva la DEDUCCIÓN, no el ACREDITAMIENTO. Son dos beneficios distintos y el
// efectivo solo conserva uno.
//
// Los litros elegibles son el dato que el PDF y el mensaje de WhatsApp le
// entregan al contador para multiplicar por la cuota semanal del DOF. Inflar ese
// número es reclamar un estímulo sin derecho, y el papel se lo dio Likida.
//
// El auditor lo midió con el motor real: 200 L de diésel en efectivo dan 0 L
// acreditables (correcto), y con `formaPago: '03'` dan 200. Ninguna prueba de la
// suite afirmaba `litrosDieselAcreditables` como SALIDA del motor: aparecía solo
// como campo de fixtures en `pdf.test.ts`, `resumen.test.ts`, `guardia.test.ts` y
// `repo_escritura.test.ts`.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { cuadrarViaje, type PoliticaGasto } from './engine';
import type { Gasto } from '@/types/likida';

const politica: PoliticaGasto[] = [{ concepto: 'diesel', topeMonto: 10000 }];
const HC = { claves: ['15101505', '15101514'], unidad: 'LTR', vigenteDesde: '2026-04-24' };
const EST = { peajeFactor: 0.5, viaticosTopeFiscalDiarioMxn: 750, efectivoTopeMxn: 2000, clavesDieselIeps: ['15101505'] };

/** Diésel de 200 litros con CFDI verificado y complemento. Solo cambia el pago. */
const diesel = (formaPago: string | undefined, extra: Partial<Gasto> = {}): Gasto => ({
  id: 'g1', concepto: 'diesel', monto: 5000, folio: 'D1', fecha: '2026-05-01',
  ocrConfianza: 0.95, cfdiUuid: 'u1', xmlVerificado: true,
  // AUDITORÍA 8: CFDI ya verificado — receptor presente a propósito.
  rfcReceptor: 'REC010101AA1',
  claveProdServ: '15101505', claveUnidad: 'LTR', tipoComprobante: 'I',
  complementoHidrocarburos: true, iepsTraslado: 900, ivaTraslado: 640,
  ocrExtra: { litros: 200 },
  ...(formaPago ? { formaPago } : {}),
  ...extra,
});

const litros = (g: Gasto) =>
  cuadrarViaje({ viajeId: 'v1', anticipo: 5000, politica, hidrocarburos: HC, estimulos: EST, gastos: [g] })
    .litrosDieselAcreditables;

// SON DOS CAPAS Y HAY QUE PROBAR LAS DOS.
//
// El efectivo EXPLÍCITO (`formaPago: '01'`) también lo ataja `SIN_ACREDITAMIENTO`
// unas líneas antes (`engine.ts:552`), porque el motor ya emitió la diferencia
// `combustible_efectivo`. La línea que M6 rompe es la SEGUNDA capa, y su caso
// propio es el gasto SIN forma de pago conocida: ahí no hay diferencia que
// atajarlo y `pagoElectronico` es lo único que queda. Verificado corriendo la
// mutación: con `pagoElectronico = true` falla la prueba del `undefined`, no la
// del `'01'`.
describe('estímulo de diésel — el medio de pago es requisito (LIF 2026 20-A, ap. IV)', () => {
  it('diésel EN EFECTIVO (formaPago 01) → 0 litros acreditables', () => {
    expect(litros(diesel('01'))).toBe(0);
  });

  // MUTACIÓN M6: `const pagoElectronico = true`. Este es el caso que la mata. Sin
  // forma de pago no se supone que fue electrónico — con la mutación devuelve
  // 200 L, el contador los multiplica por la cuota del DOF y la flota reclama un
  // estímulo que la ley no le concede, con el papel que le dio Likida.
  it('SIN forma de pago conocida tampoco: no se supone que fue electrónico (M6)', () => {
    expect(litros(diesel(undefined))).toBe(0);
  });

  // CONTROL. Sin esto, "arreglar" M6 poniendo `pagoElectronico = false` dejaría
  // las dos de arriba verdes y a la flota sin el beneficio que Likida vende.
  it('por transferencia (03) SÍ: los 200 litros son elegibles', () => {
    expect(litros(diesel('03'))).toBe(200);
  });

  it('los otros medios que la ley admite también cuentan', () => {
    expect(litros(diesel('04'))).toBe(200);   // tarjeta de crédito
    expect(litros(diesel('28'))).toBe(200);   // tarjeta de débito
    expect(litros(diesel('05'))).toBe(200);   // monedero electrónico
    expect(litros(diesel('02'))).toBe(200);   // cheque nominativo
  });

  // La facilidad del 15% del ejercicio (RFA 2026 regla 2.9) salva la DEDUCCIÓN de
  // ISR del combustible en efectivo. No habilita el acreditamiento: son dos
  // beneficios distintos y el motor tiene que distinguirlos.
  it('el efectivo entra a la cubeta "por confirmar" para ISR y aun así NO acredita', () => {
    const r = cuadrarViaje({
      viajeId: 'v2', anticipo: 5000, politica, hidrocarburos: HC, estimulos: EST,
      gastos: [diesel('01')],
    });
    expect(r.diferencias.some((d) => d.tipo === 'combustible_efectivo')).toBe(true);
    expect(r.totalPorConfirmar).toBe(5000);   // la RFA 2.9 lo salva para ISR
    expect(r.litrosDieselAcreditables).toBe(0); // pero no para el estímulo
    expect(r.ivaAcreditable).toBe(0);
  });

  // Las otras dos condiciones del mismo renglón, para que "0 litros" no se pueda
  // conseguir por accidente desde otra rama.
  it('la GASOLINA no acredita litros aunque se pague por transferencia', () => {
    // Solo diésel (clave 15101505). LIF 20-A fr. IV.
    expect(litros(diesel('03', { claveProdServ: '15101514' }))).toBe(0);
  });

  it('sin XML verificado no acredita: un ticket no es una factura', () => {
    expect(litros(diesel('03', { xmlVerificado: false }))).toBe(0);
  });

  it('sin litros leídos del ticket no se inventan', () => {
    expect(litros(diesel('03', { ocrExtra: {} }))).toBe(0);
  });
});
