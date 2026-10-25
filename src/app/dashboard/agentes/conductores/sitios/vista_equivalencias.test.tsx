import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { SitioFila } from '@/lib/likida/conductor/repo_validacion';
import type { TextoSinSitio } from '@/lib/likida/conductor/sitios';
import { VistaSitios, type PropsVistaSitios } from './vista';

const accion = async () => null;
const S = (p: Partial<SitioFila> = {}): SitioFila => ({
  id: '4f1f6e2e-95c1-4c52-9f9e-3f6f6bd8d001', nombre: 'Planta Demo', tipo: 'planta', codigo: 'PL-DEMO', direccion: null, lat: 20.72, lng: -103.39, radioM: 300,
  activa: true, fuente: 'csv', clienteId: null, clienteNombre: null, padreId: null, ...p,
});
const T: TextoSinSitio[] = [
  { texto: 'STOP Planta Demo FINAL ACERO', textoNormalizado: 'stop planta demo final acero', lado: 'destino', frecuencia: 40 },
  { texto: 'VACIO Cliente Demo', textoNormalizado: 'vacio cliente demo', lado: 'ambos', frecuencia: 30 },
];
const props = (p: Partial<PropsVistaSitios> = {}): PropsVistaSitios => ({
  sufijo: '', sitios: [S()], hayMas: false, clientes: [], puedeEditar: true, editando: null, busqueda: '',
  accionGuardar: accion, accionImportar: accion, accionEstado: accion,
  textosSinSitio: T, descargaCsv: 'data:text/csv;charset=utf-8,x', accionImportarEquivalencias: accion, accionAsignarEquivalencia: accion, ...p,
});
const pintar = (p?: Partial<PropsVistaSitios>) => renderToStaticMarkup(<VistaSitios {...props(p)} />);

describe('la sección «Textos sin sitio»', () => {
  it('lista cada texto con su lado y su frecuencia, ordenados como llegan', () => {
    const html = pintar();
    expect(html).toContain('Textos sin sitio');
    expect(html.indexOf('STOP Planta Demo FINAL ACERO')).toBeLessThan(html.indexOf('VACIO Cliente Demo'));
    expect(html).toContain('origen y destino');
    expect(html).toContain('Es una instrucción');
    expect(html).toContain('Ignorar');
  });
  it('con permiso: selector, importador y descarga; la descarga avisa que no lleva datos de personas', () => {
    const html = pintar();
    expect(html).toContain('Importar equivalencias desde CSV');
    expect(html).toContain('href="data:text/csv;charset=utf-8,x"');
    expect(html).toContain('download="textos-sin-sitio.csv"');
    expect(html).toContain('ningún dato de personas');
  });
  it('SIN permiso: se ve la lista pero no se ofrece asignar ni importar', () => {
    const html = pintar({ puedeEditar: false });
    expect(html).toContain('STOP Planta Demo FINAL ACERO');
    expect(html).not.toContain('Es una instrucción');
    expect(html).not.toContain('Importar equivalencias desde CSV');
  });
  it('lista vacía y lectura caída se distinguen', () => {
    expect(pintar({ textosSinSitio: [] })).toContain('No hay textos sin sitio');
    const caida = pintar({ textosSinSitio: null });
    expect(caida).toContain('No se pudo leer la lista ahora mismo');
    expect(caida).not.toContain('No hay textos sin sitio');
  });
  it('sin la propiedad (pantalla vieja) la sección no se pinta', () => {
    expect(pintar({ textosSinSitio: undefined })).not.toContain('Textos sin sitio');
  });
  it('avisa si la cuenta es de una muestra', () => {
    expect(pintar({ textosTruncado: true })).toContain('la cuenta es de una muestra');
  });
});
