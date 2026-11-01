/* eslint-disable security/detect-non-literal-fs-filename -- rutas fijas del propio módulo (o UI2_CSS_DIR para la prueba de rojo) */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Browser, type Page } from 'playwright';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.setConfig({ testTimeout: 30_000 }); // Chromium bajo una Mac cargada
import { lanzarNavegador, SIN_NAVEGADOR } from './navegador_prueba';
import { EstadoVacio, Switch } from './componentes';
import { AreaMini, BarraApilada, DonaMini } from './graficas';

// Lo que SOLO se ve pintado: la línea del área continua (pixeles), el hueco punteado, el vacío de una línea en 390,
// la leyenda de la dona sin estirar y las barras/switch en alto contraste forzado. Chromium real; se omite sin él.
const DIR = process.env.UI2_CSS_DIR ?? __dirname;
let browser: Browser | null = null;
beforeAll(async () => { browser = await lanzarNavegador(); }, 60_000);
afterAll(async () => { await browser?.close(); });

const css = () => ['tokens.css', 'movimiento.css', 'componentes.css', 'graficas.css'].map((f) => readFileSync(join(f === 'componentes.css' || f === 'graficas.css' || f === 'movimiento.css' ? DIR : __dirname, f), 'utf8')).join('\n');
// El punto final lleva un anillo de la superficie de 2 px (como en Vexa) que tapa la línea a ambos lados: hasta 3 columnas sin azul junto a él;
// una línea PARTIDA (el defecto que esta prueba vigila) deja decenas.
const ANILLO = 3;
const SERIE = [12, 14, 13, 17, 16, 21, 19, 24, 22, 27];
const HTML = `<div data-ui="v2" style="padding:16px">
  <section class="card" style="padding:12px"><div id="a1">${renderToStaticMarkup(<AreaMini valores={SERIE} matiz={1} etiqueta="Serie completa" />)}</div></section>
  <section class="card" style="padding:12px"><div id="a2">${renderToStaticMarkup(<AreaMini valores={[3, 5, null, null, 8, 9, 7]} matiz={2} etiqueta="Con hueco" />)}</div></section>
  <section class="card" style="padding:12px"><div id="dona">${renderToStaticMarkup(<DonaMini matiz={2} etiqueta="Rubros" gajos={[{ etiqueta: 'Diésel', valor: 91000 }, { etiqueta: 'Casetas', valor: 48200 }]} />)}</div></section>
  <section class="card" style="padding:12px"><div id="vacio">${renderToStaticMarkup(<EstadoVacio titulo="Sin desgloses todavía" accion={<button className="rv-btn rv-btn--sm" type="button">Ir a Conexiones</button>}>Entrega un archivo y aparece aquí.</EstadoVacio>)}</div></section>
  <section class="card" style="padding:12px"><div id="barras">${renderToStaticMarkup(<><BarraApilada matiz={3} etiqueta="Estado" segmentada tramos={[{ etiqueta: 'A', valor: 8 }, { etiqueta: 'B', valor: 2 }]} /><Switch nombre="sw" etiqueta="Aviso" defaultChecked /></>)}</div></section>
</div>`;

async function pagina(ancho: number, opts: { reducedMotion?: 'reduce' | 'no-preference'; forcedColors?: 'active' } = {}): Promise<Page> {
  const p = await browser!.newPage({ viewport: { width: ancho, height: 1400 }, reducedMotion: opts.reducedMotion ?? 'no-preference', forcedColors: opts.forcedColors });
  await p.setContent(`<!doctype html><html data-theme="light"><head><style>*{box-sizing:border-box}${css()}</style></head><body>${HTML}</body></html>`);
  return p;
}

