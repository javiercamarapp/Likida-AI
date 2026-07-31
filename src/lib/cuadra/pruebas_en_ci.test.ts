import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fuentesDeProduccion, sinComentarios } from '@/lib/pruebas/codigo';
import { readdirSync } from 'node:fs';

// ═══════════════════════════════════════════════════════════════════════════
// RONDA 7 · DOS PRUEBAS EXISTÍAN Y CI NO LAS CORRÍA NI UNA VEZ.
//
// `vitest.config.ts` exporta `CUADRA_COBERTURA=1` cuando hay `--coverage`, y dos
// pruebas de tiempo se saltan con esa bandera. La razón es buena: la
// instrumentación de v8 cobra por llamada, así que un umbral de milisegundos
// mediría la instrumentación y no el algoritmo.
//
// Lo que nadie ató: el workflow de CI corría SOLO `npm run test:coverage`. O sea
// que la guardia de ReDoS del buscador de fundamentos y la de crecimiento no
// lineal del deduplicador de CFDI —las dos que protegen contra que una entrada
// del operador cuelgue la función— vivían únicamente en la máquina de Javier.
//
// Una prueba que no corre en CI no es una prueba, es documentación con sintaxis
// de prueba. Y esta clase de hueco es invisible por construcción: la suite sale
// verde, el contador de pruebas se ve alto, y el número que baja —las saltadas—
// no lo mira nadie.
// ═══════════════════════════════════════════════════════════════════════════

const CI = readFileSync('.github/workflows/ci.yml', 'utf8');

/**
 * Archivos de prueba que SE SALTAN bajo `--coverage`.
 *
 * Se busca el SALTO, no la mención de la bandera, y sobre el código sin
 * comentarios: este mismo archivo nombra la bandera media docena de veces —en la
 * explicación y en el detector— sin saltarse nada. Buscar la mención lo detectaba
 * a sí mismo; buscar el salto en el archivo entero también, porque el comentario
 * de aquí arriba TIENE que poder escribir cómo se ve un salto para explicarlo.
 * Es la cuarta vez hoy que una red estructural se enreda con su propia prosa.
 */
const saltadas = (() => {
  const salida: string[] = [];
  const recorrer = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const ruta = `${dir}/${e.name}`;
      if (e.isDirectory()) recorrer(ruta);
      else if (e.name.endsWith('.test.ts') && /skipIf\([^)]*CUADRA_COBERTURA/.test(sinComentarios(readFileSync(ruta, 'utf8')))) salida.push(ruta);
    }
  };
  recorrer('src');
  return salida;
})();

describe('lo que se salta bajo cobertura sí corre en CI', () => {
  it('hay pruebas que se saltan (si no, esta red sobra y hay que borrarla)', () => {
    // Sin esto, el día que desaparezca el último `skipIf` la prueba de abajo
    // pasaría por vacía y nadie se enteraría de que ya no vigila nada.
    expect(saltadas.length).toBeGreaterThan(0);
  });

  it('cada una está cubierta por el paso sin instrumentar', () => {
    // El comando del workflow: `npx vitest run fundamento duplicados`. Los
    // argumentos son filtros por ruta, así que basta con que uno aparezca en la
    // ruta del archivo.
    const paso = CI.match(/npx vitest run ([^\n]+)/)?.[1] ?? '';
    const filtros = paso.trim().split(/\s+/).filter(Boolean);
    expect(filtros.length, 'no se encontró el paso `npx vitest run …` en ci.yml').toBeGreaterThan(0);

    const huerfanas = saltadas.filter((f) => !filtros.some((filtro) => f.includes(filtro)));
    expect(
      huerfanas,
      `estas pruebas se saltan bajo --coverage y CI no las corre por ningún otro lado:\n  ${huerfanas.join('\n  ')}\n\n` +
      'Añade su filtro al paso "Pruebas de tiempo (sin cobertura)" de .github/workflows/ci.yml, ' +
      'o quítales el skipIf. Una prueba que no corre en CI es documentación con sintaxis de prueba.',
    ).toEqual([]);
  });

  it('y CI sigue corriendo la suite con umbral', () => {
    // El paso nuevo NO sustituye al de cobertura: si alguien lo cambiara por un
    // `npm test` a secas, el umbral —que es la puerta— dejaría de evaluarse.
    expect(CI).toMatch(/npm run test:coverage/);
  });

  it('el ayudante de pruebas no se cuela al producto', () => {
    // `src/lib/pruebas/` existe solo para las redes estructurales. Si algo del
    // producto lo importara, `node:fs` entraría a un bundle del servidor.
    const importadores = fuentesDeProduccion('src')
      .filter((f) => !f.includes('/lib/pruebas/'))
      .filter((f) => /@\/lib\/pruebas\//.test(readFileSync(f, 'utf8')));
    expect(importadores, 'código de producción importando el ayudante de pruebas').toEqual([]);
  });
});
