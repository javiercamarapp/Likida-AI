import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { areaDeRuta } from '@/lib/auth/visibilidad';

// ═══════════════════════════════════════════════════════════════════════════
// UNA PANTALLA DE `operacion` NO PUEDE ENSEÑAR PESOS SIN GATEARLOS.
//
// El encargado (jefe de tráfico) ve el área `operacion` y NADA MÁS: la matriz
// de roles de la 0044 le da despachar y exportar, no ver finanzas. Por eso
// Cuadre, Rentabilidad, Cobranza y Facturación están en `dinero` y él no entra.
//
// Pero la clasificación es POR RUTA, y una ruta de operación puede tener una
// columna de dinero adentro. Cuando pasa, la puerta de `puedeVerRuta` no sirve
// de nada: ya lo dejó entrar. El 4-ago-2026 había CUATRO así, todas en
// producción:
//
//   · /dashboard/operadores — anticipo entregado, comprobado y % por chofer
//   · /dashboard/viajes     — anticipo por viaje, y sumado en un KPI
//   · /dashboard/documentos — el importe de cada comprobante
//   · /dashboard/analitica  — gasto por concepto de toda la flota
//
// Y el estándar ya estaba escrito: el despacho dice, textual, que el anticipo
// "se captura porque el motor lo necesita, pero no se lista ni se suma en
// ninguna columna". Cuatro pantallas lo listaban.
//
// LO QUE ESTA PRUEBA PRUEBA Y LO QUE NO. Es un escaneo de fuente: obliga a que
// una página de `operacion` que renderice dinero mencione la puerta. NO
// comprueba que CADA cifra esté detrás de ella —eso necesitaría renderizar la
// página con dos roles, y estas son Server Components con sesión—. Sirve para
// el caso que se dio cuatro veces: dinero puesto ahí sin acordarse del
// encargado. Es un despertador, no una demostración.
//
// EL HUECO QUE SE TAPÓ EL 4-AGO-2026: miraba SOLO `page.tsx`. Media docena de
// pantallas ya parten su render en un `vista.tsx` hermano —para poder mirarlo
// sin sesión— y la tabla que imprime el anticipo puede vivir allá. Mover una
// columna de pesos de un archivo al otro apagaba el despertador sin cambiar una
// sola cifra en pantalla. Los dos archivos se leen como UNA superficie: la
// puerta sigue viviendo en la página (es la que tiene el rol) y las cifras
// pueden estar en cualquiera de los dos.
// ═══════════════════════════════════════════════════════════════════════════

const DIR = fileURLToPath(new URL('.', import.meta.url));

/** Cómo se ve el dinero en una página: el formateador y el preset del KpiTile. */
const DINERO = /\bmxn\(|\busd\(|formato="mxn"|formato="usd"/;
/** La puerta. Basta con que la mencione: el detalle es del autor. */
const PUERTA = /puedeVerArea\(/;

/** La página y su `vista.tsx` hermano, concatenados. */
function superficie(archivos: string[]): string {
  return archivos.filter((f) => existsSync(f)).map((f) => readFileSync(f, 'utf8')).join('\n');
}

function rutasDeOperacion(): Array<{ ruta: string; archivos: string[] }> {
  const salida: Array<{ ruta: string; archivos: string[] }> = [];
  for (const entrada of readdirSync(DIR, { withFileTypes: true })) {
    if (!entrada.isDirectory()) continue;
    // `[id]` es dinámica: no está en el mapa de rutas y se gatea a mano dentro
    // de la página (`puedeVerArea(rol, 'dinero')`), que es lo correcto ahí.
    if (entrada.name.startsWith('[')) continue;
    const archivo = `${DIR}${entrada.name}/page.tsx`;
    if (!existsSync(archivo)) continue;
    const ruta = `/dashboard/${entrada.name}`;
    if (areaDeRuta(ruta) === 'operacion') {
      salida.push({ ruta, archivos: [archivo, `${DIR}${entrada.name}/vista.tsx`] });
    }
  }
  // La raíz también es `operacion`.
  salida.push({ ruta: '/dashboard', archivos: [`${DIR}page.tsx`, `${DIR}inicio-operacion.tsx`] });
  return salida;
}

const PAGINAS = rutasDeOperacion();

describe('pantallas de operación y las cifras de dinero', () => {
  it('encuentra las páginas de operación (si no, la prueba no está mirando nada)', () => {
    expect(PAGINAS.length).toBeGreaterThan(5);
  });

  for (const { ruta, archivos } of PAGINAS) {
    const fuente = superficie(archivos);
    if (!DINERO.test(fuente)) continue;

    it(`${ruta} enseña pesos, así que tiene que gatearlos con puedeVerArea`, () => {
      expect(fuente).toMatch(PUERTA);
      // Y con el área correcta: gatear por 'administracion' aquí dejaría fuera
      // al contador, que sí ve dinero.
      expect(fuente).toMatch(/puedeVerArea\(\s*rol\s*,\s*'dinero'\s*\)/);
    });
  }
});
