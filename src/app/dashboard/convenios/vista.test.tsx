import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ConvenioFila } from '@/lib/likida/convenios/repo';
import { VistaConvenios, type PropsVistaConvenios } from './vista';

const accion = async () => null;
const accionEstado = async () => {};
const C = (o: Partial<ConvenioFila> = {}): ConvenioFila => ({
  id: '4f1f6e2e-95c1-4c52-9f9e-3f6f6bd8d001', clienteId: 'c1', cliente: 'Cliente Uno', nombre: 'Ruta norte', origen: 'Zapopan', destino: 'Tlaquepaque',
  origenSitioId: null, destinoSitioId: 'g1', sitioOrigenNombre: null, sitioDestinoNombre: 'CEDIS Tlaquepaque', vigenteDesde: null, vigenteHasta: null, notas: null, activo: true,
  instrucciones: [{ categoria: 'puerta', texto: 'Puerta 3, lado poniente', momento: 'ambos', lugar: 'destino', orden: 0 }],
  comercial: undefined, ...o,
});
const props = (p: Partial<PropsVistaConvenios> = {}): PropsVistaConvenios => ({
  sufijo: '', convenios: [C()], estado: 'ok', puedeEditar: true, verDinero: false, puedeExportar: true, accionImportar: accion, accionEstado, ...p,
});
const pintar = (p?: Partial<PropsVistaConvenios>) => renderToStaticMarkup(<VistaConvenios {...props(p)} />);

describe('la pantalla de convenios', () => {
  it('lista cliente, convenio, A→B, sitios y las instrucciones con su planta y su momento', () => {
    const html = pintar();
    expect(html).toContain('Cliente Uno');
    expect(html).toContain('Ruta norte');
    expect(html).toContain('Zapopan → Tlaquepaque');
    expect(html).toContain('CEDIS Tlaquepaque');
    expect(html).toContain('Por dónde entras:');
    expect(html).toContain('Puerta 3, lado poniente');
    expect(html).toContain('planta de descarga, al despachar y al acercarse');
    expect(html).toContain('Texto para pegar en tu sistema');
  });

  it('SIN permiso de dinero no pinta la tarifa (ni la menciona en el texto ni en el importador)', () => {
    const html = pintar({ convenios: [C({ comercial: { modo: 'por_viaje', precio: 5000, moneda: 'MXN', requisitos: ['Factura'] } })], verDinero: false });
    expect(html).not.toMatch(/Tarifa:|5,000|Factura|tarifa_modo|con tarifa|requisitos de cobro/i);
  });

  it('con permiso de dinero muestra tarifa y requisitos de cobro, y el export completo', () => {
    const html = pintar({ convenios: [C({ comercial: { modo: 'por_viaje', precio: 5000, moneda: 'MXN', requisitos: ['Factura', 'Carta porte'] } })], verDinero: true });
    expect(html).toContain('Tarifa:');
    expect(html).toContain('por viaje');
    expect(html).toContain('Para cobrar: Factura, Carta porte');
    expect(html).toContain('tipo=completo');
  });

  it('sin permiso de edición no ofrece importar ni archivar; sin permiso de exportar no ofrece descargas', () => {
    const html = pintar({ puedeEditar: false, puedeExportar: false });
    expect(html).not.toContain('Importar desde CSV o Excel');
    expect(html).not.toContain('Archivar');
    expect(html).not.toContain('/api/export/convenios');
    expect(html).toContain('Solo el dueño de la flota o el jefe de tráfico editan');
  });

  it('un convenio sin instrucciones lo dice (el operador no recibirá nada)', () => {
    expect(pintar({ convenios: [C({ instrucciones: [] })] })).toContain('el operador no recibirá nada de este convenio');
  });

  it('lista vacía, base sin migrar y lectura caída se distinguen (no «sin convenios» mudo)', () => {
    expect(pintar({ convenios: [] })).toContain('Todavía no hay convenios');
    const sin = pintar({ convenios: null, estado: 'no_disponible' });
    expect(sin).toContain('falta aplicar la actualización de la base (0580)');
    expect(sin).not.toContain('Todavía no hay convenios');
    expect(pintar({ convenios: null, estado: 'error' })).toContain('No se pudieron leer los convenios');
  });

  it('declara que el agente solo dice lo que el convenio dice, y arrastra el ?tenant= del superadmin en los links', () => {
    const html = pintar({ sufijo: '?tenant=abc' });
    expect(html).toContain('El agente solo dice lo que el convenio dice');
    expect(html).toContain('tipo=instrucciones&amp;tenant=abc');
  });

  it('un convenio archivado se marca y ofrece reactivarlo', () => {
    const html = pintar({ convenios: [C({ activo: false })] });
    expect(html).toContain('(archivado)');
    expect(html).toContain('Reactivar');
  });
});
