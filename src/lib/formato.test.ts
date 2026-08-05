import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { sinComentarios } from '@/lib/pruebas/codigo';
import { execSync } from 'node:child_process';
import { mxn, litros, fechaMx, fechaHoraMx, round2 } from './formato';

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

// ═══════════════════════════════════════════════════════════════════════════
// LA HORA, no solo el día. La confirmación del chofer (mig. 0058) se decide por
// horas —el plazo de escalación son 5— y `fechaMx` solo imprime el día, así que
// "confirmó el 4 de agosto" no le sirve a nadie para decidir si cambia de
// personal. Es la misma función de siempre con hora, en la misma zona, en el
// mismo archivo: una hora formateada a mano en el componente es exactamente
// como se divergieron `mxn()` y `litros()` tres rondas seguidas.
// ═══════════════════════════════════════════════════════════════════════════
describe('fechaHoraMx: el día Y la hora del cliente', () => {
  it('las 20:00 de CDMX no saltan al día siguiente ni a otra hora', () => {
    expect(fechaHoraMx('2026-08-05T02:00:00.000+00:00')).toBe('04 ago 2026, 20:00');
  });

  it('la medianoche se imprime 00:00, no 24:00', () => {
    // `hour12: false` puede dar "24:00" según la versión de ICU, y las 24:00 no
    // son una hora que exista: por eso el `hourCycle: 'h23'` explícito.
    expect(fechaHoraMx('2026-08-05T06:00:00.000+00:00')).toBe('05 ago 2026, 00:00');
  });

  it('a un valor de SOLO FECHA no se le inventa una hora', () => {
    // No tiene hora que enseñar, y convertirlo además lo correría un día
    // (medianoche UTC leída en UTC−6 cae el día anterior).
    expect(fechaHoraMx('2026-08-04')).toBe('04 ago 2026');
  });

  it('ausente o ilegible se pinta como guion, no como "Invalid Date"', () => {
    expect(fechaHoraMx(null)).toBe('—');
    expect(fechaHoraMx(undefined)).toBe('—');
    expect(fechaHoraMx('')).toBe('—');
    expect(fechaHoraMx('no es una fecha')).toBe('—');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 9, ALTO REINCIDENTE (arquitectura) — `round2()` reimplementado en
// CUATRO archivos de dinero (`engine.ts`, `analytics.ts`, `pagadero.ts`,
// `combustible.ts`), las cuatro copias idénticas y las cuatro con el MISMO
// bug: `Math.round(n * 100) / 100` redondea mal cuando el número no es
// representable exacto en punto flotante. `round2(1.005)` da `1`, no `1.01`
// —1.005 se guarda como 1.00499999999999989…, y `Math.round(100.4999…)` cae
// para abajo—. Ya lo había marcado la ronda 8 como advertencia y nadie lo
// atacó: por la regla del rubro, una advertencia que vuelve a ocurrir es un
// hallazgo, no una advertencia.
// ═══════════════════════════════════════════════════════════════════════════
describe('round2 — redondeo a centavos que no le cree a la coma flotante', () => {
  it('el caso que reprueba Math.round(n*100)/100 a secas', () => {
    expect(round2(1.005)).toBe(1.01);
  });

  it('otros valores de la misma familia (x.xx5) que la coma flotante representa mal', () => {
    expect(round2(35.645)).toBe(35.65);
    expect(round2(0.145)).toBe(0.15);
  });

  it('el caso común (nada especial en punto flotante) sigue redondeando normal', () => {
    expect(round2(1234.567)).toBe(1234.57);
    expect(round2(839.7)).toBe(839.7);
  });

  it('negativos', () => {
    expect(round2(-1.005)).toBe(-1.01);
  });

  it('cero y enteros no se mueven', () => {
    expect(round2(0)).toBe(0);
    expect(round2(500)).toBe(500);
  });
});

describe('NO puede volver a haber una copia de round2', () => {
  // Mismo mecanismo que el guardarraíl de `mxn()` de arriba: se mide el
  // código, no una lista escrita a mano. La ronda 9 encontró las cuatro
  // copias por `command grep`; esto asegura que una quinta no pase inadvertida.
  const archivos = execSync(
    `command grep -rl "function round2\\|const round2\\s*=" src/ --include='*.ts' || true`,
    { encoding: 'utf8' },
  ).split('\n').filter(Boolean);

  it('solo `formato.ts` define round2', () => {
    const fuera = archivos.filter((f) => !f.includes('lib/formato.ts') && !f.includes('.test.'));
    expect(
      fuera,
      `estos archivos reimplementan round2 en vez de importarlo de formato.ts:\n${fuera.join('\n')}`,
    ).toEqual([]);
  });
});

describe('NO puede volver a haber una copia a mano', () => {
  // LA RED QUE FALTABA, y es la razón por la que el hallazgo sobrevivió tres
  // rondas: cada vez se arreglaban las copias conocidas, nadie impedía la
  // siguiente, y al archivo nuevo le salía la suya. Esto lo mide sobre el
  // código, no sobre una lista escrita a mano que también se desactualiza.
  // SE MIRA EL CÓDIGO, NO LOS COMENTARIOS (`sinComentarios`). La primera versión
  // hacía grep del literal sobre el archivo entero y se rompió con su propio
  // comentario: el encabezado de `dashboard/formato.ts` CITA
  // `toLocaleString('es-MX')` para contar la historia del hallazgo. Una prueba
  // que prohíbe hablar del bug que vigila obliga a borrar justo la explicación
  // que hace falta para no repetirlo.
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
