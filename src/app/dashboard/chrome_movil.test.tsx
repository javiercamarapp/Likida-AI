import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import DashboardChrome from './chrome';

// `SidebarNav` (hijo de `chrome.tsx`, ajeno a este agente) lee
// `useSearchParams()` para el sufijo de tenant/vista/rol; fuera del App
// Router eso revienta con `sp` nulo. Mismo criterio que `bloque.test.tsx`:
// se le da un `URLSearchParams` vacío de mentiras — esta prueba mira el user
// card, no a dónde apuntan los links del menú.
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(), usePathname: () => '/dashboard' }));

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 24 · H10/H11 — el user card del sidebar (avatar + nombre + salir)
// escondía "Cerrar sesión" con `hidden lg:block`: por debajo de `lg` (72px,
// TODO teléfono, ya que el sidebar colapsa a solo íconos ahí) el botón no se
// pintaba en absoluto. Un usuario en su celular no tenía NINGÚN control de
// cerrar sesión en el panel — ni siquiera navegando, porque el nombre/link a
// `/cuenta` también vive detrás de `hidden lg:block` (correcto: no cabe el
// texto en 72px) y no hay otra salida.
//
// El arreglo: el botón deja de llevar `hidden lg:block` (se renderiza
// siempre) y el user card se apila en columna en modo ícono (`sb-user-card`
// + `lg:flex-row` en el componente, `:root[data-sidebar='min'] .sb-user-card`
// en globals.css para el colapso manual en escritorio) para que avatar y
// botón quepan uno debajo del otro sin desbordar los ~40px disponibles.
// ═══════════════════════════════════════════════════════════════════════════

describe('DashboardChrome — "Cerrar sesión" sobrevive al colapso del sidebar', () => {
  it('el botón de salir se renderiza SIEMPRE, sin `hidden` — antes desaparecía bajo `lg` (todo teléfono)', async () => {
    const html = renderToStaticMarkup(
      <DashboardChrome nombre="Ana" rol="flota_admin" cerrarSesion={async () => {}}>
        <div />
      </DashboardChrome>,
    );
    // El formulario que envuelve el botón "Cerrar sesión" ya no lleva
    // `hidden lg:block`: antes esa clase lo apagaba en cualquier viewport
    // bajo 1024px, que es exactamente un teléfono.
    const formIdx = html.indexOf('title="Cerrar sesión"');
    expect(formIdx, 'el botón de cerrar sesión debe existir en el HTML').toBeGreaterThan(-1);
    // Busca el <form> que lo envuelve hacia atrás y confirma que su className
    // no trae la clase que lo escondía en móvil.
    const formStart = html.lastIndexOf('<form', formIdx);
    const claseForm = html.slice(formStart, formIdx);
    expect(claseForm).not.toMatch(/hidden lg:block/);
  });

  it('el user card se apila en columna en modo ícono, para que avatar + botón quepan', () => {
    const html = renderToStaticMarkup(
      <DashboardChrome nombre="Ana" rol="flota_admin" cerrarSesion={async () => {}}>
        <div />
      </DashboardChrome>,
    );
    // La clase que globals.css usa para apilar en columna cuando el sidebar
    // colapsa manualmente en escritorio (`data-sidebar='min'`), y que en
    // fila (Tailwind `lg:flex-row`) sigue funcionando en el colapso
    // automático por viewport.
    expect(html).toMatch(/sb-user-card/);
    expect(html).toMatch(/flex-col[^"]*lg:flex-row|lg:flex-row[^"]*flex-col/);
  });

  it('sin server action de cerrar sesión (render de prueba), no revienta y no pinta el botón', () => {
    const html = renderToStaticMarkup(
      <DashboardChrome nombre="Ana" rol="flota_admin">
        <div />
      </DashboardChrome>,
    );
    expect(html).not.toMatch(/title="Cerrar sesión"/);
  });
});
