import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }), usePathname: () => '/admin/aprobaciones', useSearchParams: () => new URLSearchParams() }));
import { EsqueletoTablaMaestra } from '../../ui-v2/esqueletos';
import { BarraVistasAprobaciones, PanelesAprobaciones, ProveedorVistas } from './vistas';

// F26 ronda 3 (Rovaq HB): las pestañas subrayadas con contador van ARRIBA de la tira de cifras, no debajo; los tres paneles siguen en el
// documento (los inactivos con `hidden`) para no perder un borrador al cambiar de vista.
it('la barra de vistas precede a la tira de cifras y los paneles la siguen', () => {
  const conteos = { aprobar: 3, enviar: 0 };
  const html = renderToStaticMarkup(
    <ProveedorVistas inicial="aprobar">
      <EsqueletoTablaMaestra titulo="Aprobaciones" filtros={<BarraVistasAprobaciones conteos={conteos} />} cifras={[{ etiqueta: 'Por decidir', valor: 3, formato: 'entero' }]}>
        <PanelesAprobaciones conteos={conteos} porAprobar={<p>P1</p>} porEnviar={<p>P2</p>} historial={<p>P3</p>} />
      </EsqueletoTablaMaestra>
    </ProveedorVistas>,
  );
  const barra = html.indexOf('Vista de aprobaciones');
  const tira = html.indexOf('class="rv-kpi"');
  const panel = html.indexOf('P1');
  expect(barra).toBeGreaterThan(-1);
  expect(barra).toBeLessThan(tira);
  expect(tira).toBeLessThan(panel);
  expect(html).toContain('P2');
  expect(html).toContain('P3');
  expect(html).toMatch(/<div hidden=""[^>]*><p>P2<\/p>/);
});
