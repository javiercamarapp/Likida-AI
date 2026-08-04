import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolverRango, urlDeRango, type Rango } from './global-filter';

// ═══════════════════════════════════════════════════════════════════════════
// EL FILTRO 7d/30d/Todo TIENE QUE RESPONDER A LOS TRES CLICS.
//
// Javier lo reportó el 4-ago-2026: en el recuadro central de /dashboard, la
// gráfica "Liquidaciones cerradas" no cambiaba al apretar 30d. Era la SEGUNDA
// vez que este mismo filtro se rompía igual.
//
// El mecanismo, las dos veces: la opción que ES el default se enlaza SIN
// `?rango=` (para dejar la URL limpia), y la página decide por su cuenta qué
// asumir cuando ese parámetro no viene. Cuando el default que declara el filtro
// y el que asume la página no coinciden, ese botón manda a la URL pelona, la
// página la lee como su propio default, y el pill salta de vuelta. /dashboard
// asumía '7' y le pasaba al filtro `pordefecto="30"`: 7d y Todo funcionaban,
// 30d no hacía nada.
//
// NO SE PRUEBA EL PARSER POR SU LADO NI LA URL POR EL SUYO — cada mitad estaba
// bien las dos veces. El bug vivía en el salto entre las dos, así que lo que se
// prueba es el VIAJE REDONDO: se construye el enlace de un botón y se vuelve a
// leer, para todas las combinaciones de opción y default.
// ═══════════════════════════════════════════════════════════════════════════

const RANGOS: Rango[] = ['7', '30', 'todo'];

describe('viaje redondo del filtro de rango', () => {
  for (const pordefecto of RANGOS) {
    for (const opcion of RANGOS) {
      it(`con default ${pordefecto}, el clic en ${opcion} aterriza en ${opcion}`, () => {
        const url = urlDeRango('/dashboard', opcion, pordefecto);
        // Lo que Next le pasaría a la página como `searchParams.rango`.
        const crudo = new URL(url, 'https://app.likida.ai').searchParams.get('rango') ?? undefined;
        expect(resolverRango(crudo, pordefecto).rango).toBe(opcion);
      });
    }
  }

  it('la opción por defecto se enlaza sin ?rango= (URL limpia)', () => {
    expect(urlDeRango('/dashboard', '7', '7')).toBe('/dashboard');
    expect(urlDeRango('/dashboard', '30', '30')).toBe('/dashboard');
  });

  it('no pierde los params que ya venían en la URL', () => {
    // Sin esto, cambiar de rango olvidaba de cuál flota se estaba hablando.
    const url = urlDeRango('/dashboard', '30', '7', { tenant: 'abc' });
    const p = new URL(url, 'https://app.likida.ai').searchParams;
    expect(p.get('tenant')).toBe('abc');
    expect(p.get('rango')).toBe('30');
    expect(urlDeRango('/dashboard', '7', '7', { tenant: 'abc' })).toBe('/dashboard?tenant=abc');
  });
});

describe('resolverRango', () => {
  it('sin parámetro devuelve el default de la página', () => {
    expect(resolverRango(undefined, '7').rango).toBe('7');
    expect(resolverRango(undefined, '30').rango).toBe('30');
  });

  it('un valor basura cae al default en vez de romper la pantalla', () => {
    expect(resolverRango('420', '30').rango).toBe('30');
    expect(resolverRango('', '7').rango).toBe('7');
  });

  it("'todo' no corta la ventana de las consultas", () => {
    expect(resolverRango('todo', '30').ventana).toBeUndefined();
    expect(resolverRango('7', '30').ventana).toBe(7);
    expect(resolverRango('30', '7').ventana).toBe(30);
  });

  it("con 'todo', ventanaDias cae al default de la página, no a un 7 fijo", () => {
    // /dashboard pedía 7 y /dashboard/analitica pedía 30 en ese caso. Fijarlo
    // en 7 le habría cambiado la consulta a analítica sin que nadie lo pidiera.
    expect(resolverRango('todo', '30').ventanaDias).toBe(30);
    expect(resolverRango('todo', '7').ventanaDias).toBe(7);
  });
});

// ── Que no vuelva a partirse en dos ────────────────────────────────────────
//
// El viaje redondo de arriba prueba el mecanismo, pero no puede impedir que
// alguien vuelva a declarar el default en dos lados. Eso lo impide la API —el
// filtro recibe el objeto entero de `resolverRango`, no dos props sueltas— y
// esta prueba vigila que nadie la desarme.

const PAGINAS = ['../../dashboard/page.tsx', '../../dashboard/analitica/page.tsx', '../page.tsx'];

describe('ninguna página vuelve a declarar el default por su cuenta', () => {
  for (const rel of PAGINAS) {
    const fuente = readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
    if (!fuente.includes('<GlobalFilter')) continue;

    it(`${rel} le pasa el objeto de resolverRango, no props sueltas`, () => {
      // El nombre de la variable da igual (/admin ya usaba `r` para su
      // resumen de negocio); lo que importa es que sea UN objeto, no dos props.
      expect(fuente).toMatch(/<GlobalFilter[^>]*\br=\{\w+\}/);
      expect(fuente).not.toMatch(/pordefecto=/);
      expect(fuente).not.toMatch(/activo=\{/);
    });

    it(`${rel} no parsea ?rango= a mano`, () => {
      // `sp?.rango === '30' ? … : '7'` escrito en la página es justo la línea
      // que se desincronizó del filtro las dos veces. Se busca el PARSEO del
      // parámetro, no el `rango === 'todo'` del render, que es legítimo y vive
      // en las tres.
      expect(fuente).not.toMatch(/sp\??\.?rango\s*===/);
      expect(fuente).toMatch(/resolverRango\(/);
    });
  }
});
