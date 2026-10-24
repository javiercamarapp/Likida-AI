import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { VistaSitios, type PropsVistaSitios } from './vista';

const accion = async () => null;
const props = (p: Partial<PropsVistaSitios> = {}): PropsVistaSitios => ({
  sufijo: '', sitios: [], hayMas: false, clientes: [], puedeEditar: true, editando: null, busqueda: '',
  accionGuardar: accion, accionImportar: accion, accionEstado: accion, accionCatalogo: accion, ...p,
});
const pintar = (p?: Partial<PropsVistaSitios>) => renderToStaticMarkup(<VistaSitios {...props(p)} />);

describe('la sección del catálogo depurado (T-SYS-25)', () => {
  it('con permiso: ofrece analizar sin guardar, el cupo 20–30 y dice que nada se fusiona solo', () => {
    const html = pintar();
    expect(html).toContain('Catálogo depurado de orígenes y destinos');
    expect(html).toContain('Solo analizar (no guarda nada)');
    expect(html).toContain('<option value="20" selected="">20</option>');
    expect(html).toContain('<option value="30">30</option>');
    expect(html).not.toContain('<option value="31">');
    expect(html).toContain('nunca se fusionan solos');
  });
  it('sin permiso o sin acción no se pinta', () => {
    expect(pintar({ puedeEditar: false })).not.toContain('Catálogo depurado');
    expect(pintar({ accionCatalogo: undefined })).not.toContain('Catálogo depurado');
  });
});
