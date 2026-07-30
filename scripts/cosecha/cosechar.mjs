#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// COSECHADOR DE DIRECTORIOS DE FACTURACIÓN — 29-jul-2026
//
// POR QUÉ EXISTE. La investigación de competencia necesita ~1,800 páginas de
// cuatro directorios. Bajarlas con Firecrawl desde el agente falló por cuatro
// razones distintas y todas reales: crawls que devuelven cero (las categorías
// cargan enlaces por JS), timeouts a los 300 s, respuestas que exceden el límite
// de tokens, y rate limit. Se llegó al 8% en diez intentos.
//
// Estas páginas son WordPress ESTÁTICO. Un `fetch` las trae completas, gratis,
// sin rate limit y sin depender de un servicio. Eso es lo que hace esto.
//
// ES REANUDABLE A PROPÓSITO: si se corta, se vuelve a correr y sigue donde iba.
// Con 1,218 páginas pendientes eso no es un lujo.
//
//   node scripts/cosecha/cosechar.mjs                    # todo lo pendiente
//   node scripts/cosecha/cosechar.mjs --limite 50        # una tanda
//   node scripts/cosecha/cosechar.mjs --solo gasolinera  # filtrar por patrón
// ═══════════════════════════════════════════════════════════════════════════

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

const AQUI = dirname(new URL(import.meta.url).pathname);
const SALIDA = join(AQUI, '../../docs/investigacion/cosecha');
const URLS = join(AQUI, 'urls.txt');

const arg = (n, d) => {
  const i = process.argv.indexOf(n);
  return i > 0 ? process.argv[i + 1] : d;
};
const LIMITE = Number(arg('--limite', '0')) || Infinity;
const SOLO = arg('--solo', null);
// Cortés con el servidor ajeno: una petición cada 700 ms por defecto. Bajarlo
// invita a que te bloqueen y entonces no se cosecha nada.
const PAUSA = Number(arg('--pausa', '700'));

mkdirSync(SALIDA, { recursive: true });

