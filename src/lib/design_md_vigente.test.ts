/* eslint-disable security/detect-non-literal-fs-filename -- lee fuentes del propio repo */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// F16: DESIGN.md v4 no puede volver a decir una tipografía que el código ya no carga (deriva medida: decía Inter y el
// layout cargaba otra cosa).
const RAIZ = process.cwd();
const diseno = readFileSync(join(RAIZ, 'DESIGN.md'), 'utf8');
const vigente = diseno.split('# Sistema v3.1 (historial)')[0];
const layout = readFileSync(join(RAIZ, 'src/app/layout.tsx'), 'utf8');
const fuentes = readFileSync(join(RAIZ, 'src/app/ui-v2/fonts.css'), 'utf8');

describe('DESIGN.md v4', () => {
  it('declara la versión y sus fuentes de verdad', () => {
    expect(diseno).toMatch(/^# Likida — Sistema de diseño v4/);
    for (const f of ['src/app/ui-v2/tokens.css', 'src/app/ui-v2/fonts.css', 'src/app/layout.tsx']) expect(vigente).toContain(f);
  });
  it('la tipografía vigente coincide con lo que carga el código', () => {
    expect(fuentes).toContain('Hanken Grotesk UI');
    expect(vigente).toContain('Hanken Grotesk');
    expect(layout).toContain('IBM_Plex_Mono');
    expect(vigente).toContain('IBM Plex Mono');
    expect(layout).not.toMatch(/from 'next\/font\/google'.*Inter\b/);
  });
  it('recoge las decisiones del dueño que ya mandan', () => {
    expect(vigente).toMatch(/Botón primario NEGRO/i);
    expect(vigente).toContain('Ejemplo');
  });
  it('los archivos que cita existen', () => {
    for (const f of ['src/app/ui-v2/tokens.css', 'src/app/ui-v2/fonts.css', 'src/app/ui-v2/componentes/CATALOGO-L7.md', 'src/app/ui-v2/graficas']) {
      expect(() => readFileSync(join(RAIZ, f).endsWith('graficas') ? join(RAIZ, 'src/app/ui-v2/graficas/index.ts') : join(RAIZ, f))).not.toThrow();
    }
  });
});
