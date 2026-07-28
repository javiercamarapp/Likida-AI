import { describe, it, expect } from 'vitest';
import { cuadrarViaje } from './engine';
import type { Gasto } from '@/types/cuadra';

// EL FALLO QUE ESTO FIJA — medido el 28-jul-2026 sobre ocho tickets de campo.
//
// El aviso de facturación solo salía cuando faltaban 2 días o menos. Ese umbral
// tiene sentido en un panel que alguien mira a diario; la liquidación es un
// documento de UNA sola vez. Ocho tickets sin timbrar, $9,070, todos con portal
// reconocido, a tres días del cierre del mes — y el PDF en silencio. Nadie
// vuelve a abrirlo el día 30.
//
// Ahora se avisa siempre que haya portal y el ticket siga sin factura. Lo que
// cambia con la urgencia es el tono, no la existencia del aviso.

const OXXO = 'CCO8605231N4';
const base = (over: Partial<Gasto> = {}): Gasto => ({
  id: 'g1', concepto: 'otro', monto: 41.5, fecha: '2026-07-16', rfcEmisor: OXXO, ...over,
});

const avisos = (g: Gasto, hoy: string) =>
  (cuadrarViaje({ viajeId: 'v', anticipo: 5000, gastos: [g], politica: [], hoy }).diferencias ?? [])
    .filter((d) => d.tipo === 'factura_por_vencer');

describe('el aviso de facturación no espera a la urgencia', () => {
  it('avisa a 15 días del cierre, con la fecha límite', () => {
    const a = avisos(base(), '2026-07-16');
    expect(a).toHaveLength(1);
    expect(a[0].nota).toContain('2026-07-31');
    expect(a[0].nota).toContain('OXXO (tienda)');
  });

  it('a 3 días también — el caso que se perdía', () => {
    expect(avisos(base(), '2026-07-28')).toHaveLength(1);
  });

  it('cuando aprieta, cambia el tono', () => {
    expect(avisos(base(), '2026-07-30')[0].nota).toContain('día(s) para timbrarlo');
  });

  it('y cuando ya pasó, lo dice', () => {
    expect(avisos(base(), '2026-08-05')[0].nota).toContain('se pasó el plazo');
  });

  // Los límites no se mueven: sin comercio reconocido no se promete portal, y un
  // gasto ya timbrado no necesita aviso de ninguna clase.
  it('sigue sin inventar portal para un ticket que no se puede atribuir', () => {
    expect(avisos(base({ rfcEmisor: undefined, ocrExtra: { emisor: 'ABARROTES DOÑA MARY' } }), '2026-07-28')).toHaveLength(0);
  });

  it('sigue sin avisar de un gasto ya timbrado', () => {
    expect(avisos(base({ cfdiUuid: '5f0e1a2b-3c4d-5e6f-7a8b-9c0d1e2f3a4b' }), '2026-07-28')).toHaveLength(0);
  });
});
