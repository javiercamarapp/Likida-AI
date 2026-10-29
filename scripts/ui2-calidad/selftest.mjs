// Autoprueba del detector: una pantalla LIMPIA debe dar 0 hallazgos y una pantalla SUCIA (con una falla de cada tipo)
// debe disparar cada subcriterio. Si no, el detector no mide lo que dice medir. Se invoca con detectar.mjs --selftest.
const ESTILO = `
  body{margin:0;font:13px/1.4 sans-serif;color:#0e0e10;background:#f6f6f7}
  button{position:relative;font:600 13px sans-serif}
  .b::after{content:'';position:absolute;inset:-6px}
  .tarj{border:1px solid #e6e6e8;border-radius:12px;background:#fff;padding:14px}
`;

const LIMPIA = `
<main id="contenido-principal" style="padding:24px">
  <h1 style="font-size:20px;margin:0 0 12px">Pantalla limpia</h1>
  <div style="display:flex;gap:12px;margin-bottom:12px">
    ${[1, 2, 3, 4].map((i) => `<div class="tarj" style="flex:1"><p style="margin:0;font-size:12px;color:#5a5a61">Etiqueta ${i}</p><div class="kpi-valor" style="font-size:26px;font-weight:700;line-height:32px">1,23${i}</div></div>`).join('')}
  </div>
  <div style="display:flex;gap:8px;margin-bottom:12px;padding:6px 0">
    <button class="b" style="height:32px;padding:0 12px;border:1px solid #d6d6d9;border-radius:8px;background:#fff;color:#0e0e10">Acción</button>
    <button class="b" style="height:32px;padding:0 12px;border:0;border-radius:8px;background:#0e0e10;color:#fff">Primaria</button>
    <span class="chip" style="height:28px;padding:0 12px;border-radius:999px;border:1px solid #d6d6d9;background:#fff;display:inline-flex;align-items:center;font-size:12px">Chip</span>
  </div>
  <div style="display:flex;gap:12px"><div class="tarj" style="flex:1"><p style="margin:0">Texto de la tarjeta de ancho completo</p></div></div>
</main>`;

const SUCIA = `
<main id="contenido-principal" style="padding:30px;width:100%">
  <h1 style="font-size:32px;margin:0">Uno</h1><h1 style="font-size:20px">Dos</h1>
  <div><button style="height:48px;padding:0 12px;border:1px solid #888;border-radius:5px;background:#fff">Gordo</button></div>
  <div><button style="height:40px;padding:0 12px;border:0;border-radius:8px;background:#0e0e10;color:#fff">Primario alto</button></div>
  <div><select style="height:44px" aria-label="s"><option>a</option></select></div>
  <div style="display:flex"><button style="height:32px;border:1px solid #888;margin-right:3px">A</button><button style="height:32px;border:1px solid #888">B</button></div>
  <div style="padding:30px 0"><button style="height:24px;border:1px solid #888;background:#fff">Chico</button></div>
  <p style="font-size:9px">Texto de nueve píxeles</p><p style="font-size:17px">Diecisiete</p>
  <div class="kpi-valor" style="font-size:40px">9,999</div>
  <div class="tarj" style="padding:24px;width:600px;height:200px">Una línea y vacío abajo</div>
  <div style="display:flex;width:1000px;gap:20px;margin-top:12px"><div class="tarj" style="width:300px;height:100px">x</div><div class="tarj" style="width:300px;height:160px">y</div></div>
  <div style="min-height:300px">contenido corto con min-height</div>
  <div style="width:3000px;height:4px;background:#ccc"></div>
  <div style="width:50px;overflow:hidden;white-space:nowrap">texto largo que se recorta sin elipsis</div>
  <div style="display:flex"><div style="width:100px;height:30px;background:#ddd">a</div><div style="width:100px;height:30px;margin-left:-40px;background:#bbb">b</div></div>
  <button><svg width="10" height="10"></svg></button>
  <p style="color:#bbbbbb;background:#ffffff">Texto gris claro sobre blanco</p>
  <div style="background:#f7f7f7;padding:10px"><button style="background:#f6f6f6;border:0;border-radius:8px;height:32px;padding:0 12px;color:#0e0e10">gris sobre gris</button></div>
</main>`;

