/* eslint-disable security/detect-non-literal-fs-filename -- rutas fijas del propio módulo */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { Inbox } from 'lucide-react';
import { describe, expect, it } from 'vitest';
import { AvisoCompacto, CamposSistema, CampoArchivo, CampoFecha, CampoSelect, CampoTexto, CampoTextarea, Disclosure, EstadoVacio, Tarjeta } from './index';

const fuente = (f: string) => readFileSync(join(__dirname, f), 'utf8');
const css = (f: string) => readFileSync(join(__dirname, '..', f), 'utf8');

describe('R9 · campos con estilo del sistema', () => {
  it('CampoTexto/Fecha/Select/Textarea: etiqueta enlazada, name y atributos intactos, obligatorio con asterisco discreto', () => {
    const h = renderToStaticMarkup(
      <form>
        <CampoTexto etiqueta="Folio" name="folio" maxLength={40} obligatorio ayuda="Como en la carta porte" />
        <CampoFecha etiqueta="Inicio" name="fecha" error="Falta la fecha" />
        <CampoSelect etiqueta="Tipo" name="tipo"><option value="a">A</option></CampoSelect>
        <CampoTextarea etiqueta="Notas" name="notas" rows={3} />
      </form>,
    );
    for (const n of ['folio', 'fecha', 'tipo', 'notas']) expect(h, n).toContain(`name="${n}"`);
    expect(h).toContain('type="date"');
    expect(h).toContain('rv-ctl--fecha');
    expect(h).toContain('maxLength="40"');
    // asterisco: discreto, aria-hidden, sin la palabra «(obligatorio)» y sin rojo; la semántica la lleva `required`
    expect(h).toContain('<span class="rv-campo__obl" aria-hidden="true"> *</span>');
    expect(h).toContain('required');
    expect(h).not.toContain('(obligatorio)');
    // error anunciado, control marcado inválido
    expect(h).toContain('role="alert"');
    expect(h).toContain('aria-invalid="true"');
    // cada etiqueta apunta a un id presente
    for (const m of h.matchAll(/for="([^"]+)"/g)) expect(h).toContain(`id="${m[1]}"`);
  });
  it('CampoArchivo: input file real dentro del formulario, oculto con clase accesible, botón y nombre vacío honesto', () => {
    const h = renderToStaticMarkup(<form><CampoArchivo etiqueta="Documento" name="archivo" accept=".pdf" obligatorio /></form>);
    expect(h).toContain('type="file"');
    expect(h).toContain('name="archivo"');
    expect(h).toContain('accept=".pdf"');
    expect(h).toContain('rv-archivo__input');
    expect(h).toContain('rv-archivo__boton');
    expect(h).toContain('Seleccionar archivo');
    expect(h).toContain('Sin archivo seleccionado');
    expect(h).toMatch(/aria-describedby="[^"]*-nombre"/);
    expect(h).not.toContain('style=');
  });
  it('CSS: el input de archivo se oculta SIN display:none (sigue en el tab) y el nombre se trunca con elipsis', () => {
    const c = css('piezas.css');
    const oculto = c.match(/\.rv-archivo__input \{([^}]*)\}/)![1];
    expect(oculto).toContain('clip-path');
    expect(oculto).not.toContain('display: none');
    expect(oculto).not.toContain('visibility');
    const nombre = c.match(/\.rv-archivo__nombre \{([^}]*)\}/)![1];
    for (const t of ['text-overflow: ellipsis', 'overflow: hidden', 'white-space: nowrap', 'min-width: 0']) expect(nombre, t).toContain(t);
    expect(c.match(/\.rv-archivo__boton \{([^}]*)\}/)![1]).toContain('min-height: 32px');
  });
});

