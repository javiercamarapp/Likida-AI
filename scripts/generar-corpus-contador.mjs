#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// GENERADOR DEL CORPUS DE TEXTO COMPLETO DEL CONTADOR (E.26, fase 2 EVALOPS)
//
// `generar-normas.mjs` proyecta los METADATOS de las fichas a `corpus.ts`
// (índice compacto para el guardia de citas). El CONTADOR necesita otra cosa:
// el TEXTO VIGENTE completo de cada ficha, porque su regla número uno es
// "solo afirma lo que el corpus verificado sostiene" — y eso exige que el
// corpus viaje entero en su prompt, no un resumen.
//
// Misma doctrina que el otro generador: `normas/*.yaml` es la fuente de
// verdad (se revisa en el PR), Vercel NO despliega esa carpeta, y meter un
// parser de YAML al runtime por ~35 archivos que casi nunca cambian sería
// cargar una dependencia para resolver un problema de build. Se proyecta a un
// módulo TypeScript con el YAML TAL CUAL (sin parsear: el modelo lee YAML
// mejor que cualquier resumen nuestro), y `corpus_texto.test.ts` vuelve a
// leer la carpeta y falla si esto se separó de ella.
//
//   node scripts/generar-corpus-contador.mjs
//
// Entran también los datos versionados (`normas/datos/*.yaml`, hoy la cuota
// semanal de IEPS): el contador que no sabe qué cuota rige una fecha no puede
// ni explicar por qué el motor se negó a calcular.
// ═══════════════════════════════════════════════════════════════════════════

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SALIDA = 'src/lib/likida/normas/corpus_texto.ts';

/** Lee una carpeta de fichas YAML, orden estable por nombre de archivo. */
function leerCarpeta(dir, prefijo) {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'))
    .sort()
    .map((f) => ({ archivo: `${prefijo}${f}`, texto: readFileSync(join(dir, f), 'utf8') }));
}

/** El corpus completo: fichas de normas/ + datos versionados de normas/datos/. */
export function leerCorpusTexto(raiz = '.') {
  return [
    ...leerCarpeta(join(raiz, 'normas'), ''),
    ...leerCarpeta(join(raiz, 'normas', 'datos'), 'datos/'),
  ];
}

// Solo genera cuando se corre a mano, no cuando la prueba lo importa.
if (process.argv[1] && process.argv[1].endsWith('generar-corpus-contador.mjs')) {
  const fichas = leerCorpusTexto().filter((f) => f.archivo !== 'README.md');
  const cuerpo = `// ⚠️ GENERADO por scripts/generar-corpus-contador.mjs — NO editar a mano.
// La fuente de verdad es normas/*.yaml y normas/datos/*.yaml (se revisan en
// el PR, como dice normas/README.md). Para regenerar:
//   node scripts/generar-corpus-contador.mjs
// \`corpus_texto.test.ts\` vuelve a leer la carpeta y falla si esto se separó.

export const FICHAS_TEXTO: ReadonlyArray<{ archivo: string; texto: string }> = ${JSON.stringify(fichas, null, 2)};
`;
  writeFileSync(SALIDA, cuerpo);
  const kb = (Buffer.byteLength(cuerpo, 'utf8') / 1024).toFixed(0);
  console.log(`${fichas.length} fichas (texto completo, ${kb} KB) → ${SALIDA}`);
}
