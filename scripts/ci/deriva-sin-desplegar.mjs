#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// OP-A6 (auditoría 31, ALTO; escalado de OP-M3/30 y OP-A1/29).
//
// El cotejo de `salud-produccion.yml` pregunta «¿producción corre el último
// commit con [deploy] de master, o uno posterior?». Esa pregunta es sobre la
// INTENCIÓN declarada, no sobre el estado: si nadie pidió publicar, producción
// puede quedarse arbitrariamente atrás de `master` y el pulso sale verde.
//
// Ya ocurrió, y con el camino del dinero: el 12-sep-2026 se mergeó `5ce91b2`
// —asunto sin `[deploy]`— con `cuadre/desde_db.ts` (ARQ-C2: el cubo del 15 %,
// $90,600 impresos donde lo correcto son $95,300) y `sat_descarga/ciclo.ts`
// (AG-C1). Siete corridas del pulso en `success` mientras el arreglo fiscal no
// estaba en producción.
//
// Este detector pregunta por el ESTADO: qué commits de `src/` y `supabase/`
// hay en master que producción no está corriendo. NO falla el job —quedarse
// atrás a propósito es el flujo documentado en CLAUDE.md («los pushes a GitHub
// no cambian»)— pero deja de ser silencioso: el resumen de la mañana nombra
// los commits, para que «no desplegué» sea una decisión y no un descubrimiento.
// ═══════════════════════════════════════════════════════════════════════════
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';

/** Las rutas cuyo contenido CORRE en producción. `docs/`, `normas/` y los
 *  workflows no cambian lo que el contralor ve en pantalla. */
export const RUTAS_QUE_CORREN = ['src/', 'supabase/'];

/** `git` con argumentos sueltos y sin shell. */
const correrGit = (args) => execFileSync('git', args, { encoding: 'utf8' });

/**
 * El veredicto, puro y testeable: a partir de los commits que master tiene y
 * producción no (ya filtrados a `RUTAS_QUE_CORREN`), decide qué decir.
 *
 * @param {{sha: string, asunto: string}[]} commits
 * @returns {{hay: boolean, cuantos: number, mensaje: string}}
 */
export function resumirDeriva(commits) {
  if (commits.length === 0) {
    return { hay: false, cuantos: 0, mensaje: 'Producción corre todo el código de master: no hay deriva.' };
  }
  const lista = commits
    .map((c) => `  · ${c.sha.slice(0, 7)} ${c.asunto}`)
    .join('\n');
  const plural = commits.length === 1 ? 'commit' : 'commits';
  return {
    hay: true,
    cuantos: commits.length,
    // El texto dice las dos cosas que hacen falta para decidir: cuánto código
    // y cómo publicarlo. Sin la segunda, el aviso es una queja.
    mensaje:
      `Producción está atrás de master: ${commits.length} ${plural} de ${RUTAS_QUE_CORREN.join(' / ')} ` +
      `sin publicar.\n${lista}\n` +
      'Si eso es a propósito, ignora este aviso. Si no: Redeploy en Vercel, o un commit con [deploy] en la PRIMERA línea.',
  };
}

/**
 * Los commits que `ref` tiene y `desplegado` no, acotados a lo que corre.
 *
 * `execFileSync` con ARGUMENTOS, nunca una plantilla para el shell: los dos
 * refs entran por `process.argv` y, en el workflow, `$version` sale de un
 * `curl` a `/api/health` — o sea que son entrada externa. Interpolarlos en una
 * cadena que pasa por `sh` es inyección de comandos, y CodeQL
 * (`security-and-quality`) lo marca con razón. Sin shell no hay nada que
 * escapar: un ref con `;` o con comillas es un ref inválido y git lo rechaza.
 */
export function commitsSinDesplegar(desplegado, ref = 'HEAD', ejecutar = correrGit) {
  const salida = ejecutar([
    'log', '--format=%H%x1f%s', `${desplegado}..${ref}`, '--', ...RUTAS_QUE_CORREN,
  ]);
  return salida.split('\n').filter(Boolean).map((linea) => {
    const i = linea.indexOf('\x1f');
    return { sha: linea.slice(0, i), asunto: linea.slice(i + 1) };
  });
}

/**
 * Los canales por los que sale el aviso, separados del veredicto para poder
 * probarlos sin escribir en disco.
 *
 * OP-31C-A1 (auditoría 31, continuación, ALTO): `::warning::` pinta una
 * anotación en la corrida y nada más. GitHub manda correo cuando un workflow
 * programado FALLA, y este paso tiene prohibido fallar, así que el aviso moría
 * en el log — el mismo sitio donde OP-C1 lleva seis rondas atascado. Medido por
 * el auditor: con el detector mergeado, las 14 corridas verdes sobre el arreglo
 * fiscal sin publicar habrían mandado CERO avisos.
 *
 * Dos canales que sí se leen: el RESUMEN de la corrida (se ve sin abrir el log)
 * y, vía `$GITHUB_OUTPUT`, el ISSUE que abre el workflow — lo único que
 * notifica de verdad. Fuera de Actions no escribe nada: correrlo en local no
 * ensucia ningún archivo.
 *
 * @param {{hay: boolean, cuantos: number, mensaje: string}} r
 * @param {Record<string, string|undefined>} env
 * @param {(ruta: string, texto: string) => void} anexar
 * @returns {string[]} los canales por los que salió
 */
export function publicarDeriva(r, env = process.env, anexar = appendFileSync) {
  const canales = [];
  if (env.GITHUB_STEP_SUMMARY) {
    anexar(env.GITHUB_STEP_SUMMARY, `${r.hay ? '⚠️ ' : ''}${r.mensaje}\n`);
    canales.push('resumen');
  }
  if (env.GITHUB_OUTPUT) {
    // El formato de `$GITHUB_OUTPUT` parte por salto de línea: un mensaje
    // multilínea sin delimitador llega cortado en la primera línea, y el issue
    // saldría sin la lista de commits, que es justo el dato que se necesita.
    anexar(
      env.GITHUB_OUTPUT,
      `hay=${r.hay ? '1' : '0'}\ncuantos=${r.cuantos}\nmensaje<<FIN_DERIVA\n${r.mensaje}\nFIN_DERIVA\n`,
    );
    canales.push('salida');
  }
  return canales;
}

// `import.meta.main` no existe en Node 22; el patrón del repo es comparar argv.
if (process.argv[1] && process.argv[1].endsWith('deriva-sin-desplegar.mjs')) {
  const desplegado = process.argv[2];
  const ref = process.argv[3] ?? 'HEAD';
  if (!desplegado) {
    console.log('Sin sha desplegado: nada que cotejar.');
    process.exit(0);
  }
  const r = resumirDeriva(commitsSinDesplegar(desplegado, ref));
  publicarDeriva(r);
  // `::warning::` y NUNCA `exit 1`: el pulso rojo está reservado para
  // producción caída o para un [deploy] que no aterrizó. Un aviso que se
  // aprende a ignorar es peor que no tenerlo (la lección de las 40 corridas
  // rojas seguidas, auditoría 24).
  console.log(r.hay ? `::warning::${r.mensaje.replace(/\n/g, '%0A')}` : r.mensaje);
  process.exit(0);
}
