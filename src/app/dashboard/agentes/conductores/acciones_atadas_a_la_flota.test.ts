/* eslint-disable security/detect-non-literal-fs-filename -- lee fuentes fijas del propio repo. */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// A37-S13-02: las acciones del Conductor no re-resuelven la flota «a ciegas».
// Solo el render llama `resolverTenantEfectivo`; toda acción usa
// `resolverTenantAtado(..., tenantId)` y se niega si la flota cambió.
const PAGINAS = [
  'src/app/dashboard/agentes/conductores/page.tsx',
  'src/app/dashboard/agentes/conductores/sitios/page.tsx',
  'src/app/dashboard/agentes/conductores/configuracion/page.tsx',
];
const sinComentarios = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('A37-S13-02 · acciones del Conductor atadas a la flota renderizada', () => {
  for (const ruta of PAGINAS) {
    it(`${ruta}: una sola resolución libre (la del render) y las acciones usan resolverTenantAtado`, () => {
      const codigo = sinComentarios(readFileSync(join(process.cwd(), ruta), 'utf8'));
      const libres = codigo.match(/await resolverTenantEfectivo\(/g) ?? [];
      const atadas = codigo.match(/await resolverTenantAtado\(/g) ?? [];
      expect(libres).toHaveLength(1);
      expect(atadas.length).toBeGreaterThanOrEqual(3);
      expect(codigo).toContain('MENSAJE_FLOTA_CAMBIO');
    });
  }
});
