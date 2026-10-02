import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { VistaFormatoLiquidacion, type AccionesFormato } from './vista';
import { FORMATO_BASE } from '@/lib/likida/liquidacion_externa/formato_flota';
import type { ConfigFormatoFlota } from '@/lib/likida/liquidacion_externa/repo';

const nada = async () => {};
const acciones: AccionesFormato = { subirMuestra: nada, guardarAjustes: nada, quitar: nada };
const config: ConfigFormatoFlota = {
  formato: { ...FORMATO_BASE, titulo: 'LIQUIDACIÓN SEMANAL' }, nombreMuestra: 'muestra.xlsx',
  copiaTelefonos: ['525511110001'], discrepanciaTelefonos: ['525511110002'],
};
const pintar = (o: Partial<Parameters<typeof VistaFormatoLiquidacion>[0]> = {}) => renderToStaticMarkup(
  <VistaFormatoLiquidacion sufijo="?tenant=f-1" aviso={null} error={null} config={config} puedeAdministrar acciones={acciones} {...o} />,
);

describe('la pantalla del formato de las liquidaciones', () => {
  it('sin formato lo dice y no inventa columnas', () => {
    const html = pintar({ config: null });
    expect(html).toContain('Todavía no hay formato');
    expect(html).toContain('Subir muestra');
    expect(html).not.toContain('Columnas de la tabla');
  });

  it('con formato muestra título, columnas con su campo de origen, datos de arriba y los teléfonos', () => {
    const html = pintar();
    expect(html).toContain('LIQUIDACIÓN SEMANAL');
    expect(html).toContain('Se llena con: Percepciones');
    expect(html).toContain('Se llena con: Operador');
    expect(html).toContain('525511110001');
    expect(html).toContain('525511110002');
    expect(html).toContain('muestra.xlsx');
    expect(html).toContain('Reemplazar muestra');
  });

  it('quien no administra lo ve pero no puede subir, guardar ni quitar', () => {
    const html = pintar({ puedeAdministrar: false });
    expect(html).toContain('Solo el dueño de la flota');
    expect(html).not.toContain('Guardar cambios');
    expect(html).not.toContain('Quitar el formato');
    expect(html).not.toContain('type="file"');
  });

  it('muestra el aviso y el error (con rol de alerta), y escapa lo que traiga', () => {
    const html = pintar({ aviso: 'Listo <b>x</b>', error: 'Falló <script>' });
    expect(html).toContain('role="status"');
    expect(html).toContain('role="alert"');
    expect(html).toContain('Falló &lt;script&gt;');
    expect(html).not.toContain('<b>x</b>');
  });

  it('vuelve al agente conservando el contexto de la flota', () => {
    expect(pintar()).toContain('/dashboard/agentes/liquidacion?tenant=f-1');
  });
});
