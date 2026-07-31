import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { sinComentarios, fuentesDeProduccion } from '@/lib/pruebas/codigo';

// ═══════════════════════════════════════════════════════════════════════════
// RONDA 7 · DOS ORÍGENES PARA LA POLÍTICA DE GASTOS, Y EL MUERTO ERA EL QUE
// MÁS PARECÍA EL VIVO.
//
// `politica_gasto` es una tabla con una columna `tope_monto` por concepto y un
// `requiere_cfdi`. Se llama como lo que hace. El seed la llenaba con topes y
// afirmaba por escrito que "el motor de cuadre usa tope_monto y requiere_cfdi".
//
// No lo usa. El motor lee `tenant.config.politica`. `getPolitica` —el único
// lector de la tabla— no tenía un solo llamador.
//
// El daño no es el código muerto: es el señuelo. Un contralor que quiera bajar
// el tope de diésel de su flota abre Supabase, encuentra EXACTAMENTE la tabla
// que busca, la edita, y las liquidaciones siguen aprobando cargas por encima
// del tope. Sin error, sin aviso, y creyendo que su política está puesta.
//
// Se nota en las propias filas del seed: ahí el viático se llama `viaticos` y en
// la config viva `alimentacion`. Las dos listas ya se habían separado.
// ═══════════════════════════════════════════════════════════════════════════

const src = (f: string) => readFileSync(f, 'utf8');

describe('la política de gastos tiene un solo origen', () => {
  it('nada en `src/` lee la tabla `politica_gasto`', () => {
    // CÓDIGO, no comentarios: `repo.ts` NOMBRA la tabla para explicar por qué se
    // borró su lector, y esa explicación es lo que impide que alguien la vuelva
    // a cablear. Una prueba que la prohibiera obligaría a borrarla.
    const lectores = fuentesDeProduccion('src')
      .filter((f) => /politica_gasto/.test(sinComentarios(src(f))));
    expect(
      lectores,
      'la política viva es `tenant.config.politica`. Un segundo origen que además ' +
      'SE LLAMA como el concepto es la peor clase de duda: el contralor edita el ' +
      'que parece y liquida el que no.',
    ).toEqual([]);
  });

  it('el motor la recibe de la config, que es el origen vivo', async () => {
    const { DEMO_CONFIG } = await import('./config');
    const desdeDb = src('src/lib/cuadra/cuadre/desde_db.ts');

    expect(desdeDb).toMatch(/politica: config\.politica/);
    expect(DEMO_CONFIG.politica.find((p) => p.concepto === 'diesel')?.topeMonto).toBe(4000);
  });

  it('y el seed ya no afirma que el motor lee la tabla', () => {
    // El comentario mentía, que es peor que no estar: mandaba a editar el sitio
    // equivocado con la autoridad de estar escrito en el repo.
    const seed = src('supabase/seed.sql');
    expect(seed).not.toMatch(/El motor de cuadre usa `tope_monto`/);
    expect(seed).toMatch(/NO LA LEE NADIE/);
  });
});
