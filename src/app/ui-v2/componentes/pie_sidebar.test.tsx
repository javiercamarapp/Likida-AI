import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Settings } from 'lucide-react';

vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(), usePathname: () => '/dashboard' }));
const { default: PieSidebar, TarjetaUsuario, etiquetaAvisos, inicialesDe, ConmutadorIdioma, organizacionVigente } = await import('./pie-sidebar');
const { IdiomaProvider } = await import('@/lib/i18n/proveedor');
const { IDIOMA_EN_DISPONIBLE, idiomaElegible } = await import('@/lib/i18n/idioma');
const { shell: shellEn } = await import('@/lib/i18n/en/shell');

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
  it('Avisos: punto de no leídos solo si hay pendientes; sin dato es «?»; la cifra va en el aria-label, no pintada', () => {
    const base = { organizacion: org([]), tarjeta };
    const con = pintar({ ...base, avisos: { href: '/av', pendientes: 18 } });
    expect(con).toContain('rv-ps-punto');
    expect(con).not.toContain('rv-contador');
    expect(con).toContain('aria-label="Avisos: 18 pendientes"');
    expect(pintar({ ...base, avisos: { href: '/av', pendientes: 0 } })).not.toContain('rv-ps-punto');
    expect(pintar({ ...base, avisos: { href: '/av' } })).not.toContain('rv-ps-punto');
    const caida = pintar({ ...base, avisos: { href: '/av', pendientes: null } });
    expect(caida).not.toContain('rv-ps-punto');
    expect(caida).toContain('rv-ps-sindato');
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
    expect(h).toMatch(/role="tooltip"[^>]*>Avisos: 2 pendientes</);
  });
});

describe('PieSidebar: la organización sigue a la prop', () => {
  const dos = [{ valor: 'a', nombre: 'Flota A' }, { valor: 'b', nombre: 'Flota B' }];
  it('al cambiar `actual` el nombre y el destino de «Ir» cambian con ella (no se queda con la flota inicial)', () => {
    const a = pintar({ organizacion: org(dos, 'a'), avisos: { href: '/av' }, tarjeta });
    const b = pintar({ organizacion: org(dos, 'b'), avisos: { href: '/av' }, tarjeta });
    expect(a).toContain('href="/ir/a"');
    expect(b).toContain('href="/ir/b"');
    expect(b).not.toContain('href="/ir/a"');
  });
  it('una elección del usuario vale solo contra la `actual` con que se hizo', () => {
    expect(organizacionVigente({ de: 'a', valor: 'b' }, 'a')).toBe('b');
    expect(organizacionVigente({ de: 'a', valor: 'b' }, 'c')).toBe('c');
    expect(organizacionVigente(null, 'c')).toBe('c');
  });
  it('flota única que cambia: muestra la nueva', () => {
    expect(pintar({ organizacion: org([{ valor: 'b', nombre: 'Flota B' }], 'b'), avisos: { href: '/av' }, tarjeta })).toContain('Flota B');
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
  it('idioma: MX activo y marcado; US visible pero DESHABILITADO («Inglés: próximamente») mientras no haya traducción completa', () => {
    const bloque = renderToStaticMarkup(<ConmutadorIdioma />);
    expect(bloque.match(/type="radio"/g)).toHaveLength(2);
    expect(bloque.match(/disabled=""/g)).toHaveLength(1);
    expect(bloque).toMatch(/value="en"[^>]*disabled=""|disabled=""[^>]*value="en"/);
    expect(bloque).not.toMatch(/value="es"[^>]*disabled=""|disabled=""[^>]*value="es"/);
    expect(bloque).toContain('aria-label="Inglés: próximamente"');
    // Tooltip del sistema (tarjeta, lateral): nunca el title nativo oscuro, que tapaba la fila Avisos.
    expect(bloque).not.toContain('title=');
    expect(bloque).toMatch(/role="tooltip"[^>]*>Inglés: próximamente</);
    expect(bloque).not.toContain('aria-label="English (US)"');
    expect(bloque).toMatch(/value="es"[^>]*checked|checked=""[^>]*value="es"/);
    expect(bloque).not.toMatch(/value="en"[^>]*checked=""|checked=""[^>]*value="en"/);
    expect(bloque).toContain('aria-label="Español (México)"');
  });
  it('la bandera IDIOMA_EN_DISPONIBLE está apagada y con ella apagada el inglés no es elegible (no hay POST)', () => {
    expect(IDIOMA_EN_DISPONIBLE).toBe(false);
    expect(idiomaElegible('en')).toBe(false);
    expect(idiomaElegible('es')).toBe(true);
    expect(idiomaElegible('en', true)).toBe(true); // el día que F15 termine, basta con encender la bandera
  });
  it('idioma: con el proveedor en inglés marca US y la interfaz del pie está en inglés', () => {
    const bloque = renderToStaticMarkup(
      <IdiomaProvider idioma="en" diccionarios={{ shell: shellEn }}><ConmutadorIdioma /></IdiomaProvider>,
    );
    expect(bloque).toMatch(/value="en"[^>]*checked|checked=""[^>]*value="en"/);
    expect(bloque).toContain('Language');
  });
});

describe('PieSidebar en inglés (demostración de i18n P0)', () => {
  const enIngles = (o: Parameters<typeof PieSidebar>[0]) =>
    renderToStaticMarkup(<IdiomaProvider idioma="en" diccionarios={{ shell: shellEn }}><PieSidebar {...o} /></IdiomaProvider>);
  it('traduce todas las cadenas del propio pie y no deja español suelto', () => {
    const h = enIngles({
      // Sin `textoIr`: el «Ir» por omisión sale del diccionario (quien lo pasa, como el admin con «Ver como», traduce el suyo).
      organizacion: { opciones: [{ valor: 'a', nombre: 'Flota A' }, { valor: 'b', nombre: 'Flota B' }], actual: 'b', hrefIr: (v: string) => `/ir/${v}` },
      avisos: { href: '/av', pendientes: 2, urgente: true },
      tarjeta: <TarjetaUsuario nombre={null} rolEtiqueta="Admin" iniciales="?" href="/mi" cerrarSesion={async () => {}} />,
    });
    for (const t of ['Organization', 'Notices', 'Notices: 2 pending, something is urgent', 'Interface theme', 'Light theme', 'Language', 'My account', 'Sign out', 'Go']) {
      expect(h, t).toContain(t);
    }
    for (const t of ['Organización', 'Avisos', 'Tema', 'Idioma', 'Mi cuenta', 'Cerrar sesión', 'pendiente', 'Seguir al sistema']) {
      expect(h, t).not.toContain(t);
    }
  });
  it('lectura caída y sin pendientes siguen siendo honestos en inglés', () => {
    const base = { organizacion: org(null), tarjeta };
    expect(enIngles({ ...base, avisos: { href: '/av', pendientes: null } })).toContain('Notices: no data');
    expect(enIngles({ ...base, avisos: { href: '/av', pendientes: 0 } })).toContain('Notices: nothing pending');
    expect(enIngles({ ...base, avisos: { href: '/av' } })).toContain('No data');
  });
  it('etiquetaAvisos acepta un traductor y por omisión sigue en español', async () => {
    expect(etiquetaAvisos({ pendientes: 1 })).toBe('Avisos: 1 pendiente');
    expect(etiquetaAvisos({ pendientes: 3, urgente: true })).toBe('Avisos: 3 pendientes, hay algo urgente');
    expect(etiquetaAvisos({ pendientes: null })).toBe('Avisos: sin dato');
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
