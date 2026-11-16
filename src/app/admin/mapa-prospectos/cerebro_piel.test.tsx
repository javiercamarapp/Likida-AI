/* eslint-disable security/detect-non-literal-fs-filename -- rutas fijas del propio módulo */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { COLOR_EMBUDO, type DatosMapa, type FilaCompacta, type ProspectoMapa, type ResumenProspectos } from '@/lib/admin/prospectos-mapa-client';
import { emojis } from '../guardas/medir';
import { T_SISTEMA_ES } from '@/lib/i18n/sistema_tr';
import { Cerebro, LeyendaColor, TarjetaProspecto } from './cerebro';

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

  // Decisión de Javier (16-nov): el Cerebro vuelve a llevar color. Reemplaza la rampa monocroma de la decisión 10.
  const FAMILIA_COLOR: Record<string, string> = {
    nuevo: 'azul', contactado: 'azul', appointment: 'violeta', demo: 'violeta', rescheduled: 'violeta',
    proposal: 'naranja', negociacion: 'naranja', pilot: 'naranja', won: 'verde', cerrado: 'verde',
    'no-show': 'ocre', cancelled: 'ocre',
  };

  it('cada etapa del embudo tiene el matiz de su familia (azul, violeta, naranja, verde, ocre) y «perdido» va hueco', () => {
    const css = leer('cerebro.css');
    for (const estado of Object.keys(COLOR_EMBUDO)) {
      expect(css, estado).toContain(`[data-etapa="${estado}"]`);
      const regla = css.match(new RegExp(`\\.cer-e-${estado}[^{]*\\{ --etapa: ([^;]+);`))?.[1];
      expect(regla, estado).toBeDefined();
      if (estado === 'perdido' || estado === 'lost') expect(regla).toBe('var(--surface)');
      else expect(regla, estado).toBe(`var(--cer-${FAMILIA_COLOR[estado]})`);
    }
    expect(css).toMatch(/\.cer-punto\[data-etapa="perdido"\][^}]*box-shadow: inset/);
    // Ya no hay tintas de la rampa monocroma en las etapas.
    expect(css).not.toMatch(/\[data-etapa="[a-z-]+"\][^{]*\{ --etapa: color-mix\(in srgb, var\(--ink\)/);
  });

  it('los cuatro niveles de urgencia tienen su color en el CSS: burdeos, ocre, verde y gris', () => {
    const css = leer('cerebro.css');
    expect(css).toMatch(/\[data-urgencia="urgente"\][^{]*\{ --urg: var\(--cer-burdeos\); \}/);
    expect(css).toMatch(/\[data-urgencia="atencion"\][^{]*\{ --urg: var\(--cer-ocre\); \}/);
    expect(css).toMatch(/\[data-urgencia="aldia"\][^{]*\{ --urg: var\(--cer-verde\); \}/);
    expect(css).toMatch(/\[data-urgencia="frio"\][^{]*\{ --urg: var\(--cer-gris\); \}/);
    // Burdeos, ocre y verde salen de los semáforos del sistema; el azul, el violeta y el naranja no existen como token y se declaran aquí, en oklch (sin hex).
    expect(css).toMatch(/--cer-burdeos: var\(--senal\);/);
    expect(css).toMatch(/--cer-ocre: var\(--warn\);/);
    expect(css).toMatch(/--cer-verde: var\(--ok\);/);
    for (const m of ['azul', 'violeta', 'naranja']) expect(css).toMatch(new RegExp(`--cer-${m}: oklch\\(`));
    expect(css).toMatch(/:root\[data-theme="dark"\] \[data-ui="v2"\] \{[^}]*--cer-azul: oklch/);
  });

  it('las luces toman la urgencia o el grupo de etapa según «Colorear por»; el mapa de color usa el matiz del modo', () => {
    const css = leer('cerebro.css');
    expect(css).toContain('.cer-raiz[data-colorear="urgencia"] .cer-pin { fill: var(--urg); }');
    expect(css).toContain('.cer-raiz[data-colorear="etapa"] .cer-pin { fill: var(--grupo); }');
    for (const g of ['inicio', 'cita', 'propuesta', 'cierre', 'caida', 'perdido']) expect(css, g).toContain(`.cer-estado[data-matiz="${g}"]`);
    expect(css).toContain('.cer-estado[data-matiz="urgente"]');
  });

  it('los ocho tonos de empresa existen en el CSS (monograma) y cada uno tiene su variante clara y oscura', () => {
    const css = leer('cerebro.css');
    for (let n = 1; n <= 8; n++) {
      expect(css, `tono ${n}`).toContain(`.cer-mono[data-tono="${n}"] { --cer-tono: var(--cer-tono-${n}); }`);
      expect(css.match(new RegExp(`--cer-tono-${n}: oklch`, 'g'))?.length, `claro y oscuro ${n}`).toBe(2);
    }
  });

  it('solo se animan transform y opacity (más el color); ningún @keyframes toca layout', () => {
    const css = sinComentarios(leer('cerebro.css'));
    const cuerpos = [...css.matchAll(/@keyframes [\w-]+ \{(.*)\}\s*$/gm)].map((m) => m[1]);
    expect(cuerpos.length).toBeGreaterThanOrEqual(10);
    for (const c of cuerpos) {
      for (const prop of c.matchAll(/([a-z-]+)\s*:/g)) expect(['opacity', 'transform'], c).toContain(prop[1]);
    }
  });

  it('la geometría original del mapa se conserva: alto por calc(100dvh), mapa + ranking de 320 px y paneles estirados', () => {
    const css = leer('cerebro.css');
    expect(css).toContain('height: calc(100dvh - 17rem); min-height: 480px; }');
    expect(css).toContain('height: calc(100dvh - 20rem); min-height: 440px; }');
    expect(css).toContain('grid-template-columns: minmax(0, 1fr) 320px');
    expect(css).toContain('.cer-fila-baja { align-items: stretch; }');
    expect(css).not.toMatch(/\.cer-(zona|rank)[^{]*\{[^}]*clamp\(/);
  });

  it('«lost» y «perdido» salen como UNA sola etapa en «El embudo, en luces»; la leyenda de color lleva cuatro niveles con texto y cantidad', () => {
    const html = renderToStaticMarkup(<Cerebro inicial={datos} />);
    const embudo = html.slice(html.indexOf('El embudo, en luces'));
    expect(embudo.slice(0, embudo.indexOf('</section>')).split('Perdido').length - 1).toBe(1);
    // Dos leyendas: la compacta sobre el mapa y la ancha (con conteos) en el ranking.
    expect(html.match(/<ul class="cer-leyenda-color/g)?.length).toBe(2);
    const ancha = html.slice(html.lastIndexOf('<ul class="cer-leyenda-color'));
    const bloque = ancha.slice(0, ancha.indexOf('</ul>'));
    expect(bloque.match(/data-urgencia=/g)?.length).toBe(4);
    for (const t of ['Urgente', 'Atención', 'Al día', 'Frío']) expect(bloque, t).toContain(t);
    expect(bloque.match(/<b>/g)?.length).toBe(4);
  });

  it('el conmutador «Colorear por» está en la barra, con Urgencia por omisión', () => {
    const html = renderToStaticMarkup(<Cerebro inicial={datos} />);
    expect(html).toContain('Colorear por');
    expect(html).toContain('data-colorear="urgencia"');
    expect(html).toMatch(/aria-checked="true"[^>]*>Urgencia</);
    expect(html).toMatch(/aria-checked="false"[^>]*>Etapa</);
  });

  it('la leyenda por etapa tiene seis grupos con texto y su matiz (data-grupo)', () => {
    const html = renderToStaticMarkup(<LeyendaColor modo="etapa" tx={T_SISTEMA_ES} idioma="es" conteos={{ nivel: new Map(), grupo: new Map() }} />);
    expect(html.match(/data-grupo=/g)?.length).toBe(6);
    for (const t of ['Nuevo o contactado', 'Cita, demo o reprogramada', 'Propuesta, negociación o piloto', 'Ganado o cliente', 'No se presentó o cancelada', 'Perdido']) {
      expect(html, t).toContain(t);
    }
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
    // 16-nov: la leyenda sigue al modo de color; por omisión es Urgencia.
    expect(html).toContain('Leyenda de urgencia');
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

// ── La identidad y la urgencia en cada tarjeta ──────────────────────────────────────────────────────────────────
const prospecto = (urgencia: number, extra: Partial<{ estado: string; empresa: string; ultimoToque: string | null }> = {}): ProspectoMapa => ({
  id: 'p1', empresa: extra.empresa ?? 'Fletes del Norte', ciudad: 'Escobedo', entidad: 'Nuevo León', lat: null, lng: null, telefono: null, correo: null,
  contacto: null, vacante: null, estado: extra.estado ?? 'contactado', fuente: 'censo', giro: 'transportista', urgencia, cierre: 60,
  tamano: null, completitud: 90, ultimoToque: extra.ultimoToque ?? null, mensajesGeneradosEn: null, numUnidades: null, similitudIcpPct: 80, necesidadPct: 70,
});

describe('la tarjeta del prospecto: monograma, etapa y urgencia, siempre con texto', () => {
  it.each([
    [90, 'contactado', null, 'urgente', 'Urgente'],
    [55, 'contactado', null, 'atencion', 'Atención'],
    [20, 'contactado', '2026-11-01T00:00:00.000Z', 'aldia', 'Al día'],
    [20, 'contactado', null, 'frio', 'Frío'],
  ] as const)('urgencia %i en %s (toque %s): nivel %s con su texto «%s» y su aria-label', (urgencia, estado, ultimoToque, nivel, texto) => {
    const html = renderToStaticMarkup(<TarjetaProspecto p={prospecto(urgencia, { estado, ultimoToque })} nuevo={false} />);
    expect(html).toContain(`data-urgencia="${nivel}"`);
    expect(html).toContain(`>${texto}</span>`);
    expect(html).toContain(`aria-label="Fletes del Norte: etapa Contactado, urgencia ${texto}"`);
  });

  it.each(Object.keys(COLOR_EMBUDO))('la etapa %s sale con su punto (data-etapa) y su nombre en texto', (estado) => {
    const html = renderToStaticMarkup(<TarjetaProspecto p={prospecto(10, { estado })} nuevo={false} />);
    expect(html).toContain(`<i class="cer-punto" data-etapa="${estado}"`);
    expect(html).toContain('class="cer-etapa"');
  });

  it('el monograma lleva las iniciales y un tono determinista (el mismo nombre, el mismo tono)', () => {
    const a = renderToStaticMarkup(<TarjetaProspecto p={prospecto(10)} nuevo={false} />);
    const b = renderToStaticMarkup(<TarjetaProspecto p={prospecto(80)} nuevo={false} />);
    expect(a).toMatch(/<span class="cer-mono" data-tono="[1-8]" aria-hidden="true">FN<\/span>/);
    expect(a.match(/data-tono="\d"/)?.[0]).toBe(b.match(/data-tono="\d"/)?.[0]);
  });
});

describe('Cerebro: el movimiento y los tokens del color nuevo', () => {
  it('todo token --cer-* que se usa sin respaldo está declarado al inicio de línea en el propio CSS', () => {
    const css = sinComentarios(leer('cerebro.css'));
    const definidos = new Set([...css.matchAll(/^\s*(--[a-zA-Z0-9-]+)\s*:/gm)].map((m) => m[1]));
    const usados = new Set([...css.matchAll(/var\((--cer-[a-zA-Z0-9-]+|--etapa|--grupo|--urg)\)/g)].map((m) => m[1]));
    for (const t of usados) expect(definidos.has(t), t).toBe(true);
  });

  it('el pop de las luces, el anillo de las urgentes, el conteo y el esqueleto viven dentro de la guarda de movimiento', () => {
    const css = sinComentarios(leer('cerebro.css'));
    const dentro = css.slice(css.indexOf('@media (prefers-reduced-motion: no-preference)'));
    for (const k of ['cer-pop', 'cer-onda', 'cer-barra', 'cer-brillo', 'cer-sube']) expect(dentro, k).toContain(`@keyframes ${k}`);
  });
});