const CAPA_BUENA = `<div style="position:fixed;inset:0;background:#f6f6f7;display:flex;align-items:center;justify-content:center"><span role="img" aria-label="Likida" style="width:100px;height:30px;background:#0e0e10;display:block"></span></div>`;
const CAPA_MALA = `<aside class="rv-sb" style="width:200px;height:100vh;background:#fff">menú</aside><div style="margin-left:200px;min-height:60vh;display:flex;align-items:center;justify-content:center"><span role="img" aria-label="Likida" style="width:100px;height:30px;background:#0e0e10;display:block"></span><span role="img" aria-label="Likida" style="width:20px;height:20px;background:#0e0e10;display:block"></span><p>Cargando datos…</p></div>`;

const ESPERADOS_SUCIA = [
  'c1.boton_gordo', 'c1.alto_visual', 'c1.toque', 'c1.vecinos',
  'c2.texto_menor_11', 'c2.h1', 'c2.kpi_mayor_30', 'c2.kpi_no_26', 'c2.fuera_de_escala',
  'c3.radio', 'c3.padding_tarjeta', 'c3.gap', 'c3.padding_pagina',
  'c4.hueco_fila', 'c4.aire_inferior', 'c4.min_height_decorativo', 'c4.alto_desigual',
  'c5.grafica', 'c5.filas',
  'c6.desborde', 'c6.recorte', 'c6.solape', 'c6.sin_nombre',
  'c7.contraste', 'c7.gris_sobre_gris',
];
const ESPERADOS_CAPA_MALA = ['c8.un_logo', 'c8.capa_completa', 'c8.solo_la_capa', 'c8.sin_texto'];

import { evaluar, duracionesInline, duracionesCss } from './duraciones.mjs';
import { mkdtempSync, writeFileSync as escribir } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

export async function selftest({ chromium, docHtml, ejecutar, comprobarRaizV2 }) {
  const browser = await chromium.launch();
  const correr = async (cuerpo, opts, w = 1440, h = 900) => {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    await page.setContent(docHtml(cuerpo, null, `<style>${ESTILO}</style>`));
    await page.waitForTimeout(40);
    const r = await ejecutar(page, opts); await ctx.close(); return r;
  };
  let ok = true; const dice = (b, m) => { console.log((b ? '   ok: ' : '   FALLA: ') + m); if (!b) ok = false; };
  const limpia = await correr(LIMPIA, { pliegue: false, sinShell: true });
  dice(Object.keys(limpia.n).length === 0, 'pantalla limpia = 0 hallazgos ' + JSON.stringify(limpia.n) + (Object.keys(limpia.n).length ? ' ' + JSON.stringify(limpia.hallazgos).slice(0, 600) : ''));
  const sucia = await correr(SUCIA, { pliegue: true, tipo: 'hub', sinShell: true });
  for (const k of ESPERADOS_SUCIA) dice((sucia.n[k] || 0) > 0, `la pantalla sucia dispara ${k} (${sucia.n[k] || 0})`);
  const sinKpi = await correr('<main id="contenido-principal"><h1>Sin KPI</h1></main>', { pliegue: true, tipo: 'hub', sinShell: true });
  dice((sinKpi.n['c5.kpi'] || 0) > 0, 'una página sin KPI dispara c5.kpi');
  const buena = await correr(CAPA_BUENA, { carga: true });
  dice(Object.keys(buena.n).filter((k) => k.startsWith('c8.')).length === 0, 'capa de carga correcta = 0 hallazgos c8 ' + JSON.stringify(buena.n));
  const mala = await correr(CAPA_MALA, { carga: true });
  for (const k of ESPERADOS_CAPA_MALA) dice((mala.n[k] || 0) > 0, `la carga dividida dispara ${k} (${mala.n[k] || 0})`);
  const v21 = await selftestV21({ correr, dice, browser, docHtml, comprobarRaizV2 });
  if (!v21) ok = false;
  await browser.close();
  console.log(ok ? 'AUTOPRUEBA OK' : 'AUTOPRUEBA FALLÓ');

  return ok;
}


