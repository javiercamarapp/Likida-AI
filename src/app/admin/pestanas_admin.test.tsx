import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MarcoPagina } from '../ui-v2/componentes/marco-pagina';

let ruta = '/admin/agente-ocr';
vi.mock('next/navigation', () => ({ usePathname: () => ruta }));
const { default: ProveedorMarcoAdmin, pestanasDeRuta, areaDeRutaAdmin } = await import('./pestanas-admin');
const { ProveedorConteosPestanas } = await import('./conteos-pestanas-contexto');
const { conteosDePestanas } = await import('./conteos-pestanas');

const pagina = () => renderToStaticMarkup(<ProveedorMarcoAdmin><p>contenido</p></ProveedorMarcoAdmin>);
const paginaConMarco = () => renderToStaticMarkup(<ProveedorMarcoAdmin><MarcoPagina titulo="OCR"><p>contenido</p></MarcoPagina></ProveedorMarcoAdmin>);

describe('ProveedorMarcoAdmin (PestanasHub del admin)', () => {
  it('pantalla sin MarcoPagina: pinta las pestañas del grupo como respaldo y marca la actual', () => {
    ruta = '/admin/agente-ocr';
    const html = pagina();
    expect(html).toContain('aria-label="Secciones de Agentes"');
    expect(html).toContain('href="/admin/agente-cuadre"');
    expect(html).toMatch(/<a[^>]*aria-current="page"[^>]*>OCR</);
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
  });
  it('pantalla con MarcoPagina: la barra va DENTRO del marco, bajo el encabezado', () => {
    ruta = '/admin/agente-ocr';
    const html = paginaConMarco();
    const marco = html.indexOf('<main');
    expect(html.indexOf('</header>')).toBeGreaterThan(marco);
    expect(html.indexOf('rv-marco__pestanas')).toBeGreaterThan(html.indexOf('</header>'));
    expect(html.indexOf('rv-marco__pestanas')).toBeLessThan(html.indexOf('</main>'));
    // El respaldo del SSR sigue en el HTML (lo oculta el CSS y lo retira el cliente al hidratar), pero el marco trae la suya.
    expect(html).toContain('Secciones de Agentes');
  });
  it('el área sale de SECCIONES (la misma etiqueta que el sidebar)', () => {
    ruta = '/admin/agente-ocr';
    expect(areaDeRutaAdmin('/admin/agente-ocr')).toBe('Agentes');
    expect(areaDeRutaAdmin('/admin/consumo')).toBe('Negocio');
    expect(areaDeRutaAdmin('/admin')).toBeNull();
    expect(paginaConMarco()).toContain('rv-encabezado__rotulo');
  });
  it('rutas con parámetro cuentan por prefijo y las pestañas sin dato no inventan conteo', () => {
    const v = pestanasDeRuta('/admin/qa/abc');
    expect(v?.actual).toBe('/admin/qa');
    expect(v?.pestanas.every((p) => p.conteo == null)).toBe(true);
  });
  it('no pinta nada en una página de grupo único o fuera de los grupos', () => {
    ruta = '/admin/soporte';
    expect(pagina()).not.toContain('<nav');
    ruta = '/admin';
    expect(pagina()).not.toContain('<nav');
  });
});

describe('áreas y pestañas del árbol final', () => {
  it('Integraciones ya es del área Sistema (no existe «Plataforma») y Equipo es de Control', () => {
    expect(areaDeRutaAdmin('/admin/integraciones')).toBe('Sistema');
    expect(areaDeRutaAdmin('/admin/whatsapp-infra')).toBe('Sistema');
    expect(areaDeRutaAdmin('/admin/usuarios/nuevo')).toBe('Control');
    expect(areaDeRutaAdmin('/admin/corridas/abc')).toBe('Sistema');
  });
  it('Salud tiene sus 5 pestañas y la de una corrida con id es «Corridas»', () => {
    const v = pestanasDeRuta('/admin/corridas/abc');
    expect(v?.pestanas.map((p) => p.nombre)).toEqual(['Estado', 'Relojes', 'Observabilidad', 'Corridas', 'Capacidad']);
    expect(v?.actual).toBe('/admin/corridas');
  });
  it('Clientes (sin pestañas) y su ficha no pintan barra', () => {
    expect(pestanasDeRuta('/admin/flotas')).toBeNull();
    expect(pestanasDeRuta('/admin/flotas/xyz')).toBeNull();
  });
});

