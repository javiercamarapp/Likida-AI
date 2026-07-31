import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { mxn, litros, fechaMx } from './formato';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 7 · MEDIO REINCIDENTE POR TERCERA RONDA — y el número CRECÍA:
//
//     ronda 6 →  3 copias de `mxn()` escritas a mano
//     ronda 7 →  8
//     31-jul  → 11
//
// Siete de ellas eran la misma línea, repetida en cada archivo que imprime
// dinero que el contralor lee: el PDF, el resumen de WhatsApp, el panel, el
// aviso del tope del 15%, los acreditables y el motor.
//
// Que fueran idénticas no era defensa: el hallazgo gemelo de `litros()` YA se
// divergió una vez —el panel decía "1,235 L" donde el PDF decía "1,234.56 L"—.
// Una cifra fiscal que se lee distinta en dos pantallas se lee como dos
// cálculos distintos.
// ═══════════════════════════════════════════════════════════════════════════

describe('el formato del dinero', () => {
  it('es el que espera un contador mexicano', () => {
    expect(mxn(1234.5)).toBe('$1,234.50');
    expect(mxn(0)).toBe('$0.00');
    expect(mxn(839.7)).toBe('$839.70');
  });

  it('un negativo se ve como negativo', () => {
    // El operador que puso de su bolsa lee un número en rojo, no un paréntesis
    // contable que no todo el mundo interpreta igual.
    expect(mxn(-1250)).toContain('-');
    expect(mxn(-1250)).toContain('1,250.00');
  });

  it('redondea a centavos, que es lo que existe en un CFDI', () => {
    expect(mxn(0.005)).toBe('$0.01');
  });

  it('litros: hasta dos decimales, sin rellenar ceros', () => {
    expect(litros(1234.56)).toBe('1,234.56 L');
    expect(litros(200)).toBe('200 L');
    // El motor redondea a dos decimales; esto solo evita que un
    // 1234.5600000001 de coma flotante salga con tres cifras.
    expect(litros(1234.5600000001)).toBe('1,234.56 L');
  });

  it('fecha: el cierre nocturno NO se pasa al día siguiente', () => {
    // 31-jul 19:30 en México (CST, UTC−6) = 01:30 UTC del 1-ago.
    expect(fechaMx('2026-08-01T01:30:00.000Z')).toContain('31');
    expect(fechaMx('2026-08-01T01:30:00.000Z')).toContain('jul');
  });
});

describe('NO puede volver a haber una copia a mano', () => {
  // LA RED QUE FALTABA, y es la razón por la que el hallazgo sobrevivió tres
  // rondas: cada vez se arreglaban las copias conocidas, nadie impedía la
  // siguiente, y al archivo nuevo le salía la suya. Esto lo mide sobre el
  // código, no sobre una lista escrita a mano que también se desactualiza.
  // SE MIRA EL CÓDIGO, NO LOS COMENTARIOS. La primera versión hacía grep del
  // literal sobre el archivo entero y se rompió con su propio comentario: el
  // encabezado de `dashboard/formato.ts` CITA `toLocaleString('es-MX')` para
  // contar la historia del hallazgo. Una prueba que prohíbe hablar del bug que
  // vigila obliga a borrar justo la explicación que hace falta para no repetirlo.
  const sinComentarios = (src: string) => src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

  const archivos = execSync(
    `grep -rl "toLocaleString('es-MX'" src/ --include='*.ts' --include='*.tsx' || true`,
    { encoding: 'utf8' },
  ).split('\n').filter(Boolean);

  it('solo `formato.ts` formatea cifras mexicanas', () => {
    const fuera = archivos
      .filter((f) => !f.includes('lib/formato.ts') && !f.includes('.test.'))
      .filter((f) => /toLocaleString\('es-MX'/.test(sinComentarios(readFileSync(f, 'utf8'))));
    expect(
      fuera,
      `estos archivos formatean por su cuenta en vez de usar formato.ts:\n${fuera.join('\n')}`,
    ).toEqual([]);
  });

  it('y `formato.ts` no importa NADA, para que el motor pueda usarlo', () => {
    // `engine.ts` es puro y sin I/O, y `pdf.ts` viaja en el bundle del webhook.
    // Si el formato viviera en `utils.ts` —que importa clsx y tailwind-merge
    // para `cn()`— los dos arrastrarían el sistema de clases de Tailwind. Hoy el
    // tree-shaking lo salva; un archivo sin imports no depende de la suerte.
    const fuente = readFileSync('src/lib/formato.ts', 'utf8');
    expect(fuente).not.toMatch(/^\s*import\s/m);
  });
});
