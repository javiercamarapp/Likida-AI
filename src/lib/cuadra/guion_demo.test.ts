import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// ═══════════════════════════════════════════════════════════════════════════
// EL GUION DEL DEMO PROMETÍA UNA CIFRA QUE EL PRODUCTO DEJÓ DE DAR.
//
// `GUION_DEMO.md` era del 25-jul y el producto avanzó 182 commits. Decía:
//
//     "Arriba, en grande: IEPS de diésel acreditable, IVA acreditable, peaje 50%"
//
// El IEPS EN PESOS se quitó a propósito: la fórmula sumaba el IEPS trasladado
// del CFDI, que no es el estímulo. El estímulo es cuota vigente × litros, la
// cuota la publica el DOF cada semana y pasó de $7.36 a $2.09 en cinco meses.
// La cifra vieja inflaba la propuesta ~30%.
//
// Un guion desincronizado no es un documento viejo: es a Javier diciendo en voz
// alta, frente al contralor, un número que la pantalla no va a enseñar.
//
// Esta prueba ata el guion a lo que el panel de verdad pinta.
// ═══════════════════════════════════════════════════════════════════════════

const GUION = readFileSync('GUION_DEMO.md', 'utf8');
const PANEL = readFileSync('src/app/dashboard/page.tsx', 'utf8');

describe('el guion dice lo que el producto hace', () => {
  it('el panel enseña el diésel en LITROS, no en pesos', () => {
    // La fuente de verdad. Si esto cambia, el guion tiene que cambiar con ello.
    // Era `unidad="litros"` (prop del componente `Acred`, propio del panel);
    // al pasar /dashboard al design system compartido esa tarjeta es un
    // `KpiTile` con un preset de formato. Lo que se prueba es lo mismo —que la
    // cifra del estímulo salga en litros y no en pesos—, escrito como el panel
    // lo escribe hoy.
    expect(PANEL).toMatch(/formato="litros"/);
    expect(PANEL).toMatch(/litrosDiesel/);
    // Y que NO se cuele un preset de moneda en esa misma tarjeta: es
    // exactamente la regresión que este archivo existe para cazar.
    expect(PANEL).not.toMatch(/valor=\{acred\.litrosDiesel\}\s+formato="mxn"/);
  });

  it('y el guion lo dice en litros', () => {
    expect(GUION).toMatch(/elegible para el estímulo/i);
    expect(GUION).toMatch(/litros/);
  });

  it('el guion NO promete el IEPS en pesos', () => {
    // La frase exacta que traía, y cualquier variante que prometa el estímulo
    // como una cantidad de dinero.
    const promesas = [
      /IEPS de diésel acreditable/i,
      /IEPS acreditable[^\n]*\$/i,
    ];
    for (const p of promesas) {
      expect(GUION, `el guion volvió a prometer el IEPS en pesos: ${p}`).not.toMatch(p);
    }
  });

  it('explica POR QUÉ va en litros, no solo que va en litros', () => {
    // Sin la razón, se lee como una carencia. Con la razón, se lee como rigor —
    // y es la diferencia frente a un contralor.
    expect(GUION).toMatch(/DOF/);
    expect(GUION).toMatch(/su contador la tiene fechada|Él multiplica/);
  });
});

describe('el guion no manda abrir lo que está vacío', () => {
  it('avisa que las liquidaciones del historial son de siembra', () => {
    // Medido el 1-ago contra la base: las tres del seed tienen 0 comprobantes y
    // ningún PDF. Abrir su detalle en la sala enseña una pantalla vacía.
    expect(GUION).toMatch(/no tienen comprobantes|de siembra/i);
    expect(GUION).toMatch(/No las abras/i);
  });

  it('y manda abrir la que se creó en vivo, que sí tiene todo', () => {
    expect(GUION).toMatch(/liquidación que acabas de crear/i);
  });
});

describe('el guion trae lo que el demo necesita y nadie más va a recordar', () => {
  it('la prueba de dev_mode, ANTES del día del demo', () => {
    // Es lo único que puede dejar la sala en silencio sin un solo error.
    expect(GUION).toMatch(/dev_mode/);
    expect(GUION).toMatch(/sin rol en la app/i);
    expect(GUION).toMatch(/DÍAS ANTES/i);
  });

  it('y el bloque de descubrimiento, que es a lo que de verdad va', () => {
    // Javier lo dijo: "el demo es más que nada el primer approach, aún debemos
    // pedir sus necesidades". Un guion que solo enseña producto no lo cumple.
    expect(GUION).toMatch(/Preguntas de descubrimiento/i);
    expect(GUION).toMatch(/Lo que NO hay que prometer/i);
    // La más valiosa de las quince: casi nadie sabe la respuesta, y no saberla
    // ES la respuesta.
    expect(GUION).toMatch(/tickets de gasolina se les vencen/i);
  });
});
