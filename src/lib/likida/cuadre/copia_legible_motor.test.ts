import { describe, it, expect } from 'vitest';
import { copiasDeComprobante } from './engine';
import type { Gasto } from '@/types/likida';

// ═══════════════════════════════════════════════════════════════════════════
// FIS/DAT/ARQ-32C12-C1 (auditoría 32 c12, CRÍTICO) — EL EJE DEL SOBREVIVIENTE.
//
// TRES auditores independientes (fiscal desde la norma, modelo de datos desde
// el esquema, arquitectura desde el censo de sedes) llegaron al mismo sitio:
// el dedup ya coincide en CUÁNTAS filas sobreviven —la 0365/0366/0367 cerraron
// el eje de la MEMBRESÍA— y sigue divergiendo en CUÁL.
//
//   · `0365:165,172,188` ordena `sin_forma_pago_util, created_at, id`
//     → sobrevive la copia LEGIBLE (la que permite derivar el numerador).
//   · `0367:206,209,221` ordena `created_at, id` y esta función se queda con
//     la PRIMERA del arreglo → sobrevive la copia ILEGIBLE.
//
// Y la ilegible es SIEMPRE la de `created_at` menor, porque el producto guarda
// la foto ANTES de pedir la refoto (`processor.ts:3163` + `acuse_ticket.ts:202`
// lo dicen literal, y la 0364 lo dejó medido).
//
// LA FILA QUE SOBREVIVE NO APORTA SÓLO EL MONTO: aporta `cfdi_uuid`,
// `iva_traslado`, `sub_total`, `forma_pago` y `clave_prod_serv`. Medido contra
// PostgreSQL 16.14 con las 344 migraciones sobre base virgen, con el par que el
// producto de verdad produce (borrosa primero, sin CFDI ni forma de pago;
// legible después, con UUID, forma de pago '01' e IVA $344.83):
//
//     sumar_combustible_ejercicio (0365) → efectivo 2500.00   (gana la legible)
//     gastos_fiscales_agregados_tenant   → muestraId = LA BORROSA,
//       (0367, el panel del contador)        iva 0, ivaEstado 'nulo',
//                                           tieneCfdi false, subTotal 0,
//                                           sobreTopeEfectivo true
//
// El contralor ve «IVA $0 · sin CFDI» de un ticket TIMBRADO con $344.83
// desglosados, y el mismo ticket acusado de ir sobre el tope de efectivo. Es
// textualmente lo que CLAUDE.md prohíbe: una cifra fiscal que se lee distinto
// en dos pantallas se lee como dos cálculos.
//
// LA DIRECCIÓN DEL ARREGLO es la que la 0364 ya declaró y no se reabre: las dos
// copias son fotos del MISMO pago, y que una no haya podido leerse no cambia
// cómo se pagó — sólo dice que trae menos información. Sobrevive la que más
// información trae; el orden de llegada queda de desempate.
//
// `Gasto` NO tiene `createdAt`, así que el espejo es del PRIMER criterio
// (`sin_forma_pago_util`), y el orden del arreglo queda como desempate residual
// en el lugar donde el SQL pone `created_at, id`.
// ═══════════════════════════════════════════════════════════════════════════

const base = (over: Partial<Gasto>): Gasto =>
  ({
    id: 'x', concepto: 'diesel', monto: 2500, folio: '7777', folioNorm: '7777',
    rfcEmisor: 'ESX050505EEE', fecha: '2026-05-10',
    ...over,
  }) as Gasto;

/** La borrosa: el OCR no leyó forma de pago ni timbre. Llega PRIMERO. */
const borrosa = base({ id: 'borrosa' });
/** La legible: trae UUID, forma de pago e IVA. Llega DESPUÉS. */
const legible = base({
  id: 'legible',
  cfdiUuid: '99955555-5555-4555-8555-555555555555',
  formaPago: '01',
  ivaTraslado: 344.83,
  subTotal: 2155.17,
});

describe('FIS/DAT/ARQ-32C12-C1 — entre dos copias sobrevive la LEGIBLE, no la primera', () => {
  it('la borrosa llega primero: sobrevive la LEGIBLE (espejo de 0365:165)', () => {
    const copias = copiasDeComprobante([borrosa, legible]);
    expect(
      copias.get('borrosa'),
      'la borrosa debe quedar marcada como copia de la legible; si sale undefined, sobrevivió la borrosa y el PDF imprime IVA $0 de un ticket timbrado',
    ).toBe('legible');
    expect(copias.get('legible'), 'la legible NO es copia de nadie').toBeUndefined();
    expect(copias.size).toBe(1);
  });

  it('la legible llega primero: sigue sobreviviendo la LEGIBLE (la dirección que ya acertaba)', () => {
    const copias = copiasDeComprobante([legible, borrosa]);
    expect(copias.get('borrosa')).toBe('legible');
    expect(copias.size).toBe(1);
  });

  it('CONTRAPESO — dos copias igual de legibles: manda el orden de llegada, como antes', () => {
    const a = base({ id: 'a', formaPago: '01' });
    const b = base({ id: 'b', formaPago: '01' });
    expect(copiasDeComprobante([a, b]).get('b')).toBe('a');
    expect(copiasDeComprobante([b, a]).get('a')).toBe('b');
  });

  it('CONTRAPESO — forma_pago 99 sin pagadoEn NO es útil (negación exacta del case de la 0364)', () => {
    const ppd = base({ id: 'ppd', formaPago: '99' });
    const util = base({ id: 'util', formaPago: '03' });
    expect(
      copiasDeComprobante([ppd, util]).get('ppd'),
      'un CFDI PPD trae 99 sin pagado_en por construcción: de él no se deriva el numerador',
    ).toBe('util');
  });

  it('CONTRAPESO — dos CFDI DISTINTOS con mismo folio/monto/emisor siguen contando DOS veces', () => {
    const uno = base({ id: 'uno', cfdiUuid: 'aaaaaaaa-1111-4111-8111-111111111111', formaPago: '01' });
    const dos = base({ id: 'dos', cfdiUuid: 'bbbbbbbb-2222-4222-8222-222222222222', formaPago: '01' });
    expect(copiasDeComprobante([uno, dos]).size, 'no son copias: son dos comprobantes').toBe(0);
  });
});
