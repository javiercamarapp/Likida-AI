import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// AUDITORÍA 18, MEDIO (M6) — la pantalla citaba el art. 32, que es la
// numeración de la LFPDPPP abrogada (2010). Los plazos ARCO en la ley de 2025
// son el art. 31 (la documentación interna:48). Se lee el
// fuente, como en `login/no_autoregistro.test.ts`: la página es un server
// component con sesión y no se monta suelta.
const PAGINA = readFileSync(fileURLToPath(new URL('./page.tsx', import.meta.url)), 'utf8');

// Desde i18n P3 el texto visible vive en el diccionario es (`src/lib/i18n/es/dinero.ts`), no en la página.
// La ruta la arma `import.meta.url`, no entrada de nadie.
// eslint-disable-next-line security/detect-non-literal-fs-filename
const DICCIONARIO = readFileSync(fileURLToPath(new URL('../../../lib/i18n/es/dinero.ts', import.meta.url)), 'utf8');

describe('/dashboard/arco cita la ley vigente (M6)', () => {
  it('no queda ninguna referencia al art. 32 (ley abrogada)', () => {
    expect(PAGINA + DICCIONARIO.split('\n').filter((l) => l.includes("'arco.")).join('\n')).not.toMatch(/art\.?\s*32/i);
  });
  it('el texto visible funda los 20 días hábiles en el art. 31', () => {
    expect(DICCIONARIO).toContain('LFPDPPP art. 31: 20 días hábiles');
  });
});
