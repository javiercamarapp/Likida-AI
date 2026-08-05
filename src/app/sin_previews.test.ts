import { describe, it, expect } from 'vitest';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

// ═══════════════════════════════════════════════════════════════════════════
// NINGÚN PREVIEW TEMPORAL SE VA A PRODUCCIÓN.
//
// CLAUDE.md manda mirar el render, y para eso se levanta un preview temporal
// bajo `src/app/zzz-preview-*` que importe el componente REAL. La regla dice
// "se borra al terminar" — y el 4-ago-2026 dos de ellos llegaron a producción.
//
// No fue por olvidar borrarlos: se borraron. Fue un `git add -A` desde otra
// sesión que los recogió mientras todavía existían, en un repo con varios
// agentes trabajando a la vez. Confiar en que cada quien limpie a tiempo no
// funciona cuando el commit lo hace alguien más.
//
// ── LO QUE ESTABA EN JUEGO ───────────────────────────────────────────────
//
// Un preview es una ruta VIVA de Next.js: `app.likida.ai/zzz-preview-contador`
// renderizaba el panel fiscal fuera del layout que aplica el gateo por rol y
// por flota. No es un archivo muerto en el repo, es una puerta.
//
// Por eso esta prueba mira el DISCO y no una lista: cualquier carpeta nueva que
// empiece con `zzz-` la rompe, sin que nadie tenga que acordarse de registrarla.
// ═══════════════════════════════════════════════════════════════════════════

describe('src/app no contiene previews temporales', () => {
  it('ninguna carpeta zzz-* sobrevive al commit', () => {
    const raiz = join(process.cwd(), 'src', 'app');
    const previews = readdirSync(raiz, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name.startsWith('zzz-'))
      .map((e) => `src/app/${e.name}`);

    expect(
      previews,
      previews.length === 0 ? '' :
        'Hay previews temporales en el árbol. Cada carpeta zzz-* es una RUTA VIVA en producción, ' +
        'fuera del gateo por rol y por flota del layout. Bórralas antes de commitear:\n  ' +
        previews.join('\n  '),
    ).toEqual([]);
  });
});
