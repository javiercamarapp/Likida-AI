import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Settings } from 'lucide-react';

vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(), usePathname: () => '/dashboard' }));
const { default: PieSidebar, TarjetaUsuario, etiquetaAvisos, inicialesDe, ConmutadorIdioma } = await import('./pie-sidebar');

const tarjeta = <TarjetaUsuario nombre="Ana Pérez" rolEtiqueta="Administrador" iniciales="AP" href="/mi" />;
const org = (opciones: Array<{ valor: string; nombre: string }> | null, actual: string | null = null) =>
  ({ opciones, actual, hrefIr: (v: string) => `/ir/${v}`, textoIr: 'Ir' });
const pintar = (o: Parameters<typeof PieSidebar>[0]) => renderToStaticMarkup(<PieSidebar {...o} />);

describe('PieSidebar: estados', () => {
  it('con varias organizaciones pinta un select real con chevron y «Ir» hacia la elegida', () => {
    const h = pintar({ organizacion: org([{ valor: 'a', nombre: 'Flota A' }, { valor: 'b', nombre: 'Flota B' }], 'b'), avisos: { href: '/av' }, tarjeta });
    expect(h).toContain('<select');
    expect(h).toContain('aria-label="Organización"');
    expect(h).toContain('href="/ir/b"');
    expect(h).toContain('Organización</p>');
  });
  it('con una sola organización es un campo fijo (sin select) y lleva a su panel', () => {
    const h = pintar({ organizacion: org([{ valor: 'a', nombre: 'Flota A' }], 'a'), avisos: { href: '/av' }, tarjeta });
    expect(h).not.toContain('<select');
    expect(h).toContain('Flota A');
    expect(h).toContain('href="/ir/a"');
  });
  it('lista caída: dice «Sin dato», no una lista vacía', () => {
    const h = pintar({ organizacion: { ...org(null), hrefSinOpcion: '/elegir' }, avisos: { href: '/av' }, tarjeta });
    expect(h).toContain('Sin dato');
    expect(h).toContain('href="/elegir"');
  });
  it('el acceso cruzado solo existe si se pasa (el rol lo permite)', () => {
    const sin = pintar({ organizacion: org([]), avisos: { href: '/av' }, tarjeta });
    const con = pintar({ organizacion: org([]), avisos: { href: '/av' }, acceso: { href: '/admin', texto: 'Administración de Likida', Icono: Settings }, tarjeta });
    expect(sin).not.toContain('rv-ps-acceso');
    expect(con).toContain('Administración de Likida');
  });
  it('sin pantalla de avisos la fila no existe', () => {
    expect(pintar({ organizacion: org([]), avisos: null, tarjeta })).not.toContain('rv-ps-avisos');
  });
  it('en el riel hay iconos con tooltip y nombre accesible: organización, avisos, ciclo de tema', () => {
    const h = pintar({ organizacion: org([{ valor: 'a', nombre: 'Flota A' }], 'a'), avisos: { href: '/av', pendientes: 2 }, tarjeta });
    expect(h).toContain('rv-ps-org__riel');
    expect(h).toContain('title="Flota A"');
    expect(h).toContain('rv-ps-tema__riel');
    expect(h).toMatch(/aria-label="Tema claro\. Cambiar a: Seguir al sistema"/);
    expect(h).toContain('title="Avisos: 2 pendientes"');
  });
});

describe('PieSidebar: conmutadores', () => {
  const h = pintar({ organizacion: org([]), avisos: { href: '/av' }, tarjeta });
  it('tema: tres radios nativos (claro, sistema, oscuro) con nombre accesible y el claro marcado por omisión', () => {
    const bloque = h.slice(h.indexOf('data-conmutador="tema"'), h.indexOf('data-conmutador="idioma"'));
    expect(bloque.match(/type="radio"/g)).toHaveLength(3);
    for (const r of ['Tema claro', 'Seguir al sistema', 'Tema oscuro']) expect(bloque).toContain(`aria-label="${r}"`);
    expect(bloque).toMatch(/checked=""[^>]*value="claro"|value="claro"[^>]*checked=""/);
  });
  it('idioma: visible pero DESHABILITADO y dice «Próximamente» (Likida no tiene i18n: no se finge traducción)', () => {
    const bloque = renderToStaticMarkup(<ConmutadorIdioma />);
    expect(bloque).toContain('disabled');
    expect(bloque).toContain('Próximamente');
    expect(bloque).toContain('title="Idioma: próximamente"');
  });
});

describe('TarjetaUsuario', () => {
  it('iniciales, nombre, rol legible y salir; en modo enlace es un <a>, en modo menú un botón con aria-haspopup', () => {
    const enlace = renderToStaticMarkup(<TarjetaUsuario nombre="Ana Pérez" rolEtiqueta="Superadmin" iniciales="AP" href="/mi" cerrarSesion={async () => {}} />);
    expect(enlace).toContain('>AP<');
    expect(enlace).toContain('Superadmin');
    expect(enlace).toContain('aria-label="Cerrar sesión"');
    expect(enlace).toContain('href="/mi"');
    const menu = renderToStaticMarkup(<TarjetaUsuario nombre="Ana" rolEtiqueta="x" iniciales="A" menu={<button role="menuitem">Hola</button>} />);
    expect(menu).toContain('aria-haspopup="menu"');
  });
  it('sin nombre cae a «Mi cuenta»', () => {
    expect(renderToStaticMarkup(<TarjetaUsuario nombre={null} rolEtiqueta="x" iniciales="?" href="/mi" />)).toContain('Mi cuenta');
  });
});

describe('utilidades', () => {
  it('etiquetaAvisos: lectura caída = sin dato, nunca 0; sin fuente = sin cifra', () => {
    expect(etiquetaAvisos({ pendientes: null })).toBe('Avisos: sin dato');
    expect(etiquetaAvisos({ pendientes: undefined })).toBe('Avisos');
    expect(etiquetaAvisos({ pendientes: 1 })).toBe('Avisos: 1 pendiente');
  });
  it('inicialesDe', () => {
    expect(inicialesDe('Ana Pérez')).toBe('AP');
    expect(inicialesDe('Ana')).toBe('AN');
    expect(inicialesDe(null)).toBe('?');
  });
});
