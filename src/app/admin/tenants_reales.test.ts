import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 10, ALTO — "La consola de Javier le dice que tiene 1 flota.
// Tiene 0."
//
// Cuatro afirmaciones estáticas en el panel cuya premisa es NUNCA INVENTAR
// UNA CIFRA (CLAUDE.md): "Con 1 flota dada de alta…", "solo existe el
// tenant demo", "hoy Likida tiene 1 flota" y "Flota (solo el demo)" — texto
// fijo, sin relación con `r.tenants` (el conteo real de `getResumenNegocio`).
// El 4-ago-2026 la base quedó en CERO tenants y las cuatro pantallas
// siguieron afirmando que había una.
//
// Se prueba contra el CÓDIGO FUENTE de los cuatro archivos reales (mismo
// patrón que `foto_no_expuesta.test.ts`), no un mock: lo que falla aquí es
// exactamente lo que un `grep` sobre el repo real encontraría.
// ═══════════════════════════════════════════════════════════════════════════

function leer(ruta: string): string {
  return readFileSync(fileURLToPath(new URL(ruta, import.meta.url)), 'utf8');
}

const CRECIMIENTO = leer('./crecimiento/page.tsx');
const ANALITICA = leer('./analitica/page.tsx');
// El Inicio de /admin vive en `consola.tsx` desde el 14-ago-2026 (page.tsx
// quedó como puro gateo, convención de inicio-contenido.tsx para que el
// preview headless monte el componente REAL) — se vigila el archivo donde la
// etiqueta REALMENTE vive, no el cascarón.
const ADMIN = leer('./consola.tsx');
const EJECUTIVO = leer('./ejecutivo/page.tsx');

describe('admin/crecimiento: el conteo de flotas ya no es texto fijo', () => {
  it('el H1 no dice "Con 1 flota dada de alta" sin condición', () => {
    expect(CRECIMIENTO).not.toMatch(/Con 1 flota dada de alta/);
  });

  it('el párrafo no afirma "solo existe el tenant demo" sin comprobarlo', () => {
    // La forma exacta del bug: la frase del demo pegada, en la misma línea,
    // a la continuación del párrafo — sin ningún operador ternario de por
    // medio, texto plano incondicional.
    expect(CRECIMIENTO).not.toMatch(
      /No hay historial de altas de flota que graficar \(solo existe el tenant demo\), y Likida no/,
    );
    // Puede seguir diciéndolo, pero solo colgando de una condición sobre el
    // conteo real (y comprobado contra el id del tenant demo, no supuesto).
    expect(CRECIMIENTO).toMatch(/r\.tenants === 0/);
    expect(CRECIMIENTO).toMatch(/esSoloDemo/);
  });
});

describe('admin/analitica: "hoy Likida tiene 1 flota" ya lee el conteo real', () => {
  it('no queda el "1" fijo en esa frase', () => {
    expect(ANALITICA).not.toMatch(/hoy Likida tiene 1 flota/);
  });

  it('usa r.tenants en su lugar', () => {
    expect(ANALITICA).toMatch(/hoy Likida tiene \{r\.tenants\}/);
  });
});

describe('admin/consola.tsx y admin/ejecutivo: "Flota (solo el demo)" ya no es incondicional', () => {
  for (const [nombre, src] of [['admin/consola.tsx', ADMIN], ['admin/ejecutivo/page.tsx', EJECUTIVO]] as const) {
    it(`${nombre}: la etiqueta ya no es "r.tenants <= 1 ? 'Flota (solo el demo)'"`, () => {
      // Esa era la forma exacta del bug: con 0 tenants, `r.tenants <= 1` es
      // verdadero y el tile decía "0 — Flota (solo el demo)".
      expect(src).not.toMatch(/r\.tenants <= 1 \? 'Flota \(solo el demo\)'/);
    });

    it(`${nombre}: con 0 tenants la etiqueta no puede seguir diciendo "solo el demo"`, () => {
      // Se evalúa la MISMA expresión que el JSX usa para decidir la etiqueta,
      // con r.tenants en 0 — el escenario real del 4/5-ago-2026 — y se
      // comprueba que no cuela "demo" en el resultado.
      const match = src.match(/etiqueta=\{([^}]*'Flota[^}]*)\}/);
      expect(match, `no se encontró la etiqueta de KpiTile en ${nombre}`).not.toBeNull();
      const expr = match![1];
      // Evaluar la expresión JSX real extraída del archivo, con r.tenants=0
      // y sin tenant demo, es la forma más directa de probar el caso exacto
      // del reporte sin renderizar todo el árbol de la página.
      const evaluar = new Function('r', 'esSoloDemo', `return (${expr});`);
      const resultado = evaluar({ tenants: 0, flotas: [] }, false);
      expect(resultado).not.toMatch(/demo/i);
    });
  }
});

// AUDITORÍA 24, ADM-5 (MEDIO) — "Likida sigue con solo el tenant demo" y
// "Cifras reales, no de ejemplo…" en consola.tsx (y la MISMA alerta en
// calcular-alertas.ts) usaban `r.tenants <= 1`: con el PRIMER cliente real
// (1 tenant, pero NO el demo) seguían afirmando "solo el demo". El criterio
// correcto es `esSoloDemo` — comprobado contra el id real del tenant demo,
// no contra "hay como máximo uno". Ver calcular-alertas.test.ts para el
// caso funcional (llama a `calcularAlertas` de verdad).
const CALCULAR_ALERTAS = leer('./calcular-alertas.ts');

describe('admin/consola.tsx y calcular-alertas.ts: "solo el tenant demo" ya no es r.tenants <= 1', () => {
  it('consola.tsx: el párrafo "Cifras reales" ya no cuelga de `r.tenants <= 1`', () => {
    expect(ADMIN).not.toMatch(/\{r\.tenants <= 1 && \(/);
    expect(ADMIN).toMatch(/\{esSoloDemo && \(/);
  });

  it('calcular-alertas.ts: la alerta "solo el tenant demo" ya no cuelga de `r.tenants <= 1`', () => {
    expect(CALCULAR_ALERTAS).not.toMatch(/if \(r\.tenants <= 1\)/);
    expect(CALCULAR_ALERTAS).toMatch(/esSoloDemo/);
  });
});
