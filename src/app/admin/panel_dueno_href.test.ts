import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * El botón «Panel de dueño» sin `?rol=flota_admin` deja al superadmin en
 * /dashboard con su rol real, y el gate de onboarding (solo `flota_admin`)
 * no corre. selector-vista.tsx ya lo hace bien para la demo; estos archivos
 * eran el hueco.
 */
const ARCHIVOS = [
  'src/app/admin/consola.tsx',
  'src/app/admin/flotas/page.tsx',
  'src/app/admin/flotas/[id]/ficha.tsx',
  'src/app/admin/command-palette.tsx',
  'src/app/admin/corridas/[id]/page.tsx',
];

describe('Panel de dueño lleva ?rol=flota_admin', () => {
  it.each(ARCHIVOS)('%s', (rel) => {
    const src = readFileSync(resolve(process.cwd(), rel), 'utf8');
    const hrefs = [...src.matchAll(/\/dashboard\?tenant=\$\{[^}]+\}[^"'`]*/g)].map((m) => m[0]);
    const dueno = hrefs.filter((h) => !h.includes('rol=encargado') && !h.includes('rol=contador'));
    expect(dueno.length, `${rel} no arma el href de dueño`).toBeGreaterThan(0);
    for (const h of dueno) {
      expect(h, h).toMatch(/rol=flota_admin/);
    }
  });
});

