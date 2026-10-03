import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { SitioFila } from '@/lib/likida/conductor/repo_validacion';
import { VistaSitios, type PropsVistaSitios } from './vista';

const accion = async () => null;
const accionEstado = async () => {};
const S = (p: Partial<SitioFila> = {}): SitioFila => ({
  id: '4f1f6e2e-95c1-4c52-9f9e-3f6f6bd8d001', nombre: 'Planta Zapopan', tipo: 'planta', codigo: 'PL-ZAP', direccion: null, lat: 20.72, lng: -103.39, radioM: 300,
  activa: true, fuente: 'csv', clienteId: 'c1', clienteNombre: 'Cliente A', padreId: null, ...p,
});
const props = (p: Partial<PropsVistaSitios> = {}): PropsVistaSitios => ({
  sufijo: '', sitios: [S()], hayMas: false, clientes: [{ id: 'c1', nombre: 'Cliente A' }], puedeEditar: true, editando: null, busqueda: '',
  accionGuardar: accion, accionImportar: accion, accionEstado, ...p,
});
const pintar = (p?: Partial<PropsVistaSitios>) => renderToStaticMarkup(<VistaSitios {...props(p)} />);

describe('el catálogo de sitios', () => {
  it('lista nombre, tipo, código, centro, radio, cliente y de dónde salió el dato', () => {
    const html = pintar();
    expect(html).toContain('Planta Zapopan');
    expect(html).toContain('PL-ZAP');
    expect(html).toContain('20.72000, -103.39000');
    expect(html).toContain('300 m');
    expect(html).toContain('Cliente A');
    expect(html).toContain('importado de CSV');
  });
  it('declara que NINGUNA coordenada se inventa', () => {
    expect(pintar()).toContain('Ninguna coordenada se calcula ni se inventa');
  });
  it('un sitio capturado a mano lo dice', () => {
    expect(pintar({ sitios: [S({ fuente: 'manual' })] })).toContain('captura manual');
  });
  it('catálogo vacío: dice qué pasa mientras tanto (llegadas «sin dato»), no una tabla vacía muda', () => {
    expect(pintar({ sitios: [] })).toContain('las llegadas se quedan «sin dato»');
  });
  it('búsqueda sin resultados distingue «no hay sitios» de «no coincide»', () => {
    expect(pintar({ sitios: [], busqueda: 'xyz' })).toContain('Ningún sitio coincide');
  });
  it('lectura caída: lo dice (no «catálogo vacío»)', () => {
    const html = pintar({ sitios: null });
    expect(html).toContain('No se pudo leer el catálogo');
    expect(html).not.toContain('Todavía no hay sitios');
  });
  it('un sitio archivado se ve atenuado y ofrece reactivar', () => {
    const html = pintar({ sitios: [S({ activa: false })] });
    expect(html).toContain('(archivado)');
    expect(html).toContain('Reactivar');
  });
  it('con permiso: editor, importador, formato de ejemplo con coordenadas EN BLANCO a propósito', () => {
    const html = pintar();
    expect(html).toContain('Nuevo sitio');
    expect(html).toContain('Importar desde CSV');
    expect(html).toContain('Latitud (grados decimales)');
    expect(html).toContain('no se usa para calcular coordenadas');
    expect(html).toContain('trae las coordenadas en blanco a propósito');
    expect(html).toContain('Todo o nada');
  });
  it('SIN permiso: se lista pero no se ofrece editar, importar ni archivar', () => {
    const html = pintar({ puedeEditar: false });
    expect(html).toContain('Planta Zapopan');
    expect(html).not.toContain('Nuevo sitio');
    expect(html).not.toContain('Importar desde CSV');
    expect(html).not.toContain('Archivar');
    expect(html).toContain('Solo el dueño de la flota o el jefe de tráfico editan el catálogo');
  });
  it('editando: el formulario trae los datos del sitio y un enlace para cancelar', () => {
    const html = pintar({ editando: S() });
    expect(html).toContain('Editar «Planta Zapopan»');
    expect(html).toContain('value="PL-ZAP"');
    expect(html).toContain('Cancelar la edición');
  });
  it('avisa cuando hay más sitios de los que se listan', () => {
    expect(pintar({ hayMas: true })).toContain('Hay más sitios de los que se listan');
  });
});
