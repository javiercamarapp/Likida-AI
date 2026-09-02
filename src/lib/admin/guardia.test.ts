import { describe, it, expect } from 'vitest';
import { clasificarBandeja } from './guardia';
import type { BandejaEscalaciones, ItemEscalacion, FuenteLeida } from './escalaciones';

// ═══════════════════════════════════════════════════════════════════════════
// EL GUARDIA (A0) — la clasificación es DETERMINISTA y se prueba sin base:
// la matriz del runbook aplicada a items reales de la bandeja, las fuentes
// ciegas como S2 por sí mismas, y el límite declarado (S1 no se deriva).
// ═══════════════════════════════════════════════════════════════════════════

const AHORA = Date.parse('2026-08-16T12:00:00Z');
const HACE_2H = new Date(AHORA - 2 * 3_600_000).toISOString();
const EN_2_DIAS = new Date(AHORA + 2 * 86_400_000).toISOString();
const EN_10_DIAS = new Date(AHORA + 10 * 86_400_000).toISOString();
const VENCIO_AYER = new Date(AHORA - 86_400_000).toISOString();

function item(fuente: ItemEscalacion['fuente'], vence: string | null): ItemEscalacion {
  return { fuente, titulo: `item de ${fuente}`, detalle: null, tenantNombre: 'Flota X', desde: HACE_2H, vence, href: null };
}
const leida = (items: ItemEscalacion[]): FuenteLeida => ({ items, error: null });
const ciega = (error: string): FuenteLeida => ({ items: null, error });

function bandeja(cola: ItemEscalacion[], fuentes: Partial<Record<string, FuenteLeida>> = {}): BandejaEscalaciones {
  return {
    fuentes: {
      arco: leida([]), corridas: leida([]), talachas: leida([]),
      facturas_proveedor: leida([]), tickets: leida([]), liquidaciones: leida([]),
      ...fuentes,
    } as BandejaEscalaciones['fuentes'],
    cola,
    conteos: { arco: 0, corridasFallo: 0, talachas: 0, facturasProveedor: 0, ticketsAbiertos: 0, ticketsVencidos: 0, liquidacionesRevisar: 0 },
  };
}

describe('la matriz del runbook, determinista', () => {
  it('una corrida en fallo es S2: una función dejó de operar, nada miente', () => {
    const c = clasificarBandeja(bandeja([item('corridas', null)]), AHORA);
    expect(c.items[0].severidad).toBe('S2');
    expect(c.items[0].regla).toMatch(/nada miente/);
  });

  it('ARCO dentro de plazo es S3; a <5 días o vencida SUBE a S2 con el artículo citado', () => {
    const c = clasificarBandeja(bandeja([
      item('arco', EN_10_DIAS),
      item('arco', EN_2_DIAS),
      item('arco', VENCIO_AYER),
    ]), AHORA);
    expect(c.items.map((i) => i.severidad)).toEqual(['S3', 'S2', 'S2']);
    expect(c.items[2].regla).toMatch(/VENCIDO.*art\. 31/s);
  });

  it('un ticket dentro de SLA es S3; vencido sube a S2', () => {
    const c = clasificarBandeja(bandeja([item('tickets', EN_2_DIAS), item('tickets', VENCIO_AYER)]), AHORA);
    expect(c.items.map((i) => i.severidad)).toEqual(['S3', 'S2']);
  });

  it('talachas, facturas de proveedor y liquidaciones son S3: decisión humana con el sistema operando', () => {
    const c = clasificarBandeja(bandeja([
      item('talachas', null), item('facturas_proveedor', null), item('liquidaciones', null),
    ]), AHORA);
    expect(c.items.every((i) => i.severidad === 'S3')).toBe(true);
  });
});

describe('las fuentes ciegas y los límites', () => {
  it('una fuente ciega es S2 POR SÍ MISMA — no ver no es no haber (§6)', () => {
    const c = clasificarBandeja(bandeja([], { tickets: ciega('db down'), arco: ciega('timeout') }), AHORA);
    expect(c.fuentesCiegas).toHaveLength(2);
    expect(c.porSeveridad.S2).toBe(2);
  });

  it('el límite se DECLARA: S1 no se deriva de la bandeja, y la clasificación lo dice', () => {
    const c = clasificarBandeja(bandeja([]), AHORA);
    expect(c.porSeveridad.S1).toBe(0);
    expect(c.limites.join(' ')).toMatch(/S1.*no se deriva/i);
  });
});
