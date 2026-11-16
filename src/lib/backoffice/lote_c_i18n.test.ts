/* eslint-disable security/detect-non-literal-fs-filename -- lee archivos del propio repo */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { admin_backoffice as es } from '@/lib/i18n/es/admin_backoffice';
import { admin_backoffice as en } from '@/lib/i18n/en/admin_backoffice';
import { variablesDe } from '@/lib/i18n/traducir';

// LOTE C del Back-office: gastos., proveedores., comis., vend_pago. y tesor. Paridad exacta es/en y que cada clave que el código usa exista.
const PREFIJOS = /^(gastos|proveedores|comis|vend_pago|tesor)\./;
const claves = (d: Record<string, string>) => Object.keys(d).filter((k) => PREFIJOS.test(k)).sort();
const RAIZ = process.cwd();
const ARCHIVOS = [
  'src/lib/backoffice/gastos.ts', 'src/lib/backoffice/proveedores.ts', 'src/lib/backoffice/clasificador.ts', 'src/lib/backoffice/comisiones.ts',
  'src/lib/backoffice/pago-vendedor.ts', 'src/lib/backoffice/tesoreria.ts', 'src/lib/backoffice/utiles-c.ts',
  'src/app/admin/back-office/gastos/page.tsx', 'src/app/admin/back-office/gastos/acciones.ts', 'src/app/admin/back-office/gastos/forma-gasto.tsx',
  'src/app/admin/back-office/comisiones/page.tsx', 'src/app/admin/back-office/comisiones/acciones.ts', 'src/app/admin/back-office/comisiones/formas.tsx',
];

describe('diccionario del LOTE C', () => {
  it('es y en tienen EXACTAMENTE las mismas claves', () => {
    expect(claves(en)).toEqual(claves(es));
    expect(claves(es).length).toBeGreaterThan(200);
  });

  it('cada clave lleva las mismas {variables} en los dos idiomas y ningún texto está vacío', () => {
    const mal: string[] = [];
    for (const k of claves(es)) {
      const e = (es as Record<string, string>)[k];
      const i = (en as Record<string, string>)[k];
      if (!e.trim() || !i.trim()) mal.push(`${k}: vacío`);
      if (variablesDe(e).sort().join() !== variablesDe(i).sort().join()) mal.push(`${k}: variables distintas`);
    }
    expect(mal).toEqual([]);
  });

  it('toda clave que el código del lote nombra existe en el diccionario (sin huecos que se pinten como la clave)', () => {
    const faltan: string[] = [];
    for (const f of ARCHIVOS) {
      const src = readFileSync(join(RAIZ, f), 'utf8');
      for (const m of src.matchAll(/'((?:gastos|proveedores|comis|vend_pago|tesor)\.[a-z0-9_]+)'/g)) {
        if (!(m[1] in es)) faltan.push(`${f}: ${m[1]}`);
      }
    }
    expect([...new Set(faltan)]).toEqual([]);
  });

  it('los textos de apoyo de página caben en 140 caracteres y no llevan emojis', () => {
    for (const k of ['gastos.apoyo', 'comis.apoyo'] as const) expect(es[k].length).toBeLessThanOrEqual(140);
    const emoji = /\p{Extended_Pictographic}/u;
    for (const k of claves(es)) expect(emoji.test((es as Record<string, string>)[k]), k).toBe(false);
  });

  it('la regla de comisión no se teclea en ningún texto: los porcentajes salen de las constantes', () => {
    for (const k of claves(es)) expect((es as Record<string, string>)[k], k).not.toMatch(/\b(50|20) ?%/);
  });
});
