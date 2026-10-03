import type { CampoGuion, GuionPortal } from '../facturacion/adaptadores/guion';
import { SELECTORES_CAPTCHA_COMUNES } from '../facturacion/adaptadores/pasos';
import type { InventarioPagina } from '../facturacion/adaptadores/playwright_base';
import { huellaDeGuion, sha256Texto, type EntradaVerificacion } from './verificacion';

// ═══════════════════════════════════════════════════════════════════════════
// LA CORRIDA SUPERVISADA — el núcleo, sin Chromium ni red (la página entra por un puerto).
//
// Es lo que `scripts/verificar-portal.mjs` ejecuta contra el portal REAL, y SOLO tras la
// confirmación humana explícita (ver el script). Aquí solo vive la LÓGICA, para poder probarla con
// dobles y para que el veredicto no dependa de quién lo corra:
//   · una visita, de SOLO LECTURA (el script aborta toda petición que no sea GET/HEAD);
//   · primero el CAPTCHA: si lo hay, el portal no se gradúa (modo asistido);
//   · después cada selector que DEBE estar con el formulario en blanco;
//   · el veredicto es `graduable` únicamente si no hubo CAPTCHA y todos los `debe` resolvieron.
//
// QUÉ SIGNIFICA «GRADUABLE» (y qué no): los selectores del formulario en blanco existen. El contenedor
// del UUID, el cuadro de error y el XML solo aparecen al emitir, así que NO se ven; el botón de emitir
// es una apuesta en varios portales. Por eso la entrada del registro es de nivel `prevuelo`, y la
// PRIMERA emisión real sigue siendo supervisada (control de emisión: fase `supervisada`).
// ═══════════════════════════════════════════════════════════════════════════

/** Lo que la corrida necesita de una página (la implementa PaginaPlaywright). */
export interface PaginaVerificable {
  abrir(url: string): Promise<void>;
  existe(selector: string): Promise<boolean>;
  inventario(): Promise<InventarioPagina>;
  captura(): Promise<string>;
  titulo(): Promise<string>;
  urlActual(): string;
  html(): Promise<string>;
}

type Espera = 'debe' | 'no-todavia';
export interface Chequeo { que: string; candidatos: readonly string[]; espera: Espera; nota?: string }

const lista = (s: string | readonly string[]): readonly string[] => (typeof s === 'string' ? [s] : s);

/** Los chequeos de UN guion, derivados de su tabla (los mismos del arnés manual `guion-prevuelo.prueba.ts`). */
export function chequeosDe(g: GuionPortal): Chequeo[] {
  const c: Chequeo[] = [];
  for (const [dato, campo] of Object.entries(g.receptor ?? {}) as Array<[string, CampoGuion]>) {
    c.push({ que: `dato fiscal · ${dato}`, candidatos: lista(campo.selector), espera: 'debe' });
  }
  for (const [clave, campo] of Object.entries(g.campos) as Array<[string, CampoGuion]>) {
    c.push({ que: `campo del ticket · ${clave}`, candidatos: lista(campo.selector), espera: 'debe' });
  }
  if (g.buscar) {
    c.push({ que: g.buscar.que, candidatos: lista(g.buscar.boton), espera: 'debe' });
    if (g.buscar.esperar) c.push({ que: 'resultado de la búsqueda', candidatos: [g.buscar.esperar], espera: 'no-todavia', nota: 'Solo aparece DESPUÉS de buscar.' });
    if (g.buscar.sinResultados) c.push({ que: 'aviso de "no encontramos ese ticket"', candidatos: [g.buscar.sinResultados], espera: 'no-todavia' });
  }
  c.push({ que: 'botón de emitir', candidatos: lista(g.botonEmitir), espera: 'debe', nota: 'APUESTA en varios portales: se elige por TEXTO y a veces no existe hasta que el consumo se encontró.' });
  if (g.uuid) c.push({ que: 'contenedor del UUID', candidatos: [g.uuid], espera: 'no-todavia', nota: 'Imposible de verificar sin emitir: es la apuesta a mirar en la PRIMERA emisión real supervisada.' });
  if (g.error) c.push({ que: 'cuadro de error', candidatos: [g.error], espera: 'no-todavia', nota: 'Con el formulario en blanco no hay error que enseñar.' });
  if (g.xml) c.push({ que: 'botón de bajar el XML', candidatos: lista(g.xml.boton), espera: 'no-todavia', nota: 'Aparece después de emitir.' });
  return c;
}

