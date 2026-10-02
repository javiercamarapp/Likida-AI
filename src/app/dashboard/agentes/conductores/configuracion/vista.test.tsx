import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CONFIG_CONDUCTOR_DEFAULT } from '@/lib/likida/conductor/config';
import { valoresDeForma } from '@/lib/likida/conductor/config_forma';
import { VistaConfigConductor } from './vista';

const accion = async () => null;
const props = (p: Partial<Parameters<typeof VistaConfigConductor>[0]> = {}): Parameters<typeof VistaConfigConductor>[0] => ({
  sufijo: '', config: { ...CONFIG_CONDUCTOR_DEFAULT }, valores: valoresDeForma({ ...CONFIG_CONDUCTOR_DEFAULT }),
  contactos: [{ nivel: 1, nombre: 'Patio Norte', telefono: '523312345678', terminalId: 'p1' }],
  patios: [{ id: 'p1', nombre: 'Tlaquepaque' }], puedeEditar: true, accionGuardar: accion, ...p,
});
/** La etiqueta <input …> completa de un campo, sin depender del orden en que React escribe los atributos. */
const campo = (html: string, nombre: string): string => html.match(new RegExp(`<(?:input|select)[^>]*name="${nombre}"[^>]*>`))?.[0] ?? '';
const pintar = (p?: Partial<Parameters<typeof VistaConfigConductor>[0]>) => renderToStaticMarkup(<VistaConfigConductor {...props(p)} />);

describe('la configuración del agente Conductor (pantalla)', () => {
  it('trae cada perilla de la estrategia con su valor actual', () => {
    const html = pintar();
    expect(html).toContain('name="f_solicitudesMin"');
    expect(html).toContain('value="0, 15, 30, 45"');
    for (const k of ['escalarTrasMin', 'segundoNivelMin', 'topeDiarioChofer', 'horaInicio', 'horaFin', 'toleranciaUbicacionM', 'ventanaUbicacionMin', 'estadiaAlertaCargaMin']) {
      expect(html, k).toContain(`name="f_${k}"`);
    }
    for (const d of [1, 2, 3, 4, 5, 6, 7]) expect(html).toContain(`name="f_dia_${d}"`);
    expect(html).toContain('Guardar configuración');
  });

  it('muestra los contactos existentes y filas en blanco para nuevos, con los patios de la flota', () => {
    const html = pintar();
    expect(html).toContain('value="Patio Norte"');
    expect(html).toContain('value="3312345678"');            // sin el 52: es lo que se teclea
    expect(html).toContain('name="c_nombre_3"');            // 1 existente + 3 en blanco
    expect(html).not.toContain('name="c_nombre_4"');
    expect(html).toContain('name="c_filas" value="4"');
    expect(html).toContain('Tlaquepaque');
  });

  it('las alertas de estadía apagadas se muestran vacías (no «0»)', () => {
    const html = pintar();
    const c = campo(html, 'f_estadiaAlertaCargaMin');
    expect(c).toContain('placeholder="vacío = sin alerta"');
    expect(c).not.toContain('value="0"');
    expect(c).toContain('value=""');
  });

  it('quien solo mira (jefe de tráfico) ve todo deshabilitado y SIN botón de guardar', () => {
    const html = pintar({ puedeEditar: false });
    expect(html).not.toContain('Guardar configuración');
    expect(html).toContain('Solo el dueño de la flota cambia esta configuración');
    expect(campo(html, 'f_topeDiarioChofer')).toContain('disabled');
    expect(campo(pintar(), 'f_topeDiarioChofer')).not.toContain('disabled');
  });

  it('lectura caída: lo dice y NO enseña un formulario con defaults como si fueran lo guardado', () => {
    const html = pintar({ config: null, valores: null });
    expect(html).toContain('No se pudo leer la configuración');
    expect(html).not.toContain('name="f_solicitudesMin"');
  });

  it('el aviso del servidor usa el componente único del panel (role=alert / status), no uno local', async () => {
    const { AvisoResultado } = await import('../../../../admin/ui/aviso-resultado');
    expect(renderToStaticMarkup(<AvisoResultado estado={{ ok: false, error: 'La escalera necesita…' }} />)).toContain('role="alert"');
    expect(renderToStaticMarkup(<AvisoResultado estado={{ ok: true, mensaje: 'Configuración guardada.' }} />)).toContain('role="status"');
  });
});
