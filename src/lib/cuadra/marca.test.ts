import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { sinComentarios, fuentesDeProduccion } from '@/lib/pruebas/codigo';

// ═══════════════════════════════════════════════════════════════════════════
// EL PRODUCTO SE LLAMABA DE DOS FORMAS, Y EL OPERADOR LEÍA LAS DOS.
//
// El primer contacto de un operador con Likida son dos mensajes seguidos:
//
//   1. el aviso de privacidad → "Likida procesa esta información por cuenta
//      de la empresa, siguiendo sus instrucciones"
//   2. el saludo del agente   → "¡Hola! Soy Cuadra, te ayudo a liquidar…"
//
// Dos nombres para lo mismo, en la primera pantalla, ante alguien que no sabe
// nada del producto y que va a mandarle fotos de sus gastos. Un chofer que
// desconfía de a quién le está mandando sus tickets no manda tickets.
//
// `cuadra` es el nombre viejo del repo. Ya se había colado antes en el pie de
// cada PDF de liquidación (`cuadra.mx`, que además era un dominio de un
// tercero). Esta prueba vigila los textos que el CLIENTE lee.
//
// NO prohíbe la palabra en el código: los módulos viven en `lib/cuadra/`, los
// tipos se llaman `CuadraConfig` y las variables `CUADRA_*`. Renombrarlos sería
// un refactor enorme sin ningún beneficio para nadie. Lo que no puede pasar es
// que salga hacia afuera.
// ═══════════════════════════════════════════════════════════════════════════

describe('el producto se presenta con un solo nombre', () => {
  it('el agente se llama Likida, que es lo que dice el aviso', () => {
    const conv = sinComentarios(readFileSync('src/lib/cuadra/conv.ts', 'utf8'));
    expect(conv).toMatch(/agentName: 'Likida'/);
    expect(conv, 'volvió el nombre viejo al saludo del operador').not.toMatch(/agentName: 'Cuadra'/);
  });

  it('el pie del PDF también', () => {
    // El papel que el contralor archiva y que puede ver un tercero.
    const pdf = readFileSync('src/lib/cuadra/liquidacion/pdf.ts', 'utf8');
    expect(pdf).toMatch(/Generado por Likida/);
    expect(pdf).toContain("right('likida.ai'");
  });

  it('y lo que viaja hacia proveedores', () => {
    const or = sinComentarios(readFileSync('src/lib/llm/openrouter.ts', 'utf8'));
    expect(or).toMatch(/'X-Title': 'Likida'/);
  });

  it('ningún mensaje de WhatsApp se presenta con el nombre viejo', () => {
    // Los textos que salen por el chat. Se mira el CÓDIGO, no los comentarios:
    // los de arriba y los de `conv.ts` NOMBRAN 'Cuadra' para contar por qué se
    // quitó, y esa explicación es lo que impide que alguien lo reponga.
    const culpables = fuentesDeProduccion('src')
      .filter((f) => !f.includes('/lib/pruebas/'))
      .filter((f) => /Soy Cuadra|soy Cuadra|de Cuadra\b/.test(sinComentarios(readFileSync(f, 'utf8'))));
    expect(culpables, 'el nombre viejo volvió a un mensaje al operador').toEqual([]);
  });
});
