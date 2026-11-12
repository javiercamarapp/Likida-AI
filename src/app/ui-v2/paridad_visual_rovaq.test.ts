/* eslint-disable security/detect-non-literal-fs-filename -- lee el CSS del propio módulo por rutas fijas. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { matizDeEtiqueta } from './graficas/matiz-etiqueta';
import { TiraCifras } from './graficas';

// Paridad visual con Rovaq (auditoría en vivo 10-nov, puntos 8, 9, 10, 14 y 20). Cada valor sale de getComputedStyle en app.rovaq.ai.
const css = (f: string) => readFileSync(join(__dirname, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const chat = css('chat.css');
const graf = css('graficas.css');
const comp = css('componentes.css');
const pie = css('pie-sidebar.css');
const sistema = readFileSync(join(__dirname, '..', 'admin', 'sistema.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

describe('filete de KPI con el color de cada métrica (punto 8)', () => {
  it('la etiqueta decide el matiz por su familia, igual que el registro de métricas', () => {
    expect(matizDeEtiqueta('Monto comprobado')).toBe(1);
    expect(matizDeEtiqueta('Gasto de IA (30 días)')).toBe(2);
    expect(matizDeEtiqueta('CFDI timbrados')).toBe(3);
    expect(matizDeEtiqueta('Anticipos abiertos')).toBe(4);
    expect(matizDeEtiqueta('A tiempo')).toBe(5);
    expect(matizDeEtiqueta('Requiere acción')).toBe(6);
    expect(matizDeEtiqueta('Incidencias abiertas')).toBe(7);
    expect(matizDeEtiqueta('Viajes')).toBe(8);
  });
  it('la prioridad evita el color engañoso: «Facturas vencidas» es acción, «Gasto pendiente» es pendiente', () => {
    expect(matizDeEtiqueta('Facturas vencidas')).toBe(6);
    expect(matizDeEtiqueta('Gasto pendiente')).toBe(4);
  });
  it('una etiqueta sin familia NO lleva filete (un color sin significado es decoración)', () => {
    expect(matizDeEtiqueta('Zxq')).toBeUndefined();
    const h = renderToStaticMarkup(createElement(TiraCifras, { items: [{ etiqueta: 'Zxq', valor: 3 }, { etiqueta: 'Monto comprobado', valor: 5 }] }));
    expect(h).toContain('data-matiz="1"');
    expect(h.match(/data-matiz=/g)).toHaveLength(1);
  });
  it('una celda con tono de atención conserva su tono y no recibe un matiz inventado', () => {
    const h = renderToStaticMarkup(createElement(TiraCifras, { items: [{ etiqueta: 'Viajes', valor: 3, tono: 'bad' }] }));
    expect(h).not.toContain('data-matiz');
  });
  it('la etiqueta de KPI es 11px/600 MAYÚSCULAS con tracking .06em', () => {
    expect(graf).toMatch(/\[data-ui="v2"\] \.rv-kpi__etq \{ font: 600 11px\/1\.3[^}]*text-transform: uppercase; letter-spacing: \.06em/);
  });
});

describe('cabecera de tablas con tinte y texto de Rovaq (punto 9)', () => {
  it('el padding es 0 12px 0 14px y el color sale de los tokens petróleo', () => {
    expect(comp).toMatch(/\.card table thead th \{[^}]*height: 36px; padding: 0 12px 0 14px/);
    expect(comp).toMatch(/color: var\(--tabla-cab-ink\); background: var\(--tabla-cab-bg\)/);
  });
});

describe('Copiloto: tema activo en alto contraste neutro (punto 10 del dueño, 11-nov; anula el azul de Rovaq)', () => {
  it('fondo = 10 % de la tinta sobre la superficie y borde en tinta (sin azul)', () => {
    expect(chat).toMatch(/\.rv-chat__tema\[aria-pressed="true"\] \{[^}]*border-color: var\(--ink\); background: color-mix\(in srgb, var\(--ink\) 10%, var\(--surface\)\)/);
    expect(css('tokens.css')).toMatch(/--chart-1: #0e0e10;/);
  });
  it('el botón Historial mide 32 px', () => {
    expect(chat).toMatch(/\.rv-chat \.rv-btn\.rv-chat__hist-boton \{[^}]*height: 32px/);
  });
});

describe('enlace externo en línea (punto 14)', () => {
  it('el enlace es inline-flex con el ícono a su lado', () => {
    expect(sistema).toMatch(/\.adm-sis-fila__enlace \{ display: inline-flex; align-items: center; gap: 4px/);
  });
});

describe('tipografía del pie y de los rótulos (punto 20)', () => {
  it('eyebrow 12px/600 con tracking .06em (0.72 px) en v2 (la regla v1 queda intacta)', () => {
    expect(comp).toMatch(/\[data-ui="v2"\] \.rv-encabezado__rotulo \{[^}]*font: 600 12px[^}]*letter-spacing: \.06em/);
  });
  it('selector de organización 12/400, «Ir» y acceso cruzado 12/500 (nada de 13 px en el pie)', () => {
    expect(pie).toMatch(/\.rv-ps-campo \{[^}]*font: 400 12px\/1/);
    expect(pie).toMatch(/\.rv-ps-ir \{[^}]*font: 500 12px\/1/);
    expect(pie).toMatch(/\.rv-ps-acceso \{[^}]*font: 500 12px\/1\.25/);
    expect(pie).not.toMatch(/font: [0-9]+ 13px/);
  });
});