/** Columnas de la zona de la línea (en px de pantalla) que NO tienen ningún píxel de la línea azul. */
async function columnasSinLinea(p: Page, mitad = false): Promise<number> {
  const r = await diagnostico(p, mitad);
  if (r.vacias > ANILLO) throw new Error(`línea del área con ${r.vacias} columnas sin línea (máx. ${ANILLO}). Ancho ${r.ancho}px, primera=${r.primera}, ultima=${r.ultima}, vacías=[${r.huecos.join(',')}]\nColores no blancos más frecuentes: ${r.colores}\nMapa (# = línea, o = otro pixel con tinta):\n${r.mapa}`);
  return r.vacias;
}
async function diagnostico(p: Page, mitad: boolean) {
  // mitad = capturar CON la animación de entrada en curso (como hace el arnés): la línea puede estar a medias,
  // pero nunca partida; el recuento son solo los huecos INTERNOS entre la primera y la última columna con línea.
  if (!mitad) await p.waitForTimeout(900); // la animación de entrada (≤ 420 ms) ya terminó
  const caja = await p.locator('#a1 .rv-gr-plot svg').boundingBox();
  // La medición se acota al rectángulo del TRAZO (getBBox del path, en px del SVG = px de la captura): fuera de él hay texto (marcas del eje y etiqueta
  // directa) cuyo suavizado sub-pixel LCD (franjas azules en el Chromium de Linux del CI) no es la línea y daba extremos falsos.
  const bbox = await p.evaluate(() => { const b = (document.querySelector('#a1 .rv-area__linea') as SVGGraphicsElement).getBBox(); return [b.x, b.y, b.x + b.width, b.y + b.height]; });
  const png = await p.screenshot({ clip: caja!, animations: 'allow' });
  return p.evaluate(async ([b64, enCurso, bb]) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const x = c.getContext('2d')!; x.drawImage(img, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height).data;
    let vacias = 0;
    const desde = Math.max(0, Math.floor(bb[0]) - 2), hasta = Math.min(c.width, Math.ceil(bb[2]) + 2); // del primer al último px del trazo
    const fila0 = Math.max(0, Math.floor(bb[1]) - 3), fila1 = Math.min(c.height, Math.ceil(bb[3]) + 3);
    const cubiertas: boolean[] = [];
    for (let col = desde; col < hasta; col++) {
      let hay = false;
      for (let fila = fila0; fila < fila1 && !hay; fila++) {
        const i = (fila * c.width + col) * 4;
        const [r, g, bl] = [d[i], d[i + 1], d[i + 2]];
        if (bl > 70 && r < 110 && g < 150 && bl - r > 30) hay = true; // azul de la métrica 1 (#2f6bd8, paleta de datos de Vexa)
      }
      cubiertas.push(hay);
    }
    const primera = cubiertas.indexOf(true) + desde, ultima = cubiertas.lastIndexOf(true) + desde;
    const rel = (k: number) => k - desde;
    const huecos: number[] = [];
    for (let k = primera; primera >= desde && k <= ultima; k++) if (!cubiertas[rel(k)]) { vacias++; huecos.push(k); }
    // terminada la animación, la línea debe cubrir el trazo entero (no solo no estar partida)
    // Extremos medidos contra el TRAZO: arranca en su borde izquierdo (±4 px) y llega a su borde derecho (±8 px: el anillo del punto final lo tapa).
    if (!enCurso && (primera < desde || primera > bb[0] + 4 || ultima < bb[2] - 8)) vacias += 1000;
    // Diagnóstico para el log del CI: mapa ASCII 120×30 del plano y los colores más frecuentes que no son blanco.
    const esLinea = (i: number) => d[i + 2] > 70 && d[i] < 110 && d[i + 1] < 150 && d[i + 2] - d[i] > 30; // la MISMA regla del detector
    const cols = 120, filas = 30, mapa: string[] = [];
    for (let fy = 0; fy < filas; fy++) {
      let linea = '';
      for (let fx = 0; fx < cols; fx++) {
        let ch = '.';
        for (let yy = Math.floor((fy * c.height) / filas); yy < Math.floor(((fy + 1) * c.height) / filas); yy++) {
          for (let xx = Math.floor((fx * c.width) / cols); xx < Math.floor(((fx + 1) * c.width) / cols); xx++) {
            const i = (yy * c.width + xx) * 4;
            if (esLinea(i)) { ch = '#'; } else if (ch === '.' && d[i] + d[i + 1] + d[i + 2] < 600) ch = 'o';
          }
        }
        linea += ch;
      }
      mapa.push(linea);
    }
    const frecuencias = new Map<string, number>();
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] + d[i + 1] + d[i + 2] > 735) continue;
      const k = `${d[i] >> 4 << 4},${d[i + 1] >> 4 << 4},${d[i + 2] >> 4 << 4}`;
      frecuencias.set(k, (frecuencias.get(k) ?? 0) + 1);
    }
    const colores = [...frecuencias.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, n]) => `rgb(${k})×${n}`).join('  ');
    return { vacias, huecos, primera, ultima, ancho: c.width, mapa: mapa.join('\n'), colores };
  }, [png.toString('base64'), mitad, bbox] as const);
}