// ═══ Detector v2.1: casos sintéticos MALOS (debe marcar) y BUENOS (NO debe marcar) ═══════════════════════════════
const LOGO_SVG = '<span role="img" aria-label="Likida" style="display:block;width:100px;height:30px"><svg width="100" height="30" viewBox="0 0 100 30"><rect width="100" height="30" rx="0" fill="#0e0e10"/></svg></span>';
const itemsNav = (n, activo) => Array.from({ length: n }, (_, i) => `<li style="list-style:none"><a href="#${i}" ${i === 0 && activo ? 'aria-current="page"' : ''} style="display:block;height:32px;line-height:32px;padding:0 10px;border-radius:8px;font:500 13px sans-serif;color:#0e0e10;text-decoration:none;${i === 0 && activo ? activo : ''}">Ítem ${i + 1}</a></li>`).join('');
const seccion = (titulo, n, extra = '') => `<section class="rv-grupo"><h2 class="rv-grupo__t" style="margin:0;font:500 11px/24px sans-serif;text-transform:uppercase">${titulo}</h2><ul style="margin:0;padding:0">${itemsNav(n, extra)}</ul></section>`;
const pieItems = (n, h) => Array.from({ length: n }, (_, i) => `<a href="#p${i}" style="display:block;height:${h}px;line-height:${h}px;padding:0 10px;font:500 13px sans-serif;color:#0e0e10">Pie ${i + 1}</a>`).join('');
const sidebar = ({ logo = LOGO_SVG, secciones, pie }) => `<aside class="rv-sb" style="position:fixed;left:0;top:0;bottom:0;width:232px;background:#fff;border-right:1px solid #e6e6e8;display:flex;flex-direction:column;overflow:hidden"><div class="rv-sb__marca" style="height:52px;padding:12px">${logo}</div><nav aria-label="Navegación principal" class="rv-sb__nav" style="flex:1;min-height:0;overflow:auto">${secciones}</nav><div class="rv-sb__pie">${pie}</div></aside>`;
const conMain = (side, cuerpo) => `${side}<main id="contenido-principal" style="margin-left:232px;padding:24px"><h1 style="font-size:20px;margin:0 0 12px">Pantalla</h1>${cuerpo}</main>`;
const SHELL_BUENO = conMain(sidebar({
  secciones: seccion('Agentes', 3) + seccion('Operación', 3, 'background:#f1f1f2;box-shadow:inset 3px 0 0 #0e0e10') + '<section class="rv-grupo"><h2 class="rv-grupo__t" style="margin:0;font:500 11px/24px sans-serif;text-transform:uppercase"><button aria-expanded="false" style="all:unset">Cuenta</button></h2></section>',
  pie: pieItems(4, 32),
}), '<p style="font:13px sans-serif">Contenido</p>');
const SHELL_MALO = conMain(sidebar({
  logo: '<span role="img" aria-label="Likida" style="display:block;width:100px;height:30px;background:#0e0e10"></span>', // máscara, no SVG
  secciones: seccion('Agentes', 3) + seccion('Operación', 2, 'background:#0e0e10;color:#fff') + seccion('Cuenta', 2) + seccion('Otra', 2),
  pie: pieItems(20, 40), // 800 px: pasa de 150 y a 1280×720 se sale del sidebar
}), `<button class="rv-btn--primary" style="height:32px;padding:0 12px;border:1px solid #d6d6d9;border-radius:8px;background:#e4e4e6">Uno</button> <button class="rv-btn--primary" style="height:32px;padding:0 12px;border:1px solid #d6d6d9;border-radius:8px;background:#e4e4e6">Dos</button>`);

