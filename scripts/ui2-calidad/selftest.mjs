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

export async function selftest({ chromium, docHtml, ejecutar }) {
  const browser = await chromium.launch();
  const correr = async (cuerpo, opts, w = 1440, h = 900) => {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    await page.setContent(docHtml(cuerpo, null, `<style>${ESTILO}</style>`));
    await page.waitForTimeout(40);
    const r = await ejecutar(page, opts); await ctx.close(); return r;
  };
  let ok = true; const dice = (b, m) => { console.log((b ? '   ok: ' : '   FALLA: ') + m); if (!b) ok = false; };
  const limpia = await correr(LIMPIA, { pliegue: false });
  dice(Object.keys(limpia.n).length === 0, 'pantalla limpia = 0 hallazgos ' + JSON.stringify(limpia.n) + (Object.keys(limpia.n).length ? ' ' + JSON.stringify(limpia.hallazgos).slice(0, 600) : ''));
  const sucia = await correr(SUCIA, { pliegue: true });
  for (const k of ESPERADOS_SUCIA) dice((sucia.n[k] || 0) > 0, `la pantalla sucia dispara ${k} (${sucia.n[k] || 0})`);
  const sinKpi = await correr('<main id="contenido-principal"><h1>Sin KPI</h1></main>', { pliegue: true });
  dice((sinKpi.n['c5.kpi'] || 0) > 0, 'una página sin KPI dispara c5.kpi');
  const buena = await correr(CAPA_BUENA, { carga: true });
  dice(Object.keys(buena.n).filter((k) => k.startsWith('c8.')).length === 0, 'capa de carga correcta = 0 hallazgos c8 ' + JSON.stringify(buena.n));
  const mala = await correr(CAPA_MALA, { carga: true });
  for (const k of ESPERADOS_CAPA_MALA) dice((mala.n[k] || 0) > 0, `la carga dividida dispara ${k} (${mala.n[k] || 0})`);
  await browser.close();
  console.log(ok ? 'AUTOPRUEBA OK' : 'AUTOPRUEBA FALLÓ');
  return ok;
}
