import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import AgentesError from './error';
import Loading from './loading';

// CT-CAL-06: los segmentos de agentes tienen su propia frontera de error y de carga.
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => undefined }) }));

describe('boundaries de /dashboard/agentes', () => {
  it('error.tsx es componente de cliente, avisa con role=alert, muestra el digest y ofrece Reintentar', () => {
    const fuente = readFileSync(join(__dirname, 'error.tsx'), 'utf8');
    expect(fuente.startsWith("'use client'")).toBe(true);
    const err = Object.assign(new Error('boom'), { digest: '1234567890' });
    const h = renderToStaticMarkup(<AgentesError error={err} reset={() => undefined} />);
    expect(h).toContain('role="alert"');
    expect(h).toContain('1234567890');
    expect(h).toContain('Reintentar');
  });
  it('sin digest no pinta la línea del código', () => {
    const h = renderToStaticMarkup(<AgentesError error={new Error('x')} reset={() => undefined} />);
    expect(h).not.toContain('Código del incidente');
  });
  it('loading.tsx pinta un esqueleto (no vacío)', () => {
    expect(renderToStaticMarkup(<Loading />).length).toBeGreaterThan(50);
  });
});