const TABLA = (filas, altoTh = 36, extraTd = '') => `<table style="border-collapse:collapse;width:100%"><thead><tr style="height:${altoTh}px"><th style="font:600 12px sans-serif;text-align:left;padding:0 12px;height:${altoTh}px">Folio</th><th style="font:600 12px sans-serif;text-align:left;padding:0 12px">Ruta</th></tr></thead><tbody>${Array.from({ length: filas }, (_, i) => `<tr style="height:40px"><td style="font:13px sans-serif;padding:0 12px">${extraTd || 'LQ-' + (4100 + i)}</td><td style="font:13px sans-serif;padding:0 12px">Monterrey a Guadalajara</td></tr>`).join('')}</tbody></table>`;
const KPIS = `<div class="rv-kpis" style="display:flex;height:112px;gap:0;border:1px solid #e6e6e8;border-radius:12px;background:#fff;margin-bottom:12px">${[1, 2, 3, 4].map((i) => `<div class="rv-kpi" style="flex:1;padding:14px;font:12px sans-serif">Etiqueta ${i}<div class="kpi-valor" style="font:700 26px/32px sans-serif">${i},2${i}0</div></div>`).join('')}</div>`;
const GRAF = (h) => `<figure style="margin:0 0 12px;border:1px solid #e6e6e8;border-radius:12px;background:#fff;padding:14px"><svg width="600" height="${h}" role="img" aria-label="Serie"><rect width="600" height="${h}" fill="#e6edfa"/></svg></figure>`;
const ATENCION = (n) => `<section style="border:1px solid #e6e6e8;border-radius:12px;background:#fff;padding:14px;margin-bottom:12px"><h2 style="font:600 14px sans-serif;margin:0 0 8px">Requiere tu atención</h2><ul style="margin:0;padding:0">${Array.from({ length: n }, (_, i) => `<li style="list-style:none;height:48px;font:13px sans-serif">Asunto ${i + 1}</li>`).join('')}</ul></section>`;
const CAMPOS = (n) => `<form style="display:grid;gap:8px">${Array.from({ length: n }, (_, i) => `<label style="font:12px sans-serif">Campo ${i + 1}<input style="display:block;height:32px;border:1px solid #8a8a90;border-radius:8px;width:300px" aria-label="Campo ${i + 1}"></label>`).join('')}</form>`;

