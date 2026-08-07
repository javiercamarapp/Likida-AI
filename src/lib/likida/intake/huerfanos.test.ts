import { describe, it, expect } from 'vitest';
import {
  mensajeGuardadoSinViaje, mensajeGuardadoTrasLiquidar, mensajeOfrecer,
  mensajeAdjuntados, esAfirmacion, esNegacion,
} from './huerfanos';

// ═══════════════════════════════════════════════════════════════════════════
// UNA FOTO NUNCA SE RECHAZA. 1-ago-2026.
//
// No todos los choferes escriben «hola» ni esperan a que la oficina les abra el
// viaje: terminan la ruta, sacan el fajo y mandan once fotos de golpe. Hasta hoy
// ese operador perdía once comprobantes y no se enteraba — se le contestaba «No
// tienes un viaje abierto», que es cierto y no es lo que pasó. Lo que pasó es
// que se tiraron sus tickets.
//
// Y no se adjuntan solos: un ticket del viaje anterior metido en el de hoy es
// dinero en la liquidación equivocada, y nadie lo nota hasta que el contralor
// paga.
// ═══════════════════════════════════════════════════════════════════════════

const TRES = [
  { monto: 2890, etiqueta: 'Diésel' },
  { monto: 980, etiqueta: 'Caseta' },
  { monto: 450, etiqueta: 'Alimentación' },
];

describe('el ofrecimiento enseña qué hay antes de preguntar', () => {
  it('lista cada comprobante y el total, para que pueda decir que no', () => {
    const m = mensajeOfrecer(TRES, 'Silao→N. Laredo');
    expect(m).toContain('Diésel');
    expect(m).toContain('$2,890.00');
    expect(m).toContain('$4,320.00');
    expect(m).toContain('3 comprobantes');
    expect(m).toContain('Silao→N. Laredo');
    expect(m).toMatch(/¿Los agrego a este viaje\?/);
  });

  it('sin ruta no inventa una', () => {
    expect(mensajeOfrecer(TRES)).not.toContain('(');
  });

  it('uno solo no se anuncia en plural', () => {
    expect(mensajeOfrecer([TRES[0]])).toContain('Tengo 1 comprobante tuyo');
  });

  it('con muchos no vomita la lista entera', () => {
    const veinte = Array.from({ length: 20 }, (_, i) => ({ monto: 100, etiqueta: `Gasto ${i}` }));
    const m = mensajeOfrecer(veinte);
    expect(m).toContain('y 8 más');
    expect(m).toContain('$2,000.00');
  });
});

describe('los acuses dicen la verdad de lo que pasó', () => {
  it('sin viaje: dice que NO se pierden, que es lo que el operador necesita saber', () => {
    expect(mensajeGuardadoSinViaje(1)).toMatch(/no se pierden/i);
    expect(mensajeGuardadoSinViaje(1)).toMatch(/te pregunto si van/i);
  });

  it('tras liquidar: dice el monto, que no entró, y que se guardó', () => {
    const m = mensajeGuardadoTrasLiquidar(800);
    expect(m).toContain('$800.00');
    expect(m).toMatch(/no entró en ella/i);
    expect(m).toMatch(/no se perdió/i);
    // Lo que NO puede volver: mandarlo a un trámite que no existe.
    expect(m, 'la oficina no tiene forma de agregar a un viaje cerrado').not.toMatch(/pídele a la oficina/i);
  });

  it('al adjuntar dice cuántos y cuánto, y qué sigue', () => {
    const m = mensajeAdjuntados(TRES);
    expect(m).toContain('$4,320.00');
    expect(m).toContain('3 comprobantes');
    expect(m).toMatch(/escribe \*listo\*/);
  });

  it('EL FALLO: ya no suelta un total que se cae a la mitad tres mensajes después', () => {
    // Medido el 1-ago: el acuse dijo «$28,041.15» y la liquidación dijo
    // «$12,388.05 comprobado», porque seis venían repetidos. El acuse era
    // exacto y aun así el operador entiende que le recortaron.
    const m = mensajeAdjuntados(TRES, { copias: 2, comprobado: 3000 });
    expect(m).toContain('$4,320.00');      // lo que entregó en papel
    expect(m).toContain('2 repetidos');
    expect(m).toContain('$3,000.00');      // lo que de verdad cuenta
  });

  it('sin repetidos no inventa una advertencia', () => {
    const m = mensajeAdjuntados(TRES, { copias: 0, comprobado: 4320 });
    expect(m).not.toMatch(/repetid/i);
    expect(m).toContain('$4,320.00');
  });

  it('si no se pudo calcular el neto, NO promete un total del viaje', () => {
    // Callar es mejor que arriesgar una cifra que después contradice al PDF.
    const m = mensajeAdjuntados(TRES);
    expect(m).not.toMatch(/llevas/i);
  });

  it('ya no dice «los demás», que sonaba a que quedó algo pendiente', () => {
    // No faltaba ninguno: se acababa de vaciar la sala de espera.
    expect(mensajeAdjuntados(TRES)).not.toMatch(/los demás/i);
  });
});

describe('entender el sí y el no — aquí es donde se mueve el dinero', () => {
  it.each(['sí', 'si', 'Si', 'sale', 'va', 'dale', 'ok', 'correcto', 'adelante', 'agrégalos', 'sí porfa'])(
    '«%s» es un sí', (t) => expect(esAfirmacion(t)).toBe(true));

  it.each(['no', 'No', 'nel', 'ninguno', 'todavía no'])(
    '«%s» es un no', (t) => expect(esNegacion(t)).toBe(true));

  it('«listo» NO es un sí, aunque llegue justo después de la pregunta', () => {
    // Quiere decir «cierra mi viaje». Confundirlos cerraría la liquidación con
    // comprobantes que el operador nunca aceptó.
    expect(esAfirmacion('listo')).toBe(false);
    expect(esNegacion('listo')).toBe(false);
  });

  it('«no, el de diésel no» no se toma como un no rotundo', () => {
    // Es una respuesta PARCIAL que este flujo no sabe resolver. Tratarla como un
    // no descartaría los otros dos sin que el operador lo pidiera.
    expect(esNegacion('no, el de diesel no va')).toBe(false);
    expect(esAfirmacion('no, el de diesel no va')).toBe(false);
  });

  it('una frase larga no se interpreta: ante la duda no se adjunta', () => {
    // Los dos errores no cuestan lo mismo. Un falso positivo mete el ticket de
    // otro viaje en éste; un falso negativo solo repite la pregunta.
    expect(esAfirmacion('si te digo que ayer cargué diesel en la estación de Silao')).toBe(false);
  });

  it('vacío no es nada', () => {
    expect(esAfirmacion('')).toBe(false);
    expect(esNegacion('   ')).toBe(false);
  });
});
