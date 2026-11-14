#!/usr/bin/env node
// Decide si un workflow de CI pesado aplica a los archivos que toca un PR.
//
// POR QUÉ EXISTE (ver docs/operacion/ci-costos.md): `verificar`, `Migraciones + aislamiento (Postgres efímero)`
// y `Pila local + Playwright contra el producto` son checks que el ruleset de master (o la ruta de release)
// exigen POR NOMBRE. Un `paths:` a nivel de `on:` los dejaría sin reportar y bloquearía el merge. El patrón
// correcto: el workflow SIEMPRE se dispara, este script (primer paso del job) calcula `relevante`, y los
// pasos pesados se condicionan con `if: steps.cambios.outputs.relevante == 'true'`. Si no aplica, el job
// termina en verde en segundos CON EL MISMO NOMBRE de check.
//
// FALLA ABIERTO: ante cualquier duda (evento que no es PR, etiqueta `ci-completo`, diff vacío, git roto)
// la respuesta es `relevante=true`, es decir, corre todo. Solo un diff legible y claramente ajeno salta.
//
// Uso: node scripts/ci/cambios-ci.mjs <verificar|postgres|e2e>
// Entorno: EVENT_NAME, BASE_SHA (PR), ETIQUETAS (JSON con los nombres de etiquetas del PR),
//          GITHUB_OUTPUT y GITHUB_STEP_SUMMARY (los pone Actions).
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';

export const ETIQUETA_COMPLETO = 'ci-completo';

// Solo documentación y plantillas: nada que compile, se pruebe o llegue al navegador.
const DOCS = [/^docs\//, /\.md$/i, /^LICENSE$/, /^\.github\/(ISSUE_TEMPLATE|PULL_REQUEST_TEMPLATE)/, /^\.github\/CODEOWNERS$/];
const esDoc = (f) => DOCS.some((r) => r.test(f));

// Cada perfil dice qué archivo vuelve relevante al workflow. Un PR es relevante si AL MENOS UN archivo cae.
export const PERFILES = {
  // Typecheck, lint, pruebas y build: todo lo que no sea documentación.
  verificar: (f) => !esDoc(f),
  // Postgres efímero: migraciones, baterías SQL, scripts de CI, los workflows y la prueba que las lee.
  postgres: (f) =>
    /^supabase\//.test(f) ||
    /^scripts\/ci\//.test(f) ||
    /^\.github\/workflows\//.test(f) ||
    f === 'src/lib/likida/migraciones_verificadas.test.ts',
  // Navegador contra el producto: la app, lo que se sirve, la propia suite, la pila local (supabase/ trae
  // migraciones y seed que levantan la pila; scripts/ci/e2e/ la arranca) y la configuración de build.
  e2e: (f) =>
    /^src\//.test(f) ||
    /^public\//.test(f) ||
    /^pruebas-navegador\//.test(f) ||
    /^supabase\//.test(f) ||
    /^scripts\/ci\/e2e\//.test(f) ||
    /^\.github\/workflows\//.test(f) ||
    /^package(-lock)?\.json$/.test(f) ||
    /^next\.config\./.test(f) ||
    /^vercel\.json$/.test(f) ||
    /^(playwright|postcss|tailwind)\.config\./.test(f) ||
    /^tsconfig[^/]*\.json$/.test(f),
};

/**
 * Veredicto puro.
 * @param {keyof typeof PERFILES} perfil
 * @param {string[]|null} archivos archivos cambiados, o null si no se pudieron leer
 * @param {{evento?: string, etiquetas?: string[]}} ctx
 * @returns {{relevante: boolean, motivo: string}}
 */
export function clasificar(perfil, archivos, { evento = 'pull_request', etiquetas = [] } = {}) {
  const regla = PERFILES[perfil];
  if (!regla) throw new Error(`perfil desconocido: ${perfil}`);
  if (evento !== 'pull_request') return { relevante: true, motivo: `evento ${evento}: corre todo` };
  if (etiquetas.includes(ETIQUETA_COMPLETO)) return { relevante: true, motivo: `etiqueta ${ETIQUETA_COMPLETO}: corrida completa forzada` };
  if (!Array.isArray(archivos) || archivos.length === 0) return { relevante: true, motivo: 'diff ilegible o vacío: corre todo (falla abierto)' };
  // Un .md o docs/** nunca vuelve relevante a ningún perfil, aunque viva dentro de src/ o supabase/.
  const tocados = archivos.filter((f) => !esDoc(f) && regla(f));
  if (tocados.length > 0) return { relevante: true, motivo: `${tocados.length} archivo(s) relevantes, p. ej. ${tocados[0]}` };
  return { relevante: false, motivo: `${archivos.length} archivo(s), ninguno relevante para «${perfil}»` };
}

function archivosDelPr(baseSha) {
  if (!/^[0-9a-f]{40}$/.test(baseSha ?? '')) return null;
  try {
    // El checkout de un PR es el merge commit refs/pull/N/merge: comparar contra la base trae exactamente lo del PR.
    execFileSync('git', ['fetch', '--no-tags', '--depth=1', 'origin', baseSha], { stdio: 'ignore' });
    const salida = execFileSync('git', ['diff', '--name-only', '--no-renames', baseSha, 'HEAD'], { encoding: 'utf8' });
    return salida.split('\n').filter(Boolean);
  } catch {
    return null;
  }
}

if (process.argv[1] && process.argv[1].endsWith('cambios-ci.mjs')) {
  const perfil = process.argv[2];
  let etiquetas = [];
  try { etiquetas = JSON.parse(process.env.ETIQUETAS || '[]'); } catch { /* falla abierto: sin etiquetas */ }
  const evento = process.env.EVENT_NAME || 'push';
  const archivos = evento === 'pull_request' ? archivosDelPr(process.env.BASE_SHA) : null;
  const { relevante, motivo } = clasificar(perfil, archivos, { evento, etiquetas });
  const linea = `${relevante ? 'CORRE' : 'SE SALTA'} (${perfil}): ${motivo}`;
  console.log(linea);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `relevante=${relevante}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `### Filtro de cambios\n${linea}\n${relevante ? '' : `\nEl check conserva su nombre y termina en verde sin correr lo pesado. Para forzar la corrida completa: etiqueta \`${ETIQUETA_COMPLETO}\` o *Run workflow*.\n`}`,
    );
  }
  if (!relevante) console.log(`::notice::Pasos pesados omitidos: ${motivo}`);
}
