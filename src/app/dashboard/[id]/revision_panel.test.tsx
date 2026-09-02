import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { PanelRevision } from './revision-panel';
import type { RevisionDetalle } from '@/lib/likida/revision';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 24, BLOQUEANTE 6 — la firma humana llega a la pantalla.
//
// El hueco medido: NI UN `update` sobre `liquidacion` en toda la app. El
// contralor leía el PDF y decidía en Excel. Lo que se prueba aquí es que la
// pantalla no vuelva a mentir en ninguno de los tres bordes:
//   · una ya firmada dice QUIÉN y CUÁNDO (y una que cuadró sola no finge
//     que la firmó alguien);
//   · el rol que no firma ve por qué no, no un botón que rebota;
//   · rechazar avisa que el motivo se lo va a leer el chofer.
// ═══════════════════════════════════════════════════════════════════════════

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }));

const estado = (sobre: Partial<RevisionDetalle> = {}): RevisionDetalle => ({
  revision: 'pendiente', revisadaPor: null, revisadaEn: null, motivo: null, ajustes: [],
  viajeEstatus: 'liquidado', firmable: true, ...sobre,
});
const GASTOS = [{ id: 'g-1', etiqueta: 'Diésel', monto: 800 }];
const pintar = (e: RevisionDetalle, accion: unknown = async () => null) => renderToStaticMarkup(
  <PanelRevision estado={e} gastos={GASTOS} accion={accion as never} folio="V-1041" />,
);

describe('PanelRevision', () => {
  it('pendiente: ofrece las tres decisiones y el motivo, con el botón que se apaga al enviar', () => {
    const html = pintar(estado());
    expect(html).toContain('Aprobar');
    expect(html).toContain('Ajustar montos');
    expect(html).toContain('Rechazar');
    expect(html).toContain('name="motivo"');
    expect(html).toContain('name="accion"');
  });

  it('la que cuadró sola NO dice que la firmó alguien, y sigue siendo corregible', () => {
    const html = pintar(estado({
      revision: 'aprobada', revisadaPor: null, revisadaEn: '2026-08-25T18:00:00+00:00',
      motivo: 'Cuadró sola: sin diferencias', firmable: true,
    }));
    expect(html).toContain('cuadró sola');
    expect(html).not.toContain('la firmó ');
    expect(html).toContain('todavía la puedes corregir');
  });

  it('la firmada por una persona dice quién y cuándo, y ya no se vuelve a firmar', () => {
    const html = pintar(estado({
      revision: 'ajustada', revisadaPor: 'contralor@flota.mx', revisadaEn: '2026-08-25T18:00:00+00:00',
      motivo: 'el ticket dice 8,000', firmable: false,
      ajustes: [{ gastoId: 'g-1', concepto: 'diesel', montoAnterior: 800, montoNuevo: 8000 }],
    }));
    expect(html).toContain('contralor@flota.mx');
    expect(html).toContain('el ticket dice 8,000');
    // La corrección de WA-3, visible: de dónde a dónde se movió la cifra.
    expect(html).toContain('$800.00');
    expect(html).toContain('$8,000.00');
    expect(html).not.toContain('name="accion"');
  });

  it('rechazada: no se firma otra vez y se dice qué sigue', () => {
    const html = pintar(estado({
      revision: 'rechazada', revisadaPor: 'a@b.mx', revisadaEn: '2026-08-25T18:00:00+00:00',
      motivo: 'faltan casetas', firmable: false,
    }));
    expect(html).not.toContain('name="accion"');
    expect(html).toContain('volvió a cuadre');
  });

  it('el rol que no firma ve POR QUÉ, no un botón que va a rebotar', () => {
    const html = pintar(estado(), null);
    expect(html).not.toContain('name="accion"');
    expect(html).toContain('Tu rol no firma liquidaciones');
  });
});
