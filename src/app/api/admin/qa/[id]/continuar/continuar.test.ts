// ═══════════════════════════════════════════════════════════════════════════
// EL NÚMERO QUE NEXT OBLIGA A ESCRIBIR DOS VECES.
//
// `export const maxDuration` de una ruta tiene que ser un LITERAL: Next lee la
// config de segmento con un análisis estático del módulo —no lo ejecuta— y un
// identificador importado revienta el build con «Unknown identifier … at
// "maxDuration"». Eso pasó de verdad al escribir esta ruta: el `npm run build`
// se cayó con «Invalid segment configuration export detected» y el motivo real
// estaba diez líneas más arriba en el log.
//
// La cura obligada —escribir 300 a mano— crea el problema de siempre: dos
// números que dicen lo mismo y pueden separarse sin que nadie se entere. Si
// alguien subiera el `maxDuration` de la ruta a 600 sin mover
// `MAX_DURATION_PASADA_S`, el motor seguiría cortando a los 255 s y la mitad
// del presupuesto se tiraría; si lo BAJARA, Vercel mataría la invocación antes
// de que la pasada alcanzara a escribir su corte y a soltar la llave — que es
// justo el fallo mudo que este carril existe para no tener.
//
// Así que se comparan, leyendo el archivo. No es elegante; es verificable.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { MAX_DURATION_PASADA_S, TECHO_PASADA_MS, MARGEN_PASADA_MS } from '@/lib/admin/qa-tipos';

const RUTA = 'src/app/api/admin/qa/[id]/continuar/route.ts';

describe('el maxDuration de la ruta y el techo del motor son el MISMO número', () => {
  test('el literal del archivo es exactamente MAX_DURATION_PASADA_S', () => {
    const fuente = readFileSync(RUTA, 'utf8');
    const m = fuente.match(/^export const maxDuration = (\d+);$/m);
    expect(m, 'la ruta tiene que declarar `export const maxDuration = <número>;`').not.toBeNull();
    expect(Number(m![1])).toBe(MAX_DURATION_PASADA_S);
  });

  test('sigue siendo un literal — un identificador importado tumba el build', () => {
    const fuente = readFileSync(RUTA, 'utf8');
    // Lo que NO puede volver: `export const maxDuration = ALGUNA_CONSTANTE;`.
    expect(fuente).not.toMatch(/^export const maxDuration = [A-Za-z_]/m);
  });

  test('el reloj de la pasada se toma de TECHO_PASADA_MS, no de una resta suelta', () => {
    const fuente = readFileSync(RUTA, 'utf8');
    expect(fuente).toContain('const venceEn = Date.now() + TECHO_PASADA_MS;');
    // Y ese techo es el maxDuration menos el margen del cierre — el margen que
    // qa-tipos.test.ts compara contra la cola que tiene que pagar.
    expect(TECHO_PASADA_MS).toBe(MAX_DURATION_PASADA_S * 1_000 - MARGEN_PASADA_MS);
  });
});
