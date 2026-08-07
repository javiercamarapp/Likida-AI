import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { CONCEPTOS_OCR } from './ocr';
import type { ConceptoGasto } from '@/types/likida';

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

const OCR = readFileSync('src/lib/likida/intake/ocr.ts', 'utf8');

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

  it('y AL REVÉS: todo concepto del prompt existe en el esquema', () => {
    // ESTA ES LA DIRECCIÓN EN LA QUE OCURRIÓ EL BUG, y era la que faltaba. El
    // fallo fue "el prompt tiene un concepto que el esquema no acepta"; la
    // aserción de arriba recorre el ESQUEMA, así que un valor que viva solo en
    // el prompt no lo ve nadie. Corrido tal cual sobre la línea real más
    // ", peaje_urbano, otro." la prueba salía verde: la red que conmemora el bug
    // de `flete` no estaba tendida del lado por el que se cayó.
    const linea = OCR.split('\n').find((l) => l.startsWith('- concepto:'))!;
    // Se leen los identificadores enumerados ANTES del primer paréntesis o coma
    // de cada ítem: "diesel (combustible...), caseta (peaje...), ... flete, otro."
    const enumerado = linea.slice('- concepto:'.length).split(/,(?![^(]*\))/);
    const delPrompt = enumerado
      .map((x) => x.replace(/\(.*?\)/g, '').trim().replace(/\.$/, ''))
      .filter((x) => /^[a-z_]+$/.test(x));
    expect(delPrompt.length, 'no se pudo extraer ningún concepto del prompt').toBeGreaterThan(3);
    for (const c of delPrompt) {
      expect(CONCEPTOS_OCR as readonly string[], `el prompt pide "${c}" y el esquema no lo acepta`).toContain(c);
    }
  });

  it('los campos del esquema que el prompt NUNCA explica se quedan sin instrucción', () => {
    // Un campo del esquema sin un renglón en el prompt llega al modelo SIN
    // description —`z.toJSONSchema` no lleva los comentarios de TypeScript— y
    // sin una sola instrucción sobre qué poner en él. Es la familia del bug de
    // `flete` en su otra dirección: no hay error en ningún log, hay degradación.
    //
    // Pasó con dos: `producto`, que decide si el PDF etiqueta "Diésel" un
    // litraje de gasolina (y con él, un estímulo que solo aplica al diésel), y
    // `cfdi_uuid`, cuya ausencia levanta un `sin_cfdi` sobre un CFDI legítimo
    // cuando el QR no decodifica — que sobre los tickets de campo del 27-jul
    // fue el 100% de los casos.
    const cuerpo = OCR.slice(OCR.indexOf('const ExtraccionSchema'), OCR.indexOf('const SYSTEM'));
    const campos = [...cuerpo.matchAll(/^\s{2}([a-z_]+):\s*z\./gm)].map((m) => m[1]);
    expect(campos.length, 'no se leyeron los campos del esquema').toBeGreaterThan(15);
    const prompt = OCR.slice(OCR.indexOf('const SYSTEM'));
    // NO basta con que la palabra aparezca: `producto` sale en "un código
    // INTERNO de producto de la estación", que es prosa sobre lo que NO hay que
    // poner ahí. Tiene que ser una INSTRUCCIÓN para ese campo: un renglón de
    // mapeo (`- campo ←`), una regla dura (`- campo:` / `- "campo" =`) o el
    // nombre entrecomillado, que es como el prompt se refiere a un campo cuando
    // lo menciona dentro de un párrafo.
    for (const campo of campos) {
      const instruido =
        new RegExp(`^-\\s*"?${campo}"?\\s*(?:←|:|=)`, 'm').test(prompt) ||
        prompt.includes(`"${campo}"`);
      expect(instruido, `el esquema pide "${campo}" y el prompt no le da una sola instrucción`).toBe(true);
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
