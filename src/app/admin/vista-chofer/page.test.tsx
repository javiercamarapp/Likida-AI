import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import VistaChofer from './page';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 10, BAJO (frontend) — "El preview del chofer en /admin ya se
// desincronizó del real". El preview mirroreaba a mano los cuatro textos de
// "no hay nada todavía" en vez de importar los componentes reales de
// `chofer/vista.tsx`, y ya divergió: le faltaba el botón `<EnlaceViajes/>`
// ("Ver mis viajes") que sí tiene `/chofer/liquidacion` real
// (`liquidacion/page.tsx`). Esta prueba monta el componente REAL de la ruta
// `/admin/vista-chofer` — no una copia — así que si alguien vuelve a
// mirrorear el contenido a mano, esta prueba lo atrapa la próxima vez que
// diverja.
// ═══════════════════════════════════════════════════════════════════════════

describe('VistaChofer (preview de /admin) — el contenido es el REAL, no un espejo', () => {
  it('la pestaña "Mi saldo" trae el botón "Ver mis viajes" que sí tiene /chofer/liquidacion real', async () => {
    const el = await VistaChofer({ searchParams: Promise.resolve({ pestana: 'saldo' }) });
    const html = renderToStaticMarkup(el);
    expect(html).toContain('Ver mis viajes');
    expect(html).toContain('href="/chofer/viajes"');
  });

  it('la pestaña "Tickets" sigue diciendo lo mismo que /chofer/comprobantes real', async () => {
    const el = await VistaChofer({ searchParams: Promise.resolve({ pestana: 'tickets' }) });
    const html = renderToStaticMarkup(el);
    expect(html).toContain('No traes ningún viaje abierto. Los comprobantes de tus viajes cerrados');
  });

  it('la pestaña "Viajes" sigue diciendo lo mismo que /chofer/viajes real', async () => {
    const el = await VistaChofer({ searchParams: Promise.resolve({ pestana: 'viajes' }) });
    const html = renderToStaticMarkup(el);
    expect(html).toContain('Todavía no tienes viajes registrados a tu nombre');
  });
});
