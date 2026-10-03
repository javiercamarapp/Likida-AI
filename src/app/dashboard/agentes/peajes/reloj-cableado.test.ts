import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// ═══════════════════════════════════════════════════════════════════════════
// PRU-31C-A1 (auditorías 31-32, ALTO reincidente) — «se probó el parámetro y
// no el argumento».
//
// `barrerPorConciliar` sabe cortarse sola desde `54bddb2`, y su motor tiene
// arnés en `consolidado_barrido.test.ts`. Lo que NO tenía arnés era la única
// llamada de producción: borrar `{ venceEn: ahoraMs() + 25_000 }` de
// `page.tsx:234` COMPILA —la firma es `opts.venceEn ?? POSITIVE_INFINITY`— y
// devuelve el «Ejecutar ahora» de Peajes al estado previo a `54bddb2`: ~914 s
// nominales contra los 300 de techo, con **613 pruebas en verde**. Ninguna
// Server Action de `src/app/dashboard` declara `maxDuration`.
//
// Se afirma sobre el FUENTE, y se dice por qué: la acción es un cierre
// `'use server'` declarado DENTRO del componente de `page.tsx`, así que no hay
// nada importable que invocar. Es el mismo trato que `cobranza/reloj-corte.test.ts`
// le da a su acción hermana. El corte se hace sobre la EXPRESIÓN DE LA LLAMADA,
// no sobre el archivo entero: un comentario que mencione `venceEn`, o la misma
// línea movida a otro sitio, no lo satisfacen.
//
// Lo que esta prueba NO hace: ejecutar el barrido. Eso exige extraer la acción
// del componente, que es un refactor y no un parche.
// ═══════════════════════════════════════════════════════════════════════════

// Ruta LITERAL desde la raíz del repo, como `scripts/ci/deriva_sin_desplegar.test.ts`:
// un `fileURLToPath(new URL(...))` dispara `security/detect-non-literal-fs-filename`
// y el ratchet de lint no admite avisos nuevos.
const PAGE = readFileSync('src/app/dashboard/agentes/peajes/page.tsx', 'utf8');

/** La expresión de la llamada a `fn(`, desde el nombre hasta su paréntesis de
 *  cierre, equilibrando paréntesis. Sin esto, `toContain` sobre el archivo
 *  entero lo satisface cualquier otra línea que diga `venceEn`. */
function llamada(src: string, fn: string): string {
  const desde = src.indexOf(`${fn}(`);
  expect(desde, `no hay ninguna llamada a ${fn}(`).toBeGreaterThan(-1);
  let nivel = 0;
  for (let i = desde + fn.length; i < src.length; i++) {
    if (src[i] === '(') nivel++;
    else if (src[i] === ')') {
      nivel--;
      if (nivel === 0) return src.slice(desde, i + 1);
    }
  }
  throw new Error(`la llamada a ${fn}( no cierra`);
}

describe('Peajes "Ejecutar ahora": el reloj de corte llega al barrido (PRU-31C-A1)', () => {
  it('la llamada a barrerPorConciliar pasa venceEn', () => {
    const expr = llamada(PAGE, 'barrerPorConciliar');
    expect(
      expr,
      'sin `venceEn` el barrido vuelve a ~914 s nominales contra 300 de techo, y la '
        + 'plataforma lo mata a media cola dejando sellos escritos sin su línea',
    ).toMatch(/venceEn:/);
  });

  it('el reloj que se le pasa es un instante calculado, no un literal pegado', () => {
    const expr = llamada(PAGE, 'barrerPorConciliar');
    // `venceEn: 0` o `venceEn: undefined` satisfacen la prueba de arriba y
    // desarman el corte igual que borrarlo.
    expect(expr).toMatch(/venceEn:\s*ahoraMs\(\)\s*\+/);
  });

  it('el acuse declara lo que el reloj dejó fuera (REN-31C-C1)', () => {
    expect(PAGE).toMatch(/cortadosPorReloj/);
  });
});
