import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { resumenLaboral } from '@/lib/likida/laboral/pagadero';
import type { Gasto } from '@/types/likida';
import { SeccionLaboral } from './detalle';

// ═══════════════════════════════════════════════════════════════════════════
// TABLEROS AL DÍA (28-ago-2026) — DEDUCIBLE ≠ PAGADERO llega a la pantalla.
//
// El hueco medido (inventario, prioridad 1): el contralor decidía el neto en
// /dashboard/[id] viendo SOLO la deducibilidad, y la advertencia de que «no
// deducible» no autoriza descontárselo al operador (LFT 110/111/263) solo
// existía en el PDF ya generado. La decisión se toma en pantalla; la
// advertencia tiene que estar en pantalla.
//
// La sección pinta EL MISMO texto que el PDF (`resumenLaboral`, sin segunda
// redacción), así que aquí se prueba el render con el resumen REAL calculado
// por esa función — no con un texto de utilería que podría divergir.
// ═══════════════════════════════════════════════════════════════════════════

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }));

function gasto(sobre: Partial<Gasto>): Gasto {
  return {
    id: 'g-1', concepto: 'diesel', monto: 1000,
    ...sobre,
  } as Gasto;
}

describe('SeccionLaboral — la advertencia laboral en la pantalla donde se decide', () => {
  it('lo no deducible que SÍ se reembolsa: texto del PDF + monto pagadero', () => {
    const lab = resumenLaboral({
      gastos: [gasto({ id: 'g-1', monto: 3500 })],
      idsNoDeducibles: new Set(['g-1']),
      idsPorConfirmar: new Set(),
      sobrePolitica: new Set(),
    });
    expect(lab).not.toBeNull();
    const html = renderToStaticMarkup(<SeccionLaboral laboral={lab!} />);
    expect(html).toContain('Lo que se le reembolsa al operador');
    expect(html).toContain('no autoriza descontárselo');
    // La cifra viene de la MISMA función que el PDF, no de una copia.
    expect(html).toContain('3,500');
  });

  it('la obligación del 263-I (demora ajena) llega con su fundamento', () => {
    const lab = resumenLaboral({
      gastos: [gasto({ id: 'g-1', concepto: 'hospedaje', monto: 1200 })],
      idsNoDeducibles: new Set(),
      idsPorConfirmar: new Set(),
      sobrePolitica: new Set(['g-1']),
      demoraNoImputable: true,
    });
    expect(lab).not.toBeNull();
    const html = renderToStaticMarkup(<SeccionLaboral laboral={lab!} />);
    expect(html).toContain('SE DEBEN al operador');
    expect(html).toContain('LFT 263-I');
  });

  it('solo «a revisar» (sin criterio): la advertencia sale SIN un $0.00 confuso', () => {
    const lab = resumenLaboral({
      gastos: [gasto({ id: 'g-1', concepto: 'viaticos', monto: 800 })],
      idsNoDeducibles: new Set(),
      idsPorConfirmar: new Set(),
      sobrePolitica: new Set(['g-1']),
      // Sin demora declarada: 110-I exige acuerdo — lo revisa el contralor.
    });
    expect(lab).not.toBeNull();
    expect(lab!.montoPagadero).toBe(0);
    const html = renderToStaticMarkup(<SeccionLaboral laboral={lab!} />);
    expect(html).toContain('no se descuenta solo');
    // Cero pagadero aquí no es una medición que enseñar: es «no hay monto
    // obligado», y un $0.00 junto a la advertencia se leería como «no le
    // debes nada», que es la conclusión contraria.
    expect(html).not.toContain('$0.00');
  });

  it('sin nada que advertir, resumenLaboral es null y la sección no existe', () => {
    const lab = resumenLaboral({
      gastos: [gasto({ id: 'g-1' })],
      idsNoDeducibles: new Set(),
      idsPorConfirmar: new Set(),
      sobrePolitica: new Set(),
    });
    expect(lab).toBeNull();
  });
});