export type Veredicto = 'graduable' | 'no_abrio' | 'no_graduar_captcha' | 'no_graduar_selectores';

export interface ResultadoPrevuelo {
  comercio: string;
  url: string;
  fechaIso: string;
  abrio: boolean;
  motivoNoAbrio?: string;
  urlReal?: string;
  titulo?: string;
  captcha: string[];
  chequeos: Array<Chequeo & { ganador: string | null }>;
  resueltos: string[];
  sinResolver: string[];
  inventario?: { campos: number; botones: number };
  capturaRuta?: string;
  veredicto: Veredicto;
}

export async function correrPrevuelo(g: GuionPortal, pagina: PaginaVerificable, ahora: () => Date = () => new Date()): Promise<ResultadoPrevuelo> {
  const base = { comercio: g.comercio, url: g.portal, fechaIso: ahora().toISOString(), captcha: [] as string[], chequeos: [], resueltos: [] as string[], sinResolver: [] as string[] };
  try {
    await pagina.abrir(g.portal);
  } catch (e) {
    return { ...base, abrio: false, motivoNoAbrio: e instanceof Error ? e.message : String(e), veredicto: 'no_abrio' };
  }
  const r: ResultadoPrevuelo = { ...base, abrio: true, urlReal: pagina.urlActual(), titulo: await pagina.titulo(), veredicto: 'graduable' };

  for (const sel of [...(g.captcha ?? []), ...SELECTORES_CAPTCHA_COMUNES]) {
    if (await pagina.existe(sel)) r.captcha.push(sel);
  }
  for (const ch of chequeosDe(g)) {
    let ganador: string | null = null;
    for (const cand of ch.candidatos) { if (await pagina.existe(cand)) { ganador = cand; break; } }
    r.chequeos.push({ ...ch, ganador });
    if (ganador) r.resueltos.push(ch.que);
    else if (ch.espera === 'debe') r.sinResolver.push(ch.que);
  }
  const inv = await pagina.inventario();
  r.inventario = { campos: inv.campos.length, botones: inv.botones.length };
  r.capturaRuta = await pagina.captura();
  r.veredicto = r.captcha.length > 0 ? 'no_graduar_captcha' : r.sinResolver.length > 0 ? 'no_graduar_selectores' : 'graduable';
  return r;
}

/** El reporte en texto: lo que queda como EVIDENCIA (su sha256 va al registro). Determinista. */
export function renderizarReporte(r: ResultadoPrevuelo): string {
  const l: string[] = [];
  l.push(`PRE-VUELO SUPERVISADO · ${r.comercio.toUpperCase()} — SOLO LECTURA`);
  l.push(`URL      ${r.url}`);
  l.push(`Fecha    ${r.fechaIso}`);
  if (!r.abrio) {
    l.push(`Abrió    NO — ${r.motivoNoAbrio}`);
    l.push('NO se marca nada como verificado: un portal que no abrió no dijo que sus selectores estén mal.');
    return `${l.join('\n')}\n`;
  }
  l.push(`Título   ${r.titulo ?? ''}`);
  l.push(`URL real ${r.urlReal}${r.urlReal !== r.url ? '   (HUBO REDIRECCIÓN)' : ''}`);
  l.push(r.captcha.length > 0 ? `CAPTCHA  ${r.captcha.join(', ')}` : 'CAPTCHA  ninguno visible');
  l.push('');
  for (const c of r.chequeos) {
    l.push(`${c.ganador ? 'OK ' : c.espera === 'debe' ? 'FALTA' : '·  '} ${c.que}${c.ganador ? ` → ${c.ganador}` : ` — ninguno de ${c.candidatos.length} candidato(s)`}`);
  }
  l.push('');
  l.push(`Inventario: ${r.inventario?.campos ?? 0} campos, ${r.inventario?.botones ?? 0} botones`);
  l.push(`VEREDICTO ${r.veredicto}`);
  return `${l.join('\n')}\n`;
}

