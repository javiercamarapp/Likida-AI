import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  COOKIE_IDIOMA, IDIOMAS, IDIOMA_POR_OMISION, LOCALE_INTL, idiomaValido, resolverIdioma,
} from './idioma';
import { crearTraductor, interpolar, variablesDe } from './traducir';
import { cargarDiccionarios } from './catalogo';
import { solicitarCambioIdioma } from './cambiar';
import { shell as shellEs } from './es/shell';
import { LOCALE_FORMATO } from '../formato';

describe('idioma: quién manda', () => {
  it('por omisión es español, y NO se autodetecta', () => {
    expect(IDIOMA_POR_OMISION).toBe('es');
    expect(resolverIdioma()).toBe('es');
    expect(resolverIdioma({})).toBe('es');
  });
  it('cookie válida > preferencia del usuario > es', () => {
    expect(resolverIdioma({ cookie: 'en', preferencia: 'es' })).toBe('en');
    expect(resolverIdioma({ cookie: undefined, preferencia: 'en' })).toBe('en');
    expect(resolverIdioma({ cookie: 'es', preferencia: 'en' })).toBe('es');
  });
  it('un valor inválido (texto que el usuario pudo escribir en su metadata) se ignora, nunca se propaga', () => {
    expect(resolverIdioma({ cookie: 'fr', preferencia: 'en' })).toBe('en');
    expect(resolverIdioma({ cookie: '<script>', preferencia: { x: 1 } })).toBe('es');
    expect(idiomaValido('EN')).toBe(false);
    expect(idiomaValido(null)).toBe(false);
    for (const i of IDIOMAS) expect(idiomaValido(i)).toBe(true);
  });
  it('la cookie se llama likida_lang', () => expect(COOKIE_IDIOMA).toBe('likida_lang'));
  it('la configuración regional de i18n y la de formato.ts (que no importa nada) son la misma', () => {
    expect(LOCALE_INTL).toEqual(LOCALE_FORMATO);
  });
});

describe('traducir', () => {
  it('interpola {variables} y deja visible la que falta', () => {
    expect(interpolar('Hola {nombre}, {n} avisos', { nombre: 'Ana', n: 3 })).toBe('Hola Ana, 3 avisos');
    expect(interpolar('Hola {nombre}', {})).toBe('Hola {nombre}');
    expect(interpolar('sin variables')).toBe('sin variables');
    expect(variablesDe('{a} y {b} y {a}')).toEqual(['a', 'b']);
  });
  it('plural: uno/otros según el idioma (0 y 2 son «otros»)', () => {
    const es = crearTraductor('es', shellEs, shellEs);
    expect(es.tp('pie.avisos.pendientes', 1)).toBe('Avisos: 1 pendiente');
    expect(es.tp('pie.avisos.pendientes', 0)).toBe('Avisos: 0 pendientes');
    expect(es.tp('pie.avisos.pendientes', 2)).toBe('Avisos: 2 pendientes');
  });
  it('una clave que falta en el idioma cae al español; si tampoco está, devuelve la clave (visible)', () => {
    const parcial = crearTraductor('en', { 'pie.org.titulo': 'Organization' }, shellEs);
    expect(parcial.t('pie.org.titulo')).toBe('Organization');
    expect(parcial.t('pie.org.sinDato')).toBe('Sin dato');
    expect(parcial.t('no.existe' as never)).toBe('no.existe');
  });
});

describe('catálogo: carga solo el idioma pedido', () => {
  it('en devuelve el inglés del namespace; es, el español', async () => {
    const en = await cargarDiccionarios('en', ['shell']);
    const es = await cargarDiccionarios('es', ['shell']);
    expect(en.shell['pie.org.titulo']).toBe('Organization');
    expect(es.shell['pie.org.titulo']).toBe('Organización');
    expect(Object.keys(en)).toEqual(['shell']);
  });
});

describe('solicitarCambioIdioma', () => {
  const peticion = vi.fn<typeof fetch>();
  beforeEach(() => peticion.mockReset());
  it('hace POST same-origin con el idioma y es true solo si el servidor confirma', async () => {
    peticion.mockResolvedValue(new Response('{}', { status: 200 }));
    expect(await solicitarCambioIdioma('en', peticion)).toBe(true);
    const [url, init] = peticion.mock.calls[0];
    expect(url).toBe('/api/preferencias/idioma');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({ idioma: 'en' });
    expect(init?.credentials).toBe('same-origin');
  });
  it('un 4xx/5xx o un fallo de red es false, nunca lanza', async () => {
    peticion.mockResolvedValueOnce(new Response('{}', { status: 401 }));
    expect(await solicitarCambioIdioma('en', peticion)).toBe(false);
    peticion.mockRejectedValueOnce(new Error('red'));
    expect(await solicitarCambioIdioma('es', peticion)).toBe(false);
  });
});
