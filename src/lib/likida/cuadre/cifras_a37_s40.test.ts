import { describe, it, expect } from 'vitest';
import { tieneCifrasDeDinero } from './cifras';

// A37-S40-01 (ALTO): la compuerta de la guardia de cifras dejaba pasar «veinte»
// suelto y cualquier número en una cláusula que trajera comprobantes/ticket/días/
// litros, aunque la palabra no estuviera pegada al número.
describe('A37-S40-01 — la palabra inocente solo apaga el número que tiene PEGADO', () => {
  it('marca un saldo derivado aunque la cláusula mencione comprobantes, días o litros', () => {
    for (const t of [
      'Con tus 6 comprobantes te sobran 3200 del anticipo.',
      'En 3 días te sobran 3200 del anticipo',
      'Tras 40 litros de diésel te faltan 1500 de anticipo',
      'Con el ticket te quedan 2000 por comprobar',
      'te sobran veinte del anticipo',
      'Te sobran veinte pesos',
    ]) expect(tieneCifrasDeDinero(t), t).toBe(true);
  });

  it('sigue sin marcar lo que de verdad no es dinero', () => {
    for (const t of [
      'Ya recibí tus 30 comprobantes',
      'Van 40 fotos y 15 días de plazo',
      'Cargaste 320 litros',
      'Tienes 15 días para el folio 1042',
      'Según el artículo 27 de la LISR',
      'Recorriste 450 km',
      'El 16 por ciento de IVA',
      'Ya van veinte fotos, ¿te falta alguna?',
      'Pasaron veinte días',
    ]) expect(tieneCifrasDeDinero(t), t).toBe(false);
  });
});