/** El nombre del archivo sale de la URL, así que reanudar es mirar el disco. */
const archivo = (u) => join(SALIDA, u.replace(/^https?:\/\//, '').replace(/[^\w.-]/g, '_') + '.json');

// ── Extracción: estos sitios son plantillas de WordPress, no hay que adivinar ──
const limpio = (s) => s?.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&').replace(/&#\d+;/g, '').replace(/\s+/g, ' ').trim() || null;

function extraer(html, url) {
  const f = { url, cosechado: new Date().toISOString() };
  f.titulo = limpio(html.match(/<h1[^>]*>(.*?)<\/h1>/s)?.[1]);

  // EL PORTAL REAL es un enlace externo. Se descartan los del propio directorio
  // y el ruido de plugins: sin eso, el "portal" sale siendo la página que lo
  // describe, que fue el error que arruinó la extracción de facturasfacil.
  const RUIDO = /facturaelectronicamexico|facturasfacil|recuperafacturas|rfacturacion|gasolinerasmx|facturacion-ticket|zummafinancial|wp\.com|wordpress|gravatar|jetpack|facebook|twitter|x\.com|instagram|youtube|google|gstatic|doubleclick|googletagmanager|analytics|schema\.org|w3\.org|cloudflare|jquery|bootstrap|unpkg|jsdelivr|openstreetmap|waze|gob\.mx\/cre/i;
  const enlaces = [...html.matchAll(/href="(https?:\/\/[^"]+)"/g)].map((m) => m[1]);
  f.portales = [...new Set(enlaces.filter((u) => !RUIDO.test(u)).map((u) => {
    try { return new URL(u).host.replace(/^www\./, ''); } catch { return null; }
  }).filter(Boolean))].slice(0, 6);

  // El bloque "Link para Facturación X" es el portal AUTORITATIVO cuando existe.
  // El bloque "Link para Facturación X" es el portal AUTORITATIVO. La primera
  // versión exigía que el <a> viniera inmediatamente después del </h2> y falló
  // en la mayoría: el tema mete párrafos en medio. Se busca el primer enlace
  // externo DENTRO de los 600 caracteres que siguen al encabezado.
  const trasLink = html.match(/Link (?:para|de) Facturaci[oó]n[\s\S]{0,600}/i)?.[0];
  if (trasLink) {
    const a = [...trasLink.matchAll(/href="(https?:\/\/[^"]+)"/g)]
      .map((m) => m[1]).find((u) => !RUIDO.test(u));
    if (a) f.portal_declarado = a;
  }

  const bloque = (titulo) => {
    const re = new RegExp(`<h[23][^>]*>[^<]*${titulo}[^<]*<\\/h[23]>(.*?)(?=<h[23]|$)`, 'is');
    return html.match(re)?.[1] ?? null;
  };
  const lista = (b) => b ? [...b.matchAll(/<li[^>]*>(.*?)<\/li>/gs)].map((m) => limpio(m[1])).filter(Boolean) : [];

  f.requisitos = lista(bloque('Requisitos'));
  f.registro_previo = /(?:debes? de |es necesario )?estar registrad|Nuevo usuario|reg[íi]strate|crear cuenta/i.test(bloque('Requisitos') ?? '');

  // Los pasos: cada "Paso N" es un h3/h4 y su cuerpo.
  f.pasos = [...html.matchAll(/<h[34][^>]*>\s*(?:<[^>]+>\s*)*Paso\s*(\d+)[^<]*(.*?)<\/h[34]>(.*?)(?=<h[234]|$)/gis)]
    .map((m) => ({ n: Number(m[1]), titulo: limpio(m[2]), detalle: limpio(m[3])?.slice(0, 700) }))
    .filter((p) => p.detalle);

  // ── LOS CAMPOS VIVEN DENTRO DEL TEXTO DEL PASO, no en una lista aparte ─────
  //
  // La primera versión los buscaba en un `<ul>` tras "Ingresa los siguientes
  // datos" y salió vacía en la mayoría: estos sitios los escriben en línea,
  // "Ingresa los siguientes datos: Código de Facturación Folio Rfc". Se leen de
  // las dos formas y se toma la que dé algo.
  f.campos_ticket = lista(bloque('Ingresa los (?:siguientes )?datos'))
    .concat(lista(bloque('datos del ticket')));
  if (f.campos_ticket.length === 0) {
    const enLinea = f.pasos.map((x) => x.detalle).join(' ')
      .match(/(?:siguientes datos|datos del ticket|datos de(?:l)? (?:compra|consumo))[:\s]+(.{5,220}?)(?:Haz click|Da click|Selecciona|Despu[eé]s|$)/i);
    if (enLinea) {
      f.campos_ticket = enLinea[1].split(/(?<=[a-zá-úñ])(?=[A-ZÁ-ÚÑ])|,|\u2022/)
        .map((x) => x.trim()).filter((x) => x.length > 2 && x.length < 60).slice(0, 16);
    }
  }
  f.campos_ticket = f.campos_ticket.slice(0, 16);

  f.telefono = limpio(html.match(/Tel[eé]fono[^:]*:?\s*<\/strong>?\s*([\d\s()+-]{7,})/i)?.[1]);
  f.email = html.match(/[\w.+-]+@[\w-]+\.[a-z]{2,}(?:\.[a-z]{2,})?/i)?.[0] ?? null;

  // Los comentarios son un registro público de portales caídos. Valen: cualquier
  // automatización sobre esto necesita reintento y camino de escape humano.
  f.quejas = [...html.matchAll(/<div[^>]*class="[^"]*comment-(?:body|content)[^"]*"[^>]*>(.*?)<\/div>/gis)]
    .map((m) => limpio(m[1])).filter((t) => t && t.length > 30).slice(0, 5);
  return f;
}

const pendientes = readFileSync(URLS, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean)
  .filter((u) => !SOLO || u.includes(SOLO))
  .filter((u) => !existsSync(archivo(u)));

console.log(`${pendientes.length} pendientes${SOLO ? ` (filtro: ${SOLO})` : ''}${LIMITE < Infinity ? ` · se bajarán ${Math.min(LIMITE, pendientes.length)}` : ''}`);

let ok = 0, fallo = 0;
for (const u of pendientes.slice(0, LIMITE)) {
  try {
    const r = await fetch(u, {
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; likida-research/1.0)' },
      signal: AbortSignal.timeout(20_000),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const f = extraer(await r.text(), u);
    writeFileSync(archivo(u), JSON.stringify(f, null, 1));
    ok++;
    if (ok % 25 === 0) console.log(`  ${ok} bajadas…`);
  } catch (e) {
    fallo++;
    console.error(`  ✗ ${u} — ${e.message}`);
  }
  await new Promise((s) => setTimeout(s, PAUSA));
}
const total = readdirSync(SALIDA).filter((f) => f.endsWith('.json')).length;
console.log(`\n${ok} bajadas, ${fallo} fallos · ${total} fichas en disco`);
console.log(total < 1200 ? 'Vuelve a correrlo para seguir: es reanudable.' : 'Cosecha completa.');
