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
//
// OP40-02 (cierre100, ola 10): leía TODO `git log` con `execSync` y el
// `maxBuffer` por omisión (1 MiB). Con ~154 commits/día esa salida pasaba de
// 1 MiB hacia el 22-nov-2026 (ENOBUFS en cada corrida programada: pulso rojo
// fijo). Ahora se lee en STREAMING línea por línea y se corta en cuanto
// aparece el primer commit con la bandera: no hay tope de commits y casi nunca
// se lee la historia completa.
import { spawn } from 'node:child_process';
import { ultimoConDeployEnAsunto } from './compuerta-deploy.mjs';

// \x1f (unit separator) como delimitador: no puede aparecer en un asunto de
// commit de verdad, así que un asunto con "|" no rompe el parseo.
const hijo = spawn('git', ['log', '--format=%H%x1f%s'], { stdio: ['ignore', 'pipe', 'inherit'] });
let resto = '';
let encontrado = null;
let cortado = false;

function revisar(linea) {
  if (encontrado || !linea) return;
  const i = linea.indexOf('\x1f');
  const sha = ultimoConDeployEnAsunto([{ sha: linea.slice(0, i), asunto: linea.slice(i + 1) }]);
  if (sha) {
    encontrado = sha;
    cortado = true;
    hijo.stdout.destroy();
    hijo.kill();
  }
}

hijo.stdout.setEncoding('utf8');
hijo.stdout.on('data', (trozo) => {
  if (encontrado) return;
  resto += trozo;
  const lineas = resto.split('\n');
  resto = lineas.pop() ?? '';
  for (const l of lineas) { revisar(l); if (encontrado) break; }
});
hijo.on('error', (e) => { console.error(`git no se pudo ejecutar: ${e.message}`); process.exit(1); });
hijo.on('close', (codigo) => {
  if (!encontrado) revisar(resto);
  if (encontrado) { console.log(encontrado); return; }
  if (!cortado && codigo !== 0) { console.error(`git log terminó con código ${codigo}`); process.exit(1); }
});
