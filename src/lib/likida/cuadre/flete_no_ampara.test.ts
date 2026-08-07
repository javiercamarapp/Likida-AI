import { describe, it, expect } from 'vitest';
import { cuadrarViaje } from './engine';
import { DEMO_CONFIG } from '../config';
import type { Gasto } from '@/types/likida';

// EL FALLO QUE ESTO FIJA — medido el 28-jul-2026 sobre nueve tickets de campo.
//
// LISR 28-V condiciona la deducción del viático de alimentos a que un
// comprobante de hospedaje o de TRANSPORTE lo ampare. Ahí "transporte" es el
// traslado DE LA PERSONA. Tres guías de Paquetexpress —traslado de una caja—
// entraban como concepto `transporte` y hacían desaparecer la advertencia sobre
// una comida de $1,050.
//
// Se comprobó por A/B con fotos reales: con solo el ticket de comida, la
// observación salía; al añadir las tres guías, dejaba de salir. El motor daba
// por amparado un viático que la ley no ampara, y sin decir nada.

const g = (over: Partial<Gasto>): Gasto => ({
  id: Math.random().toString(36).slice(2), concepto: 'otro', monto: 100, fecha: '2026-07-27', ...over,
});

const cuadrar = (gastos: Gasto[]) =>
  cuadrarViaje({
    viajeId: 'v', anticipo: 20_000, gastos,
    politica: DEMO_CONFIG.politica, estimulos: DEMO_CONFIG.estimulos,
  });

const sinSoporte = (gastos: Gasto[]) =>
  (cuadrar(gastos).diferencias ?? []).filter((d) => d.tipo === 'alimentacion_sin_soporte');

const comida = g({ concepto: 'alimentacion', monto: 1050, folio: '3095' });

describe('el flete no ampara un viático de alimentos', () => {
  it('una comida sola levanta la advertencia', () => {
    expect(sinSoporte([comida])).toHaveLength(1);
  });

  it('tres guías de paquetería NO la silencian', () => {
    const guias = [
      g({ concepto: 'flete', monto: 507.65, folio: 'MIDAB199347' }),
      g({ concepto: 'flete', monto: 1370.10, folio: 'MIDAB200143' }),
      g({ concepto: 'flete', monto: 400.44, folio: 'MIDAB198553' }),
    ];
    expect(sinSoporte([comida, ...guias])).toHaveLength(1);
  });

  it('el transporte de la PERSONA sí la ampara', () => {
    expect(sinSoporte([comida, g({ concepto: 'transporte', monto: 180 })])).toHaveLength(0);
  });

  it('y el hospedaje también', () => {
    expect(sinSoporte([comida, g({ concepto: 'hospedaje', monto: 900 })])).toHaveLength(0);
  });

  // El otro efecto de haberlos mezclado: un flete de $1,370 se trataba como
  // viático, sujeto a un tope de $800 que no le corresponde. Es costo de
  // operación, no gasto personal del operador.
  it('el flete no lleva el tope del viático', () => {
    const d = cuadrar([g({ concepto: 'flete', monto: 1370.10 })]).diferencias ?? [];
    expect(d.filter((x) => x.tipo === 'sobre_politica')).toHaveLength(0);
  });

  it('el transporte de la persona sí lo lleva', () => {
    const d = cuadrar([g({ concepto: 'transporte', monto: 1370.10 })]).diferencias ?? [];
    expect(d.filter((x) => x.tipo === 'sobre_politica')).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// UNA observación, no una por comida. 1-ago-2026.
//
// La causa es del VIAJE —no hay hospedaje ni transporte en toda la liquidación—,
// así que repetirla por comprobante decía tres veces lo mismo cambiando la
// cifra. En el PDF real eran tres renglones de seis; al envolverse para no
// cortar la cita legal pasaron a nueve, con media hoja ocupada por una frase
// idéntica.
// ═══════════════════════════════════════════════════════════════════════════
describe('la advertencia de LISR 28-V no se repite por comprobante', () => {
  const tres = [
    g({ concepto: 'alimentacion', monto: 154, folio: '689630' }),
    g({ concepto: 'alimentacion', monto: 192, folio: '106841' }),
    g({ concepto: 'alimentacion', monto: 45, folio: '05461' }),
  ];

  it('tres comidas sin soporte levantan UNA sola', () => {
    expect(sinSoporte(tres)).toHaveLength(1);
  });

  it('y trae el TOTAL en revisión, que antes el contralor tenía que sumar', () => {
    const [d] = sinSoporte(tres);
    expect(d.nota).toContain('$391.00');
    expect(d.nota).toContain('3 comprobantes');
    expect(d.nota, 'el fundamento no se pierde al colapsar').toContain('LISR 28-V');
  });

  it('sigue sin declarar dinero perdido: es para revisar, no un no deducible', () => {
    // Ponerle el total en la columna de importes lo declararía no deducible sin
    // ver la contabilidad de la flota, que es justo lo que el motor no puede
    // afirmar.
    expect(sinSoporte(tres)[0].monto).toBe(0);
  });

  it('con UNA comida el texto no cambia, y sigue apuntando a su comprobante', () => {
    const [d] = sinSoporte([comida]);
    expect(d.nota).toMatch(/^Alimentación de \$1,050\.00 sin comprobante/);
    expect(d.gastoId).toBe(comida.id);
  });

  it('con varias NO apunta a ninguno: señalar al primero mentiría sobre los otros', () => {
    expect(sinSoporte(tres)[0].gastoId).toBeUndefined();
  });
});
