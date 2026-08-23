import { describe, it, expect } from 'vitest';
import { evidenciaMonedero, notaTicketMonedero, TOLERANCIA_ECC_MXN, VENTANA_ECC_DIAS } from './evidencia_monedero';
import { TOLERANCIA_MONTO_MXN, VENTANA_DIAS_FECHA } from './consolidado';

describe('evidenciaMonedero — FASE 2, sin adivinar', () => {
  it('las tolerancias son las MISMAS que el JOIN de consolidado', () => {
    expect(TOLERANCIA_ECC_MXN).toBe(TOLERANCIA_MONTO_MXN);
    expect(VENTANA_ECC_DIAS).toBe(VENTANA_DIAS_FECHA);
  });

  it('camino A: RFC de emisor de la semilla (Edenred)', () => {
    const s = evidenciaMonedero({ rfcEmisor: 'ASE930924SS7', fecha: '2026-07-20', monto: 5000 });
    expect(s.tipo).toBe('padron');
    if (s.tipo === 'padron') expect(s.emisor).toMatch(/Edenred/i);
  });

  it('un RFC de estación (PEMEX) NO es monedero por el padrón — no se afirma', () => {
    expect(evidenciaMonedero({ rfcEmisor: 'PEM050101XXX', fecha: '2026-07-20', monto: 5000 })).toEqual({ tipo: 'ninguna' });
  });

  it('camino B: línea ECC mismo día, misma estación, mismo monto', () => {
    const s = evidenciaMonedero(
      { rfcEmisor: 'EST010101AAA', fecha: '2026-07-20', monto: 5000 },
      [{ fecha: '2026-07-20', monto: 5000.4, estacionRfc: 'est010101aaa' }],
    );
    expect(s.tipo).toBe('ecc');
  });

  it('camino B no corre sin RFC de estación: monto+día solos no bastan', () => {
    expect(evidenciaMonedero(
      { fecha: '2026-07-20', monto: 5000 },
      [{ fecha: '2026-07-20', monto: 5000, estacionRfc: 'EST010101AAA' }],
    )).toEqual({ tipo: 'ninguna' });
  });

  it('fuera de tolerancia de monto → ninguna', () => {
    expect(evidenciaMonedero(
      { rfcEmisor: 'EST010101AAA', fecha: '2026-07-20', monto: 5000 },
      [{ fecha: '2026-07-20', monto: 5015, estacionRfc: 'EST010101AAA' }],
    )).toEqual({ tipo: 'ninguna' });
  });

  it('la nota cita RMF 3.3.1.7 y no promete factura de estación', () => {
    const s = evidenciaMonedero({ rfcEmisor: 'PUN9810229R0', monto: 1, fecha: '2026-07-20' });
    expect(s.tipo).toBe('padron');
    if (s.tipo !== 'ninguna') {
      const n = notaTicketMonedero(s);
      expect(n).toMatch(/RMF 3\.3\.1\.7/);
      expect(n).toMatch(/no puede facturar/i);
    }
  });
});
