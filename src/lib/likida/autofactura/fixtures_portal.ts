import type { CampoGuion, GuionPortal } from '../facturacion/adaptadores/guion';

// ═══════════════════════════════════════════════════════════════════════════
// FIXTURES HTML POR GUION — para que cada tabla de selectores se pruebe contra un DOM, con el
// motor de verdad, sin tocar un portal real.
//
// ── QUÉ SON Y QUÉ NO ──────────────────────────────────────────────────────
// Estos fixtures son `sintetico_desde_guion`: se DERIVAN de los propios selectores del guion, así que
// «el guion resuelve contra su fixture» es una tautología sobre el DOM y NO prueba nada del portal.
// Lo que sí prueban, cada vez: (a) que cada selector es sintácticamente válido para Playwright
// (xpath, :has-text, escapes de `:` de JSF…), (b) que el MOTOR llena los campos correctos, aprieta el
// botón correcto, lee el UUID y lee el rechazo, y (c) que el estado «ensayo no emite» se cumple.
// Se vuelven `grabado` cuando una corrida supervisada guarda el DOM real saneado
// (`scripts/verificar-portal.mjs`): ese archivo reemplaza al sintético y el manifiesto lo dice.
//
// Sin datos reales: los valores salen de los campos que escribe el motor; el UUID del fixture es
// el UUID nulo 00000000-0000-4000-8000-000000000001, jamás un folio fiscal.
// ═══════════════════════════════════════════════════════════════════════════

export const UUID_FIXTURE = '00000000-0000-4000-8000-000000000001';
export const TEXTO_RECHAZO_FIXTURE = 'El RFC capturado no es válido (fixture)';

const lista = (s: string | readonly string[] | undefined): string[] => (s === undefined ? [] : typeof s === 'string' ? [s] : [...s]);

/** Parte «a, b» por comas FUERA de comillas, corchetes y paréntesis. */
function partirCandidatos(sel: string): string[] {
  const out: string[] = [];
  let actual = '';
  let comilla: string | null = null;
  let prof = 0;
  for (let i = 0; i < sel.length; i++) {
    const c = sel[i];
    if (comilla) { actual += c; if (c === comilla && sel[i - 1] !== '\\') comilla = null; continue; }
    if (c === '"' || c === "'") { comilla = c; actual += c; continue; }
    if (c === '[' || c === '(') prof++;
    if (c === ']' || c === ')') prof--;
    if (c === ',' && prof === 0) { out.push(actual.trim()); actual = ''; continue; }
    actual += c;
  }
  if (actual.trim()) out.push(actual.trim());
  return out;
}

/** Las claves SAT que un portal puede recibir en un <select> (régimen, uso de CFDI): el fixture las ofrece todas. */
const OPCIONES_SAT = ['601', '603', '605', '606', '607', '608', '610', '611', '612', '614', '615', '616', '620', '621', '622', '623', '624', '625', '626', 'G01', 'G02', 'G03', 'S01', 'CP01', 'P01'];
const OPCIONES = `<option value="">Selecciona</option>${OPCIONES_SAT.map((o) => `<option value="${o}">${o}</option>`).join('')}`;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

export type Rol = 'campo' | 'select' | 'boton' | 'contenedor';

/**
 * El HTML MÍNIMO que hace que UN selector (el primero traducible de su lista) resuelva. `null` si
 * ningún candidato tiene una forma que sepamos construir — entonces el guion se declara «no
 * sintetizable» y se dice, en vez de fabricar algo que no lo cumpla.
 */
export function htmlDeSelector(selector: string | readonly string[], rol: Rol, texto = ''): string | null {
  for (const cruda of lista(selector)) {
    for (const cand of partirCandidatos(cruda)) {
      const h = traducir(cand, rol, texto);
      if (h !== null) return h;
    }
  }
  return null;
}

