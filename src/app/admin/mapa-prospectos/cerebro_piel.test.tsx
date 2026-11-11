/* eslint-disable security/detect-non-literal-fs-filename -- rutas fijas del propio módulo */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { COLOR_EMBUDO, type DatosMapa, type FilaCompacta, type ResumenProspectos } from '@/lib/admin/prospectos-mapa-client';
import { emojis } from '../guardas/medir';
import { Cerebro } from './cerebro';

// Fase 6: la piel del Cerebro cumple el contrato visual (cero emojis, hex, style= ni .card) y NO pierde ninguna capacidad.
const DIR = __dirname;
const FUENTES = [...readdirSync(DIR), ...readdirSync(join(DIR, '[id]')).map((f) => `[id]/${f}`)]
  .filter((f) => /\.(tsx?|css)$/.test(f) && !/\.test\./.test(f) && !/mexico-estados-geo/.test(f));
const leer = (f: string) => readFileSync(join(DIR, f), 'utf8');
const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('Cerebro: contrato visual', () => {
  it.each(FUENTES)('%s: sin emojis, sin colores hex, sin style= ni .card', (f) => {
    const t = sinComentarios(leer(f));
    expect(emojis(t), 'emoji').toBe(0);
    expect(t.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [], 'hex').toEqual([]);
    if (!f.endsWith('.css')) {
      expect(t).not.toMatch(/style=\{/);
      expect(t).not.toMatch(/className="card/);
      expect(t).not.toMatch(/<style>/);
    }
  });

  it('todo @keyframes y toda animation viven dentro de prefers-reduced-motion: no-preference', () => {
    const css = sinComentarios(leer('cerebro.css'));
    const i = css.indexOf('@media (prefers-reduced-motion: no-preference)');
    expect(i).toBeGreaterThan(0);
    const fuera = css.slice(0, i);
    expect(fuera).not.toMatch(/@keyframes|animation\s*:/);
    // No hay transiciones fuera de la capa de movimiento tampoco.
    expect(fuera).not.toMatch(/transition\s*:/);
  });

  it('cada etapa del embudo tiene su tinta en el CSS (rampa monocroma de la decisión 10, «Perdido» hueco)', () => {
    const css = leer('cerebro.css');
    for (const estado of Object.keys(COLOR_EMBUDO)) {
      expect(css, estado).toContain(`[data-etapa="${estado}"]`);
      expect(css, estado).toMatch(new RegExp(`\\.cer-e-${estado}[^{]*\\{ --etapa: `));
    }
    // Las etapas con rótulo distinto se distinguen por la tinta: ninguna comparte valor con otra.
    const tintas = [...css.matchAll(/\.cer-e-([a-z-]+) \{ --etapa: ([^;]+);/g)].filter((m) => !['perdido', 'lost'].includes(m[1])).map((m) => m[2]);
    expect(new Set(tintas).size).toBe(tintas.length);
  });

  it('«lost» y «perdido» se rotulan igual y salen como UNA sola etapa en la leyenda', () => {
    const html = renderToStaticMarkup(<Cerebro inicial={datos} />);
    const leyenda = html.slice(html.indexOf('Leyenda del embudo'));
    const bloque = leyenda.slice(0, leyenda.indexOf('</div>'));
    expect(bloque.split('Perdido').length - 1).toBe(1);
  });

  it('el ala izquierda sigue existiendo y solo aparece desde 1900 px', () => {
    expect(leer('cerebro.css')).toMatch(/@media \(min-width: 1900px\) \{ \.cer-ala \{ display: flex; \} \}/);
  });
});

const fila = (id: string, extra: Partial<Record<'empresa' | 'estado', string>> = {}): FilaCompacta => [
  id, extra.empresa ?? `Empresa ${id}`, 'Monterrey', 'Nuevo León', 25.67, -100.31, '8112345678', 'a@b.mx', 'Ana', 'Auxiliar de liquidaciones',
  extra.estado ?? 'contactado', 'censo', 'transportista', 75, 60, '31-50', 80, null, null, 40, 70, 65,
];
const datos: DatosMapa = { filas: [fila('1'), fila('2', { estado: 'demo' })], generadoEn: '2026-11-10T12:00:00.000Z', fallo: false, marca: null, delta: false, total: 2 };

describe('Cerebro: capacidades presentes en el render', () => {
  const html = renderToStaticMarkup(<Cerebro inicial={datos} />);

  it('mapa, ala izquierda, leyenda y las dos tarjetas de resumen', () => {
    expect(html).toContain('Mapa de México con la cartera de prospectos');
    expect(html).toContain('cer-ala');
    expect(html).toContain('Más cerrables');
    expect(html).toContain('Leyenda del embudo');
    expect(html).toContain('El embudo, en luces');
    expect(html).toContain('Dónde vive la cartera');
    expect(html).toContain('Los 12 más cerrables del país');
  });

  it('cifras, atajos y cajón de filtros con orden, radio, similitud, necesidad y toque', () => {
    for (const t of ['Prospectos', 'Con teléfono', 'Con decisor', 'Urgentes', 'Filtros']) expect(html).toContain(t);
    for (const t of ['Ordenar por', 'Cerca de (plaza)', 'Radio', 'Similitud ICP mínima', 'Necesidad mínima', 'Sin toque en', 'Etapa del embudo', 'Fuente']) {
      expect(html, t).toContain(t);
    }
    expect(html).toContain('Exportar CSV (2)');
  });

  it('los criterios de cálculo se enseñan (no se esconden)', () => {
    expect(html).toContain('Cómo se calculan los porcentajes');
    expect(html).toContain('Similitud con el ICP');
  });

  it('un solo h1 NO sale del Cerebro (lo pone el marco de la página)', () => {
    expect(html).not.toContain('<h1');
  });
});

// ── w15/perf (puntos 4 y 15): con SOLO el resumen del servidor el Cerebro ya pinta el mapa de color, el ranking y las cifras ─────────────
const resumen: ResumenProspectos = {
  generadoEn: '2026-11-11T12:00:00.000Z', total: 130, conTelefono: 100, conDecisor: 40, sinPlaza: 10,
  porEtapa: { nuevo: 100, contactado: 30 },
  porEntidad: {
    'Nuevo León': { n: 80, conTelefono: 70, conDecisor: 30, porEtapa: { nuevo: 60, contactado: 20 } },
    Jalisco: { n: 40, conTelefono: 30, conDecisor: 10, porEtapa: { nuevo: 30, contactado: 10 } },
  },
};

describe('Cerebro con SOLO el resumen (el detalle llega después)', () => {
  const html = renderToStaticMarkup(<Cerebro resumen={resumen} />);

  it('las cifras salen del resumen y las que solo el detalle sabe se dicen «cargando» (no un cero)', () => {
    expect(html).toContain('130'); // prospectos
    expect(html).toContain('Cargando el detalle de la cartera');
    expect(html).not.toContain('Urgentes</span><span');
  });

  it('mapa de color: cada estado con prospectos lleva su paso de la rampa; el máximo, el más oscuro', () => {
    expect(html).toContain('data-paso="5"'); // Nuevo León (el máximo)
    expect(html).toMatch(/data-paso="[1-4]"/); // Jalisco (40 de 80: paso intermedio)
  });

  it('ranking lateral: estados con su cifra exacta, de más a menos, y la leyenda de la rampa con sus rangos reales', () => {
    expect(html).toContain('Estados con más prospectos');
    expect(html.indexOf('Nuevo León')).toBeLessThan(html.indexOf('Jalisco', html.indexOf('cer-rank__lista')));
    expect(html).toContain('cer-rampa');
    expect(html).toContain('10 sin plaza conocida');
  });

  it('los controles que dependen del detalle (filtros, atajos) esperan a que llegue', () => {
    expect(html).toMatch(/<button[^>]*disabled[^>]*>[^]*?Filtros/);
  });

  it('el HTML NO crece con la cartera: 130 o 33,148 prospectos pesan lo mismo (solo cambian unas cifras)', () => {
    expect(html).not.toContain('Empresa 1');
    const grande = renderToStaticMarkup(<Cerebro resumen={{ ...resumen, total: 33_148, conTelefono: 20_000, conDecisor: 9_000, sinPlaza: 500 }} />);
    expect(Math.abs(grande.length - html.length)).toBeLessThan(500);
  });
});
