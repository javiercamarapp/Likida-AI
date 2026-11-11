import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/** A49-OP-01 (era A48-OP-01, abierto una ronda entera) — el comando de la guía
 *  del piloto tiene que CORRER.
 *
 *  `docs/operacion/entrega-flota-piloto.md` es la guía de encendido que se sigue
 *  el día de la conexión, delante del cliente. Su único comando ejecutable era
 *
 *      node scripts/tms/verificar-local.mjs --en-seco --muestra-tms
 *
 *  que imprime el uso y sale con código 2 SIN HACER NADA, porque
 *  `verificar-local.mjs:128` exige que `--en-seco` venga acompañado de `--falso`
 *  (ensayo sintético, sin red) o de un `<mapeos.json>` (el cliente real):
 *
 *      if (desconocido || (enSeco && !falso && !archivoMapeos)) salir(2, ...)
 *
 *  Esta prueba codifica ESA regla contra el texto de la guía, en vez de ejecutar
 *  el script: ejecutarlo tarda minutos y, con `--falso`, termina en código 1 por
 *  el veredicto de la muestra sintética (1 fila no mapeable), que es un
 *  resultado legítimo y no un fallo de invocación. Lo que se protege acá es lo
 *  que falló: que la guía mande un comando que el parser rechaza. */

const GUIA = 'docs/operacion/entrega-flota-piloto.md';

/** Los comandos de `verificar-local.mjs` que la guía manda ejecutar, uno por
 *  cada bloque de código en línea (`` `...` ``) que lo invoque. */
function comandosDeLaGuia(): string[] {
  const texto = readFileSync(new URL(`../../../../${GUIA}`, import.meta.url), 'utf8');
  return [...texto.matchAll(/`([^`]*verificar-local\.mjs[^`]*)`/g)].map(([, c]) => c.trim());
}

describe('A49-OP-01 · el comando de la guía del piloto es una invocación aceptada', () => {
  it('la guía manda al menos un comando de verificar-local.mjs', () => {
    expect(comandosDeLaGuia().length).toBeGreaterThan(0);
  });

  it('todo `--en-seco` de la guía trae `--falso` o un <mapeos.json>', () => {
    const malos = comandosDeLaGuia().filter((cmd) => {
      if (!cmd.includes('--en-seco')) return false;
      return !cmd.includes('--falso') && !/\.json\b/.test(cmd);
    });
    expect(
      malos,
      'verificar-local.mjs:128 sale con código 2 sin hacer nada: `--en-seco` necesita `--falso` o un <mapeos.json>',
    ).toEqual([]);
  });

  it('ningún comando de la guía usa una bandera que el script no conozca', () => {
    const CONOCIDAS = new Set(['--falso', '--en-seco', '--desgloses', '--muestra-tms']);
    const desconocidas = comandosDeLaGuia().flatMap((cmd) =>
      cmd.split(/\s+/).filter((t) => t.startsWith('--') && !CONOCIDAS.has(t)),
    );
    expect(desconocidas, 'verificar-local.mjs:127 rechaza cualquier bandera fuera de su lista').toEqual([]);
  });

  it('la regla que se codifica sigue viva en el script', () => {
    const src = readFileSync(new URL('../../../../scripts/tms/verificar-local.mjs', import.meta.url), 'utf8');
    expect(src).toMatch(/enSeco && !falso && !archivoMapeos/);
  });
});
