import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Casilla } from './componentes';
import { FormaCliente } from '../dashboard/clientes/forma';
import { FormaAjustes } from '../dashboard/configuracion/forma';
import { FormaImportarConvenios } from '../dashboard/convenios/formas';

// L7 · los pilotos NO cambian lo que el servidor recibe. Se reproduce lo que haría `new FormData(form)` sobre el marcado: controles con
// `name`, sin `disabled`, sin `form="otro"`, y casillas/radios solo si están marcados (valor `on` si no declaran `value`). La lista
// esperada es la de los formularios ANTES de migrar (nombres de campo del código previo a L7, bfb2417a6).
function campos(html: string): string[] {
  const salida: string[] = [];
  for (const m of html.matchAll(/<(input|select|textarea)\b([^>]*)>/g)) {
    const a = m[2];
    const attr = (n: string) => new RegExp(`\\s${n}="([^"]*)"`).exec(` ${a}`)?.[1];
    const nombre = attr('name');
    if (!nombre || /\sdisabled(=|\s|$)/.test(` ${a} `) || attr('form')) continue;
    const tipo = attr('type') ?? (m[1] === 'input' ? 'text' : m[1]);
    if ((tipo === 'checkbox' || tipo === 'radio') && !/\schecked(=|\s|$)/.test(` ${a} `)) continue;
    salida.push(`${nombre}=${tipo === 'checkbox' || tipo === 'radio' ? (attr('value') ?? 'on') : (attr('value') ?? '')}`);
  }
  return salida.sort();
}

describe('pilotos L7: lo que el servidor recibe no cambia', () => {
  it('Clientes: mismos campos y «Cliente activo» viaja como `on`', () => {
    const h = renderToStaticMarkup(<FormaCliente accion={async () => null} idPrefijo="x" inicial={{ nombre: 'Demo', rfc: '', contacto: '', correo: '', telefono: '', diasCredito: '30', activo: true }} />);
    expect(campos(h)).toEqual(['activo=on', 'contacto=', 'correo=', 'diasCredito=30', 'id=', 'nombre=Demo', 'rfc=', 'telefono=']);
  });
  it('Cliente inactivo: la casilla no viaja (como antes)', () => {
    const h = renderToStaticMarkup(<FormaCliente accion={async () => null} idPrefijo="x" inicial={{ nombre: 'Demo', rfc: '', contacto: '', correo: '', telefono: '', diasCredito: '', activo: false }} />);
    expect(campos(h).some((c) => c.startsWith('activo='))).toBe(false);
  });
  it('Ajustes operativos: los radios del formato NO envían campo extra (solo el oculto `salida`)', () => {
    const h = renderToStaticMarkup(<FormaAjustes inicial={{ rendimientoPorDefecto: '3.2', factorCarga: '1', precioDieselPorDefecto: '24.5', umbralDesviacionPct: '15', salida: 'csv', cuentas: '' }} ejemploKm={900} guardar={async () => null} catalogo="sin_declarar" />);
    const c = campos(h);
    expect(c).toEqual(['cuentas=', 'factorCarga=1', 'precioDieselPorDefecto=24.5', 'rendimientoPorDefecto=3.2', 'salida=csv', 'umbralDesviacionPct=15']);
    const radios = h.match(/<input\b[^>]*name="formato_salida_ui"[^>]*>/g) ?? [];
    expect(radios).toHaveLength(3); // el grupo existe (para las flechas) pero cada radio cuelga de un formulario que no existe
    for (const r of radios) expect(r).toContain('form="sin-formulario"');
  });
  it('Convenios: importar manda `archivo` y `csv`', () => {
    const h = renderToStaticMarkup(<FormaImportarConvenios accion={async () => null} />);
    expect(campos(h)).toEqual(['archivo=', 'csv=']);
  });
  it('Casilla con `value="si"` conserva su valor (reenviar / llevarAViajes)', () => {
    expect(campos(renderToStaticMarkup(<Casilla name="reenviar" value="si" defaultChecked etiqueta="x" />))).toEqual(['reenviar=si']);
    expect(campos(renderToStaticMarkup(<Casilla name="reenviar" value="si" etiqueta="x" />))).toEqual([]);
  });
});
