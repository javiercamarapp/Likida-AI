import { describe, it, expect } from 'vitest';
import { htmlDeSelector, construirFixture, UUID_FIXTURE } from './fixtures_portal';
import { GUIONES } from '../facturacion/adaptadores/portales';

describe('htmlDeSelector: el DOM mínimo que hace resolver cada forma de selector del repo', () => {
  it.each([
    ['xpath=//label[contains(normalize-space(.), "RFC")]/following::input[1]', 'campo', /<label>RFC<\/label><div><input/],
    ['#ctl00_Main_txt', 'campo', /<input type="text" id="ctl00_Main_txt">/],
    ['#form\\:folio', 'campo', /id="form:folio"/],
    ['input[name="folio"]', 'campo', /<input type="text" name="folio">/],
    ['input[name*="rfc" i]', 'campo', /name="x-rfc-x"/],
    ['select[name="regimen"]', 'select', /<select name="regimen">/],
    ['input[formcontrolname="itu"]', 'campo', /formcontrolname="itu"/],
    ['button:has-text("Generar"), input[type="submit"][value*="Generar" i]', 'boton', /<button type="button">Generar<\/button>/],
    ['.uuid, [class*="folio-fiscal" i], [data-uuid]', 'contenedor', /<div class="uuid">/],
    ['a[href$=".xml"]', 'boton', /<a href="\/x\.xml">/],
  ] as const)('%s', (sel, rol, esperado) => {
    expect(htmlDeSelector(sel, rol, 'texto')).toMatch(esperado);
  });
  it('un selector que no sabe construir devuelve null (no fabrica algo que no lo cumpla)', () => {
    expect(htmlDeSelector('xpath=//div[@x]/y', 'campo')).toBeNull();
    expect(htmlDeSelector('div > span:nth-child(3)', 'contenedor')).toBeNull();
  });
  it('con varios candidatos usa el primero que sabe construir', () => {
    expect(htmlDeSelector(['xpath=//raro', '#ok'], 'campo')).toMatch(/id="ok"/);
  });
});

describe('construirFixture', () => {
  it('cubre TODOS los guiones del repo sin dejar nada sin construir', () => {
    for (const g of GUIONES) expect(construirFixture(g).noSintetizable, g.comercio).toEqual([]);
  });
  it('el fixture no revela UUID hasta que se aprieta emitir, y jamás un folio real', () => {
    const f = construirFixture(GUIONES[0]);
    expect(f.formulario).toContain(UUID_FIXTURE);
    expect(f.formulario.indexOf('<div id="fx-salida"></div>')).toBeGreaterThan(0); // la salida nace vacía
    expect(f.formulario).toContain('NO es el portal real');
  });
});
