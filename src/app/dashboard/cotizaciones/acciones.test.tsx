import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { FilaAccionesCotizacion } from './acciones';
import type { ResultadoAccion } from '../../admin/ui/forma';

// ═══════════════════════════════════════════════════════════════════════════
// FE-13b (auditoría 24): "Marcar enviada"/"Crear viaje"/"Perdida"/"Vencida"
// eran `Promise<void>` sin `useActionState` (sin `pending`, doble clic =
// doble envío) y su `catch` solo escribía al log — el humano no veía el
// error. Ahora son `AccionDeForma` (ResultadoAccion) con estado propio.
// ═══════════════════════════════════════════════════════════════════════════

const ok = async (): Promise<ResultadoAccion> => ({ ok: 'listo' });

describe('Cotizaciones — botones de fila con estado (FE-13b)', () => {
  it('sin precio, "Crear viaje" nace disabled (no se puede mandar dos veces lo que no procede)', () => {
    const html = renderToStaticMarkup(
      <FilaAccionesCotizacion id="q1" puedeEnviar={false} precio={null} enviada={ok} convertir={ok} perdida={ok} />,
    );
    expect(html).toMatch(/disabled=""[^>]*>Crear viaje/);
  });

  it('borrador: pinta "Marcar enviada"; no-borrador: no la pinta', () => {
    const conBoton = renderToStaticMarkup(
      <FilaAccionesCotizacion id="q1" puedeEnviar precio={1000} enviada={ok} convertir={ok} perdida={ok} />,
    );
    expect(conBoton).toContain('Marcar enviada');

    const sinBoton = renderToStaticMarkup(
      <FilaAccionesCotizacion id="q1" puedeEnviar={false} precio={1000} enviada={ok} convertir={ok} perdida={ok} />,
    );
    expect(sinBoton).not.toContain('Marcar enviada');
  });
});
