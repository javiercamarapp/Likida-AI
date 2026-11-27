import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Tarjeta } from './index';

// ═══════════════════════════════════════════════════════════════════════════
// A47-FE-01 — Una `Tarjeta` solo pinta `children` en estado `ok`
// (`tarjeta.tsx:50`). Eso es correcto para DATOS: en vacío se pinta
// `EstadoVacio` en su lugar, no una lista hueca.
//
// Pero la ronda 12 (`a0f4d190`, «tarjetas con vacío contenido y formularios
// plegados») metió los formularios de CAPTURA de `/dashboard/emergencias` como
// `children` de tarjetas cuyo estado es `vacio` precisamente cuando la flota es
// nueva. Resultado: en una flota recién creada —el caso del demo— la pantalla
// de emergencias no tenía cómo capturar la póliza, ni un proveedor, ni un
// contacto. Pantalla sin salida, y el `abierto={!poliza}` del propio Disclosure
// demuestra que la intención era la contraria.
//
// Antes de esa ronda los formularios estaban fuera de toda tarjeta y siempre se
// pintaban (`git show cb8180f2:…/emergencias/page.tsx`), así que es regresión.
//
// Las 14 pruebas de la página no lo cazaron porque recorren `props.children`
// sin renderizar: el formulario estaba en el árbol de props, y por eso «se
// veía». Esta prueba RENDERIZA, que es la única forma de ver un vacío.
//
// La ranura `formulario` se pinta en `ok` Y en `vacio`. Se fija por los dos
// lados: que el formulario sobreviva al vacío, y que los datos NO.
// ═══════════════════════════════════════════════════════════════════════════

describe('A47-FE-01 · el formulario de captura sobrevive al estado vacío', () => {
  it('en vacío: la ranura `formulario` se pinta y `children` no', () => {
    const h = renderToStaticMarkup(
      <Tarjeta titulo="Póliza de la flota" estado="vacio" mensaje="Sin póliza capturada"
        formulario={<form action="/x"><input name="aseguradora" /></form>}>
        <p>Quálitas · póliza 123</p>
      </Tarjeta>,
    );
    expect(h).toContain('name="aseguradora"');        // la captura, alcanzable
    expect(h).toContain('Sin póliza capturada');      // y el vacío, dicho
    expect(h).not.toContain('Quálitas');              // los datos, no
  });

  it('en ok: se pintan las dos cosas, datos y formulario', () => {
    const h = renderToStaticMarkup(
      <Tarjeta titulo="Póliza de la flota" estado="ok"
        formulario={<form action="/x"><input name="aseguradora" /></form>}>
        <p>Quálitas · póliza 123</p>
      </Tarjeta>,
    );
    expect(h).toContain('Quálitas');
    expect(h).toContain('name="aseguradora"');
  });

  it('en error y en cargando el formulario NO se pinta (no se captura sobre un dato que no se pudo leer)', () => {
    for (const estado of ['error', 'cargando'] as const) {
      const h = renderToStaticMarkup(
        <Tarjeta titulo="Póliza" estado={estado} esqueleto={<div />}
          formulario={<form action="/x"><input name="aseguradora" /></form>} />,
      );
      expect(h, estado).not.toContain('name="aseguradora"');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// A51-FE-03 — El ancla de la pantalla se mudó a `emergencias/page.test.tsx`,
// que es el único sitio con el árbol REAL de la página, y aquí se queda el
// contrato del componente, que es lo que de verdad protege la propiedad.
//
// La versión anterior exigía tres `formulario={` literales en el TEXTO de
// `emergencias/page.tsx`. El rediseño F26 mudó la captura a `acciones` dentro
// de un `CajonAlta` y el ancla se puso roja durante 327 commits sin que el
// comportamiento se hubiera roto: la `Tarjeta` pinta `acciones` FUERA del
// switch de `estado` (`tarjeta.tsx:51`), así que la captura sigue alcanzable
// con cero datos, que es lo único que A47-FE-01 pedía.
//
// Se intentó reescribir el ancla como otro grep («la forma cuelga de una
// ranura») y se comprobó que NO PRUEBA NADA: sacando la forma de la póliza a
// los `children` y dejando un `acciones={<span/>}` vacío delante, las 6
// seguían verdes, porque un grep posicional no distingue «dentro de la ranura»
// de «después del texto de la ranura». Un ancla que no caza su propia mutación
// es peor que ninguna: enseña que el defecto ya está cubierto.
// ═══════════════════════════════════════════════════════════════════════════

describe('A51-FE-03 · el contrato de la ranura que sobrevive al vacío', () => {
  it('`acciones` se pinta en los cuatro estados; `children`, solo en ok', () => {
    for (const estado of ['ok', 'vacio', 'error', 'cargando'] as const) {
      const h = renderToStaticMarkup(
        <Tarjeta titulo="Proveedores" estado={estado} mensaje="Sin proveedores" esqueleto={<div />}
          acciones={<button type="button">Agregar proveedor</button>}>
          <p>Grúas del Bajío</p>
        </Tarjeta>,
      );
      // Por eso `CajonAlta` en `acciones` cumple A47-FE-01: la cabecera no
      // depende del estado, así que una flota con cero datos SÍ tiene captura.
      expect(h, `acciones en ${estado}`).toContain('Agregar proveedor');
      if (estado !== 'ok') expect(h, `children en ${estado}`).not.toContain('Grúas del Bajío');
    }
  });
});