describe('conteos vivos en las pestañas', () => {
  const bandeja = (c: Record<string, number | null>) => ({ conteos: { arco: 0, corridasFallo: 0, talachas: 0, facturasProveedor: 0, ticketsAbiertos: 0, ticketsVencidos: 0, liquidacionesRevisar: 0, ...c } }) as never;
  it('Escalaciones lleva el total de la campana: 3 pendientes', () => {
    const c = conteosDePestanas(bandeja({ talachas: 2, liquidacionesRevisar: 1 }));
    expect(c['/admin/escalaciones'].conteo).toBe(3);
  });
  it('0 pendientes es un 0 leído (se mide y no hay nada) y no pide atención', () => {
    const c = conteosDePestanas(bandeja({}));
    expect(c['/admin/escalaciones']).toEqual({ conteo: 0, atencion: false });
  });
  it('lectura caída: conteo null («sin dato»), nunca 0; sin bandeja no hay conteos', () => {
    const caido = Object.fromEntries(['arco', 'corridasFallo', 'talachas', 'facturasProveedor', 'ticketsAbiertos', 'ticketsVencidos', 'liquidacionesRevisar'].map((k) => [k, null]));
    expect(conteosDePestanas(bandeja(caido))['/admin/escalaciones'].conteo).toBeNull();
    expect(conteosDePestanas(null)).toEqual({});
  });
  const cola = (c: Partial<{ pendientes: number; urgentes: number; frenaAlRunner: boolean }> = {}) => ({ pendientes: 0, urgentes: 0, frenaAlRunner: false, ...c });
  it('Aprobaciones lleva las piezas pendientes; pide atención si hay urgentes o si la bandeja ya frena al runner', () => {
    expect(conteosDePestanas(null, cola({ pendientes: 100, frenaAlRunner: true }))['/admin/aprobaciones']).toEqual({ conteo: 100, atencion: true });
    expect(conteosDePestanas(null, cola({ pendientes: 3, urgentes: 1 }))['/admin/aprobaciones']).toEqual({ conteo: 3, atencion: true });
    expect(conteosDePestanas(null, cola({ pendientes: 3 }))['/admin/aprobaciones']).toEqual({ conteo: 3, atencion: false });
    // 0 leído no es alerta aunque el runner estuviera frenado por otra razón.
    expect(conteosDePestanas(null, cola())['/admin/aprobaciones']).toEqual({ conteo: 0, atencion: false });
  });
  it('Tu turno suma envíos por aprobar + escalaciones; una lectura caída solo quita SU parte (mínimo verdadero) y las dos caídas dan null', () => {
    const c = conteosDePestanas(bandeja({ talachas: 2 }), cola({ pendientes: 5 }));
    expect(c['/admin/tu-turno'].conteo).toBe(7);
    const caido = Object.fromEntries(['arco', 'corridasFallo', 'talachas', 'facturasProveedor', 'ticketsAbiertos', 'ticketsVencidos', 'liquidacionesRevisar'].map((k) => [k, null]));
    expect(conteosDePestanas(bandeja(caido), cola({ pendientes: 5 }))['/admin/tu-turno'].conteo).toBe(5);
    expect(conteosDePestanas(bandeja(caido), null)['/admin/tu-turno'].conteo).toBeNull();
    expect(conteosDePestanas(bandeja({ talachas: 2 }), null)['/admin/tu-turno'].conteo).toBe(2);
    expect(conteosDePestanas(bandeja({}), cola())['/admin/tu-turno']).toEqual({ conteo: 0, atencion: false });
  });
  it('se mezclan sobre las pestañas de la ruta; las demás pestañas quedan sin número', () => {
    const v = pestanasDeRuta('/admin/tu-turno', { '/admin/escalaciones': { conteo: 12, atencion: true } });
    const por = Object.fromEntries(v!.pestanas.map((p) => [p.nombre, p]));
    expect(por.Escalaciones.conteo).toBe(12);
    expect(por.Escalaciones.atencion).toBe(true);
    expect(por['Tu turno'].conteo).toBeUndefined();
    expect(por.Aprobaciones.conteo).toBeUndefined();
  });
  it('el proveedor pinta el número de Escalaciones y NO pinta uno para una lectura caída', () => {
    ruta = '/admin/tu-turno';
    const con = renderToStaticMarkup(<ProveedorConteosPestanas valor={{ '/admin/escalaciones': { conteo: 12, atencion: true } }}><ProveedorMarcoAdmin><p>x</p></ProveedorMarcoAdmin></ProveedorConteosPestanas>);
    expect(con).toMatch(/Escalaciones[\s\S]{0,200}12/);
    const caido = renderToStaticMarkup(<ProveedorConteosPestanas valor={{ '/admin/escalaciones': { conteo: null } }}><ProveedorMarcoAdmin><p>x</p></ProveedorMarcoAdmin></ProveedorConteosPestanas>);
    expect(caido).toContain('Escalaciones');
    expect(caido).not.toMatch(/Escalaciones[\s\S]{0,200}>0</);
  });
});
