import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 18 · continuación 4 — OPER-C4-1 (ALTO)
//
// `c311997` commiteó, sin querer, el enlace simbólico que apuntaba al
// `node_modules` de la laptop del autor:
//
//     120000 blob 9ae56bb  node_modules -> /Users/javiercamaraportepetit/likida/node_modules
//
// `.gitignore` decía `node_modules/` —con diagonal— y esa forma solo casa
// DIRECTORIOS. Un enlace simbólico llamado `node_modules` no es un directorio
// para git, así que pasó de largo por el ignore y entró al árbol.
//
// Lo que le pasa a quien clona: el checkout deja un enlace colgado a una ruta
// que no existe en su máquina, `ls node_modules/` responde "No such file or
// directory" y cualquier herramienta que mire ahí antes de instalar lee el
// proyecto como si no tuviera dependencias. `npm ci` lo sobrevive porque borra
// y recrea, pero al hacerlo deja el árbol sucio (` D node_modules`) — y un
// árbol sucio es justo lo que apaga el autofix de esta auditoría.
//
// La regla que se defiende es más ancha que el caso: ninguna ruta versionada
// puede ser un enlace simbólico a una ruta ABSOLUTA. Un enlace absoluto solo
// puede resolver en la máquina que lo creó; en cualquier otra es basura.
// ═══════════════════════════════════════════════════════════════════════════

/** Las rutas versionadas que git guarda como enlace simbólico (modo 120000). */
function enlacesVersionados(): { ruta: string; destino: string }[] {
  const salida = execSync('git ls-files -s', { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const enlaces: { ruta: string; destino: string }[] = [];

  for (const linea of salida.split('\n')) {
    if (!linea.startsWith('120000 ')) continue;
    // Formato: `<modo> <sha> <etapa>\t<ruta>`
    const ruta = linea.slice(linea.indexOf('\t') + 1);
    if (!ruta) continue;
    // El contenido del blob de un enlace simbólico ES la ruta de destino.
    const destino = execSync(`git cat-file blob :"${ruta}"`, { encoding: 'utf8' });
    enlaces.push({ ruta, destino: destino.trim() });
  }

  return enlaces;
}

describe('el árbol versionado', () => {
  it('no guarda enlaces simbólicos a rutas absolutas de la máquina de alguien', () => {
    const absolutos = enlacesVersionados().filter((e) => e.destino.startsWith('/'));

    // El mensaje importa: si esto se vuelve a romper, quien lo lea tiene que
    // ver la ruta ajena, no un `expected [] to have length 0`.
    expect(
      absolutos.map((e) => `${e.ruta} -> ${e.destino}`),
      'un enlace a ruta absoluta solo resuelve en la máquina que lo creó',
    ).toEqual([]);
  });

  it('no versiona `node_modules` en ninguna forma', () => {
    const salida = execSync('git ls-files -- node_modules', { encoding: 'utf8' });
    expect(salida.trim()).toBe('');
  });
});