describe.skipIf(SIN_NAVEGADOR)('gráficas y vacíos · pintados en Chromium', () => {
  for (const ancho of [1060, 1280, 1440]) {
    it(`${ancho}: la línea del área con serie SIN nulos es continua (ninguna columna sin línea)`, async () => {
      const p = await pagina(ancho);
      expect(await columnasSinLinea(p)).toBeLessThanOrEqual(ANILLO);
      await p.close();
    });
  }
  for (const ancho of [1280, 1440]) {
    it(`${ancho}: capturada CON la animación en curso, la línea nunca sale partida (sin huecos internos)`, async () => {
      const p = await pagina(ancho);
      await p.waitForTimeout(120);
      expect(await columnasSinLinea(p, true)).toBeLessThanOrEqual(ANILLO);
      await p.close();
    });
  }
  it('el texto del eje y de la etiqueta directa en el azul de la serie (franjas LCD del CI) no cuenta como línea ni mueve los extremos', async () => {
    const p = await pagina(1280);
    await p.addStyleTag({ content: '[data-ui="v2"] .rv-gr__marca, [data-ui="v2"] .rv-gr__directa { fill: rgb(32,96,208) !important }' });
    expect(await columnasSinLinea(p)).toBeLessThanOrEqual(ANILLO);
    await p.close();
  });
  it('1440 y reduced-motion: también continua', async () => {
    const p = await pagina(1440, { reducedMotion: 'reduce' });
    expect(await columnasSinLinea(p)).toBeLessThanOrEqual(ANILLO);
    await p.close();
  });
  it('el hueco de nulos se dibuja punteado (con regla CSS) y no hay guion sobre la línea', async () => {
    const p = await pagina(1280);
    await p.waitForTimeout(900); // el trazo de entrada (380 ms) ya terminó
    const r = await p.evaluate(() => ({
      hueco: getComputedStyle(document.querySelector('#a2 .rv-area__hueco')!).strokeDasharray,
      ancho: getComputedStyle(document.querySelector('#a2 .rv-area__hueco')!).strokeWidth,
      guion: getComputedStyle(document.querySelector('#a1 .rv-area__linea')!).strokeDasharray,
    }));
    expect(r.hueco).not.toBe('none');
    expect(parseFloat(r.ancho)).toBeGreaterThan(0);
    expect(r.guion).toBe('none'); // en reposo la línea es continua: el guion de pathLength solo existe mientras se dibuja
    await p.close();
  });
  it('390: el estado vacío es un bloque compacto (título + acción) sin borde punteado, de ≤ 120 px', async () => {
    const p = await pagina(390);
    const r = await p.evaluate(() => { const e = document.querySelector('#vacio .rv-vacio')!; return { h: e.getBoundingClientRect().height, borde: getComputedStyle(e).borderTopStyle }; });
    expect(r.h).toBeLessThanOrEqual(120);
    expect(r.borde).toBe('none');
    await p.close();
  });
  it('1440: la leyenda de la dona no se estira (etiqueta y cifra juntas)', async () => {
    const p = await pagina(1440);
    const w = await p.evaluate(() => document.querySelector('#dona .rv-dona__leyenda')!.getBoundingClientRect().width);
    expect(w).toBeLessThanOrEqual(281);
    await p.close();
  });
  it('alto contraste forzado: barras y perilla del switch no desaparecen (se pintan con colores del sistema)', async () => {
    const p = await pagina(1280, { forcedColors: 'active' });
    const r = await p.evaluate(() => {
      const bg = (s: string) => getComputedStyle(document.querySelector(s)!).backgroundColor;
      const canvas = getComputedStyle(document.body).backgroundColor;
      return { tramo: bg('#barras .rv-apilada__tramo'), perilla: bg('#barras .rv-switch__perilla'), pista: getComputedStyle(document.querySelector('#barras .rv-switch__pista')!).borderTopWidth, canvas };
    });
    expect(r.tramo).not.toBe(r.canvas);
    expect(r.tramo).not.toBe('rgba(0, 0, 0, 0)');
    expect(r.perilla).not.toBe(r.canvas);
    expect(r.pista).toBe('1px');
    await p.close();
  });
});
