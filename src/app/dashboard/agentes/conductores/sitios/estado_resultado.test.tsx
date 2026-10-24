import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { FormaEstadoSitio } from './formas_estado';

// A37-S13-06 — archivar/reactivar descartaba el resultado: si la base fallaba o el sitio
// ya no existía, la fila seguía activa SIN mensaje y la geocerca seguía validando llegadas.
const PAGE = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8');
const VISTA = readFileSync(new URL('./vista.tsx', import.meta.url), 'utf8');

describe('A37-S13-06: archivar/reactivar devuelve y muestra el resultado', () => {
  it('la acción del servidor DEVUELVE el resultado de archivarSitioDelPanel (no void)', () => {
    const accion = PAGE.slice(PAGE.indexOf('async function accionEstado'), PAGE.indexOf('return (\n    <VistaSitios'));
    expect(accion).toMatch(/Promise<ResultadoSitio>/);
    expect(accion).toMatch(/return r;/);
    expect(accion).not.toMatch(/\n\s*await archivarSitioDelPanel/);
  });

  it('la vista usa la forma con estado (useActionState + Aviso), no un <form action> mudo', () => {
    expect(VISTA).toMatch(/<FormaEstadoSitio /);
    expect(VISTA).not.toMatch(/<form action=\{p\.accionEstado\}/);
  });

  it('la forma pinta el botón según el estado del sitio', () => {
    const accion = async () => null;
    expect(renderToStaticMarkup(<FormaEstadoSitio accion={accion} id="s1" activa />)).toContain('Archivar');
    expect(renderToStaticMarkup(<FormaEstadoSitio accion={accion} id="s1" activa={false} />)).toContain('Reactivar');
  });
});
