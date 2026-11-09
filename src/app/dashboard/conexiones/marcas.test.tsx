import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Conector } from '@/lib/likida/conexiones';
import { VistaConexiones } from './vista';
import { SeccionIntegraciones } from './seccion-integraciones';
import { catalogoIntegraciones } from '@/lib/likida/integraciones';

const conectores: Conector[] = [
  { id: 'whatsapp', nombre: 'WhatsApp (choferes y oficina)', estado: 'sin_configurar', detalle: 'No configurado.', falta: [] },
  { id: 'correo', nombre: 'Correo de avisos', estado: 'incompleto', detalle: 'Configurado.', falta: ['activar el envío'] },
  { id: 'sat', nombre: 'SAT (validación de CFDI)', estado: 'ensayo', detalle: 'En ensayo.', falta: [] },
];

describe('Conexiones: marca verificada, fila compacta y estado como pastilla', () => {
  const html = renderToStaticMarkup(<VistaConexiones conectores={conectores} />);
  it('WhatsApp lleva su logo de marca; las demás un icono sobrio, nunca un logo inventado', () => {
    expect(html).toContain('data-marca="whatsapp"');
    expect(html).not.toMatch(/data-marca="(hubspot|zendesk|sap|resend|gmail|outlook|microsoft|google)"/);
  });
  it('el estado va como pastilla con texto (nunca solo color)', () => {
    expect(html).toContain('rv-estado');
    for (const t of ['Sin conectar', 'Incompleto', 'En ensayo']) expect(html).toContain(t);
  });
  it('no filtra nombres de proveedores de infraestructura al cliente', () => {
    expect(html).not.toMatch(/Resend|marketplace de Vercel/);
  });
});

describe('Catálogo de sistemas: marcas solo con trazado verificado', () => {
  it('CSV, SAP y WhatsApp con marca; el resto con el icono genérico', () => {
    const html = renderToStaticMarkup(<SeccionIntegraciones integraciones={catalogoIntegraciones({ credencialesRastreo: 0 })} />);
    expect(html).toContain('data-marca="csv"');
    expect(html).toContain('data-marca="sap"');
    expect(html).toContain('data-marca="whatsapp"');
    expect(html).toContain('data-marca="generico"');
    expect(html).not.toContain('etiqueta-mono');
  });
});
