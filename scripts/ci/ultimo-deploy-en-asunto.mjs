#!/usr/bin/env node
// Imprime el sha completo del último commit de `git log` (HEAD hacia atrás)
// cuyo ASUNTO lleva `[deploy]`/`[deploy:forzar]` — nada si ninguno lo lleva.
//
// Reemplaza a `git log -i --grep='\[deploy' -1 --pretty=%H` en
// `salud-produccion.yml` (auditoría 25, ALTO REINCIDENTE): `--grep` casa
// contra asunto Y CUERPO, así que un merge commit cuyo asunto no lleva la
// bandera pero cuyo cuerpo la hereda del commit mergeado pasaba igual. Este
// script usa `ultimoConDeployEnAsunto`, la MISMA regla que `decidir()`
// aplica al tip de `master` — ver compuerta-deploy.mjs.
import { execSync } from 'node:child_process';
import { ultimoConDeployEnAsunto } from './compuerta-deploy.mjs';

// \x1f (unit separator) como delimitador: no puede aparecer en un asunto de
// commit de verdad, así que un asunto con "|" no rompe el parseo.
const salida = execSync("git log --format='%H%x1f%s'", { encoding: 'utf8' });
const commits = salida.split('\n').filter(Boolean).map((linea) => {
  const i = linea.indexOf('\x1f');
  return { sha: linea.slice(0, i), asunto: linea.slice(i + 1) };
});

const sha = ultimoConDeployEnAsunto(commits);
if (sha) console.log(sha);
