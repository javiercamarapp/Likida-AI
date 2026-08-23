import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ComboCatalogo } from './combo-catalogo';
import { FiltroRegistro } from './registro-filtro';
import { paginarRegistro } from './paginar-registro';

// ═══════════════════════════════════════════════════════════════════════════
// LO QUE FE-2 Y FE-12 PROMETEN SE MIDE EN EL HTML SERVIDO, NO EN LA INTENCIÓN.
//
// El hallazgo era de PESO: un `<select>` con 7,500 `<option>` por fila, y
// registros que pintaban 5,000 formularios de edición. Una prueba que solo
// comprobara que "existe un buscador" seguiría verde con el catálogo pegado
// al lado. Estas dos miran el markup que sale por el cable:
//   · el combo NO trae una sola `<option>` (la lista se pide al usarlo);
//   · el filtro DECLARA "25 de 200" — un tope que no se dice se lee como
//     total — y conserva el `?tenant=` del superadmin en el GET, que es como
//     una búsqueda podría sacarlo de la flota que estaba mirando.
// ═══════════════════════════════════════════════════════════════════════════

describe('ComboCatalogo — el catálogo NO viaja (FE-2)', () => {
  it('sirve cero opciones y el campo del id vacío', () => {
    const html = renderToStaticMarkup(
      <ComboCatalogo tipo="operador" name="operadorId" buscar={async () => []}
        etiquetaVacia="Escribe el nombre del chofer…" total={7500} />,
    );
    expect(html).toContain('<datalist');
    // LA aserción del hallazgo: ni una `<option>` en el HTML inicial.
    expect(html).not.toContain('<option');
    // Lo que el formulario manda es el ID, y arranca vacío — nunca el texto.
    expect(html).toContain('name="operadorId" value=""');
    expect(html).toContain('Escribe el nombre del chofer');
  });

  it('con un valor ya elegido arranca lleno, y sigue sin catálogo', () => {
    const html = renderToStaticMarkup(
      <ComboCatalogo tipo="unidad" name="unidadId" buscar={async () => []}
        etiquetaVacia="Sin unidad" valorInicial="u-1" textoInicial="T-014" total={5000} />,
    );
    expect(html).toContain('name="unidadId" value="u-1"');
    expect(html).toContain('value="T-014"');
    expect(html).not.toContain('<option');
  });
});

describe('FiltroRegistro — el tope se declara y el sufijo sobrevive (FE-12)', () => {
  const filas = Array.from({ length: 200 }, (_, i) => ({ id: `u${i}`, eco: `T-${i}` }));

  it('dice cuántos de cuántos, y el GET conserva el ?tenant= del superadmin', () => {
    const pag = paginarRegistro(filas, (u) => u.eco, { p: '2' }, (u) => u.id);
    const html = renderToStaticMarkup(
      <FiltroRegistro ruta="/dashboard/unidades" sufijo="?tenant=t-9" pagina={pag}
        sustantivo="unidades" camposOcultos={[['tenant', 't-9']]} />,
    );
    expect(html).toContain('25 de 200 unidades');
    expect(html).toContain('Página 2 de 8');
    // Sin este hidden, buscar sacaría al superadmin de la flota que miraba.
    expect(html).toContain('name="tenant" value="t-9"');
    expect(html).toContain('/dashboard/unidades?tenant=t-9&amp;p=3');
  });

  it('con búsqueda dice cuántos COINCIDEN de cuántos hay — no solo cuántos se ven', () => {
    const pag = paginarRegistro(filas, (u) => u.eco, { q: 'T-1' }, (u) => u.id);
    const html = renderToStaticMarkup(
      <FiltroRegistro ruta="/dashboard/unidades" sufijo="" pagina={pag} sustantivo="unidades" />,
    );
    // T-1, T-10..T-19, T-100..T-199 = 111
    expect(html).toContain('111 coinciden de 200');
    expect(html).toContain('Quitar filtro');
  });
});
