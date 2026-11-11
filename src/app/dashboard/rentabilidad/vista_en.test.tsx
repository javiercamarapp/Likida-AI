import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { VistaRentabilidad } from './vista';
import { crearTraductor } from '@/lib/i18n/traducir';
import { dinero as dineroEs } from '@/lib/i18n/es/dinero';
import { dinero as dineroEn } from '@/lib/i18n/en/dinero';
import type { Cobranza, Rentabilidad } from '@/lib/likida/comercial';

// i18n P3 (Dinero y fiscal): la pantalla habla inglés cuando recibe el traductor en inglés, y las CIFRAS no cambian de
// forma (la moneda y el separador salen de `formato.ts`, no del diccionario).
const RENTABILIDAD: Rentabilidad = {
  ingreso: 500_000, costoComprobado: 300_000, contribucion: 200_000,
  margenPct: 40, viajesConIngreso: 10, viajesSinIngreso: 2, viajesSinLiquidar: 0,
};
const COBRANZA: Cobranza = { facturas: [], total: 350, pagina: 99, porPagina: 100, porCobrar: 480_000, vencido: 120_000, sinCondiciones: 0 };

describe('VistaRentabilidad en inglés', () => {
  const en = crearTraductor('en', dineroEn, dineroEs).t;
  const html = renderToStaticMarkup(<VistaRentabilidad tr={en} rentabilidad={RENTABILIDAD} cobranza={COBRANZA} />);

  it('sin traductor sigue hablando español (las pruebas existentes no cambian)', () => {
    const es = renderToStaticMarkup(<VistaRentabilidad rentabilidad={RENTABILIDAD} cobranza={COBRANZA} />);
    expect(es).toContain('Esta página no tiene facturas');
    expect(es).toMatch(/Contribución/);
  });

  it('el texto sale en inglés, con el mismo número de la cartera completa', () => {
    expect(html).toContain('This page has no invoices');
    expect(html).toContain('350');
    expect(html).toMatch(/Contribution/);
    // Lo que pinta ESTA pantalla (los componentes compartidos de ui-v2 se traducen en su propio paquete).
    for (const frase of ['Esta página no tiene', 'Margen real', 'Cartera por cobrar', 'Rentabilidad por folio', 'Sin ingreso de flete']) expect(html).not.toContain(frase);
  });

  it('las cifras no cambian de forma entre idiomas', () => {
    const es = renderToStaticMarkup(<VistaRentabilidad rentabilidad={RENTABILIDAD} cobranza={COBRANZA} />);
    const cifras = (h: string) => [...h.matchAll(/\$[0-9,.]+/g)].map((m) => m[0]).sort();
    expect(cifras(html)).toEqual(cifras(es));
  });
});
