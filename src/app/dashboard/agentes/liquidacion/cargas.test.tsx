import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SeccionCargas } from './cargas';

const nada = async () => {};
const acciones = { desgloses: nada, contactos: nada };
const pintar = (o: Partial<Parameters<typeof SeccionCargas>[0]> = {}) => renderToStaticMarkup(
  <SeccionCargas acciones={acciones} aviso={null} error={null} detalle={null} puedeCargar {...o} />,
);

describe('SeccionCargas (Ola 1 · A1)', () => {
  it('el dueño ve los dos formularios, con el formato de contactos y la regla de la póliza', () => {
    const html = pintar();
    expect(html).toContain('Subir y enviar');
    expect(html).toContain('Ver vista previa');
    expect(html).toContain('Correos que saldrán');
    expect(html).toContain('name="paso"');
    expect(html).toContain('value="previa"');
    expect(html).toContain('value="subir"');
    expect(html).toContain('Subir correos');
    expect(html).toContain('numero_empleado;correo;coordinador_nombre;coordinador_correo');
    expect(html).toContain('Una bitácora sin póliza no se envía');
    expect(html).toContain('no crea a nadie');
    expect(html.match(/type="file"/g)).toHaveLength(2);
    expect(html.match(/<form/g)).toHaveLength(2);
  });

  it('quien no administra no ve ningún formulario y se le dice por qué', () => {
    const html = pintar({ puedeCargar: false });
    expect(html).not.toContain('type="file"');
    expect(html).toContain('Solo el dueño de la flota sube archivos');
  });

  it('muestra el aviso, el error y el detalle, escapados', () => {
    const html = pintar({ aviso: 'Listo <b>x</b>', error: 'Falló <script>', detalle: 'BIT-1: motivo\nBIT-2: otro' });
    expect(html).toContain('role="status"');
    expect(html).toContain('role="alert"');
    expect(html).toContain('Falló &lt;script&gt;');
    expect(html).not.toContain('<b>x</b>');
    expect(html).toContain('BIT-2: otro');
  });
});
