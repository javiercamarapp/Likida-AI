import { describe, it, expect } from 'vitest';
import { cuadrarViaje } from './engine';
import { DEMO_CONFIG } from '../config';
import type { Gasto } from '@/types/cuadra';

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
