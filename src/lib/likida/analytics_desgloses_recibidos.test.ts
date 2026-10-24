import { describe, it, expect, vi } from 'vitest';

// A37-S29-07: getDesglosesRecibidos lee una ventana de 1,000 líneas; si se llena, el consolidado del borde NO se presenta como total.

type Linea = { cfdi_xml_id: string; estatus: string; monto: number; cfdi: { cfdi_uuid: string; created_at: string } };
let filas: Linea[] = [];

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => {
    const q: Record<string, unknown> = {};
    for (const m of ['from', 'select', 'eq', 'order']) q[m] = () => q;
    q.limit = (n: number) => Promise.resolve({ data: filas.slice(0, n), error: null });
    return q;
  },
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('./cuadre/desde_db', () => ({ cuadrarDesdeDB: vi.fn(), ventanaDesdeDB: vi.fn() }));

const { getDesglosesRecibidos } = await import('./analytics');

const linea = (xml: string, creado: string, monto = 10): Linea => ({ cfdi_xml_id: xml, estatus: 'conciliada', monto, cfdi: { cfdi_uuid: `${xml}-uuid-0000`, created_at: creado } });

describe('getDesglosesRecibidos', () => {
  it('con la ventana sin llenar, nada es parcial', async () => {
    filas = [linea('a', '2026-10-02T00:00:00Z'), linea('b', '2026-10-01T00:00:00Z')];
    const r = await getDesglosesRecibidos('t1');
    expect(r.map((d) => d.parcial)).toEqual([false, false]);
  });

  it('con la ventana llena (1,000 líneas), el consolidado del borde se marca parcial y los demás no', async () => {
    filas = [
      ...Array.from({ length: 600 }, () => linea('nuevo', '2026-10-02T00:00:00Z')),
      ...Array.from({ length: 400 }, () => linea('viejo', '2026-10-01T00:00:00Z')),
      linea('viejo', '2026-10-01T00:00:00Z'), // la 1,001: queda fuera de la ventana
    ];
    const r = await getDesglosesRecibidos('t1');
    const por = new Map(r.map((d) => [d.cfdiXmlId, d]));
    expect(por.get('viejo')).toMatchObject({ lineas: 400, parcial: true });
    expect(por.get('nuevo')).toMatchObject({ lineas: 600, parcial: false });
  });
});
