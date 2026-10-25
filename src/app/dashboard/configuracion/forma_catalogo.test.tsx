import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { FormaAjustes } from './forma';

// A37-S17-02: una flota sin catálogo declarado no ve el error «catálogo vacío» ni se ve obligada a inventar cuentas.
const inicial = { rendimientoPorDefecto: '2.4', factorCarga: '0.78', precioDieselPorDefecto: '24', umbralDesviacionPct: '15', salida: 'csv', cuentas: '' };
const pintar = (catalogo: 'declarado' | 'sin_declarar' | 'ilegible') =>
  renderToStaticMarkup(<FormaAjustes inicial={inicial} ejemploKm={null} guardar={async () => null} catalogo={catalogo} />);

describe('FormaAjustes: catálogo de cuentas', () => {
  it('sin catálogo declarado NO muestra el error de catálogo vacío desde el primer render', () => {
    expect(pintar('sin_declarar')).not.toContain('no puede quedar vacío');
  });
  it('con catálogo declarado (o ilegible) y vacío SÍ lo avisa: vaciarlo borraría uno real', () => {
    expect(pintar('declarado')).toContain('no puede quedar vacío');
    expect(pintar('ilegible')).toContain('no puede quedar vacío');
  });
});
