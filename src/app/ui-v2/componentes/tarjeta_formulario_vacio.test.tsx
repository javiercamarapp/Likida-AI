import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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

// El ancla de la pantalla que produjo la regresión: si alguien vuelve a meter un
// formulario de captura como `children` de una tarjeta con vacío, esto truena.
describe('A47-FE-01 · /dashboard/emergencias captura por la ranura, no por children', () => {
  const fuente = readFileSync(
    join(__dirname, '..', '..', 'dashboard', 'emergencias', 'page.tsx'), 'utf8',
  );

  it('las tres tarjetas con vacío pasan su formulario por `formulario=`', () => {
    // Tres tarjetas de captura: póliza, proveedores, contactos.
    expect((fuente.match(/formulario=\{/g) ?? []).length).toBe(3);
    expect((fuente.match(/<FormaConAviso/g) ?? []).length).toBe(3);
  });

  it('ningún FormaConAviso queda fuera de una ranura `formulario`', () => {
    // Cada `formulario={` tiene que abrirse ANTES del `<FormaConAviso` que le toca.
    const ranuras = [...fuente.matchAll(/formulario=\{/g)].map((m) => m.index ?? -1);
    const formas = [...fuente.matchAll(/<FormaConAviso/g)].map((m) => m.index ?? -1);
    expect(formas).toHaveLength(ranuras.length);
    for (let i = 0; i < formas.length; i += 1) expect(ranuras[i]).toBeLessThan(formas[i]);
  });
});
