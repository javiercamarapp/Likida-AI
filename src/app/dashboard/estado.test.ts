import { describe, it, expect } from 'vitest';
import { estadoPanel } from './estado';

// ═══════════════════════════════════════════════════════════════════════════
// "AÚN NO HAY LIQUIDACIONES" ES UNA AFIRMACIÓN, Y SE ESTABA HACIENDO A CIEGAS.
//
// Escenario del reporte (auditoría 5, frontend, CRÍTICO): Supabase no responde
// durante el demo del 6-ago. Antes del arreglo las tres consultas devolvían
// ceros —no `null`—, así que el panel afirmaba con tipografía impecable que la
// flota nunca ha liquidado un viaje. Con las consultas ya lanzando, aquí se
// fija la otra mitad: qué pantalla se elige con cada combinación.
// ═══════════════════════════════════════════════════════════════════════════

const KPIS_VACIOS = { viajesLiquidados: 0 };
const KPIS_CON_DATOS = { viajesLiquidados: 12 };

describe('estadoPanel', () => {
  it('todo caído → error, nunca "aún no hay liquidaciones"', () => {
    expect(estadoPanel({ acreditables: null, kpis: null, liquidaciones: null, anomalias: null })).toBe('error');
  });

  it('un tenant de verdad vacío → vacio', () => {
    expect(estadoPanel({ acreditables: {}, kpis: KPIS_VACIOS, liquidaciones: [], anomalias: [] })).toBe('vacio');
  });

  it('solo se cayó el listado → parcial, no vacio', () => {
    // Este es el fallo parcial que el reporte llama "peor": KPIs con 12 viajes
    // y $340,000 arriba, tabla con cero filas abajo.
    expect(estadoPanel({ acreditables: {}, kpis: KPIS_CON_DATOS, liquidaciones: null, anomalias: [] })).toBe('parcial');
  });

  it('se cayó el listado Y los KPIs vienen en cero → parcial, no vacio', () => {
    // Sin esto, la combinación más traicionera (kpis=0 legítimo + listado
    // caído) volvía a pintar "aún no hay liquidaciones".
    expect(estadoPanel({ acreditables: {}, kpis: KPIS_VACIOS, liquidaciones: null, anomalias: [] })).toBe('parcial');
  });

  it('se cayó solo la detección de duplicados → parcial', () => {
    // "0 anomalías" por fallo de lectura se lee como "revisamos y todo limpio".
    expect(estadoPanel({ acreditables: {}, kpis: KPIS_CON_DATOS, liquidaciones: [{}], anomalias: null })).toBe('parcial');
  });

  it('todo cargó y hay liquidaciones → datos', () => {
    expect(estadoPanel({ acreditables: {}, kpis: KPIS_CON_DATOS, liquidaciones: [{}], anomalias: [] })).toBe('datos');
  });
});
