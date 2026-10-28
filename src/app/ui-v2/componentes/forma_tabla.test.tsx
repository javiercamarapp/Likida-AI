import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Campo, CampoTexto, Casilla, ESTILO_CONTROL, Selector } from '@/app/admin/ui/forma';
import { Switch } from './index';

// B.5: la piel v2 NO cambia ids, name ni roles de forma.tsx (contrato e2e).
describe('forma.tsx sigue igual (ids, name, roles)', () => {
  it('Campo / CampoTexto / Casilla / Selector conservan id=name y etiquetas', () => {
    const h = renderToStaticMarkup(
      <form>
        <Campo nombre="folio" etiqueta="Folio" requerido />
        <CampoTexto nombre="nota" etiqueta="Nota" />
        <Casilla nombre="interna" etiqueta="Interna" />
        <Selector nombre="tipo" etiqueta="Tipo" opciones={[{ valor: 'a', texto: 'A' }]} />
      </form>,
    );
    for (const n of ['folio', 'nota', 'interna', 'tipo']) {
      expect(h).toContain(`id="${n}"`);
      expect(h).toContain(`name="${n}"`);
      expect(h).toContain(`for="${n}"`);
    }
    expect(h).toContain('type="checkbox"');
    expect(h).toContain('value="1"');
  });
  it('el estilo del control en v1 sigue resolviendo a lo de siempre (fallbacks)', () => {
    expect(ESTILO_CONTROL.background).toBe('var(--campo-bg, var(--canvas))');
    expect(ESTILO_CONTROL.border).toBe('1px solid var(--input, var(--line))');
    expect(ESTILO_CONTROL.color).toBe('var(--ink)');
  });
});

describe('Switch', () => {
  it('checkbox real con role=switch, id=name, value=1 y etiqueta asociada', () => {
    const h = renderToStaticMarkup(<Switch nombre="avisos" etiqueta="Avisos por correo" ayuda="Uno al día" defaultChecked />);
    expect(h).toContain('role="switch"');
    expect(h).toContain('id="avisos"');
    expect(h).toContain('name="avisos"');
    expect(h).toContain('value="1"');
    expect(h).toContain('for="avisos"');
    expect(h).toContain('checked=""');
  });
});

describe('piel CSS', () => {
  const css = readFileSync(join(__dirname, '..', 'componentes.css'), 'utf8');
  it('toda regla de tabla y de campos cuelga de [data-ui="v2"] y no toca la clase .card en sí', () => {
    const tras = css.slice(css.indexOf('Piel de tablas y formularios'));
    const selectores = tras.split('{').map((b) => b.split('}').pop()!.trim()).filter((s) => s && !s.startsWith('@') && !s.startsWith('/*'));
    for (const s of selectores) expect(s, s).toContain('[data-ui="v2"]');
    expect(tras).not.toMatch(/\.card\s*\{/);
  });
  it('divisores sólidos, cifras tabulares, foco de 2 px', () => {
    expect(css).toContain('border-bottom: 1px solid var(--line)');
    expect(css).toContain('tabular-nums');
    expect(css).toContain('outline: 2px solid var(--ink)');
  });
});
