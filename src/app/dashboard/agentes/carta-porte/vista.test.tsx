import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {} }), usePathname: () => '/', useSearchParams: () => new URLSearchParams() }));

import { VistaAgenteCartaPorte, FRASE_SIN_GRUPOS, type BuzonCartaPorteVista } from './vista';

const BUZON: BuzonCartaPorteVista = { direccion: 'cp-abc123@correo.ejemplo.test', activo: true, remitentes: ['cliente.ejemplo.test'], dominioConfigurado: true };
const pintar = (buzon?: BuzonCartaPorteVista | null | 'no_leido') =>
  renderToStaticMarkup(<VistaAgenteCartaPorte datos={null} {...(buzon === undefined ? {} : { buzon })} />);
/** El HTML sin la única frase que puede nombrar los grupos (para afirmar que no hay otra mención). */
const sinLaFrase = (html: string) => html.replace(FRASE_SIN_GRUPOS, '');

describe('Agente de Carta Porte: «Cómo mandarme documentos»', () => {
  it('con buzón activo enseña el correo del buzón con su botón de copiar, el 1:1 de WhatsApp y el panel', () => {
    const html = pintar(BUZON);
    expect(html).toContain('Cómo mandarme documentos');
    expect(html).toContain('cp-abc123@correo.ejemplo.test');
    expect(html).toContain('Copiar la dirección del buzón');
    expect(html).toContain('el medio oficial');
    expect(html).toContain('WhatsApp 1:1 de la oficina');
    expect(html).toContain('«carta porte»');
    expect(html).toContain('/dashboard/carta-porte/documentos');
  });

  it('dice sin rodeos que los grupos de WhatsApp no se pueden leer, y NO los ofrece como capacidad en ningún otro texto', () => {
    const html = pintar(BUZON);
    expect(html).toContain('Los grupos de WhatsApp no se pueden leer');
    expect(html).toContain('pide a tus clientes que escriban al correo o reenvíalos tú');
    expect(sinLaFrase(html)).not.toMatch(/grupo/i);
    // Tampoco sin buzón, ni con la lectura caída.
    expect(sinLaFrase(pintar(null))).not.toMatch(/grupo/i);
    expect(sinLaFrase(pintar('no_leido'))).not.toMatch(/grupo/i);
  });

  it('muestra los remitentes reconocidos (remitentes_permitidos) o dice que es cualquiera', () => {
    expect(pintar(BUZON)).toContain('cliente.ejemplo.test');
    expect(pintar(BUZON)).toContain('remitente no reconocido');
    expect(pintar({ ...BUZON, remitentes: [] })).toContain('Remitentes reconocidos: cualquiera');
  });

  it('sin buzón activado: estado vacío con la llamada a activarlo en el panel, y ninguna dirección inventada', () => {
    const html = pintar(null);
    expect(html).toContain('Aún no tienes buzón');
    expect(html).toContain('Actívalo en el panel de documentos');
    expect(html).not.toMatch(/cp-[a-z0-9]+@/);
    expect(html).toContain('/dashboard/carta-porte/documentos');
  });

  it('buzón apagado lo avisa; sin dominio configurado no inventa dirección; lectura caída no finge «sin buzón»', () => {
    expect(pintar({ ...BUZON, activo: false })).toContain('El buzón está apagado');
    const sinDominio = pintar({ direccion: null, activo: true, remitentes: [], dominioConfigurado: false });
    expect(sinDominio).toContain('El dominio de correo de Likida no está configurado');
    const caido = pintar('no_leido');
    expect(caido).toContain('No se pudo leer el buzón de tu flota');
    expect(caido).not.toContain('Aún no tienes buzón');
  });

  it('respeta el sufijo de tenant en la liga al panel', () => {
    const html = renderToStaticMarkup(<VistaAgenteCartaPorte datos={null} sufijo="?tenant=t1" buzon={BUZON} />);
    expect(html).toContain('/dashboard/carta-porte/documentos?tenant=t1');
  });

  it('sin el prop buzon (pantallas viejas) se comporta como «sin buzón»: ofrece activarlo', () => {
    expect(pintar()).toContain('Aún no tienes buzón');
  });

  it('liga al catálogo del cliente y conserva el sufijo del «ver como»', () => {
    const html = renderToStaticMarkup(<VistaAgenteCartaPorte datos={null} sufijo="?tenant=t1" buzon={BUZON} />);
    expect(html).toContain('/dashboard/agentes/carta-porte/catalogo?tenant=t1');
    expect(pintar(BUZON)).toContain('catálogo del cliente');
  });
});
