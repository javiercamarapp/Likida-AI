import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// ═══════════════════════════════════════════════════════════════════════════
// `ConceptoGasto` (types/likida.ts, 9 valores) tiene CUATRO espejos escritos a
// mano — auditoría 21, MEDIO: `contabilidad/catalogo.ts`, `dashboard/
// politicas/page.tsx`, `intake/ocr.ts` y `reglas/catalogo.ts` (el más nuevo,
// PR #136, `CONCEPTOS_VIGILABLES`). Cada uno es `readonly ConceptoGasto[]` (o
// equivalente), y TypeScript solo verifica PERTENENCIA, no EXHAUSTIVIDAD: una
// lista de cinco de los nueve compila exactamente igual.
//
// No se leen por IMPORT porque `politicas/page.tsx` es un server component de
// Next (arrastraría `next/cache`, Supabase admin, auth…) — el mismo problema
// que ya resolvió `etiquetas_sincronizadas.test.ts` leyendo el FUENTE en vez
// de importar el módulo. `intake/ocr.ts` excluye 'viaticos' A PROPÓSITO (es
// heredado; el prompt se lo prohíbe al modelo, ya vigilado línea por línea por
// `intake/conceptos_coinciden.test.ts`) — esa es la única excepción declarada
// que este test conoce; cualquier otro faltante es divergencia.
// ═══════════════════════════════════════════════════════════════════════════

/** Los 9 valores de `ConceptoGasto`, leídos de la fuente única del tipo. */
function conceptosDelTipo(): string[] {
  const src = readFileSync('src/types/likida.ts', 'utf8');
  const i = src.indexOf('export type ConceptoGasto');
  expect(i, 'no se encontró "export type ConceptoGasto" en types/likida.ts').toBeGreaterThanOrEqual(0);
  const decl = src.slice(i, src.indexOf(';', i));
  const conceptos = [...decl.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  expect(conceptos.length, 'no se pudo leer ConceptoGasto').toBeGreaterThan(3);
  return conceptos;
}

/** Extrae los literales `'x', 'y'` del arreglo que empieza en `ancla`, hasta
 *  el `]` que lo cierra (el arreglo puede partirse en varias líneas). */
function arregloDeConceptos(ruta: string, ancla: string): string[] {
  const src = readFileSync(ruta, 'utf8');
  const i = src.indexOf(ancla);
  expect(i, `no se encontró "${ancla}" en ${ruta}`).toBeGreaterThanOrEqual(0);
  // Ojo: `ancla` puede traer "ConceptoGasto[]" en la propia anotación de tipo
  // — hay que buscar el "]" de cierre a partir de DESPUÉS del ancla, no desde
  // su inicio, o el corte cae dentro de la anotación y no en el arreglo.
  const desde = i + ancla.length;
  const bloque = src.slice(desde, src.indexOf(']', desde));
  const valores = [...bloque.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  expect(valores.length, `no se pudo leer el arreglo de ${ruta}`).toBeGreaterThan(3);
  return valores;
}

interface Espejo { nombre: string; ruta: string; ancla: string; excluye: readonly string[] }

const ESPEJOS: readonly Espejo[] = [
  {
    nombre: 'contabilidad/catalogo.ts (CONCEPTOS)',
    ruta: 'src/lib/likida/contabilidad/catalogo.ts',
    ancla: 'const CONCEPTOS: readonly ConceptoGasto[] = [',
    excluye: [],
  },
  {
    nombre: 'dashboard/politicas/page.tsx (CONCEPTOS)',
    ruta: 'src/app/dashboard/politicas/page.tsx',
    ancla: 'const CONCEPTOS = [',
    excluye: [],
  },
  {
    nombre: 'reglas/catalogo.ts (CONCEPTOS_VIGILABLES)',
    ruta: 'src/lib/likida/reglas/catalogo.ts',
    ancla: 'export const CONCEPTOS_VIGILABLES: readonly ConceptoGasto[] = [',
    excluye: [],
  },
  {
    // 'viaticos' es la única ausencia DELIBERADA y ya probada aparte
    // (conceptos_coinciden.test.ts): el prompt se lo prohíbe al modelo porque
    // es un concepto heredado. Cualquier otro faltante sí es divergencia.
    nombre: 'intake/ocr.ts (CONCEPTOS_OCR)',
    ruta: 'src/lib/likida/intake/ocr.ts',
    ancla: 'export const CONCEPTOS_OCR = [',
    excluye: ['viaticos'],
  },
];

describe('ConceptoGasto — los cuatro espejos escritos a mano cubren el tipo', () => {
  const tipo = conceptosDelTipo();

  it('el tipo se sigue leyendo con los 9 valores conocidos (si cambió, hay que revisar los cuatro espejos)', () => {
    expect([...tipo].sort()).toEqual(
      ['alimentacion', 'caseta', 'diesel', 'factura', 'flete', 'hospedaje', 'otro', 'transporte', 'viaticos'].sort(),
    );
  });

  const leidos = ESPEJOS.map((e) => ({ ...e, valores: arregloDeConceptos(e.ruta, e.ancla) }));

  for (const { nombre, valores, excluye } of leidos) {
    it(`${nombre} cubre los mismos conceptos que el tipo${excluye.length ? ` (menos ${excluye.join(', ')}, declarado y probado aparte)` : ''}`, () => {
      const esperado = tipo.filter((c) => !excluye.includes(c));
      expect([...valores].sort(), `${nombre} no cubre los mismos conceptos que el tipo`).toEqual([...esperado].sort());
    });
  }

  it('los cuatro espejos dicen lo mismo ENTRE SÍ, contando la única excepción declarada', () => {
    // Se "rellena" cada espejo con su excepción declarada antes de comparar:
    // así la comparación cruzada no confunde una ausencia CONOCIDA (viaticos
    // en OCR) con una divergencia real.
    const normalizados = leidos.map((e) => ({ nombre: e.nombre, set: new Set([...e.valores, ...e.excluye]) }));
    for (let a = 0; a < normalizados.length; a++) {
      for (let b = a + 1; b < normalizados.length; b++) {
        expect(
          [...normalizados[a].set].sort(),
          `${normalizados[a].nombre} vs ${normalizados[b].nombre}`,
        ).toEqual([...normalizados[b].set].sort());
      }
    }
  });
});