/** La entrada del registro para una corrida graduable. Lanza si la corrida NO lo era: no se gradúa a la fuerza. */
export function entradaDeRegistro(a: {
  guion: GuionPortal; resultado: ResultadoPrevuelo; confirmadoPor: string; reporteRel: string; reporteTexto: string; capturaRel?: string;
}): EntradaVerificacion {
  if (a.resultado.veredicto !== 'graduable') throw new Error(`la corrida no es graduable (${a.resultado.veredicto}): no se escribe en el registro`);
  return {
    fecha: a.resultado.fechaIso.slice(0, 10),
    nivel: 'prevuelo',
    huellaGuion: huellaDeGuion(a.guion),
    arnes: 'scripts/verificar-portal.mjs',
    resueltos: a.resultado.resueltos,
    confirmadoPor: a.confirmadoPor,
    evidencia: { reporte: a.reporteRel, sha256: sha256Texto(a.reporteTexto), ...(a.capturaRel ? { captura: a.capturaRel } : {}) },
  };
}

// ── El DOM grabado, saneado (para el fixture `grabado`) ─────────────────────

const ETIQUETAS_CON_CUERPO_FUERA = new Set(['script', 'noscript', 'iframe', 'object', 'embed']);
const ATRIBUTOS_FUERA = new Set(['nonce', 'integrity', 'data-token', 'data-csrf', 'data-sitekey', 'autocomplete']);
const esBlanco = (c: string | undefined): boolean => c === ' ' || c === '\n' || c === '\t' || c === '\r' || c === '\f';
const esInicioDeNombre = (c: string | undefined): boolean => c !== undefined && /[A-Za-z_:]/.test(c);
const esCharDeNombre = (c: string | undefined): boolean => c !== undefined && /[-A-Za-z0-9_:.]/.test(c);

