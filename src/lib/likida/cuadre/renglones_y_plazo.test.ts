import { describe, it, expect } from 'vitest';
import { calcularCaducidad } from '../facturacion/caducidad';

// ═══════════════════════════════════════════════════════════════════════════
// LOS DOS BUGS QUE ENCONTRÓ LA AUDITORÍA DE CINCO TICKETS REALES (24-ago-2026).
//
// No son hipótesis: son las dos fotos que el chofer mandó esa mañana y lo que
// el sistema le contestó. Los números de aquí salen de esos papeles.
// ═══════════════════════════════════════════════════════════════════════════

describe('el plazo IMPRESO en el ticket manda sobre la suposición del catálogo', () => {
  it('24 hrs de la ferretería: vence al día siguiente, no a fin de mes', () => {
    // Ticket real: VILMA GUADALUPE POOL RUIZ, 19/08/2026, "plazo máximo de
    // 24 hrs para facturar este ticket". El motor decía "hasta el 2026-08-31
    // (7 días)" porque aplicaba `mes_natural`.
    const c = calcularCaducidad({ fechaTicket: '2026-08-19', plazo: { horas: 24 }, hoy: '2026-08-24' });
    expect(c.fechaLimite).toBe('2026-08-20');
    expect(c.vencido).toBe(true);

    // Lo que decía ANTES, para que se vea el tamaño del error:
    const antes = calcularCaducidad({ fechaTicket: '2026-08-19', plazo: 'mes_natural', hoy: '2026-08-24' });
    expect(antes.fechaLimite).toBe('2026-08-31');
    expect(antes.vencido).toBe(false);
  });

  it('72 horas de Boston\'s: tres días, no doce', () => {
    // Ticket real: GRUPO BOSPATEX, 16/08/2026, "usted tiene solo 72 horas".
    const c = calcularCaducidad({ fechaTicket: '2026-08-16', plazo: { horas: 72 }, hoy: '2026-08-24' });
    expect(c.fechaLimite).toBe('2026-08-19');
    expect(c.vencido).toBe(true);
  });

  it('las horas se truncan hacia ABAJO — la dirección conservadora', () => {
    // Sin la hora de compra no se sabe el instante exacto. Decir que queda
    // menos tiempo hace correr a la oficina; decir que queda más le cuesta el
    // CFDI. 36 h desde el día 10 vence el 11, no el 12.
    // 36 h → un día completo (no dos): el medio día extra no se promete.
    expect(calcularCaducidad({ fechaTicket: '2026-08-10', plazo: { horas: 36 }, hoy: '2026-08-10' }).fechaLimite).toBe('2026-08-11');
    // 12 h → el mismo día; con `ceil` habría prometido una tarde inexistente.
    expect(calcularCaducidad({ fechaTicket: '2026-08-10', plazo: { horas: 12 }, hoy: '2026-08-10' }).fechaLimite).toBe('2026-08-10');
  });

  it('sigue respetando los plazos de mes que ya existían', () => {
    expect(calcularCaducidad({ fechaTicket: '2026-08-19', plazo: 'mes_natural', hoy: '2026-08-20' }).fechaLimite).toBe('2026-08-31');
    expect(calcularCaducidad({ fechaTicket: '2026-07-25', plazo: 'mes_siguiente', hoy: '2026-08-01' }).fechaLimite).toBe('2026-08-31');
    expect(calcularCaducidad({ fechaTicket: '2026-08-19', plazo: { dias: 7 }, hoy: '2026-08-20' }).fechaLimite).toBe('2026-08-26');
  });

  it('sin fecha de ticket no se afirma nada, con horas tampoco', () => {
    const c = calcularCaducidad({ fechaTicket: undefined, plazo: { horas: 24 }, hoy: '2026-08-24' });
    expect(c.desconocido).toBe(true);
  });
});
