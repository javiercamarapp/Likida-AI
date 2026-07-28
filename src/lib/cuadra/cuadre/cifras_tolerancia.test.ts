// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 5 · ALTO — la tolerancia de la guardia de cifras, que es la regla
// fundacional del producto, no estaba anclada.
//
// MUTACIÓN M3 (`cifras.ts:89`): `const TOL = 0.011` → `5000`. **628 verdes.**
//
// `TOL` es lo que decide si una cifra que el modelo escribió está respaldada por
// lo que devolvió una tool. Con `TOL = 5000`, y habiendo devuelto la tool
// `{ totalComprobado: 4812.5 }`, el texto inventado "Te sobraron 4800 del
// anticipo" pasa como respaldado y se manda tal cual por WhatsApp. El backstop de
// "ninguna cifra que vea el usuario sale del LLM" se amplía 450,000× sin que nada
// falle.
//
// `guardia.test.ts` (242 líneas) prueba a fondo el FLUJO de la guardia —tres
// mutaciones sobre su lógica y las tres fallan—, pero ninguna prueba fijaba el
// UMBRAL NUMÉRICO del que depende su veredicto. Se probó la máquina de estados y
// no la constante que la alimenta.
//
// Estas pruebas encierran `TOL` por ARRIBA y por ABAJO: un centavo de diferencia
// se perdona (el motor redondea y el modelo formatea) y dos centavos no. Cualquier
// valor fuera de ese intervalo hace fallar una de las dos.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { cifrasSinRespaldo } from './cifras';

// Lo que devolvió `cuadrar_viaje` en el turno: el único respaldo que el modelo
// tiene derecho a citar.
const TOOL = [{ total_comprobado: 4812.5, total_anticipo: 5000, diferencia: 187.5 }];

describe('cifrasSinRespaldo — la tolerancia es de un CENTAVO, no de la casa (M3)', () => {
  // El caso exacto que el auditor midió con el módulo real.
  it('una cifra INVENTADA cerca de la real no se da por respaldada', () => {
    expect(cifrasSinRespaldo('Te sobraron 4800 del anticipo.', TOOL)).toEqual([4800]);
  });

  it('un centavo de diferencia SÍ se perdona: el motor redondea y el modelo formatea', () => {
    expect(cifrasSinRespaldo('Comprobaste $4,812.51 en total.', TOOL)).toEqual([]);
    expect(cifrasSinRespaldo('Comprobaste $4,812.49 en total.', TOOL)).toEqual([]);
  });

  // El techo. Si TOL creciera a 0.02 esta prueba se cae; si creciera a 5000, se
  // caen las tres de arriba y esta.
  it('DOS centavos ya no: a partir de ahí la cifra no salió de la tool', () => {
    expect(cifrasSinRespaldo('Comprobaste $4,812.52 en total.', TOOL)).toEqual([4812.52]);
    expect(cifrasSinRespaldo('Comprobaste $4,812.48 en total.', TOOL)).toEqual([4812.48]);
  });

  // El piso. Si alguien bajara TOL a 0 —"más estricto es mejor"— la guardia
  // empezaría a reemplazar mensajes correctos por el resumen del motor en cada
  // turno, y el producto se volvería un robot. La tolerancia existe por algo.
  it('la cifra EXACTA de la tool siempre pasa', () => {
    expect(cifrasSinRespaldo('Comprobaste $4,812.50 y el anticipo fue $5,000.00.', TOOL)).toEqual([]);
  });

  // Estricto a propósito: una cifra DERIVADA por el modelo no está respaldada
  // aunque sus operandos sí lo estén. Quien calcula diferencias es el motor.
  it('una resta que el modelo hizo por su cuenta NO está respaldada', () => {
    // 5000 − 4812.50 = 187.50 sí está en la tool; 5000 − 4800 = 200 no.
    expect(cifrasSinRespaldo('El anticipo fue $5,000.00 y te quedan $200.00.', TOOL)).toEqual([200]);
  });

  it('con una tolerancia de casa, un cuadre entero inventado pasaría: no pasa', () => {
    // El mensaje completo que un modelo escribe con toda naturalidad, con las
    // tres cifras cerca pero ninguna igual. Con TOL = 5000 la lista sale vacía.
    const inventado = 'Comprobado: $4,800.00 · Anticipo: $5,000.00 · Sobró: $200.00';
    expect(cifrasSinRespaldo(inventado, TOOL).sort((a, b) => a - b)).toEqual([200, 4800]);
  });
});