/** Escapa lo que no es etiqueta: un `>` o `<` suelto en el texto nunca puede volver a leerse como marcado. */
function escaparTexto(t: string): string {
  return t.replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escaparValor(v: string): string {
  return v.replace(/&(?![a-zA-Z#][a-zA-Z0-9]*;)/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Fin (índice del `>`) de la etiqueta que empieza en `desde` (un `<`), respetando comillas; -1 si no cierra. */
function finDeEtiqueta(html: string, desde: number): number {
  let comilla = '';
  for (let i = desde + 1; i < html.length; i++) {
    const c = html[i];
    if (comilla) { if (c === comilla) comilla = ''; continue; }
    if (c === '"' || c === "'") { comilla = c; continue; }
    if (c === '>') return i;
  }
  return -1;
}

/** Nombre y atributos de lo que hay entre `<` y `>`, leídos carácter a carácter (sin regex de etiquetas). */
function leerEtiqueta(cuerpo: string): { cierre: boolean; nombre: string; atributos: Array<[string, string | null]> } {
  let i = 0;
  const cierre = cuerpo[0] === '/';
  if (cierre) i++;
  let nombre = '';
  if (esInicioDeNombre(cuerpo[i])) while (esCharDeNombre(cuerpo[i])) nombre += cuerpo[i++];
  const atributos: Array<[string, string | null]> = [];
  while (i < cuerpo.length) {
    while (i < cuerpo.length && (esBlanco(cuerpo[i]) || cuerpo[i] === '/')) i++;
    if (!esInicioDeNombre(cuerpo[i])) { i++; continue; } // basura (p. ej. un `<` o una comilla suelta): se descarta
    let an = '';
    while (esCharDeNombre(cuerpo[i])) an += cuerpo[i++];
    while (esBlanco(cuerpo[i])) i++;
    let valor: string | null = null;
    if (cuerpo[i] === '=') {
      i++;
      while (esBlanco(cuerpo[i])) i++;
      const q = cuerpo[i];
      if (q === '"' || q === "'") {
        const f = cuerpo.indexOf(q, i + 1);
        valor = cuerpo.slice(i + 1, f < 0 ? cuerpo.length : f);
        i = f < 0 ? cuerpo.length : f + 1;
      } else {
        let v = '';
        while (i < cuerpo.length && !esBlanco(cuerpo[i])) v += cuerpo[i++];
        valor = v;
      }
    }
    atributos.push([an.toLowerCase(), valor]);
  }
  return { cierre, nombre: nombre.toLowerCase(), atributos };
}

/** Índice justo después del `>` que cierra `</nombre`, o -1. */
function despuesDeCierre(html: string, minusculas: string, nombre: string, desde: number): number {
  const k = minusculas.indexOf(`</${nombre}`, desde);
  if (k < 0) return -1;
  const g = html.indexOf('>', k);
  return g < 0 ? -1 : g + 1;
}

/**
 * Quita lo que no debe llegar a git: scripts, estilos en línea de terceros, iframes, comentarios, atributos de
 * evento, valores de campos, tokens y todo lo que parezca un correo o un RFC. El resultado se REVISA a mano
 * antes de commitear (runbook), esto es la primera barrera, no la única.
 *
 * NO sanea con regex de etiquetas (un patrón que borra `<script>` puede reconstruir otro al juntar los trozos
 * que quedan: CodeQL js/incomplete-multi-character-sanitization). Recorre el HTML una sola vez, reconstruye
 * cada etiqueta desde sus partes ya leídas y ESCAPA cualquier `<` / `>` que no pertenezca a una etiqueta
 * completa, así que lo emitido no puede volver a leerse como marcado distinto del que se decidió.
 */
export function sanearHtml(html: string): string {
  const minusculas = html.toLowerCase();
  let out = '';
  let i = 0;
  while (i < html.length) {
    if (html[i] !== '<') {
      const j = html.indexOf('<', i);
      const fin = j < 0 ? html.length : j;
      out += escaparTexto(html.slice(i, fin));
      i = fin;
      continue;
    }
    if (html.startsWith('<!--', i)) {
      const f = html.indexOf('-->', i + 4);
      i = f < 0 ? html.length : f + 3;
      continue;
    }
    const f = finDeEtiqueta(html, i);
    const cuerpo = f < 0 ? '' : html.slice(i + 1, f);
    if (f >= 0 && (cuerpo[0] === '!' || cuerpo[0] === '?')) {
      if (minusculas.startsWith('<!doctype', i)) out += '<!DOCTYPE html>';
      i = f + 1;
      continue;
    }
    const t = f < 0 ? null : leerEtiqueta(cuerpo);
    if (!t || !t.nombre) { out += '&lt;'; i++; continue; } // un `<` que no abre etiqueta es texto
    if (ETIQUETAS_CON_CUERPO_FUERA.has(t.nombre)) {
      if (t.cierre) { i = f + 1; continue; }
      const d = despuesDeCierre(html, minusculas, t.nombre, f + 1);
      i = d < 0 ? html.length : d;
      continue;
    }
    if (t.cierre) { out += `</${t.nombre}>`; i = f + 1; continue; }
    if (t.nombre === 'link') { i = f + 1; continue; }
    if (t.nombre === 'meta' && /(csrf|token|nonce|viewport-fit)/i.test(cuerpo)) { i = f + 1; continue; }
    const partes = t.atributos
      .filter(([n]) => !ATRIBUTOS_FUERA.has(n) && !(n.length > 2 && n.startsWith('on')))
      .map(([n, v]) => {
        if (v === null) return n;
        return `${n}="${escaparValor(t.nombre === 'input' && n === 'value' ? '' : v)}"`;
      });
    out += `<${[t.nombre, ...partes].join(' ')}>`;
    i = f + 1;
    if (t.nombre === 'textarea') {
      const d = despuesDeCierre(html, minusculas, 'textarea', i);
      out += '</textarea>';
      i = d < 0 ? html.length : d;
    }
  }
  return out
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, 'correo@fixture.invalid')
    .replace(/\b[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}\b/g, 'XAXX010101000')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '00000000-0000-4000-8000-000000000001')
    .replace(/\n{3,}/g, '\n\n');
}
