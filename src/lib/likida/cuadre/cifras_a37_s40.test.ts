import { describe, it, expect } from 'vitest';
import { tieneCifrasDeDinero, cifrasSinRespaldo } from './cifras';

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

// A37-S40-10: el respaldo de cifras no acepta ids, fechas, litros ni conteos
// como sustento de un monto.

describe('A37-S40-10 — el respaldo cuenta campos monetarios, no cualquier número', () => {
  const estado = {
    origen: 'A', destino: 'B', anticipo: 6000, comprobado: 4500, comprobantes: 3, copias_excluidas: 0,
    por_concepto: [{ concepto: 'diesel', total: 4500, n: 1 }],
    litros_diesel_leidos: 120,
    gastos: [{ id: 'gasto-777', monto: 1500, fecha: '2026-10-20', litros: 120, ocr_confianza: 95 }],
  };

  it('los litros no respaldan un saldo («te sobran 120»)', () => {
    expect(cifrasSinRespaldo('Te sobran $120 del anticipo.', [estado])).toEqual([120]);
  });

  it('las fechas, ids y conteos no respaldan un monto', () => {
    expect(cifrasSinRespaldo('Te sobran $2026 del anticipo.', [estado])).toEqual([2026]);
    expect(cifrasSinRespaldo('Te sobran $777 del anticipo.', [estado])).toEqual([777]);
    expect(cifrasSinRespaldo('Te sobran $95 del anticipo.', [estado])).toEqual([95]);
  });

  it('los campos monetarios (anticipo, comprobado, total, monto) siguen respaldando', () => {
    expect(cifrasSinRespaldo('Llevas $4,500 comprobados de $6,000.', [estado])).toEqual([]);
    expect(cifrasSinRespaldo('El diésel suma $4,500.', [estado])).toEqual([]);
    expect(cifrasSinRespaldo('Un gasto fue de $1,500.', [estado])).toEqual([]);
  });

  it('un UUID o una fecha dentro de un texto no aportan cifras', () => {
    expect(cifrasSinRespaldo('Son $2020 pesos.', [{ nota: 'creado 2026-10-20 ref 123e4567-e89b-12d3-a456-426614174000' }])).toEqual([2020]);
  });
});
