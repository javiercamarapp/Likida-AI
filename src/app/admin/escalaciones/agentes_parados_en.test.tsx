import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { crearTraductor } from '@/lib/i18n/traducir';
import { admin_inicio as es } from '@/lib/i18n/es/admin_inicio';
import { admin_inicio as en } from '@/lib/i18n/en/admin_inicio';
import { BloqueAgentesParados } from './agentes-parados';

// P11 Admin en inglés: el mismo componente, con el traductor en, dice lo mismo en inglés; sin traductor (pruebas, arneses) sigue en español.
it('sin traductor habla español y con el traductor en habla inglés, con las mismas cifras', () => {
  const t = crearTraductor('en', en, es).t;
  const enHtml = renderToStaticMarkup(<BloqueAgentesParados datos={null} cola={null} t={t} />);
  expect(enHtml).toContain('Agents that did not run, and why');
  expect(enHtml).toContain('this read failed');
  const esHtml = renderToStaticMarkup(<BloqueAgentesParados datos={null} cola={null} />);
  expect(esHtml).toContain('Agentes que no corrieron y por qué');
  expect(esHtml).not.toContain('Agents that did not run');
});
