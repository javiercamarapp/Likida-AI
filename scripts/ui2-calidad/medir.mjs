// Medidor de calidad de la UI v2 (portado de los detectores de Rovaq: choques / movil-contenido / carga-pantalla-completa).
// `medir` se ejecuta DENTRO de la página (page.evaluate): es una sola función autocontenida, sin imports ni cierres.
// Devuelve, por criterio, listas de hallazgos (texto corto con el elemento). El conteo y los informes los arma detectar.mjs.
//
// Criterios (ids estables; los usa LINEA-BASE.md y el JSON):
//   c1 controles   · c2 tipografía · c3 padding/gap/radios · c4 espacio vacío · c5 primer pliegue
//   c6 choques     · c7 contraste  · c8 carga (por fotograma; solo en pantallas de carga)
// Datos sintéticos: este archivo no nombra a ningún cliente.

export const UMBRALES = {
  // c1
  controlAltoMax: 36,        // alto visual máximo de botón/select/input/chip/tab
  primarioAltoMax: 32,       // botón primario sólido
  tolAlto: 0.3,              // ruido de redondeo de Chromium
  toque: 44,                 // zona táctil mínima (prueba de impacto con elementFromPoint, cuenta el ::after)
  vecinoMin: 8,              // separación mínima entre botones vecinos
  // c2
  textoMin: 11,
  h1: 20, h1Tol: 0.5,
  kpi: 26, kpiTol: 0.6, kpiMax: 30,
  kpiSinDato: 18,            // «—» de un KPI sin dato: 18/600 (ESTILO §3)
  kpiMovil: [17.5, 21.5],    // móvil: clamp(18px, 5.2vw, 21px)
  svgTextoMin: 12,           // texto de gráficas ≥ 12 px (ESTILO §7)
  escalaPermitida: [11, 12, 13, 14, 15, 16, 18, 20, 26], // ESTILO §3 (escala cerrada): 11 solo MAYÚSCULAS; 14 H2; 15 overlay; 16 campo móvil y cifra de tooltip; 18 KPI sin dato
  // c3
  radios: [0, 8, 12],        // + píldora / punto 50 % (radio >= la mitad del lado menor) + 16 de la hoja inferior móvil (ESTILO §5)
  radioHoja: 16,
  primarioAltoMaxMovil: 36,  // botón 32 (36 en <820)
  padTarjeta: 14, padTarjetaMovil: 12,
  gapMax: 12,
  padPagina: 24,
  // c4
  aireInfPx: 24, aireInfPct: 0.25, altoVecinoTol: 4, huecoFila: 0.12,
  cabeceraTabla: 36, cabeceraTablaTol: 1, // ESTILO §5: cabecera de tabla 36 (no 32)
  markRadioMax: 4,           // marcas de gráfica (columnas 3, celdas de calor 2-3) exentas de c3.radio
  // c5 (por tipo de pantalla, ESTILO §6): resumen / hub / lista / formulario / asistente
  filasPliegue: 8,           // formulario y asistente: filas o campos
  filasPliegueLista: 10,     // hub y lista: tabla de ≥10 filas
  plotMin: 140,              // alto mínimo de la gráfica principal (resumen y hub)
  atencionFilas: 3,          // «Requiere tu atención»: ≥3 filas en el pliegue (resumen)
  kpiTira: 112, kpiTiraTol: 8,
  // N (criterios nuevos, PLAN §4.2)
  pieMax: 150,               // N3: alto del pie del sidebar
  categoriasAbiertasMax: 1,  // N4

  // c7
  contraste: 4.5, contrasteGrande: 3,
};

