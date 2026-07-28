import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { CONCEPTOS_OCR } from './ocr';
import type { ConceptoGasto } from '@/types/cuadra';

// EL FALLO QUE ESTO FIJA — cometido el 28-jul-2026 y medido sobre fotos reales.
//
// Se añadió el concepto `flete` al PROMPT y no al esquema. El modelo no puede
// emitir lo que el esquema no acepta, así que las tres guías de paquetería
// salieron como 'otro', 'otro' y 'factura' — y esa última levantó un `sin_cfdi`
// que no existía. Peor que antes del cambio, y sin un solo error en ningún log:
// una instrucción imposible no falla, degrada.
//
// El esquema, el prompt y el tipo del dominio son TRES listas que hay que
// mantener iguales a mano. Esta prueba es lo que hace que no se separen.

const OCR = readFileSync('src/lib/cuadra/intake/ocr.ts', 'utf8');

describe('las tres listas de conceptos dicen lo mismo', () => {
  it('todo concepto del esquema existe en el tipo del dominio', () => {
    // Falla en COMPILACIÓN si alguno no pertenece a ConceptoGasto.
    const _: ConceptoGasto[] = [...CONCEPTOS_OCR];
    expect(_.length).toBe(CONCEPTOS_OCR.length);
  });

  it('todo concepto del esquema aparece en el prompt', () => {
    // La línea del prompt que enumera los conceptos.
    const linea = OCR.split('\n').find((l) => l.startsWith('- concepto:'));
    expect(linea, 'no se encontró la línea "- concepto:" del prompt').toBeDefined();
    for (const c of CONCEPTOS_OCR) {
      expect(linea, `el prompt no menciona "${c}"`).toContain(c);
    }
  });

  it("'viaticos' sigue fuera: es heredado y el prompt lo prohíbe", () => {
    expect(CONCEPTOS_OCR as readonly string[]).not.toContain('viaticos');
    expect(OCR).toContain('NO uses "viaticos" como concepto');
  });

  it('flete y transporte están los dos, que es de lo que depende LISR 28-V', () => {
    expect(CONCEPTOS_OCR as readonly string[]).toContain('flete');
    expect(CONCEPTOS_OCR as readonly string[]).toContain('transporte');
  });
});