async function selftestV21({ correr, dice, browser, docHtml, comprobarRaizV2 }) {
  let ok = true; const d = (b, m) => { dice(b, m); if (!b) ok = false; };
  const N = (r, k) => r.n[k] || 0;
  // ── c3.radio: marcas de gráfica exentas, cajas NO ──
  const marcaBuena = await correr('<main id="contenido-principal"><h1>M</h1><figure><div title="2026-10-06: 2" style="width:12px;height:12px;border-radius:2px;background:#888"></div></figure></main>', { pliegue: false, sinShell: true });
  d(N(marcaBuena, 'c3.radio') === 0, 'una marca de gráfica (hoja titulada, radio 2 dentro de figure) NO dispara c3.radio');
  const marcaPaleta = await correr('<style>:root{--g1:#2f6bd8}</style><main id="contenido-principal"><h1>M</h1><div style="width:10px;height:40px;border-radius:3px;background:var(--g1)"></div></main>', { pliegue: false, sinShell: true });
  d(N(marcaPaleta, 'c3.radio') === 0, 'una barra pintada con la paleta de datos (var(--g1), radio 3) NO dispara c3.radio');
  const marcaMala = await correr('<main id="contenido-principal"><h1>M</h1><div style="border:1px solid #888;border-radius:3px;padding:8px;width:200px">caja con texto</div><button style="height:32px;border:1px solid #888;border-radius:3px;background:#fff">B</button></main>', { pliegue: false, sinShell: true });
  d(N(marcaMala, 'c3.radio') >= 2, 'una caja con texto y un botón de radio 3 SÍ disparan c3.radio (' + N(marcaMala, 'c3.radio') + ')');
  // ── c1.toque: controles contiguos (≤16 px) reparten la franja ──
  const contiguos = await correr('<main id="contenido-principal"><h1>T</h1><ul style="margin:0;padding:0;width:200px">' + itemsNav(5) + '</ul></main>', { pliegue: false, sinShell: true });
  d(N(contiguos, 'c1.toque') <= 2, 'ítems de 32 px apilados (contiguos) solo marcan sus 2 extremos libres, no los 5 (' + N(contiguos, 'c1.toque') + ')');
  const apartados = await correr('<main id="contenido-principal"><h1>T</h1><ul style="margin:0;padding:0;width:200px">' + itemsNav(5).replace(/<li /g, '<li data-x style="margin-bottom:40px" ').replace('style="list-style:none"', '') + '</ul></main>', { pliegue: false, sinShell: true });
  d(N(apartados, 'c1.toque') === 5, 'los mismos 5 ítems separados 40 px SÍ marcan los 5 (' + N(apartados, 'c1.toque') + ')');
  const separados = await correr('<main id="contenido-principal"><h1>T</h1><div style="padding:60px 0"><a href="#x" style="display:block;width:120px;height:32px;line-height:32px;border:1px solid #888">Solo</a></div></main>', { pliegue: false, sinShell: true });
  d(N(separados, 'c1.toque') > 0, 'un enlace de 32 px aislado SÍ dispara c1.toque');
  // ── cabecera de tabla 36 ──
  const th36 = await correr(`<main id="contenido-principal"><h1>T</h1>${TABLA(3, 36)}</main>`, { pliegue: false, sinShell: true });
  d(N(th36, 'c3.cabecera_tabla') === 0, 'cabecera de 36 px NO dispara c3.cabecera_tabla');
  const th32 = await correr(`<main id="contenido-principal"><h1>T</h1>${TABLA(3, 32)}</main>`, { pliegue: false, sinShell: true });
  d(N(th32, 'c3.cabecera_tabla') > 0, 'cabecera de 32 px SÍ dispara c3.cabecera_tabla');
  // ── c5 por tipo de pantalla ──
  const f = (cuerpo, tipo) => correr(`<main id="contenido-principal" style="padding:24px"><h1 style="font-size:20px;margin:0 0 12px">P</h1>${cuerpo}</main>`, { pliegue: true, tipo, sinShell: true });
  const resumenBueno = await f(KPIS + `<div style="display:flex;gap:12px"><div style="flex:2">${GRAF(150)}</div><div style="flex:1">${ATENCION(3)}</div></div>`, 'resumen');
  d(['c5.kpi', 'c5.grafica', 'c5.atencion', 'c5.filas'].every((k) => N(resumenBueno, k) === 0), 'resumen correcto (KPI 112, plot 150, atención 3 filas, sin tabla) = 0 en c5 ' + JSON.stringify(resumenBueno.n));
  const resumenMalo = await f(KPIS + GRAF(100), 'resumen');
  d(N(resumenMalo, 'c5.atencion') > 0 && N(resumenMalo, 'c5.grafica') > 0, 'resumen sin «Requiere tu atención» y con plot de 100 px dispara c5.atencion y c5.grafica');
  const hubBueno = await f(KPIS + GRAF(150) + TABLA(10), 'hub');
  d(['c5.kpi', 'c5.grafica', 'c5.filas'].every((k) => N(hubBueno, k) === 0), 'hub correcto (tabla de 10 filas) = 0 en c5 ' + JSON.stringify(hubBueno.n));
  const hubMalo = await f(KPIS + GRAF(150) + TABLA(5), 'hub');
  d(N(hubMalo, 'c5.filas') > 0, 'hub con 5 filas dispara c5.filas (≥10)');
  const listaOk = await f(KPIS + TABLA(10), 'lista');
  d(N(listaOk, 'c5.grafica') === 0 && N(listaOk, 'c5.filas') === 0, 'lista con KPI y 10 filas NO exige gráfica');
  const formOk = await f(CAMPOS(8), 'formulario');
  d(N(formOk, 'c5.filas') === 0 && N(formOk, 'c5.kpi') === 0, 'formulario de 8 campos NO exige KPI ni gráfica y cumple ≥8');
  const formMalo = await f(CAMPOS(3), 'formulario');
  d(N(formMalo, 'c5.filas') > 0, 'formulario de 3 campos dispara c5.filas (≥8)');
  const tiraMala = await f(KPIS.replace('height:112px', 'height:160px') + GRAF(150) + TABLA(10), 'hub');
  d(N(tiraMala, 'c5.kpi') > 0, 'tira de KPI de 160 px dispara c5.kpi (112 ±8)');
  // ── N1–N5: shell bueno = 0, shell malo dispara ──
  const bueno = await correr(SHELL_BUENO, { pliegue: false });
  const nBueno = Object.keys(bueno.n).filter((k) => /^n[1-5]\./.test(k));
  d(nBueno.length === 0, 'shell v2 correcto = 0 en N1–N5 ' + JSON.stringify(nBueno.map((k) => [k, bueno.hallazgos[k]])));
  const malo = await correr(SHELL_MALO, { pliegue: false });
  for (const k of ['n1.primarios', 'n1.masa_nav', 'n3.alto_pie', 'n4.categorias_abiertas', 'n5.logo']) d(N(malo, k) > 0, `el shell malo dispara ${k} (${N(malo, k)})`);
  const malo720 = await correr(SHELL_MALO, { pliegue: false }, 1280, 720);
  d(N(malo720, 'n3.recorte') > 0, 'a 1280×720 el pie de 800 px se detecta recortado (n3.recorte: ' + N(malo720, 'n3.recorte') + ')');
  const oscuro = async (cuerpo) => { const r = await correr(cuerpo.replace('<aside', '<aside data-x'), { pliegue: false }); return r; };
  void oscuro;
  // ── N2 mono ──
  const mono = await correr('<main id="contenido-principal"><h1>M</h1><p style="font:12px monospace">Etiqueta de KPI</p><code style="font:12px monospace">LQ-4102</code><span style="font:12px monospace">LQ-4103</span></main>', { pliegue: false, sinShell: true });
  d(N(mono, 'n2.mono') === 1, 'mono en una etiqueta SÍ (1), en <code> y en un folio NO (' + N(mono, 'n2.mono') + ')');
  // ── N6 cero falso ──
  const ceroMalo = await correr('<main id="contenido-principal"><h1>C</h1><table><tbody><tr><td>$0.00</td><td>Revisar</td></tr></tbody></table><div class="kpi-valor" style="font:700 26px sans-serif">$0</div><div class="kpi-valor" style="font:700 26px sans-serif">0</div></main>', { pliegue: false, sinShell: true });
  d(N(ceroMalo, 'n6.falso_cero') >= 3, '«$0.00 Revisar» y ceros pelados en KPI disparan n6.falso_cero (' + N(ceroMalo, 'n6.falso_cero') + ')');
  const ceroBueno = await correr('<main id="contenido-principal"><h1>C</h1><table><tbody><tr><td>—</td><td data-cero-fuente="TMS · 28 oct 2026">0</td><td>12</td></tr><tr><td>$0.00</td><td>Cuadrada</td></tr></tbody></table><div class="kpi-valor" style="font:700 26px sans-serif">—</div></main>', { pliegue: false, sinShell: true });
  d(N(ceroBueno, 'n6.falso_cero') === 0, '«—», un cero con fuente+periodo, un 12 y un cuadre exacto $0.00 de una fila cerrada NO disparan n6.falso_cero');
  // ── N7 fixtures ──
  const fixMalo = await correr(`<main id="contenido-principal"><h1>F</h1><table><tbody><tr><td>VJ-1001</td><td>Operador Uno</td></tr><tr><td>VJ-1001</td><td>Operador Dos</td></tr></tbody></table><p>Datos sintéticos de demostración</p><p>Datos sintéticos de demostración</p></main>`, { pliegue: false, sinShell: true });
  d(N(fixMalo, 'n7.fixture') >= 4, 'folio repetido, «Operador Uno/Dos» y 2 avisos sintéticos disparan n7.fixture (' + N(fixMalo, 'n7.fixture') + ')');
  const fixBueno = await correr(`<main id="contenido-principal"><h1>F</h1><p style="font:12px sans-serif">Datos sintéticos de demostración</p><table><tbody><tr><td>LQ-4101</td><td>Marisol Treviño Ibarra</td></tr><tr><td>LQ-4102</td><td>Gerardo Pineda Lozano</td></tr></tbody></table></main>`, { pliegue: false, sinShell: true });
  d(N(fixBueno, 'n7.fixture') === 0, 'folios únicos, operadores con nombre y apellido y 1 aviso NO disparan n7.fixture');
  const dosTablas = await correr(`<main id="contenido-principal"><h1>F</h1><table><tbody><tr><td>LQ-4101</td></tr></tbody></table><table><tbody><tr><td>LQ-4101</td></tr></tbody></table></main>`, { pliegue: false, sinShell: true });
  d(N(dosTablas, 'n7.fixture') === 0, 'el mismo folio en DOS tablas distintas (liquidada y en cola) NO es folio repetido');
  // ── N8 esqueletos y Observado ──
  const esqMalo = await correr('<main id="contenido-principal"><h1>E</h1><div class="skeleton" style="height:40px;width:200px;background:#eee"></div><div class="rv-kpi"><span class="rv-chip" style="font:12px sans-serif">Observado</span></div><div class="rv-kpi"><span class="rv-chip" style="font:12px sans-serif">Observado</span></div></main>', { pliegue: false, sinShell: true });
  d(N(esqMalo, 'n8.esqueleto') > 0 && N(esqMalo, 'n8.observado') > 0, 'esqueleto y 2 chips «Observado» disparan n8 (' + N(esqMalo, 'n8.esqueleto') + '/' + N(esqMalo, 'n8.observado') + ')');
  // ── c9 duraciones (Node) ──
  d(evaluar(420, '.x') && evaluar(700, '.x') && evaluar(1600, '.x'), 'c9: 420, 700 y 1600 ms son tokens permitidos');
  d(!evaluar(550, '.rv-tarjeta') && !evaluar(900, '.rv-graf__barra'), 'c9: 550 ms fuera de gráfica y 900 ms en gráfica son infracción');
  d(evaluar(550, '.rv-graf__barra') && evaluar(0.01, '.x'), 'c9: 550 ms en una regla de gráfica (≤700) y el reset 0.01 ms son válidos');
  d(duracionesInline('<div style="transition:width 550ms ease 140ms"></div>').length === 1 && duracionesInline('<div style="transition:opacity 420ms ease"></div>').length === 0, 'c9: inline 550 ms marca, 420 ms no');
  const tmp = mkdtempSync(path.join(tmpdir(), 'ui2-dur-'));
  escribir(path.join(tmp, 'x.css'), ':root{--ui-slow:250ms;--rapido:130ms}.a{transition:opacity var(--ui-slow) ease}.b{animation:foo var(--rapido) ease}.c{animation:bar 900ms linear}');
  const dc = duracionesCss(tmp);
  d(dc.length === 2 && dc.some((x) => x.includes('130')) && dc.some((x) => x.includes('900')), 'c9: en CSS resuelve var(--x) y marca 130 ms (no es token) y 900 ms (' + dc.length + ')');
  // ── Umbrales alineados con ESTILO-LIKIDA.md (escala {11 M,12,13,14,15,16,18,20,26}, radio 16 de hoja móvil, primario 36 en <820) ──
  const p = (px, extra = '') => `<main id="contenido-principal"><h1 style="font-size:20px;margin:0">T</h1><p style="margin:0;font:${px}px sans-serif;${extra}">Texto</p></main>`;
  for (const px of [12, 13, 14, 15, 16, 18]) { const r = await correr(p(px), { pliegue: false, sinShell: true }); d(N(r, 'c2.fuera_de_escala') === 0, `tamaño ${px} px pertenece a la escala de ESTILO §3 (0 hallazgos)`); }
  for (const px of [12.5, 13.5, 17, 10.5]) { const r = await correr(p(px), { pliegue: false, sinShell: true }); d(N(r, 'c2.fuera_de_escala') + N(r, 'c2.texto_menor_11') > 0, `tamaño ${px} px está PROHIBIDO por ESTILO §3 (se marca)`); }
  const kpi = (px, txt) => `<main id="contenido-principal"><h1 style="font-size:20px;margin:0">T</h1><div class="kpi-valor" style="font:700 ${px}px/1.1 sans-serif">${txt}</div></main>`;
  d(N(await correr(kpi(18, '—'), { pliegue: false, sinShell: true }), 'c2.kpi_no_26') === 0, 'KPI sin dato «—» a 18 px es válido');
  d(N(await correr(kpi(18, '1,234'), { pliegue: false, sinShell: true }), 'c2.kpi_no_26') > 0, 'una cifra KPI con dato a 18 px en escritorio SÍ se marca (norma 26)');
  d(N(await correr(kpi(20, '1,234'), { pliegue: false, sinShell: true }, 390, 844), 'c2.kpi_no_26') === 0, 'KPI móvil a 20 px (clamp 18–21) es válido');
  d(N(await correr(kpi(24, '1,234'), { pliegue: false, sinShell: true }, 390, 844), 'c2.kpi_no_26') > 0, 'KPI móvil a 24 px se marca');
  const hoja = '<main id="contenido-principal"><h1 style="font-size:20px;margin:0">T</h1><div style="border:1px solid #ccc;border-radius:16px;background:#fff;padding:12px;width:300px">Hoja</div></main>';
  d(N(await correr(hoja, { pliegue: false, sinShell: true }, 390, 844), 'c3.radio') === 0, 'radio 16 de la hoja inferior en móvil es válido');
  d(N(await correr(hoja, { pliegue: false, sinShell: true }), 'c3.radio') > 0, 'radio 16 en escritorio SÍ se marca');
  const prim36 = '<main id="contenido-principal"><h1 style="font-size:20px;margin:0">T</h1><button class="rv-btn--primary" style="height:36px;padding:0 12px;border:1px solid #d6d6d9;border-radius:8px;background:#e4e4e6;font:600 13px sans-serif">Guardar</button></main>';
  d(N(await correr(prim36, { pliegue: false, sinShell: true }, 390, 844), 'c1.boton_gordo') === 0, 'primario de 36 px en <820 (norma 32 / 36 móvil) es válido');
  const prim36b = '<main id="contenido-principal"><h1 style="font-size:20px;margin:0">T</h1><button style="height:36px;padding:0 12px;border:0;border-radius:8px;background:#0e0e10;color:#fff;font:600 13px sans-serif">Guardar</button></main>';
  d(N(await correr(prim36b, { pliegue: false, sinShell: true }), 'c1.boton_gordo') > 0, 'primario sólido de 36 px en escritorio SÍ se marca (máx. 32)');
  const svgT = (px) => `<main id="contenido-principal"><h1 style="font-size:20px;margin:0">T</h1><svg width="300" height="100"><text x="10" y="50" style="font:${px}px sans-serif">dato</text></svg></main>`;
  d(N(await correr(svgT(12), { pliegue: false, sinShell: true }), 'c2.fuera_de_escala') === 0 && N(await correr(svgT(11), { pliegue: false, sinShell: true }), 'c2.fuera_de_escala') > 0, 'texto de gráfica: 12 px válido, 11 px se marca (ESTILO §7 ≥12)');
  // ── El aborto sin v2 valida el DOM, no solo la cadena ──
  const motivo = async (html) => { const ctx = await browser.newContext(); const pg = await ctx.newPage(); await pg.setContent(docHtml(html, null)); const m = await comprobarRaizV2(pg); await ctx.close(); return m; };
  const shell = '<aside class="rv-sb">menú</aside><main id="contenido-principal">x</main>';
  d((await motivo(`<div class="tema-neutro" data-ui="v2">${shell}</div>`)) === null, 'chrome v2 correcto (raíz .tema-neutro con data-ui="v2" y shell dentro) NO aborta');
  d((await motivo(`<div class="tema-neutro">${shell}</div>`)) !== null, 'chrome v1 (sin data-ui) ABORTA');
  d((await motivo(`<!-- data-ui="v2" --><p>data-ui="v2"</p><div class="tema-neutro">${shell}</div>`)) !== null, 'la cadena data-ui="v2" en un comentario o en texto NO basta: ABORTA');
  d((await motivo(`<span data-ui="v2"></span><div class="tema-neutro">${shell}</div>`)) !== null, 'data-ui="v2" fuera de la raíz del chrome ABORTA');
  d((await motivo('<div class="tema-neutro" data-ui="v2"><main id="contenido-principal">sin shell</main></div>')) !== null, 'raíz v2 sin shell dentro ABORTA');
  return ok;
}
