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
  escalaPermitida: [11, 12, 13, 14, 15, 20, 26], // 11 solo MAYÚSCULAS; 14 = H2; 15 = título de overlay; 16 solo campos en móvil
  // c3
  radios: [0, 8, 12],        // + píldora (radio >= la mitad del lado menor)
  padTarjeta: 14, padTarjetaMovil: 12,
  gapMax: 12,
  padPagina: 24,
  // c4
  aireInfPx: 24, aireInfPct: 0.25, altoVecinoTol: 4, huecoFila: 0.12,
  // c5
  filasPliegue: 8,
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
        if ((e.classList.contains('rv-btn--primary') || solido) && h > U.primarioAltoMax + U.tolAlto) add('c1.boton_gordo', 'primario sólido alto ' + Math.round(h * 10) / 10 + ' (máx. ' + U.primarioAltoMax + ') ' + desc(e));
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
    const mayus = cs.textTransform === 'uppercase';
    const esKpi = e.matches(KPI_SEL);
    if (esKpi) kpis.push(fs);
    if (fs < U.textoMin - 0.05) add('c2.texto_menor_11', fs + 'px ' + desc(e));
    if (e.matches('h1')) { /* se juzga abajo */ }
    else if (esKpi) {
      if (fs > U.kpiMax + 0.05) add('c2.kpi_mayor_30', fs + 'px (tope ' + U.kpiMax + ') ' + desc(e));
      if (Math.abs(fs - U.kpi) > U.kpiTol) add('c2.kpi_no_26', fs + 'px (norma ' + U.kpi + ') ' + desc(e));
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
    if (fs > 0 && fs < U.textoMin - 0.05) add('c2.texto_menor_11', 'svg ' + Math.round(fs * 10) / 10 + 'px "' + (t.textContent || '').trim().slice(0, 20) + '"');
  }
  const h1s = todos.filter((e) => e.matches('h1'));
  if (h1s.length !== 1) add('c2.h1', 'h1 en pantalla: ' + h1s.length + ' (debe ser 1)');
  for (const h of h1s) { const fs = px(getComputedStyle(h).fontSize); if (Math.abs(fs - U.h1) > U.h1Tol) add('c2.h1', 'h1 ' + fs + 'px (norma ' + U.h1 + ') ' + desc(h)); }
  stats.escalaTexto = escala; stats.kpiTamanos = kpis; stats.h1 = h1s.map((h) => px(getComputedStyle(h).fontSize));

  // ═══ C3 · PADDING / GAP / RADIOS ════════════════════════════════════════
  const radioOk = (e, cs, r) => {
    const t = cs.borderTopLeftRadius; let v;
    if (/%/.test(t)) v = (parseFloat(t) / 100) * Math.min(r.width, r.height); else v = px(t);
    const mitad = Math.min(r.width, r.height) / 2;
    if (v <= 0.01) return { ok: true, v };
    if (Math.abs(v - 8) <= 0.6 || Math.abs(v - 12) <= 0.6) return { ok: true, v };
    if (v >= mitad - 0.6) return { ok: true, v };
    return { ok: false, v };
  };
  const radiosVistos = {};
  for (const e of todos) {
    const cs = getComputedStyle(e); const r = e.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    if (!cajaPropia(e, cs)) continue;
    const q = radioOk(e, cs, r); const k = String(Math.round(q.v * 10) / 10); radiosVistos[k] = (radiosVistos[k] || 0) + 1;
    if (!q.ok) add('c3.radio', 'radio ' + Math.round(q.v * 10) / 10 + 'px (permitidos 8, 12, píldora) ' + desc(e));
  }
  stats.radios = radiosVistos;
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
  const cont = document.querySelector('#contenido-principal') || document.querySelector('main');
  if (cont) {
    const cs = getComputedStyle(cont); const pl = px(cs.paddingLeft), pt = px(cs.paddingTop);
    stats.paddingPagina = { izq: pl, arriba: pt };
    if (VW >= 1024 && Math.abs(pl - U.padPagina) > 1) add('c3.padding_pagina', 'padding de página ' + pl + 'px (norma ' + U.padPagina + ' en ≥1024)');
    if (movil && pl > 16.5) add('c3.padding_pagina', 'padding de página ' + pl + 'px en móvil (máx. 16)');
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

  // ═══ C5 · PRIMER PLIEGUE (solo 1440×900 y pantallas de tipo panel) ══════
  if (o.pliegue) {
    const kp = todos.filter((e) => e.matches('.rv-kpis,.rv-kpi,[class*="kpi"]') && !e.closest(SHELL));
    if (!kp.length) add('c5.kpi', 'sin tira de KPI');
    else if (!kp.some((e) => e.getBoundingClientRect().bottom <= VH)) add('c5.kpi', 'la tira de KPI no cabe en el primer pliegue (' + VH + ' px)');
    const grafs = [...document.querySelectorAll('svg')].filter((s) => !oculto(s) && vis(s) && !s.closest(SHELL) && s.getBoundingClientRect().width >= 200 && s.getBoundingClientRect().height >= 80 && !s.closest('button'));
    if (!grafs.length) add('c5.grafica', 'sin gráfica principal');
    else if (!grafs.some((s) => s.getBoundingClientRect().bottom <= VH)) add('c5.grafica', 'la gráfica principal no cabe completa en el primer pliegue');
    const filas = [...document.querySelectorAll('tbody tr')].filter((t) => vis(t) && !oculto(t));
    const dentro = filas.filter((t) => t.getBoundingClientRect().bottom <= VH).length;
    stats.pliegue = { kpis: kp.length, graficas: grafs.length, filasTotales: filas.length, filasVisibles: dentro };
    if (dentro < U.filasPliegue) add('c5.filas', dentro + ' fila(s) de tabla en el primer pliegue (mín. ' + U.filasPliegue + '; hay ' + filas.length + ')');
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
    if (e.scrollWidth <= e.clientWidth + 1 || e.tagName === 'SELECT' || e.tagName === 'INPUT' || scrollers(e)) continue;
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
    const textosCapa = capa ? textos.filter((e) => capa.contains(e)) : textos;
    if (textosCapa.length) add('c8.sin_texto', 'texto visible en la carga: ' + textosCapa.slice(0, 3).map((e) => '"' + e.textContent.trim().slice(0, 24) + '"').join(', '));
    if (capa) { const bgc = bgDe(capa).c, bgb = rgba(getComputedStyle(document.body).backgroundColor); const bgbase = bgb[3] > 0 ? bgb : bgc; if (rgba(getComputedStyle(capa).backgroundColor)[3] < 0.99 || ratio(bgc, bgbase) > 1.001) add('c8.un_color', 'la capa no es de un solo color opaco igual al fondo de la app'); }
    stats.carga = { logos: logos.length, capaFija: !!capa };
  }

  // ── salida ──────────────────────────────────────────────────────────────
  const out = { hallazgos: {}, n: {}, stats };
  for (const k of Object.keys(R)) { const u = [...new Set(R[k])]; out.n[k] = R[k].length; out.hallazgos[k] = u.slice(0, MAXEJ); }
  return out;
}
