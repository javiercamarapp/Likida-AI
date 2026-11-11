import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { FilaAcciones } from './acciones';
import { VistaHuerfanos } from './vista';
import type { HuerfanoDeFlota } from '@/lib/likida/repo';
import type { OpcionViaje } from '@/lib/likida/repo_paginado';

// ═══════════════════════════════════════════════════════════════════════════
// FE-3 (auditoría 24): "Adjuntar a…" ofrecía un `<select>` con los viajes
// vivos entre los 100 más recientes — el huérfano típico es de un viaje de
// 1-3 días atrás, que a 500 viajes/día ya no está en esa ventana. Ahora es un
// buscador (`ComboViaje`) que le pregunta al servidor por folio/operador, sin
// mandar ningún catálogo completo al cliente.
// ═══════════════════════════════════════════════════════════════════════════

const accionOk = async () => null;
const buscarOk = async (): Promise<OpcionViaje[]> => [{ id: 'v1', etiqueta: 'F-1041 · León → CDMX · J. Pérez' }];

function pintar(hayViajesVivos: boolean) {
  return renderToStaticMarkup(
    <FilaAcciones
      huerfanoId="h1" hayViajesVivos={hayViajesVivos} sinMonto={false}
      buscarViaje={buscarOk} adjuntar={accionOk} descartar={accionOk}
    />,
  );
}

describe('Huérfanos — combo de búsqueda de viaje (FE-3)', () => {
  it('con viajes vivos: pinta un buscador (combobox), no un <select> con catálogo completo', () => {
    const html = pintar(true);
    expect(html).toContain('role="combobox"');
    expect(html).not.toContain('<select');
    // Ya no confiesa una ventana de "los N más recientes": el buscador
    // pregunta a la flota entera.
    expect(html).not.toMatch(/más recientes/);
  });

  it('sin ningún viaje vivo: dice que no hay a dónde adjuntar, sin pintar el buscador', () => {
    const html = pintar(false);
    expect(html).toContain('Sin viajes abiertos');
    expect(html).not.toContain('role="combobox"');
  });
});

describe('Huérfanos — la bandeja migrada conserva lo que decide el humano', () => {
  const h = (id: string, o: Partial<HuerfanoDeFlota> = {}): HuerfanoDeFlota => ({
    id, creadoEn: '2026-10-01T15:00:00Z', operadorNombre: 'Chofer Uno', concepto: 'diesel', fecha: '2026-09-30', monto: 350, motivo: 'sin_viaje', ...o,
  }) as HuerfanoDeFlota;
  const pintarVista = (pendientes: HuerfanoDeFlota[], total: number | null = pendientes.length) => renderToStaticMarkup(
    <VistaHuerfanos pendientes={pendientes} hayViajesVivos buscarViaje={buscarOk} totalPendientes={total} acciones={{ adjuntar: accionOk, descartar: accionOk }} />,
  );

  it('un monto ilegible se dice, no se pinta como $0.00, y no ofrece adjuntar', () => {
    const html = pintarVista([h('a', { monto: 0 })]);
    expect(html).toContain('sin monto legible');
    expect(html).not.toContain('rv-hf__mono">$0.00'); // el único «$0.00» es la explicación de por qué no se adjunta
    expect(html).toContain('Sin monto legible no se puede adjuntar');
  });
  it('declara "N de M" cuando hay más que los listados y cada fila lleva sus dos salidas', () => {
    const html = pintarVista([h('a'), h('b')], 40);
    expect(html).toContain('2 de 40');
    expect((html.match(/aria-label="Descartar el comprobante"/g) ?? []).length).toBe(2);
    expect(html).toContain('Llegó sin viaje abierto');
  });
  it('vacío: dice que todo tiene su viaje; sin tabla', () => {
    const html = pintarVista([]);
    expect(html).toContain('Sin comprobantes sueltos');
    expect(html).not.toContain('<table');
  });
});