export function medir(U, opts) {
  const o = opts || {};
  const MAXEJ = 400; // tope de ejemplos guardados por subcriterio (el conteo sigue exacto)
  const R = {};
  const add = (k, msg) => { (R[k] = R[k] || []).push(msg); };

  // ── utilidades ──────────────────────────────────────────────────────────
  const vis = (e) => {
    const r = e.getBoundingClientRect(); const cs = getComputedStyle(e);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0';
  };
  const oculto = (e) => !!e.closest('.sr-only,.rv-sr,[hidden],[aria-hidden="true"],template,noscript,dialog:not([open])');
  const SHELL = '.rv-sb,.rv-cab-movil,.rv-cab-esc,.rv-hoja,.rv-skip';
  const zona = (e) => (e.closest(SHELL) ? 'shell' : 'contenido');
  const desc = (e) => {
    const cls = typeof e.className === 'string' && e.className.trim() ? '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
    const t = (e.innerText || e.getAttribute('aria-label') || e.getAttribute('title') || '').trim().replace(/\s+/g, ' ').slice(0, 26);
    return e.tagName.toLowerCase() + cls + (t ? ' "' + t + '"' : '') + ' [' + zona(e) + ']';
  };
  const px = (v) => parseFloat(v) || 0;
  const CTRL_SEL = 'button,[role="button"],a.rv-btn,a[class*="btn"],select,input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]),textarea,[role="tab"],.rv-chip,[class*="chip"],.rv-kind,summary';
  const BTN_SEL = 'button,[role="button"],a.rv-btn,a[class*="btn"]';

  const cv = document.createElement('canvas'); cv.width = cv.height = 1;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  const rgba = (c) => { cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#000'; cx.fillStyle = c; cx.fillRect(0, 0, 1, 1); const d = cx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
  const blend = (f, b) => [f[0] * f[3] + b[0] * (1 - f[3]), f[1] * f[3] + b[1] * (1 - f[3]), f[2] * f[3] + b[2] * (1 - f[3]), 1];
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const croma = (c) => Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]);
  const bgCache = new Map();
  // Fondo efectivo (compuesto sobre los ancestros). dudoso=true si hay degradado/imagen en la cadena.
  const bgDe = (el) => {
    if (bgCache.has(el)) return bgCache.get(el);
    const capas = []; let dudoso = false;
    for (let p = el; p; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (cs.backgroundImage && cs.backgroundImage !== 'none' && /gradient|url/.test(cs.backgroundImage)) dudoso = true;
      const c = rgba(cs.backgroundColor); if (c[3] > 0) capas.push(c); if (c[3] >= 1) break;
    }
    let r = rgba(getComputedStyle(document.body).backgroundColor);
    if (r[3] < 1) r = blend(r, [255, 255, 255, 1]);
    for (const c of capas.reverse()) r = blend(c, r);
    const out = { c: r, dudoso }; bgCache.set(el, out); return out;
  };
  const opacidad = (el) => { let a = 1; for (let p = el; p && p !== document.documentElement; p = p.parentElement) a *= parseFloat(getComputedStyle(p).opacity); return a; };
  const cajaPropia = (e, cs) => {
    const bw = px(cs.borderTopWidth) > 0 && rgba(cs.borderTopColor)[3] > 0.05;
    const bg = rgba(cs.backgroundColor)[3] > 0.3;
    return bw || bg;
  };
  const esControl = (e) => e.matches(CTRL_SEL);
  const VW = innerWidth, VH = innerHeight, movil = VW < 820;

  const todos = [...document.querySelectorAll('body *')].filter((e) =>
    !['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'HEAD'].includes(e.tagName) && !e.closest('svg') && !oculto(e) && vis(e));
  const esTarjeta = (e, cs, r) => {
    if (esControl(e) || e.closest(SHELL) || e.matches('td,th,tr,thead,tbody,table,li,svg')) return false;
    if (r.width < 160 || r.height < 56) return false;
    if (px(cs.borderTopLeftRadius) < 8) return false;
    const bordeVis = px(cs.borderTopWidth) > 0 && rgba(cs.borderTopColor)[3] > 0.05;
    const par = e.parentElement; const bgp = par ? bgDe(par).c : [255, 255, 255, 1];
    const bgE = rgba(cs.backgroundColor);
    const fondoDistinto = bgE[3] > 0.9 && ratio(blend(bgE, bgp), bgp) >= 1.02;
    return bordeVis || fondoDistinto;
  };
  const tarjetas = todos.filter((e) => esTarjeta(e, getComputedStyle(e), e.getBoundingClientRect()));

  // ═══ C1 · CONTROLES ═════════════════════════════════════════════════════
  const controles = todos.filter((e) => e.matches(CTRL_SEL) && !e.closest('svg') && getComputedStyle(e).display !== 'inline' && e.getBoundingClientRect().width >= 4);
  const stats = { controles: controles.length, tarjetas: tarjetas.length, altoMaxControl: 0 };
  for (const e of controles) {
    const cs = getComputedStyle(e), r = e.getBoundingClientRect();
    if (e.tagName === 'TEXTAREA' || e.tagName === 'SUMMARY') continue;
    if (e.matches('.rv-skip') || e.closest('thead')) { /* nada especial */ }
    const caja = cajaPropia(e, cs) || e.matches('select,input');
    if (!caja) continue;
    const h = r.height;
    const esBtn = e.matches(BTN_SEL);
    stats.altoMaxControl = Math.max(stats.altoMaxControl, Math.round(h * 10) / 10);
    if (esBtn) {
      if (h > U.controlAltoMax + U.tolAlto) add('c1.boton_gordo', 'alto ' + Math.round(h * 10) / 10 + ' (máx. ' + U.controlAltoMax + ') ' + desc(e));
      else {
        const bg = rgba(cs.backgroundColor); const bgp = e.parentElement ? bgDe(e.parentElement).c : [255, 255, 255, 1];
        const solido = bg[3] > 0.9 && ratio(blend(bg, bgp), bgp) >= 4 && lum(bg) < 0.2;
        if ((e.classList.contains('rv-btn--primary') || solido) && h > (movil ? U.primarioAltoMaxMovil : U.primarioAltoMax) + U.tolAlto) add('c1.boton_gordo', 'primario sólido alto ' + Math.round(h * 10) / 10 + ' (máx. ' + (movil ? U.primarioAltoMaxMovil : U.primarioAltoMax) + ') ' + desc(e));
      }
    } else if (h > U.controlAltoMax + U.tolAlto) add('c1.alto_visual', 'alto ' + Math.round(h * 10) / 10 + ' (máx. ' + U.controlAltoMax + ') ' + desc(e));
  }
  // Zona táctil ≥44 (prueba de impacto: cuenta el área ampliada con ::after).
  const tactiles = todos.filter((e) => e.matches('button,[role="button"],a[href],select,input:not([type="hidden"]),textarea,[role="tab"],[role="switch"],summary') && getComputedStyle(e).display !== 'inline' && !e.closest('svg'));
  const ctlSel = 'button,a[href],summary,select,input,[role="tab"],[role="button"],[role="switch"],label';
  for (const e of tactiles) {
    const r0 = e.getBoundingClientRect();
    if (r0.width < 1) continue;
    if (e.type === 'checkbox' || e.type === 'radio') { const l = e.closest('label'); if (l && l.getBoundingClientRect().height >= 43.5) continue; }
    if (r0.height >= 43.5 && r0.width >= 43.5) continue;
    e.scrollIntoView({ block: 'center', inline: 'center' });
    const r = e.getBoundingClientRect();
    if (r.top < 0 || r.bottom > innerHeight || r.left < 0 || r.right > innerWidth) continue;
    const cxp = r.left + r.width / 2, cyp = r.top + r.height / 2;
    const acierta = (x, y) => {
      if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return true;
      const h = document.elementFromPoint(x, y); if (!h) return false;
      if (e === h || e.contains(h) || (h.contains(e) && h.closest('label') && h.closest('label') === e.closest('label'))) return true;
      const v = h.closest(ctlSel);
      if (v && v !== e) { // controles contiguos reparten la franja que los separa
        const a = e.getBoundingClientRect(), b = v.getBoundingClientRect();
        const gap = Math.max(b.top - a.bottom, a.top - b.bottom, b.left - a.right, a.left - b.right, 0);
        if (gap <= 16) return true;
      }
      return false;
    };
    const faltaH = r.height < 43.5 ? (44 - r.height) / 2 : 0, faltaW = r.width < 43.5 ? (44 - r.width) / 2 : 0;
    const puntos = [];
    if (faltaH) puntos.push([cxp, r.top - faltaH + 2], [cxp, r.bottom + faltaH - 2]);
    if (faltaW) puntos.push([r.left - faltaW + 2, cyp], [r.right + faltaW - 2, cyp]);
    if (!puntos.every(([x, y]) => acierta(x, y))) add('c1.toque', 'zona táctil < 44 (' + Math.round(r.width) + '×' + Math.round(r.height) + ') ' + desc(e));
  }
  window.scrollTo(0, 0);
  for (const el of document.querySelectorAll('*')) if (el.scrollTop || el.scrollLeft) { el.scrollTop = 0; el.scrollLeft = 0; } // la prueba táctil desplaza contenedores internos
  // Separación entre botones vecinos ≥8 px.
  const btns = controles.filter((e) => e.matches(BTN_SEL) && cajaPropia(e, getComputedStyle(e)));
  if (btns.length <= 120) {
    for (let i = 0; i < btns.length; i++) for (let j = i + 1; j < btns.length; j++) {
      if (btns[i].contains(btns[j]) || btns[j].contains(btns[i])) continue;
      const a = btns[i].getBoundingClientRect(), b = btns[j].getBoundingClientRect();
      const gx = Math.max(a.left, b.left) - Math.min(a.right, b.right), gy = Math.max(a.top, b.top) - Math.min(a.bottom, b.bottom);
      const sx = Math.min(a.right, b.right) - Math.max(a.left, b.left), sy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if ((sy > 2 && gx < U.vecinoMin - 0.5 && gx > -1) || (sx > 2 && gy < U.vecinoMin - 0.5 && gy > -1)) add('c1.vecinos', 'botones a ' + Math.round(Math.max(gx, gy)) + ' px (≥ ' + U.vecinoMin + ') ' + desc(btns[i]) + ' / ' + desc(btns[j]));
    }
  }

  // ═══ C2 · TIPOGRAFÍA ════════════════════════════════════════════════════
  const escala = {};
  const hist = (fs) => { const k = String(Math.round(fs * 10) / 10); escala[k] = (escala[k] || 0) + 1; };
  const conTexto = todos.filter((e) => [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()));
  const KPI_SEL = '.rv-kpi__valor,[class*="kpi"][class*="valor"],[class*="kpi"][class*="value"],.stat-value,[data-kpi-valor]';
  const kpis = [];
  for (const e of conTexto) {
    const cs = getComputedStyle(e); const fs = px(cs.fontSize); hist(fs);
    const tx = (e.textContent || '').trim();
    const mayus = cs.textTransform === 'uppercase' || (/\p{L}/u.test(tx) && tx === tx.toUpperCase());
    const esKpi = e.matches(KPI_SEL);
    if (esKpi) kpis.push(fs);
    if (fs < U.textoMin - 0.05) add('c2.texto_menor_11', fs + 'px ' + desc(e));
    if (e.matches('h1')) { /* se juzga abajo */ }
    else if (esKpi) {
      if (fs > U.kpiMax + 0.05) add('c2.kpi_mayor_30', fs + 'px (tope ' + U.kpiMax + ') ' + desc(e));
      const sinDato = /^[—–-]$/.test(tx); // KPI sin dato «—»: 18
      const okKpi = sinDato ? Math.abs(fs - U.kpiSinDato) <= U.kpiTol : movil ? (fs >= U.kpiMovil[0] && fs <= U.kpiMovil[1]) || Math.abs(fs - U.kpi) <= U.kpiTol : Math.abs(fs - U.kpi) <= U.kpiTol;
      if (!okKpi) add('c2.kpi_no_26', fs + 'px (norma ' + (sinDato ? U.kpiSinDato : movil ? '18–21 (móvil) o ' + U.kpi : U.kpi) + ') ' + desc(e));
    } else {
      const campo = e.matches('input,select,textarea');
      const ok = U.escalaPermitida.some((v) => Math.abs(fs - v) < 0.3 && (v !== 11 || mayus)) || (campo && movil && Math.abs(fs - 16) < 0.3);
      // 30 como tope absoluto; entre 15 y 26 solo H1=20 y el título de overlay=15 son parte de la escala
      if (!ok && fs >= U.textoMin - 0.05 && fs <= U.kpiMax) add('c2.fuera_de_escala', fs + 'px ' + (fs < 12 && !mayus ? '(11 solo MAYÚSCULAS) ' : '') + desc(e));
      else if (fs > U.kpiMax + 0.05) add('c2.fuera_de_escala', fs + 'px (> 30) ' + desc(e));
    }
  }
  // Texto dentro de SVG (etiquetas de gráficas): tamaño efectivo = font-size × escala del viewBox.
  for (const t of document.querySelectorAll('svg text, svg tspan')) {
    if (oculto(t) || !(t.textContent || '').trim()) continue;
    const m = t.getScreenCTM && t.getScreenCTM(); const esc = m ? Math.hypot(m.a, m.b) : 1;
    const fs = px(getComputedStyle(t).fontSize) * esc;
    if (fs >= U.textoMin - 0.05 && fs < U.svgTextoMin - 0.05) add('c2.fuera_de_escala', 'texto de gráfica ' + Math.round(fs * 10) / 10 + 'px (mín. ' + U.svgTextoMin + ') "' + (t.textContent || '').trim().slice(0, 20) + '"');
    if (fs > 0 && fs < U.textoMin - 0.05) add('c2.texto_menor_11', 'svg ' + Math.round(fs * 10) / 10 + 'px "' + (t.textContent || '').trim().slice(0, 20) + '"');
  }
  const h1s = todos.filter((e) => e.matches('h1'));
  if (h1s.length !== 1) add('c2.h1', 'h1 en pantalla: ' + h1s.length + ' (debe ser 1)');
  for (const h of h1s) { const fs = px(getComputedStyle(h).fontSize); if (Math.abs(fs - U.h1) > U.h1Tol) add('c2.h1', 'h1 ' + fs + 'px (norma ' + U.h1 + ') ' + desc(h)); }
  stats.escalaTexto = escala; stats.kpiTamanos = kpis; stats.h1 = h1s.map((h) => px(getComputedStyle(h).fontSize));

  // Marca de gráfica (exenta de c3.radio, ESTILO §5): hoja (sin elementos hijos) con radio ≤4 dentro de una gráfica o con
  // etiqueta propia (title / aria-label: celdas de calor y columnas). Una caja con contenido o un botón NO es una marca.
  const CTX_GRAF = 'svg,figure,[role="img"],[data-grafica],[class*="graf"],[class*="chart"],[class*="heat"],[class*="columna"],[class*="barra"]';
  const esMarca = (e, v) => {
    if (v > U.markRadioMax + 0.01 || e.children.length > 0 || e.matches(CTRL_SEL)) return false;
    const rotulado = e.hasAttribute('title') || e.hasAttribute('aria-label') || !!e.parentElement?.closest('[title],[aria-label]');
    // ...o pintada con un color de la paleta de datos (var(--g1..g5), --m1..8, --d1..8): una barra/celda de gráfica sin etiqueta propia
    const dato = /(?:background(?:-color)?|fill)\s*:\s*var\(--(?:g\d|m\d|d\d|serie-?\d)/.test(e.getAttribute('style') || '');
    return rotulado || dato || !!e.closest(CTX_GRAF);
  };

  // ═══ C3 · PADDING / GAP / RADIOS ════════════════════════════════════════
  const radioOk = (e, cs, r) => {
    const t = cs.borderTopLeftRadius; let v;
    if (/%/.test(t)) v = (parseFloat(t) / 100) * Math.min(r.width, r.height); else v = px(t);
    const mitad = Math.min(r.width, r.height) / 2;
    if (v <= 0.01) return { ok: true, v };
    if (Math.abs(v - 8) <= 0.6 || Math.abs(v - 12) <= 0.6) return { ok: true, v };
    if (v >= mitad - 0.6) return { ok: true, v };
    if (movil && Math.abs(v - U.radioHoja) <= 0.6) return { ok: true, v }; // hoja inferior móvil
    return { ok: false, v };
  };
  let marcasExentas = 0;
  const radiosVistos = {};
  for (const e of todos) {
    const cs = getComputedStyle(e); const r = e.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    if (!cajaPropia(e, cs)) continue;
    const q = radioOk(e, cs, r); const k = String(Math.round(q.v * 10) / 10); radiosVistos[k] = (radiosVistos[k] || 0) + 1;
    if (!q.ok && esMarca(e, q.v)) { marcasExentas++; continue; }
    if (!q.ok) add('c3.radio', 'radio ' + Math.round(q.v * 10) / 10 + 'px (permitidos 8, 12, píldora) ' + desc(e));
  }
  stats.radios = radiosVistos; stats.marcasExentas = marcasExentas;
  const maxPad = movil ? U.padTarjetaMovil : U.padTarjeta;
  for (const e of tarjetas) {
    const cs = getComputedStyle(e);
    const p = Math.max(px(cs.paddingTop), px(cs.paddingBottom), px(cs.paddingLeft), px(cs.paddingRight));
    if (p > maxPad + 0.5) add('c3.padding_tarjeta', 'padding ' + p + 'px (máx. ' + maxPad + ') ' + desc(e));
  }
  for (const e of todos) {
    const cs = getComputedStyle(e);
    if (!/flex|grid/.test(cs.display)) continue;
    if (e.children.length < 2) continue;
    const g = Math.max(px(cs.rowGap), px(cs.columnGap));
    if (g > U.gapMax + 0.5) add('c3.gap', 'gap ' + g + 'px (máx. ' + U.gapMax + ') ' + desc(e));
  }
  // Cabecera de tabla: alto 36 (ESTILO §5). Solo tablas visibles de escritorio; en móvil la tabla pasa a tarjeta-fila.
  if (!movil) {
    for (const tr of document.querySelectorAll('thead tr')) {
      if (oculto(tr) || !vis(tr)) continue;
      const h = tr.getBoundingClientRect().height;
      if (Math.abs(h - U.cabeceraTabla) > U.cabeceraTablaTol) add('c3.cabecera_tabla', 'cabecera de tabla ' + Math.round(h * 10) / 10 + 'px (norma ' + U.cabeceraTabla + ') ' + desc(tr));
    }
  }
  // Margen de página = distancia entre el borde del contenedor de contenido y el primer bloque pintado (tarjeta, H1 o texto).
  const cont = document.querySelector('#contenido-principal') || document.querySelector('main');
  if (cont) {
    const cr = cont.getBoundingClientRect();
    const bloques = [...tarjetas, ...h1s].filter((x) => cont.contains(x));
    const izq = bloques.length ? Math.min(...bloques.map((x) => x.getBoundingClientRect().left)) - cr.left : 0;
    stats.paddingPagina = { izq: Math.round(izq * 10) / 10, contenedor: px(getComputedStyle(cont).paddingLeft) };
    if (VW >= 1024 && Math.abs(izq - U.padPagina) > 1.5) add('c3.padding_pagina', 'margen de página ' + Math.round(izq) + 'px (norma ' + U.padPagina + ' en ≥1024)');
    if (movil && izq > 16.5) add('c3.padding_pagina', 'margen de página ' + Math.round(izq) + 'px en móvil (máx. 16)');
  } else add('c3.padding_pagina', 'sin contenedor #contenido-principal / main');

  // ═══ C4 · ESPACIO VACÍO ═════════════════════════════════════════════════
  const tieneBorde = (cs) => px(cs.borderTopWidth) > 0 && rgba(cs.borderTopColor)[3] > 0.05;
  const finContenido = (card) => {
    let fin = -Infinity;
    const medirRango = (n) => { const rg = document.createRange(); rg.selectNodeContents(n); for (const q of rg.getClientRects()) if (q.width > 0 && q.height > 0) fin = Math.max(fin, q.bottom); };
    const w = document.createTreeWalker(card, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) {
      if (n.nodeType === 3) {
        if (!n.textContent.trim()) continue;
        const p = n.parentElement; if (!p || oculto(p) || !vis(p) || p.closest('svg')) continue;
        const rg = document.createRange(); rg.selectNodeContents(n);
        for (const q of rg.getClientRects()) if (q.width > 0 && q.height > 0) fin = Math.max(fin, q.bottom);
        continue;
      }
      const el = n; if (el === card || oculto(el) || !vis(el)) continue;
      const pos = getComputedStyle(el).position; if (pos === 'absolute' || pos === 'fixed') continue;
      if (el.matches('img,svg,canvas,video,input,select,textarea,button,hr,progress,meter')) { if (!el.closest('svg') || el.tagName === 'svg') fin = Math.max(fin, el.getBoundingClientRect().bottom); continue; }
      const cs = getComputedStyle(el); // hoja pintada (barra, chip, filete) sin más elementos adentro
      if ((tieneBorde(cs) || rgba(cs.backgroundColor)[3] > 0.3) && ![...el.children].some((c) => c.tagName !== 'svg' && c.tagName !== 'SPAN' && c.tagName !== 'path')) fin = Math.max(fin, el.getBoundingClientRect().bottom);
    }
    return fin;
  };
  for (const e of tarjetas) {
    const r = e.getBoundingClientRect(); const cs = getComputedStyle(e);
    if (e.querySelector('table')) { /* una tabla llena su tarjeta: se mide igual */ }
    if (r.height > VH * 1.2) continue; // contenedores de página, no tarjetas de contenido
    const fin = finContenido(e); if (!isFinite(fin)) { add('c4.aire_inferior', 'tarjeta sin contenido visible ' + desc(e)); continue; }
    const aire = Math.max(0, r.bottom - px(cs.borderBottomWidth) - fin);
    if (aire > U.aireInfPx + 0.5 || aire > U.aireInfPct * r.height) add('c4.aire_inferior', 'aire inferior ' + Math.round(aire) + 'px de ' + Math.round(r.height) + ' (máx. ' + U.aireInfPx + ' y ' + U.aireInfPct * 100 + ' %) ' + desc(e));
  }
  // min-height decorativo: min-height propio que deja aire interior (fuera de controles, shell y pantallas de estado).
  for (const e of todos) {
    const cs = getComputedStyle(e); const mh = cs.minHeight;
    if (!mh || mh === 'auto' || mh === '0px' || mh === 'normal' || mh === 'none') continue;
    if (esControl(e) || e.closest(SHELL) || e.matches('html,body') || e.closest('[role="status"]') || e.matches(SHELL)) continue;
    if (e.querySelector(SHELL)) continue; // contenedor del marco completo
    const r = e.getBoundingClientRect(); if (r.height < 80) continue;
    const fin = finContenido(e); const libre = isFinite(fin) ? r.bottom - px(cs.paddingBottom) - fin : r.height;
    if (libre > 16) add('c4.min_height_decorativo', 'min-height ' + mh + ' deja ' + Math.round(libre) + 'px vacíos ' + desc(e));
  }
  // Filas de tarjetas: huecos laterales y alturas desiguales.
  const contenedores = new Set(tarjetas.map((t) => t.parentElement).filter(Boolean));
  for (const par of contenedores) {
    const cs = getComputedStyle(par);
    if (!/flex|grid/.test(cs.display) || cs.flexDirection === 'column') continue;
    const pr = par.getBoundingClientRect(); if (pr.width < 600) continue;
    const kids = [...par.children].filter((k) => vis(k) && !oculto(k) && !['absolute', 'fixed'].includes(getComputedStyle(k).position));
    const tarj = kids.filter((k) => tarjetas.includes(k)); if (!tarj.length) continue;
    const interior = pr.width - px(cs.paddingLeft) - px(cs.paddingRight);
    const filas = []; for (const k of kids) { const t = k.getBoundingClientRect().top; const f = filas.find((x) => Math.abs(x.top - t) <= 4); if (f) f.k.push(k); else filas.push({ top: t, k: [k] }); }
    for (const f of filas) {
      if (!f.k.some((k) => tarjetas.includes(k))) continue;
      const izq = Math.min(...f.k.map((k) => k.getBoundingClientRect().left)), der = Math.max(...f.k.map((k) => k.getBoundingClientRect().right));
      const libre = interior - (der - izq);
      if (libre > U.huecoFila * interior) add('c4.hueco_fila', 'fila llena ' + Math.round(((der - izq) / interior) * 100) + ' % del ancho (' + f.k.length + ' tarjeta' + (f.k.length > 1 ? 's' : '') + ') en ' + desc(par));
      if (f.k.length >= 2) {
        const hs = f.k.map((k) => k.getBoundingClientRect().height);
        if (Math.max(...hs) - Math.min(...hs) > U.altoVecinoTol) add('c4.alto_desigual', 'tarjetas vecinas de ' + hs.map((h) => Math.round(h)).join('/') + ' px (±' + U.altoVecinoTol + ') en ' + desc(par));
      }
    }
  }

  // ═══ C5 · PRIMER PLIEGUE (1440×900; criterio según el TIPO de pantalla, ESTILO §6) ═══════════
  //   resumen    KPI(4) de 112 ±8 → gráfica (plot ≥140) + «Requiere tu atención» (≥3 filas) visibles; SIN tabla
  //   hub        KPI → gráfica (plot ≥140) + tabla de ≥10 filas
  //   lista      KPI → tabla de ≥10 filas
  //   formulario / asistente   ≥8 filas o campos
  if (o.pliegue) {
    const tipo = o.tipo || 'hub';
    const necesita = {
      resumen: { kpi: 1, grafica: 1, atencion: 1, filas: 0 }, hub: { kpi: 1, grafica: 1, filas: U.filasPliegueLista },
      lista: { kpi: 1, filas: U.filasPliegueLista }, formulario: { filas: U.filasPliegue }, asistente: { filas: U.filasPliegue },
    }[tipo] || { kpi: 1, grafica: 1, filas: U.filasPliegue };
    const kp = todos.filter((e) => e.matches('.rv-kpis,.rv-kpi,[class*="kpi"]') && !e.closest(SHELL));
    if (necesita.kpi) {
      if (!kp.length) add('c5.kpi', 'sin tira de KPI');
      else if (!kp.some((e) => e.getBoundingClientRect().bottom <= VH)) add('c5.kpi', 'la tira de KPI no cabe en el primer pliegue (' + VH + ' px)');
      const tira = todos.find((e) => e.matches('.rv-kpis,[data-kpis]') && !e.closest(SHELL));
      if (tira) { const h = tira.getBoundingClientRect().height; if (Math.abs(h - U.kpiTira) > U.kpiTiraTol) add('c5.kpi', 'la tira de KPI mide ' + Math.round(h) + 'px (norma ' + U.kpiTira + ' ±' + U.kpiTiraTol + ')'); }
    }
    const grafs = [...document.querySelectorAll('svg')].filter((s) => !oculto(s) && vis(s) && !s.closest(SHELL) && s.getBoundingClientRect().width >= 200 && s.getBoundingClientRect().height >= 80 && !s.closest('button'));
    if (necesita.grafica) {
      if (!grafs.length) add('c5.grafica', 'sin gráfica principal');
      else if (!grafs.some((s) => s.getBoundingClientRect().bottom <= VH)) add('c5.grafica', 'la gráfica principal no cabe completa en el primer pliegue');
      else if (!grafs.some((s) => s.getBoundingClientRect().bottom <= VH && s.getBoundingClientRect().height >= U.plotMin)) add('c5.grafica', 'la gráfica principal mide menos de ' + U.plotMin + ' px de alto');
    }
    if (necesita.atencion) {
      const tit = todos.find((e) => /^h[1-6]$/i.test(e.tagName) && /requiere tu atenci[oó]n/i.test(e.textContent || ''));
      const card = tit && (tarjetas.find((t) => t.contains(tit)) || tit.parentElement);
      if (!card) add('c5.atencion', 'sin «Requiere tu atención»');
      else {
        const filasA = [...card.querySelectorAll('li,[role="listitem"],[class*="fila"],a[href]')].filter((x) => vis(x) && x.getBoundingClientRect().bottom <= VH);
        if (card.getBoundingClientRect().bottom > VH) add('c5.atencion', '«Requiere tu atención» no cabe en el primer pliegue');
        else if (filasA.length < U.atencionFilas) add('c5.atencion', '«Requiere tu atención» muestra ' + filasA.length + ' fila(s) (mín. ' + U.atencionFilas + ')');
      }
    }
    const trs = [...document.querySelectorAll('tbody tr')].filter((t) => vis(t) && !oculto(t));
    const campos = (tipo === 'formulario' || tipo === 'asistente')
      ? [...document.querySelectorAll('input:not([type="hidden"]),select,textarea,[role="row"],.rv-paso,[data-paso]')].filter((t) => vis(t) && !oculto(t) && !t.closest(SHELL)) : [];
    const filas = trs.concat(campos);
    const dentro = filas.filter((t) => t.getBoundingClientRect().bottom <= VH).length;
    stats.pliegue = { tipo, kpis: kp.length, graficas: grafs.length, filasTotales: filas.length, filasVisibles: dentro };
    if (necesita.filas && dentro < necesita.filas) add('c5.filas', dentro + ' fila(s) en el primer pliegue (mín. ' + necesita.filas + '; hay ' + filas.length + ')');
  }

  // ═══ C6 · CHOQUES ═══════════════════════════════════════════════════════
  const doc = document.documentElement;
  if (doc.scrollWidth > VW + 1) add('c6.desborde', 'documento ' + doc.scrollWidth + ' > ' + VW);
  const cc = document.querySelector('#contenido-principal');
  if (cc && cc.scrollWidth > cc.clientWidth + 1) add('c6.desborde', '#contenido-principal ' + cc.scrollWidth + ' > ' + cc.clientWidth);
  if (doc.scrollWidth > VW + 1) {
    const clip = (e) => { for (let q = e.parentElement; q && q !== document.body; q = q.parentElement) if (getComputedStyle(q).overflowX !== 'visible') return true; return false; };
    for (const e of todos.filter((e) => e.getBoundingClientRect().right > VW + 1 && !clip(e)).slice(0, 4)) add('c6.desborde', 'culpable ' + desc(e) + ' r=' + Math.round(e.getBoundingClientRect().right));
  }
  const scrollers = (e) => { for (let p = e.parentElement; p; p = p.parentElement) { const ov = getComputedStyle(p).overflowX; if ((ov === 'auto' || ov === 'scroll') && p.scrollWidth > p.clientWidth) return true; } return false; };
  for (const e of conTexto) {
    const cs = getComputedStyle(e);
    if (!(cs.overflowX === 'hidden' || cs.overflowX === 'clip')) continue;
    if (e.clientWidth < 4 || e.scrollWidth <= e.clientWidth + 1 || e.tagName === 'SELECT' || e.tagName === 'INPUT' || scrollers(e)) continue;
    if (cs.textOverflow === 'ellipsis') {
      // truncado con «…»: solo grave en botones, chips, cifras, cabeceras y etiquetas cortas (IDs/cifras/etiquetas/botones)
      const t = (e.textContent || '').trim();
      if (e.matches(CTRL_SEL + ',th,label,' + KPI_SEL + ',code,.rv-mono') || t.length <= 18) add('c6.recorte', 'truncado con «…» ' + e.scrollWidth + '>' + e.clientWidth + ' ' + desc(e));
    } else add('c6.recorte', 'texto recortado ' + e.scrollWidth + '>' + e.clientWidth + ' ' + desc(e));
  }
  for (const e of todos) {
    if (e.children.length < 2 || e.children.length > 40) continue;
    const cs = getComputedStyle(e); if (!/flex|grid/.test(cs.display)) continue;
    const kids = [...e.children].filter((k) => vis(k) && !oculto(k) && getComputedStyle(k).display !== 'inline' && !['absolute', 'fixed', 'sticky'].includes(getComputedStyle(k).position));
    for (let i = 0; i < kids.length; i++) for (let j = i + 1; j < kids.length; j++) {
      const a = kids[i].getBoundingClientRect(), b = kids[j].getBoundingClientRect();
      const w = Math.min(a.right, b.right) - Math.max(a.left, b.left), h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (w > 2 && h > 2 && getComputedStyle(kids[i]).marginTop !== '-1px') add('c6.solape', desc(kids[i]) + ' × ' + desc(kids[j]));
    }
  }
  const nombreDe = (e) => {
    const t = (e.textContent || '').trim(); if (t) return t;
    for (const a of ['aria-label', 'title', 'aria-labelledby', 'alt']) if ((e.getAttribute(a) || '').trim()) return e.getAttribute(a);
    if (e.labels && e.labels.length) return 'label';
    if (e.tagName === 'INPUT' && (e.placeholder || e.value)) return 'ph';
    if (e.querySelector('img[alt]:not([alt=""]),svg title,[aria-label]')) return 'hijo';
    return '';
  };
  for (const e of document.querySelectorAll('button,[role="button"],a[href],[role="tab"],input:not([type="hidden"]),select,textarea,[role="switch"]')) {
    if (oculto(e) || !vis(e)) continue;
    if (!nombreDe(e)) add('c6.sin_nombre', desc(e));
  }

  // ═══ C7 · CONTRASTE ═════════════════════════════════════════════════════
  let sinMedir = 0;
  for (const e of conTexto) {
    if (e.disabled || e.getAttribute('aria-disabled') === 'true' || e.closest('[disabled],[aria-disabled="true"]')) continue;
    const cs = getComputedStyle(e); const b = bgDe(e);
    if (b.dudoso) { sinMedir++; continue; }
    const col = rgba(cs.color); col[3] *= opacidad(e);
    const fg = blend(col, b.c); const rt = ratio(fg, b.c);
    const fs = px(cs.fontSize), grande = fs >= 24 || (fs >= 18.66 && px(cs.fontWeight) >= 700);
    const min = grande ? U.contrasteGrande : U.contraste;
    if (rt < min) add('c7.contraste', rt.toFixed(2) + ':1 (mín. ' + min + ') ' + desc(e));
  }
  stats.contrasteSinMedir = sinMedir;
  // Gris sobre gris: caja (control, tarjeta o aviso) indistinguible de su fondo.
  const AVISO = '.rv-aviso,.rv-vacio,[role="alert"],[role="status"]';
  const tarjSet = new Set(tarjetas);
  for (const e of [...controles, ...tarjetas, ...todos.filter((x) => x.matches(AVISO))]) {
    if (e.disabled) continue;
    const cs = getComputedStyle(e); const par = e.parentElement; if (!par) continue;
    const bgp = bgDe(par).c; const bgE = rgba(cs.backgroundColor);
    const propio = bgE[3] > 0.3; const bg = propio ? blend(bgE, bgp) : bgp;
    let bc = null; const bcr = rgba(cs.borderTopColor); if (px(cs.borderTopWidth) > 0 && bcr[3] > 0.05) bc = blend(bcr, bgp);
    if (!propio && !bc) continue;
    const dist = propio ? ratio(bg, bgp) : 1; const borde = bc ? ratio(bc, bgp) : 1;
    const conColor = propio && croma(bg) >= 14;
    // Tarjeta = superficie con filete (sin sombra): basta un filete visible (≥1.1:1) o un fondo claramente distinto.
    // Control / aviso: tinte con color, fondo distinto del padre (≥1.08), o borde ≥1.4:1 (≥3:1 si no tiene fondo propio).
    const ok = tarjSet.has(e) ? (bc && borde >= 1.1) || dist >= 1.08 || conColor : conColor || dist >= 1.08 || borde >= 3 || (propio && borde >= 1.4);
    if (!ok) add('c7.gris_sobre_gris', 'caja del color de su fondo (fondo ' + bg.slice(0, 3).map(Math.round) + ' sobre ' + bgp.slice(0, 3).map(Math.round) + ', borde ' + borde.toFixed(2) + ':1) ' + desc(e));
  }

  // ═══ C8 · CARGA (fotograma actual; el que llama repite varias veces) ════
  if (o.carga) {
    const caps = (sel) => [...document.querySelectorAll(sel)].filter((e) => !e.closest('svg') && vis(e) && getComputedStyle(e).opacity !== '0');
    const logos = caps('[role="img"][aria-label="Likida"]');
    const estado = caps('[role="status"][aria-label="Cargando"]');
    if (logos.length !== 1) add('c8.un_logo', logos.length + ' logo(s) visible(s) a la vez (debe ser exactamente 1)');
    // La capa: el ancestro fijo más cercano del indicador de carga debe cubrir el 100 % del viewport.
    const ind = estado[0] || logos[0];
    let capa = null; for (let p = ind; p && p !== document.documentElement; p = p.parentElement) if (getComputedStyle(p).position === 'fixed') { capa = p; break; }
    if (!capa) add('c8.capa_completa', 'el indicador de carga no vive en una capa fija a pantalla completa (queda dentro del contenido)');
    else { const r = capa.getBoundingClientRect(); if (r.left > 0.5 || r.top > 0.5 || r.right < VW - 0.5 || r.bottom < VH - 0.5) add('c8.capa_completa', 'la capa fija mide ' + Math.round(r.width) + '×' + Math.round(r.height) + ' (viewport ' + VW + '×' + VH + ')'); }
    const shell = caps('.rv-sb,.rv-cab-movil,.rv-cab-esc,.rv-hoja,nav,aside,header');
    const taparon = capa ? shell.filter((s) => { const q = s.getBoundingClientRect(); const c = document.elementFromPoint(Math.min(Math.max(q.left + q.width / 2, 0), VW - 1), Math.min(Math.max(q.top + q.height / 2, 0), VH - 1)); return c && !capa.contains(c) && !s.contains(c) && !c.contains(s) ? false : !(c && capa.contains(c)); }) : shell;
    if (taparon.length) add('c8.solo_la_capa', 'visibles junto a la carga: ' + [...new Set(taparon.map((s) => s.className && typeof s.className === 'string' ? s.className.split(/\s+/)[0] : s.tagName.toLowerCase()))].join(', '));
    const textos = [...document.querySelectorAll('body *')].filter((e) => !e.closest('svg') && !e.closest('script,style') && vis(e) && !oculto(e) && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && (!capa || !shell.some((s) => s.contains(e))));
    const ambito = capa || estado[0] || null;
    const textosCapa = ambito ? textos.filter((e) => ambito.contains(e)) : textos;
    if (textosCapa.length) add('c8.sin_texto', 'texto visible en la carga: ' + textosCapa.slice(0, 3).map((e) => '"' + e.textContent.trim().slice(0, 24) + '"').join(', '));
    if (capa) { const bgc = bgDe(capa).c, bgb = rgba(getComputedStyle(document.body).backgroundColor); const bgbase = bgb[3] > 0 ? bgb : bgc; if (rgba(getComputedStyle(capa).backgroundColor)[3] < 0.99 || ratio(bgc, bgbase) > 1.001) add('c8.un_color', 'la capa no es de un solo color opaco igual al fondo de la app'); }
    stats.carga = { logos: logos.length, capaFija: !!capa };
  }

  // ═══ N · CRITERIOS NUEVOS (PLAN §4.2, N1–N8) ═══════════════════════════════════
  // Contrato de selectores (los componentes v2 los respetan): sidebar `.rv-sb` con pie `.rv-sb__pie` (o `[data-sb-pie]`),
  // cabecera móvil `.rv-cab-movil`, primario `.rv-btn--primary` (o `[data-variante="primario"]`), IDs en `code|kbd|samp|.rv-id|[data-mono="id"]`.
  const oscuro = document.documentElement.getAttribute('data-theme') === 'dark';
  if (!o.carga) {
    const sb = [...document.querySelectorAll('.rv-sb')].find((e) => vis(e));
    // N1 · primarios por pliegue y masas negras/blancas de navegación
    const PRIM = '.rv-btn--primary,[data-variante="primario"],.btn-primary';
    const prims = todos.filter((e) => e.matches(PRIM) && !e.closest(SHELL) && e.getBoundingClientRect().top < VH);
    const solidos = btns.filter((e) => { if (e.closest(SHELL) || e.matches(PRIM)) return false; const cs2 = getComputedStyle(e); const bg = rgba(cs2.backgroundColor); const bgp = e.parentElement ? bgDe(e.parentElement).c : [255, 255, 255, 1]; return bg[3] > 0.9 && lum(bg) < 0.2 && ratio(blend(bg, bgp), bgp) >= 4 && e.getBoundingClientRect().top < VH; });
    const nPrim = prims.length + solidos.length;
    if (nPrim > 1) add('n1.primarios', nPrim + ' botones primarios en el primer pliegue (máx. 1): ' + [...prims, ...solidos].slice(0, 3).map(desc).join(' · '));
    for (const e of todos.filter((x) => x.matches('.rv-sb a,.rv-sb [aria-current],.rv-hoja a,nav a,aside a,[aria-current="page"]'))) {
      const cs2 = getComputedStyle(e); const r = e.getBoundingClientRect(); const bg = rgba(cs2.backgroundColor);
      if (bg[3] < 0.9 || r.width * r.height < 1500) continue;
      const l = lum(bg);
      if ((!oscuro && l < 0.08) || (oscuro && l > 0.6)) add('n1.masa_nav', (oscuro ? 'bloque blanco' : 'bloque negro') + ' de navegación ' + Math.round(r.width) + '×' + Math.round(r.height) + ' ' + desc(e));
    }
    // N2 · mono solo en IDs/folios/trazas y captions de grupo del sidebar
    const ID_TXT = /^(?:[A-Z]{1,5}-?\d{2,}|[0-9a-f]{8}-[0-9a-f-]{20,}|[0-9a-f]{7,40}|#?[A-Z0-9]{2,}-[A-Z0-9-]{3,})$/;
    for (const e of conTexto) {
      const fam = getComputedStyle(e).fontFamily.split(',')[0].replace(/["']/g, '').trim();
      if (!/mono|courier|consolas|menlo/i.test(fam)) continue;
      const t = [...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim();
      if (e.matches('code,kbd,samp,.rv-id,[data-mono="id"],.rv-grupo__t,.rv-sb__cap') || ID_TXT.test(t)) continue;
      add('n2.mono', 'mono (' + fam + ') fuera de IDs/captions: "' + t.slice(0, 24) + '" ' + desc(e));
    }
    // N3 · pie del sidebar: alto ≤150 y ningún ítem recortado (se mide a 1440×900 y a 1280×720)
    if (sb) {
      const pie = sb.querySelector('.rv-sb__pie,[data-sb-pie]');
      if (sb.getBoundingClientRect().width < 200) { /* riel de 72 px: el texto del pie se oculta a propósito; N3 mide el sidebar completo */ }
      else if (pie) {
        const pr = pie.getBoundingClientRect(), sr = sb.getBoundingClientRect();
        stats.pie = { alto: Math.round(pr.height), viewport: VW + '×' + VH };
        if (pr.height > U.pieMax + 0.5) add('n3.alto_pie', 'pie del sidebar ' + Math.round(pr.height) + 'px (máx. ' + U.pieMax + ')');
        for (const it of pie.querySelectorAll('a,button,select,[role="button"],[role="radio"]')) {
          if (oculto(it) || !vis(it)) continue;
          const r = it.getBoundingClientRect();
          const fuera = r.bottom > Math.min(sr.bottom, VH) + 0.5 || r.top < sr.top - 0.5;
          let cortado = false; for (let q = it.parentElement; q && q !== sb.parentElement; q = q.parentElement) { const ov = getComputedStyle(q).overflowY; if (ov !== 'visible') { const qr = q.getBoundingClientRect(); if (r.bottom > qr.bottom + 0.5 || r.top < qr.top - 0.5) { cortado = true; break; } } }
          if (fuera || cortado) add('n3.recorte', 'ítem del pie recortado a ' + VW + '×' + VH + ': ' + desc(it));
        }
      } else add('n3.alto_pie', 'sidebar sin pie identificable (.rv-sb__pie)');
    }
    // N4 · categorías abiertas del sidebar (≤1); la comparación de variantes entre pantallas la hace detectar.mjs con stats.sidebarFirma
    if (sb) {
      const nav = sb.querySelector('nav') || sb;
      const grupos = [...nav.querySelectorAll('section,[data-categoria],details')].filter((g) => !/^agentes$/i.test((g.querySelector('h2,summary,[class*="grupo__t"]')?.textContent || '').trim()));
      const abiertas = grupos.filter((g) => {
        if (g.tagName === 'DETAILS') return g.open;
        const tg = g.querySelector('[aria-expanded]'); if (tg) return tg.getAttribute('aria-expanded') === 'true';
        const ul = g.querySelector('ul'); return !!ul && vis(ul) && ul.getBoundingClientRect().height > 0;
      });
      stats.categoriasAbiertas = abiertas.length;
      if (abiertas.length > U.categoriasAbiertasMax) add('n4.categorias_abiertas', abiertas.length + ' categorías abiertas en el sidebar (máx. ' + U.categoriasAbiertasMax + ')');
      const limpio = sb.outerHTML.replace(/ aria-current="page"/g, ''); let hh = 0; for (let i = 0; i < limpio.length; i++) hh = (hh * 31 + limpio.charCodeAt(i)) | 0;
      stats.sidebarFirma = hh + '|' + [...nav.querySelectorAll('a')].filter((a) => vis(a)).map((a) => (a.textContent || '').trim()).join('|') + '#' + abiertas.length;
    }
    // N5 · logo SVG: exactamente 1 instancia en el sidebar (≥768) o en la cabecera móvil (<768)
    const marco = VW >= 768 ? sb : [...document.querySelectorAll('.rv-cab-movil')].find((e) => vis(e));
    if (marco) {
      const marcas = [...marco.querySelectorAll('[role="img"][aria-label="Likida"],svg[aria-label="Likida"],img[alt="Likida"]')].filter((e) => vis(e));
      const esSvg = (e) => e.tagName.toLowerCase() === 'svg' || /\.svg(\?|$)/.test(e.getAttribute('src') || '') || !!e.querySelector('svg');
      const svgs = marcas.filter(esSvg);
      if (marcas.length === 0) add('n5.logo', 'sin logo en ' + (VW >= 768 ? 'el sidebar' : 'la cabecera móvil'));
      else if (svgs.length !== 1 || marcas.length !== 1) add('n5.logo', marcas.length + ' marca(s), ' + svgs.length + ' en SVG (debe haber exactamente 1 instancia SVG) en ' + (VW >= 768 ? 'el sidebar' : 'la cabecera móvil'));
    } else if (!o.sinShell) add('n5.logo', 'sin sidebar / cabecera móvil visible');
    // N6 · cero falso: un «0» pelado en una cifra KPI / valor de barra sin fuente+periodo, o un cero monetario en una fila
    //      cuyo estado dice que el dato falta o está sin revisar («$0.00 Revisar»). Un cuadre exacto de una fila cerrada es un cero observado.
    const CERO = /^[\s$]*(?:MXN\s*)?[−-]?0(?:[.,]0+)?\s*(?:%|MXN|mil|M)?\s*$/;
    const FALTA = /revisar|pendiente|sin dato|por cuadrar|en espera|incompleto/i;
    for (const e of conTexto) {
      if (e.children.length && ![...e.childNodes].every((n) => n.nodeType === 3 || n.nodeName === 'SPAN')) continue;
      const t = (e.textContent || '').trim();
      if (!CERO.test(t) || e.closest('[data-cero-fuente]')) continue;
      if (e.matches(KPI_SEL + ',.rv-kpi__valor,[data-valor],.rv-barra__valor')) add('n6.falso_cero', '«' + t + '» sin fuente+periodo (dato desconocido debe ser «—») ' + desc(e));
      else if (e.matches('td') && FALTA.test(e.closest('tr')?.textContent || '')) add('n6.falso_cero', '«' + t + '» en una fila que dice «revisar/pendiente» (el dato falta: «—») ' + desc(e));
    }
    // N7 · fixtures: folios repetidos, «Operador Uno», aviso sintético por tarjeta
    const FOLIO = /^[A-Z]{1,4}-\d{3,}$/;
    // Repetido = el mismo folio dos veces DENTRO de la misma tabla/lista (un viaje puede salir en dos tablas distintas de la página).
    const folios = {}; for (const e of document.querySelectorAll('td,.rv-id,code,[data-mono="id"]')) { if (oculto(e) || !vis(e)) continue; const t = (e.textContent || '').trim(); if (!FOLIO.test(t)) continue; const ambito = e.closest('table,ul,ol') || document.body; if (!ambito.__n7) ambito.__n7 = Math.random().toString(36).slice(2); const k = ambito.__n7 + '|' + t; (folios[k] = folios[k] || []).push(e); }
    for (const [k, l] of Object.entries(folios)) if (l.length > 1) add('n7.fixture', 'folio repetido ' + k.split('|')[1] + ' ×' + l.length);
    const NOMBRES_FALSOS = /\b(?:operador|chofer|conductor|unidad|usuario)\s+(?:uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|de prueba(?:\s*\d+)?|\d+)\b|\b(?:ciudad alfa|puerto beta|villa gamma|valle delta)\b/i;
    for (const e of conTexto) { const t = [...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(' '); const m = t.match(NOMBRES_FALSOS); if (m) add('n7.fixture', 'dato de caricatura «' + m[0] + '» ' + desc(e)); }
    const avisos = conTexto.filter((e) => /sint[eé]tic/i.test([...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(' ')));
    if (avisos.length > 1) add('n7.fixture', avisos.length + ' avisos «sintético» en la página (debe haber 1 por página, jamás por tarjeta)');
    // N8 · esqueletos y chips «Observado» repetidos
    for (const e of todos.filter((x) => x.matches('.skeleton,[class*="skeleton"],[class*="esqueleto"],.animate-pulse,[data-esqueleto]') && !x.closest(SHELL))) add('n8.esqueleto', 'esqueleto ' + desc(e));
    const observados = conTexto.filter((e) => /^observado$/i.test((e.textContent || '').trim()) && e.matches('[class*="chip"],[class*="kind"],[class*="badge"],span'));
    const enKpi = observados.filter((e) => e.closest('[class*="kpi"],.card,.rv-kpis'));
    if (observados.length > 1) add('n8.observado', observados.length + ' chips «Observado» (el Observado va silencioso: punto 6 px + texto muted)');
    else if (enKpi.length && enKpi[0].closest('[class*="kpi"]')) add('n8.observado', 'chip «Observado» dentro de una celda KPI');
  }

  // ── salida ──────────────────────────────────────────────────────────────
  const out = { hallazgos: {}, n: {}, stats };
  for (const k of Object.keys(R)) { const u = [...new Set(R[k])]; out.n[k] = R[k].length; out.hallazgos[k] = u.slice(0, MAXEJ); }
  return out;
}
