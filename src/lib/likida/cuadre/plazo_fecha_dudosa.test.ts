import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { cuadrarViaje } from './engine';
import { DEMO_CONFIG } from '../config';
import type { Gasto } from '@/types/likida';

// ═══════════════════════════════════════════════════════════════════════════
// 1-ago-2026 · DUDAR DE UNA FECHA Y A LA VEZ ACTUAR SOBRE ELLA.
//
// Segundo ensayo con tickets reales. El OCR leyó un 8 como 6 en la fecha ISO de
// un ticket de farmacia y lo fechó en JUNIO siendo de agosto. El motor lo cazó:
//
//   [fecha_sospechosa] La fecha del comprobante … (2026-06-01) está fuera del
//   rango esperado del viaje — verifícala.
//
// Y en la línea siguiente, sobre ESA MISMA fecha:
//
//   [factura_por_vencer] … sigue sin factura: se pasó el plazo de facturación.
//   El comercio ya no suele facturarlo en su portal, pero legalmente puedes
//   exigirlo dentro del ejercicio (Conciliación de Factura del SAT).
//
// Falso. El ticket era de ESE día y el portal lo habría facturado sin discutir.
// El aviso mandaba a la oficina a pelear por Conciliación de Factura ante el SAT
// —un trámite— por algo que se resolvía entrando al portal.
//
// Dudar de un dato y a la vez actuar sobre él es PEOR que no dudar: el aviso
// lleva la autoridad de un cálculo y la fragilidad de una lectura.
// ═══════════════════════════════════════════════════════════════════════════

// El ticket real del ensayo: farmacia, $154, con su portal leído del papel.
// El `urlFacturacion` no es decorado — sin liga ni comercio reconocido el aviso
// de plazo no dispara, así que un fixture sin él no probaría nada.
const g = (over: Partial<Gasto> = {}): Gasto => ({
  id: 'g1', viajeId: 'v1', concepto: 'alimentacion', monto: 154,
  folio: '689630', ocrConfianza: 0.95,
  ocrExtra: { urlFacturacion: 'https://www.farmaciasguadalajara.com' },
  ...over,
} as Gasto);

const cuadre = (gasto: Gasto) => cuadrarViaje({
  viajeId: 'v1', anticipo: 3000, gastos: [gasto],
  politica: DEMO_CONFIG.politica, estimulos: DEMO_CONFIG.estimulos,
  hidrocarburos: DEMO_CONFIG.hidrocarburos,
  empresaRfc: 'GMX0902279I1', hoy: '2026-08-01',
  fechaMin: '2026-07-25', fechaMax: '2026-08-01',
});

const nota = (gasto: Gasto, tipo: string) =>
  (cuadre(gasto).diferencias ?? []).find((d) => d.tipo === tipo)?.nota ?? '';

describe('el plazo no se afirma sobre una fecha en duda', () => {
  it('con la fecha fuera de rango, NO dice que el plazo se venció', () => {
    const n = nota(g({ fecha: '2026-06-01' }), 'factura_por_vencer');
    expect(n, 'sin aviso de facturación no hay nada que comprobar').not.toBe('');
    expect(n, 'afirma un plazo calculado sobre una fecha que él mismo puso en duda')
      .not.toMatch(/se pasó el plazo/);
  });

  it('dice que hay que verificar la fecha PRIMERO', () => {
    const n = nota(g({ fecha: '2026-06-01' }), 'factura_por_vencer');
    expect(n).toMatch(/no se puede calcular el plazo/);
    expect(n).toMatch(/verificarla primero/);
  });

  it('y no manda a un trámite ante el SAT por una lectura dudosa', () => {
    // Conciliación de Factura es un procedimiento real y cuesta tiempo. Que
    // salga por un OCR mal leído es el peor uso posible de un aviso correcto.
    const n = nota(g({ fecha: '2026-06-01' }), 'factura_por_vencer');
    expect(n).not.toMatch(/Conciliación de Factura/);
  });

  it('la duda de la fecha SIGUE saliendo — no se calla ninguna de las dos', () => {
    const dif = cuadre(g({ fecha: '2026-06-01' })).diferencias ?? [];
    expect(dif.some((d) => d.tipo === 'fecha_sospechosa')).toBe(true);
    expect(dif.some((d) => d.tipo === 'factura_por_vencer')).toBe(true);
  });

  it('con la fecha BIEN, el plazo se calcula como siempre', () => {
    // El control. Sin él, cualquier cambio que apagara el aviso pasaría verde.
    const n = nota(g({ fecha: '2026-08-01' }), 'factura_por_vencer');
    expect(n).not.toMatch(/no se puede calcular el plazo/);
    expect(n).toMatch(/timbrarlo|plazo/);
  });
});

describe('la regla de formato de fecha, corregida', () => {
  const PROMPT = readFileSync('src/lib/likida/intake/ocr.ts', 'utf8');

  it('el default es DÍA/MES, que es como escribe México', () => {
    // El otro error del mismo ensayo, y ése fue de instrucción: el prompt decía
    // que Walmart imprime MES/DÍA por ser cadena estadounidense, y Walmart de
    // México imprime DÍA/MES. El modelo obedeció y leyó 01/08/26 como 8 de enero.
    expect(PROMPT).toMatch(/MÉXICO ESCRIBE DÍA\/MES\/AÑO/);
    expect(PROMPT).toMatch(/1 de agosto, NO 8 de enero/);
  });

  it('Costco es la ÚNICA excepción, y se dice que fue verificada', () => {
    expect(PROMPT).toMatch(/ÚNICA excepción confirmada es COSTCO/);
    expect(PROMPT).toMatch(/verificado en un ticket real/);
    expect(PROMPT).not.toMatch(/Costco, Walmart, Sam's/);
  });
});
