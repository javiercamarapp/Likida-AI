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

/**
 * Quita lo que no debe llegar a git: scripts, estilos en línea de terceros, iframes, comentarios, atributos de
 * evento, valores de campos, tokens y todo lo que parezca un correo o un RFC. El resultado se REVISA a mano
 * antes de commitear (runbook), esto es la primera barrera, no la única.
 */
function pasadaSaneoHtml(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|noscript|iframe|object|embed)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<(script|iframe|object|embed|link)\b[^>]*\/?>/gi, '')
    .replace(/<meta\b[^>]*(csrf|token|nonce|viewport-fit)[^>]*>/gi, '')
    .replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s+(nonce|integrity|data-token|data-csrf|data-sitekey|autocomplete)\s*=\s*("[^"]*"|'[^']*')/gi, '')
    .replace(/(<input\b[^>]*?\svalue\s*=\s*)("[^"]*"|'[^']*')/gi, '$1""')
    .replace(/(<input\b[^>]*type\s*=\s*["']hidden["'][^>]*?\svalue\s*=\s*)("[^"]*"|'[^']*')/gi, '$1""')
    .replace(/<textarea\b([^>]*)>[\s\S]*?<\/textarea>/gi, '<textarea$1></textarea>')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, 'correo@fixture.invalid')
    .replace(/\b[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}\b/g, 'XAXX010101000')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '00000000-0000-4000-8000-000000000001')
    .replace(/\n{3,}/g, '\n\n');
}

/**
 * Una sola pasada puede RECONSTRUIR lo que quitó (`<scr<script></script>ipt>` →
 * `<script>` tras borrar el interior): se repite hasta que el texto deja de cambiar
 * (CodeQL js/incomplete-multi-character-sanitization). El tope evita un bucle patológico.
 */
export function sanearHtml(html: string): string {
  let actual = html;
  for (let i = 0; i < 10; i++) {
    const siguiente = pasadaSaneoHtml(actual);
    if (siguiente === actual) return siguiente;
    actual = siguiente;
  }
  return actual;
}
