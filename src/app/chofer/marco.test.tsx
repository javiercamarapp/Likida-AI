import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MarcoChofer } from './marco';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 10, BAJO (frontend) — "Inconsistencias de identidad entre los
// cuatro paneles": `/admin` y `/dashboard` pintan el lockup `<Logo/>` (ícono +
// wordmark "LIKIDA"), y `/chofer` traía un `<span>` de texto plano "Likida" —
// otra tipografía, sin ícono, la única de las tres consolas sin el lockup de
// marca. `MarcoChofer` ahora usa el MISMO componente `<Logo/>` que
// `admin/layout.tsx` y `dashboard/chrome.tsx`, no una copia con el mismo
// nombre: una copia diverge la primera vez que alguien cambia el logo.
// ═══════════════════════════════════════════════════════════════════════════

describe('MarcoChofer — el logo es el mismo <Logo/> que /admin y /dashboard', () => {
  it('renderiza el lockup de marca (role="img" aria-label="Likida"), no un texto plano', () => {
    const html = renderToStaticMarkup(
      <MarcoChofer nombre="Juan Pérez" cerrarSesion={async () => {}} ruta="/chofer">
        <div />
      </MarcoChofer>,
    );
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Likida"');
  });

  it('ya no queda el span de texto plano "Likida" suelto en el header', () => {
    const html = renderToStaticMarkup(
      <MarcoChofer nombre={null} cerrarSesion={async () => {}} ruta="/chofer">
        <div />
      </MarcoChofer>,
    );
    // El lockup real pinta el wordmark con una máscara sobre `logo-texto.png`,
    // no como texto del DOM — así que "Likida" como TEXTO ya no debe aparecer,
    // solo como `aria-label` del contenedor accesible.
    expect(html).not.toMatch(/>Likida</);
  });
});