describe('R9 · estado vacío contenido', () => {
  it('EstadoVacio contenido: marca data-contenido, icono decorativo, título, línea y acción; sin icono no pinta el hueco', () => {
    const h = renderToStaticMarkup(<EstadoVacio contenido icono={Inbox} titulo="Nada sin repartir" accion={<a href="/x">Crear viaje</a>}>Los viajes sin operador caen aquí.</EstadoVacio>);
    expect(h).toContain('data-contenido="true"');
    expect(h).toContain('rv-vacio__icono');
    expect(h).toContain('aria-hidden="true"');
    expect(h).toContain('Nada sin repartir');
    expect(h).toContain('Crear viaje');
    expect(renderToStaticMarkup(<EstadoVacio titulo="Sin datos" />)).not.toContain('rv-vacio__icono');
  });
  it('Tarjeta contenida con vacío: el vacío va dentro de la tarjeta y la tarjeta no se estira (align-self: start)', () => {
    const h = renderToStaticMarkup(<Tarjeta titulo="Por asignar" estado="vacio" contenida iconoVacio={Inbox} mensaje="Nada sin repartir" detalle="Aquí caen los viajes sin chofer." />);
    expect(h).toContain('data-contenida="true"');
    expect(h).toContain('data-contenido="true"');
    expect(h.indexOf('rv-tarjeta__cuerpo')).toBeLessThan(h.indexOf('rv-vacio'));
    const c = css('piezas.css');
    expect(c).toMatch(/\.rv-tarjeta\[data-contenida\] \{ align-self: start; \}/);
    const regla = c.match(/\.rv-vacio\[data-contenido\] \{([^}]*)\}/)![1];
    expect(regla).toContain('max-height: 220px');
    expect(regla).toContain('flex: 0 0 auto');
  });
});

describe('R9 · Disclosure y AvisoCompacto', () => {
  it('Disclosure: <details>/<summary> con chevron visible, resumen opcional y abierto opcional', () => {
    const cerrado = renderToStaticMarkup(<Disclosure titulo="Mercancías" resumen="2 partidas">contenido</Disclosure>);
    expect(cerrado).toContain('<details');
    expect(cerrado).not.toContain('open=""');
    expect(cerrado).toContain('<summary');
    expect(cerrado).toContain('rv-disc__chev');
    expect(cerrado).toContain('<svg');
    expect(cerrado).toContain('2 partidas');
    expect(renderToStaticMarkup(<Disclosure titulo="A" abierto>x</Disclosure>)).toContain('open=""');
  });
  it('AvisoCompacto: resumen recortado a 2 líneas por CSS y «Ver más» en <details> solo si hay detalle', () => {
    const h = renderToStaticMarkup(<AvisoCompacto tono="warn" resumen="Resumen corto" mas={<p>Detalle legal completo</p>} />);
    expect(h).toContain('rv-aviso--compacto');
    expect(h).toContain('<details class="rv-aviso__mas">');
    expect(h).toContain('Ver más');
    expect(h).toContain('Detalle legal completo');
    expect(renderToStaticMarkup(<AvisoCompacto resumen="Solo resumen" />)).not.toContain('<details');
    expect(css('piezas.css').match(/\.rv-aviso__resumen \{([^}]*)\}/)![1]).toContain('-webkit-line-clamp: 2');
  });
});

describe('R9 · las piezas nuevas no cruzan funciones servidor → cliente', () => {
  // Una función (o un componente) como prop de un componente de servidor hacia uno 'use client' tumbó producción una vez. Los
  // componentes de cliente de la ronda (campos.tsx) solo declaran props serializables; los demás ni siquiera son de cliente.
  it('disclosure, aviso, estado-vacio y tarjeta NO son de cliente (se pintan desde el servidor sin frontera)', () => {
    for (const f of ['disclosure.tsx', 'aviso.tsx', 'estado-vacio.tsx', 'tarjeta.tsx']) expect(fuente(f), f).not.toMatch(/^['"]use client['"]/m);
  });
  it('los campos de cliente nuevos no piden funciones ni componentes por props (solo onChange del propio input, que ya existía)', () => {
    const src = fuente('campos.tsx');
    const bloque = src.slice(src.indexOf('interface PropsCampoBase'));
    const tipos = [...bloque.matchAll(/^\s+(\w+)\??: ([^;]+);/gm)].map((m) => [m[1], m[2]] as const);
    for (const [nombre, tipo] of tipos) {
      expect(tipo, `${nombre}: ${tipo}`).not.toMatch(/=>|ComponentType|ElementType|LucideIcon|Function/);
    }
    expect(src).not.toMatch(/icono\??: LucideIcon/);
  });
});

describe('R9b · CamposSistema', () => {
  it('pinta valores de solo lectura en un <dl> sin controles de entrada, con nota opcional', () => {
    const h = renderToStaticMarkup(<CamposSistema etiqueta="Topes" campos={[{ etiqueta: 'Tope diario', valor: '$750', nota: 'LISR' }, { etiqueta: 'Peaje', valor: '50%' }]} />);
    expect(h).toContain('<dl');
    expect(h).toContain('aria-label="Topes"');
    expect(h).toContain('rv-sis__valor');
    expect(h).toContain('LISR');
    expect(h).not.toContain('<input');
    expect(h.match(/rv-sis__nota/g)?.length).toBe(1);
  });
});
