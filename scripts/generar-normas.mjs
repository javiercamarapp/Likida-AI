#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// GENERADOR DEL ÍNDICE DE NORMAS
//
// `normas/*.yaml` es la fuente de verdad: una carpeta en git que se revisa en
// un pull request, como dice su README. Pero el runtime NO puede leerla —
// Vercel no despliega esa carpeta y meter un parser de YAML al bundle por 21
// archivos que casi nunca cambian es cargar una dependencia (con su superficie
// de CVEs) para resolver un problema de build.
//
// Así que se PROYECTA a un módulo TypeScript: cero IO en runtime, cero
// dependencias, tipado. `corpus.test.ts` vuelve a leer los YAML y falla si el
// índice se separó de ellos — o sea, el YAML sigue mandando.
//
//   node scripts/generar-normas.mjs
//
// El parser de aquí es DELIBERADAMENTE parcial: solo escalares de primer nivel
// y listas simples de primer nivel, que es todo lo que el índice necesita. No
// pretende ser un parser de YAML y no debe crecer para serlo — el día que haga
// falta más estructura, se mete un parser de verdad en devDependencies.
// ═══════════════════════════════════════════════════════════════════════════

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'normas';
const SALIDA = 'src/lib/likida/normas/corpus.ts';

/** Quita comillas envolventes y espacios. */
function limpiar(v) {
  const t = v.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1).trim();
  }
  return t;
}

/**
 * Lee los escalares y listas de PRIMER NIVEL (columna 0) de un YAML.
 * Soporta `k: v`, bloques plegados (`k: >` / `k: |`) y listas de `- item`.
 */
export function leerYamlPlano(texto) {
  const out = {};
  const lineas = texto.split('\n');

  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i];
    // Solo primer nivel: si arranca con espacio, pertenece a otra cosa.
    if (/^\s/.test(linea) || linea.trim() === '' || linea.trimStart().startsWith('#')) continue;

    const m = /^([A-Za-z_][A-Za-z0-9_]*):(.*)$/.exec(linea);
    if (!m) continue;
    const clave = m[1];
    const resto = m[2].trim();

    // Bloque plegado o literal: se junta lo indentado que sigue.
    if (resto === '>' || resto === '|' || resto === '>-' || resto === '|-') {
      const partes = [];
      for (let j = i + 1; j < lineas.length; j++) {
        if (lineas[j].trim() !== '' && !/^\s/.test(lineas[j])) break;
        partes.push(lineas[j].trim());
        i = j;
      }
      out[clave] = partes.join(' ').replace(/\s+/g, ' ').trim();
      continue;
    }

    // Lista en línea: ["a", "b"]
    if (resto.startsWith('[')) {
      const dentro = resto.slice(1, resto.endsWith(']') ? -1 : undefined);
      out[clave] = dentro.split(',').map(limpiar).filter(Boolean);
      continue;
    }

    // Lista por renglones: los `- item` indentados que siguen.
    if (resto === '') {
      const items = [];
      let j = i + 1;
      for (; j < lineas.length; j++) {
        const l = lineas[j];
        if (l.trim() === '') continue;
        if (!/^\s/.test(l)) break;
        const li = /^\s+-\s+(.*)$/.exec(l);
        if (li) items.push(limpiar(li[1]));
        else if (items.length > 0) break; // sub-objeto: no es una lista simple
        else break;
      }
      if (items.length > 0) { out[clave] = items; i = j - 1; }
      continue;
    }

    out[clave] = limpiar(resto);
  }

  return out;
}

const CAMPOS_TEXTO = ['id', 'tipo', 'instrumento', 'articulo_o_regla', 'titulo', 'estado_verificacion', 'fuente_url', 'verificado_el'];

export function fichaDesdeYaml(crudo, archivo) {
  const y = leerYamlPlano(crudo);
  // `articulo_o_regla` NO es obligatorio: `politica-portales-plazos` es una
  // política de comercio (jerarquía 6), no una norma legal — no tiene artículo
  // que citar y aun así pertenece al corpus, porque el código depende de ella.
  const faltan = ['id', 'tipo', 'instrumento', 'estado_verificacion'].filter((k) => !y[k]);
  if (faltan.length) throw new Error(`${archivo}: le faltan campos obligatorios: ${faltan.join(', ')}`);

  const ficha = { archivo };
  for (const c of CAMPOS_TEXTO) if (y[c]) ficha[c] = String(y[c]);
  ficha.jerarquia = Number(y.jerarquia);
  if (!Number.isFinite(ficha.jerarquia)) throw new Error(`${archivo}: jerarquia no es un número`);
  ficha.citasEnCodigo = Array.isArray(y.citas_en_codigo) ? y.citas_en_codigo : [];
  return ficha;
}

export function leerCorpus(dir = DIR) {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'))
    .sort()
    .map((f) => fichaDesdeYaml(readFileSync(join(dir, f), 'utf8'), f));
}

// Solo genera cuando se corre a mano, no cuando la prueba lo importa.
if (process.argv[1] && process.argv[1].endsWith('generar-normas.mjs')) {
  const fichas = leerCorpus();
  const cuerpo = `// ⚠️ GENERADO por scripts/generar-normas.mjs — NO editar a mano.
// La fuente de verdad es normas/*.yaml (se revisa en el PR, como dice su
// README). Para regenerar:  node scripts/generar-normas.mjs
// \`corpus.test.ts\` vuelve a leer los YAML y falla si esto se separó de ellos.

import type { Norma } from './tipos';

export const NORMAS: readonly Norma[] = ${JSON.stringify(fichas, null, 2)} as const;
`;
  writeFileSync(SALIDA, cuerpo);
  console.log(`${fichas.length} normas → ${SALIDA}`);
}