function traducir(sel: string, rol: Rol, texto: string): string | null {
  let m: RegExpExecArray | null;

  // xpath=//label[contains(normalize-space(.), "TEXTO")]/following::input[1]
  if ((m = /^xpath=\/\/label\[contains\(normalize-space\(\.\), (?:"([^"]*)"|'([^']*)')\)\]\/following::input\[1\]$/.exec(sel))) {
    return `<label>${esc(m[1] ?? m[2])}</label><div><input type="text"></div>`;
  }
  if (sel.startsWith('xpath=')) return null;

  // botón por texto: button:has-text("X")  (el resto de la lista lo parte partirCandidatos)
  if ((m = /^button:has-text\("([^"]*)"\)$/.exec(sel))) return `<button type="button">${esc(m[1])}</button>`;
  if ((m = /^input\[type="(?:submit|button)"\]\[value\*="([^"]*)" i\]$/.exec(sel))) return `<input type="submit" value="${esc(m[1])}">`;
  if ((m = /^button\.([\w-]+(?:\.[\w-]+)*)$/.exec(sel))) return `<button type="button" class="${m[1].replace(/\./g, ' ')}">${esc(texto || 'Continuar')}</button>`;
  if ((m = /^button\[type="(\w+)"\]$/.exec(sel))) return `<button type="${m[1]}">${esc(texto || 'Continuar')}</button>`;
  if ((m = /^input\[value="([^"]*)"\]$/.exec(sel))) return `<input type="submit" value="${esc(m[1])}">`;
  if ((m = /^input\[type="(\w+)"\]\[value="([^"]*)"\]$/.exec(sel))) return `<input type="${m[1]}" value="${esc(m[2])}">`;

  // #id (JSF escapa los dos puntos: #form\:folio)
  if ((m = /^#((?:[\w-]|\\:)+)$/.exec(sel))) {
    const id = m[1].replace(/\\:/g, ':');
    if (rol === 'select') return `<select id="${esc(id)}">${OPCIONES}</select>`;
    if (rol === 'boton') return `<button type="button" id="${esc(id)}">${esc(texto || 'Continuar')}</button>`;
    if (rol === 'contenedor') return `<div id="${esc(id)}">${esc(texto)}</div>`;
    return `<input type="text" id="${esc(id)}">`;
  }
  // atributos de campo
  if ((m = /^(input|select)?\[name="([^"]*)"\]$/.exec(sel))) return campo(m[1], rol, `name="${esc(m[2])}"`);
  if ((m = /^(input|select)?\[name\*="([^"]*)" i\]$/.exec(sel))) return campo(m[1], rol, `name="x-${esc(m[2])}-x"`);
  if ((m = /^(input|select)?\[id\*="([^"]*)"\]$/.exec(sel))) return campo(m[1], rol, `id="x-${esc(m[2])}-x"`);
  if ((m = /^(input|select)?\[formcontrolname="([^"]*)"\]$/.exec(sel))) return campo(m[1], rol, `formcontrolname="${esc(m[2])}"`);
  if ((m = /^(input|select)?\[placeholder="([^"]*)"\]$/.exec(sel))) return campo(m[1], rol, `placeholder="${esc(m[2])}"`);
  if ((m = /^input\[type="(\w+)"\]$/.exec(sel))) return `<input type="${m[1]}">`;
  if ((m = /^a\[href\$="([^"]*)"\]$/.exec(sel))) return `<a href="/x${esc(m[1])}">Descargar</a>`;

  // contenedores por clase / atributo
  if ((m = /^\.([\w-]+)$/.exec(sel))) return `<div class="${m[1]}">${esc(texto)}</div>`;
  if ((m = /^\[class\*="([^"]*)"(?: i)?\]$/.exec(sel))) return `<div class="x-${esc(m[1])}-x">${esc(texto)}</div>`;
  if ((m = /^\[data-([\w-]+)\]$/.exec(sel))) return `<div data-${m[1]}="1">${esc(texto)}</div>`;
  if (sel === 'table tbody tr') return `<table><tbody><tr><td>${esc(texto || 'Resultado')}</td></tr></tbody></table>`;
  return null;
}

function campo(tag: string | undefined, rol: Rol, attr: string): string {
  if (tag === 'select' || rol === 'select') return `<select ${attr}>${OPCIONES}</select>`;
  return `<input type="text" ${attr}>`;
}

export interface FixtureDeGuion {
  /** Formulario en blanco, con el comportamiento mínimo (buscar/emitir) en JS. */
  formulario: string;
  /** El mismo formulario, pero «emitir» muestra el rechazo del portal en vez del UUID. */
  rechazo: string;
  /** Lo que no se pudo construir (vacío = el fixture cubre toda la tabla). */
  noSintetizable: string[];
}

export function construirFixture(g: GuionPortal): FixtureDeGuion {
  const faltan: string[] = [];
  const pedazos: string[] = [];
  const poner = (cuando: string, sel: string | readonly string[] | undefined, rol: Rol, texto?: string): string | null => {
    if (sel === undefined) return null;
    const h = htmlDeSelector(sel, rol, texto);
    if (h === null) faltan.push(`${cuando}: ${lista(sel).join(' | ')}`);
    return h;
  };

  for (const [dato, c] of Object.entries(g.receptor ?? {}) as Array<[string, CampoGuion]>) {
    const h = poner(`dato fiscal ${dato}`, c.selector, c.como === 'seleccionar' ? 'select' : 'campo');
    if (h) pedazos.push(`<div class="fx-campo">${h}</div>`);
  }
  for (const [clave, c] of Object.entries(g.campos) as Array<[string, CampoGuion]>) {
    const h = poner(`campo ${clave}`, c.selector, c.como === 'seleccionar' ? 'select' : 'campo');
    if (h) pedazos.push(`<div class="fx-campo">${h}</div>`);
  }
  let buscarHtml = '';
  if (g.buscar) {
    const b = poner('botón de buscar', g.buscar.boton, 'boton');
    if (b) buscarHtml = b.replace(/^<(button|input)/, '<$1 data-fx="buscar"');
  }
  let emitirHtml = poner('botón de emitir', g.botonEmitir, 'boton') ?? '';
  emitirHtml = emitirHtml.replace(/^<(button|input)/, '<$1 data-fx="emitir"');

  const uuidHtml = g.uuid ? (poner('contenedor del UUID', g.uuid, 'contenedor', UUID_FIXTURE) ?? '') : '';
  const errorHtml = g.error ? (poner('cuadro de error', g.error, 'contenedor', TEXTO_RECHAZO_FIXTURE) ?? '') : '';
  const esperarHtml = g.buscar?.esperar ? (poner('resultado de la búsqueda', g.buscar.esperar, 'contenedor', 'Resultado') ?? '') : '';
  const xmlCrudo = g.xml ? (poner('botón del XML', g.xml.boton, 'boton', 'Descargar XML') ?? '') : '';
  // El clic en el XML dispara una descarga real (Blob con un XML de fixture), que es lo que el motor espera.
  const xmlHtml = xmlCrudo.replace(/^<(button|input|a)/, '<$1 data-fx="xml"');

  const pagina = (reveladoAlEmitir: string) => `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>Fixture ${esc(g.comercio)} — sintético, NO es el portal real</title></head>
<body>
<!-- FIXTURE sintetico_desde_guion: derivado de los selectores de ${esc(g.comercio)}. No es el DOM del portal real. -->
<form onsubmit="return false" id="fx-form">
${pedazos.join('\n')}
${buscarHtml}
${emitirHtml}
</form>
<div id="fx-salida"></div>
<script>
  var DESPUES_DE_BUSCAR = ${JSON.stringify(esperarHtml)};
  var AL_EMITIR = ${JSON.stringify(reveladoAlEmitir)};
  var XML = ${JSON.stringify(xmlHtml)};
  document.addEventListener('click', function (e) {
    var el = e.target.closest ? e.target.closest('[data-fx]') : null;
    if (!el) return;
    e.preventDefault();
    var salida = document.getElementById('fx-salida');
    if (el.getAttribute('data-fx') === 'buscar') salida.insertAdjacentHTML('beforeend', DESPUES_DE_BUSCAR);
    if (el.getAttribute('data-fx') === 'emitir') salida.insertAdjacentHTML('beforeend', AL_EMITIR + XML);
    if (el.getAttribute('data-fx') === 'xml') {
      var blob = new Blob(['<?xml version="1.0"?><fixture UUID="${UUID_FIXTURE}"/>'], { type: 'text/xml' });
      var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'fixture.xml';
      document.body.appendChild(a); a.click(); a.remove();
    }
  });
</script>
</body></html>
`;
  return { formulario: pagina(uuidHtml), rechazo: pagina(errorHtml), noSintetizable: faltan };
}
