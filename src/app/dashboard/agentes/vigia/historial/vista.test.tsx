import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { analizarHistorial } from '@/lib/likida/vigia/historial/analisis';
import { VistaHistorialVigia } from './vista';

const accion = async () => null;
const acciones = { alta: accion, critico: accion, borrar: accion, importar: accion };
const base = (p: Partial<Parameters<typeof VistaHistorialVigia>[0]> = {}): Parameters<typeof VistaHistorialVigia>[0] => ({
  sufijo: '', grupos: [], clientes: [{ id: 'c1', nombre: 'Cliente A' }], reporte: null, grupoElegido: null, truncado: false, umbralMin: 10, puedeEditar: true, acciones, ...p,
});
const pintar = (p?: Partial<Parameters<typeof VistaHistorialVigia>[0]>) => renderToStaticMarkup(<VistaHistorialVigia {...base(p)} />);

describe('grupos e histórico del Vigía (pantalla)', () => {
  it('base sin la 0484: lo dice y no enseña un «no hay grupos» que parezca verdad', () => {
    const html = pintar({ grupos: null });
    expect(html).toContain('migración 0484');
    expect(html).not.toContain('Aún no hay grupos');
  });

  it('sin grupos: invita a agregar el primero y no ofrece subir histórico', () => {
    const html = pintar();
    expect(html).toContain('Aún no hay grupos');
    expect(html).toContain('name="clienteId"');
    expect(html).not.toContain('name="archivo"');
  });

  it('con un grupo: el formulario de subida pide archivo y los nombres del equipo; marcar crítico y borrar están a mano', () => {
    const html = pintar({ grupos: [{ id: 'g1', clienteId: 'c1', clienteNombre: 'Cliente A', nombre: 'Operación A', critico: false, importaciones: 0, mensajes: 0, ultimaImportacion: null }] });
    expect(html).toContain('name="archivo"');
    expect(html).toContain('name="equipo"');
    expect(html).toContain('Marcar crítico');
    expect(html).toContain('Sin subir');
    expect(html).toContain('Todavía no hay histórico subido');
  });

  it('quien no es dueño ve los grupos pero ningún formulario ni botón de cambio', () => {
    const html = pintar({ puedeEditar: false, grupos: [{ id: 'g1', clienteId: 'c1', clienteNombre: 'Cliente A', nombre: 'Operación A', critico: true, importaciones: 1, mensajes: 5, ultimaImportacion: '2026-09-12T16:00:00Z' }] });
    expect(html).toContain('Operación A');
    expect(html).not.toContain('name="archivo"');
    expect(html).not.toContain('Quitar crítico');
    expect(html).toContain('Solo el dueño');
  });

  it('el reporte enseña FAQs con la respuesta del equipo, tiempos contra el umbral y «histórico corto» sin base de comparación', () => {
    const m = (iso: string, rol: 'cliente' | 'equipo', texto: string) => ({ enviadoEn: iso, rol, texto });
    const reporte = analizarHistorial([
      m('2026-09-01T15:00:00Z', 'cliente', '¿Dónde va mi viaje?'), m('2026-09-01T15:30:00Z', 'equipo', 'Va por Querétaro.'),
      m('2026-09-02T15:00:00Z', 'cliente', 'donde va mi viaje por favor'), m('2026-09-02T15:30:00Z', 'equipo', 'Va por Querétaro.'),
    ]);
    const html = pintar({ grupos: [], reporte });
    expect(html).toContain('Preguntas frecuentes');
    expect(html).toContain('Va por Querétaro.');
    expect(html).toContain('pasaron de 10 min');
    expect(html).toContain('Histórico corto');
  });
});
