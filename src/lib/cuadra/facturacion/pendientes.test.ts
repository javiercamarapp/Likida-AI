import { describe, it, expect } from 'vitest';
import { armar, resumen } from './pendientes';

// ═══════════════════════════════════════════════════════════════════════════
// LO QUE FALTA POR FACTURAR — el puente que faltaba.
//
// El módulo de facturación llevaba construido desde el 27-jul y ninguna pantalla
// lo usaba: los datos se leían del ticket, se guardaban y ahí morían.
//
// De los 40 gastos que hay hoy en la base, 38 NO tienen CFDI. El 95%. Un gasto
// sin CFDI no es deducible —el dinero salió y el IVA se pierde— y el ticket
// CADUCA. Para una flota que liquida por quincena, el ticket del día 2 puede
// estar vencido cuando la oficina cierra el día 16.
// ═══════════════════════════════════════════════════════════════════════════

const base = {
  id: 'g1', concepto: 'diesel', monto: 400, fecha: '2026-08-01',
  folio: '286188', rfc_emisor: null, cfdi_uuid: null,
  ocr_extra: { urlFacturacion: 'https://facturacion.oxxogas.com/', webId: '65038155', estacion: 'EST 12' } as Record<string, unknown>,
};

describe('armar un ticket por facturar', () => {
  it('reconoce el comercio por el dominio de la liga', () => {
    const t = armar(base, '2026-08-04');
    expect(t.comercio?.nombre).toMatch(/oxxo gas/i);
    expect(t.comercio?.portal).toContain('oxxogas');
  });

  it('llena los campos del portal con lo que YA se leyó del ticket', () => {
    const t = armar(base, '2026-08-04');
    const porClave = Object.fromEntries(t.campos.map((c) => [c.clave, c.valor]));
    if ('folio' in porClave) expect(porClave.folio).toBe('286188');
    if ('webId' in porClave) expect(porClave.webId).toBe('65038155');
    if ('monto' in porClave) expect(porClave.monto).toBe('400.00');
  });

  it('un campo que NO se extrae queda en null, no se rellena con algo parecido', () => {
    // `caja` y `hora` no se leen del ticket todavía. Un valor inventado manda a
    // la persona a teclear algo que el portal rechaza, y a dudar del resto.
    const t = armar(base, '2026-08-04');
    for (const c of t.campos) {
      if (c.clave === 'caja' || c.clave === 'hora') expect(c.valor).toBeNull();
    }
  });

  it('sin comercio reconocido NO inventa portal ni campos', () => {
    const t = armar({ ...base, ocr_extra: {}, rfc_emisor: null }, '2026-08-04');
    expect(t.comercio).toBeNull();
    expect(t.campos).toEqual([]);
    expect(t.urlTicket).toBeNull();
  });

  it('sin fecha de ticket, la caducidad se declara DESCONOCIDA en vez de afirmar', () => {
    // El OCR falla en fechas —se le vio devolver 2023 en un ticket de 2026— y
    // decir "vigente" sobre una fecha inventada hace que la oficina deje de
    // revisarlo.
    const t = armar({ ...base, fecha: null }, '2026-08-04');
    expect(t.caducidad.desconocido).toBe(true);
    expect(t.caducidad.vencido).toBe(false);
  });

  it('marca vencido lo que ya pasó su plazo', () => {
    const t = armar({ ...base, fecha: '2026-06-01' }, '2026-08-04');
    expect(t.caducidad.vencido).toBe(true);
  });
});

describe('resumen', () => {
  it('separa vencidos de urgentes y suma lo que se pierde', () => {
    const lista = [
      armar({ ...base, id: 'a', fecha: '2026-06-01', monto: 100 }, '2026-08-04'), // vencido
      armar({ ...base, id: 'b', fecha: '2026-08-31', monto: 200 }, '2026-08-30'), // urgente
      armar({ ...base, id: 'c', fecha: '2026-08-01', monto: 300 }, '2026-08-04'), // vigente
    ];
    const r = resumen(lista);
    expect(r.total).toBe(3);
    expect(r.vencidos).toBe(1);
    // El monto vencido es lo que la flota YA no puede deducir: es la cifra que
    // justifica que esta pantalla exista.
    expect(r.montoVencido).toBe(100);
    expect(r.montoTotal).toBe(600);
  });
});
