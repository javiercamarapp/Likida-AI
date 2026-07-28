import { describe, it, expect } from 'vitest';
import { tieneCifrasDeDinero, cifrasSinRespaldo } from './cifras';

describe('tieneCifrasDeDinero', () => {
  it('marca las formas de dinero que sí escribe el agente', () => {
    for (const t of ['$500', '$ 6,850', '10,600', '5700.00', '500 pesos', 'sobró 500', '1500 a favor'])
      expect(tieneCifrasDeDinero(t), t).toBe(true);
  });
  it('no marca enteros sueltos sin contexto de dinero', () => {
    for (const t of ['son 3 comprobantes', 'folio 1042', 'en 2026'])
      expect(tieneCifrasDeDinero(t), t).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// LA PUERTA TRASERA DE `consultar_politica`.
//
// La guardia dejaba pasar CUALQUIER cifra en cuanto el modelo hubiera llamado
// consultar_politica, razonando que entonces las cifras eran topes de política.
// Pero la tool no ata al texto: el modelo puede consultar la política (una tool
// barata) y luego narrar "comprobaste $8,340 y sobró $500" — cifras que nadie
// calculó. Llamar una tool irrelevante desbloqueaba narrar dinero inventado,
// que es exactamente lo que la regla fundacional prohíbe.
//
// Grounded tiene que significar que la cifra ESTÁ en lo que devolvió la tool,
// no que hubo una tool.
// ═══════════════════════════════════════════════════════════════════════════
describe('cifrasSinRespaldo', () => {
  const politica = [{ topeAlimentacionDia: 750, topeEfectivo: 2000 }];

  it('una cifra que sí devolvió la tool está respaldada', () => {
    expect(cifrasSinRespaldo('El tope de alimentación es de $750 por día.', politica)).toEqual([]);
  });

  it('acepta el formato del modelo aunque la tool devuelva el número pelón', () => {
    // La tool devuelve 2000; el modelo escribe "$2,000.00". Es la misma cifra.
    expect(cifrasSinRespaldo('Puedes pagar hasta $2,000.00 en efectivo.', politica)).toEqual([]);
  });

  it('DELATA la cifra que ninguna tool devolvió', () => {
    const fuera = cifrasSinRespaldo('El tope es $750, y tu viaje comprobó $8,340.', politica);
    expect(fuera).toEqual([8340]);
  });

  it('un total derivado por el modelo tampoco está respaldado', () => {
    // 8840 - 8340 = 500. Aritmética del modelo, no del motor. El motor es quien
    // calcula diferencias; si el número no salió de él, no se manda.
    expect(cifrasSinRespaldo('Sobró $500 del anticipo.', [{ comprobado: 8340, anticipo: 8840 }])).toEqual([500]);
  });

  it('busca dentro de estructuras anidadas, no solo en el primer nivel', () => {
    expect(cifrasSinRespaldo('El tope es $750.', [{ politica: { topes: [{ monto: 750 }] } }])).toEqual([]);
  });

  it('acepta números que la tool devolvió como texto', () => {
    expect(cifrasSinRespaldo('Son $750.', [{ tope: '750.00' }])).toEqual([]);
  });

  it('sin resultados de tool, toda cifra queda sin respaldo', () => {
    expect(cifrasSinRespaldo('Comprobaste $8,340.', [])).toEqual([8340]);
  });

  it('un texto sin cifras no reporta nada', () => {
    expect(cifrasSinRespaldo('Mándame la foto del ticket, porfa.', politica)).toEqual([]);
  });

  it('tolera el centavo entre lo que calculó la tool y lo que escribió el modelo', () => {
    expect(cifrasSinRespaldo('Son $1,234.57.', [{ total: 1234.567 }])).toEqual([]);
  });
});
