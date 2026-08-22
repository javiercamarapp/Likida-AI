import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { autorizaCron } from './cron';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA PROD (22-ago-2026) · SEG-5 — el `!==` que decía cuánto acertaste.
//
// `CRON_SECRET` es lo único que separa a cualquiera que conozca la URL de
// disparar la escalación, la facturación o la purga. Se comparaba con `!==`,
// que sale en el primer byte distinto: el tiempo de respuesta filtra el largo
// del prefijo correcto y permite reconstruirlo byte por byte.
// ═══════════════════════════════════════════════════════════════════════════

const SECRETO = 'un-secreto-de-produccion-largo';

describe('autorizaCron', () => {
  it('acepta el secreto correcto', () => {
    expect(autorizaCron(`Bearer ${SECRETO}`, SECRETO)).toBe(true);
  });

  it('rechaza uno distinto, uno con prefijo correcto, y el esquema equivocado', () => {
    expect(autorizaCron('Bearer otra-cosa', SECRETO)).toBe(false);
    expect(autorizaCron(`Bearer ${SECRETO.slice(0, -1)}`, SECRETO)).toBe(false);
    expect(autorizaCron(`Bearer ${SECRETO}x`, SECRETO)).toBe(false);
    expect(autorizaCron(SECRETO, SECRETO)).toBe(false);
    expect(autorizaCron(`Basic ${SECRETO}`, SECRETO)).toBe(false);
  });

  it('sin cabecera o sin secreto: false, y NO lanza (un 500 aquí sería un 401 mal dado)', () => {
    expect(autorizaCron(null, SECRETO)).toBe(false);
    expect(autorizaCron(`Bearer ${SECRETO}`, '')).toBe(false);
    expect(() => autorizaCron('', '')).not.toThrow();
  });

  it('un largo distinto NO lanza: por eso los dos lados pasan por SHA-256 antes', () => {
    // `timingSafeEqual` con buffers de distinto tamaño tira RangeError — y esa
    // excepción volvería a filtrar el largo, además de tumbar la ruta.
    expect(autorizaCron('Bearer x', SECRETO)).toBe(false);
    expect(autorizaCron(`Bearer ${'y'.repeat(5_000)}`, SECRETO)).toBe(false);
  });
});

describe('las CINCO rutas de cron usan esta puerta', () => {
  const RAIZ = join(__dirname, '..', '..', '..');
  const CRONS = join(RAIZ, 'src/app/api/cron');

  it('ninguna compara el secreto con !== o ===', () => {
    const rutas = readdirSync(CRONS).filter((d) => !d.includes('.'));
    expect(rutas.length).toBeGreaterThanOrEqual(5);

    const culpables: string[] = [];
    for (const r of rutas) {
      let texto: string;
      try { texto = readFileSync(join(CRONS, r, 'route.ts'), 'utf8'); } catch { continue; }
      if (!texto.includes('CRON_SECRET')) continue;
      // La comparación directa contra el secreto, en cualquiera de sus formas.
      if (/[!=]==\s*`Bearer \$\{secreto\}`/.test(texto)) culpables.push(r);
      if (!texto.includes('autorizaCron')) culpables.push(`${r} (no usa autorizaCron)`);
    }
    expect(culpables).toEqual([]);
  });
});
