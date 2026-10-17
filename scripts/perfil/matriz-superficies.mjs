#!/usr/bin/env node
/* eslint-disable security/detect-non-literal-fs-filename -- lee el árbol de FUENTE del propio repo; ninguna ruta ni patrón viene de entrada de usuario. */
// ═══════════════════════════════════════════════════════════════════════════
// MATRIZ DE SUPERFICIES DEL PERFIL `cinco_agentes` (0770).
//
// Enumera, SIEMPRE desde el sistema de archivos y la config (nunca a mano), cada
// superficie por la que se puede llegar a un dato de una flota, y la cruza con
// la lista cerrada del perfil (`src/lib/auth/visibilidad.ts`):
//
//   páginas · server actions ('use server') · APIs /v1, /export, /dashboard ·
//   MCP (endpoint y herramientas) · webhooks · crons (disco y vercel.json) ·
//   herramientas del chat y su analista.
//
// Cada elemento sale con un veredicto: `permitido`, `negado` o `NO CLASIFICADO`.
// «Negado» exige EVIDENCIA en el código (la puerta del perfil está en la fuente) o
// estar en la lista de stand-by declarada; lo que no está en ninguna lista ni
// tiene evidencia sale `NO CLASIFICADO` — en runtime ya se niega (falla cerrado),
// pero el inventario debe saberlo para forzar a alguien a clasificarlo.
//
// Uso:  node scripts/perfil/matriz-superficies.mjs        → tabla markdown a stdout
// Solo lectura: no toca el repo ni la red. (Node ≥ 22.18 importa el .ts sin transpilar.)
// ═══════════════════════════════════════════════════════════════════════════
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  RUTAS_PERFIL_CINCO_AGENTES, RUTAS_STAND_BY_PERFIL_CINCO_AGENTES,
  API_PERFIL_CINCO_AGENTES, CRONS_PERFIL_CINCO_AGENTES, claveRutaPerfil,
} from '../../src/lib/auth/visibilidad.ts';

const RAIZ_DEFECTO = fileURLToPath(new URL('../..', import.meta.url));

export const NO_CLASIFICADO = 'NO CLASIFICADO';

// ── Declaraciones que la config del perfil NO contiene (y por qué) ─────────
/** Crons que no recorren datos de ninguna flota (sondean portales externos / corren agentes de la propia compañía). */
const CRONS_GLOBALES = ['portales-vivos', 'runner'];
/** Rutas /v1 que no pasan por `abrir`: documentación pública, sin datos de ninguna flota. */
const V1_SIN_DATOS = ['openapi'];
/** Rutas de API sin sesión de flota: credenciales/protocolo, no leen ni escriben datos del tenant. */
const API_SIN_DATOS = {
  'src/app/api/mcp/oauth/token/route.ts': 'canje OAuth; el endpoint /api/mcp rechaza con perfil toda credencial',
  'src/app/api/mcp/oauth/registro/route.ts': 'registro dinámico de cliente OAuth; sin datos de flota',
  'src/app/api/webhook/calcom/route.ts': 'agenda comercial de Likida (firma HMAC); sin datos de flota',
};
/** Archivos con `'use server'` previos a la sesión: no leen datos de ninguna flota. */
const ACCIONES_SIN_DATOS = {
  'src/app/login/page.tsx': 'entrada: antes de la sesión',
  'src/app/cuenta/page.tsx': '`cerrarSesion`: solo cierra la sesión de quien la pide',
  'src/app/sin-acceso/page.tsx': 'callejón 403: solo cierra la sesión de quien la pide',
  'src/app/dashboard/layout.tsx': '`cerrarSesion`: solo cierra la sesión de quien la pide',
};
/** Archivos de acciones que NO cuelgan de una página y gatean con una ruta distinta a su carpeta. */
const ACCIONES_RUTA_EXPLICITA = {
  'src/app/dashboard/inicio-contenido.tsx': '/dashboard',                    // el Resumen de siempre; bajo el perfil no se monta
  'src/app/dashboard/agentes/seccion-notificaciones.tsx': '/dashboard/notificaciones', // el aviso por agente gatea con la ruta de su agente
};

/** Páginas que no son una ruta del perfil (no hay llave propia ni padre) y gatean con una ruta SIEMPRE permitida: se acepta solo si su fuente lo demuestra. */
const PAGINAS_GATEADAS_EXPLICITA = {
  '/dashboard/proximamente/[modulo]': '/dashboard', // anuncio «Próximamente» (A4/A5 fase 1): sin datos ni acciones, sin perfil redirige
};

// ── Enumeración (sistema de archivos / config) ─────────────────────────────
const leer = (raiz, ruta) => readFileSync(join(raiz, ruta), 'utf8');
const existe = (raiz, ruta) => existsSync(join(raiz, ruta));
const posix = (p) => p.split(sep).join('/');

function recorrer(raiz, dirRel, filtro, salida = []) {
  const abs = join(raiz, dirRel);
  if (!existsSync(abs)) return salida;
  for (const n of readdirSync(abs).sort()) {
    const rel = join(dirRel, n);
    if (statSync(join(raiz, rel)).isDirectory()) recorrer(raiz, rel, filtro, salida);
    else if (filtro(n, rel)) salida.push(posix(rel));
  }
  return salida;
}
const esFuente = (n) => /\.(ts|tsx)$/.test(n) && !/\.test\./.test(n);
const subcarpetasConRuta = (raiz, dirRel) =>
  readdirSync(join(raiz, dirRel)).sort().filter((n) => {
    const rel = join(dirRel, n);
    return statSync(join(raiz, rel)).isDirectory() && recorrer(raiz, rel, (f) => f === 'route.ts').length > 0;
  });

/** Los nombres del arreglo `const CATALOGO = [ ... ]` de las herramientas MCP. */
function nombresCatalogoMcp(fuente) {
  const m = /const CATALOGO\s*=\s*\[([\s\S]*?)\]/.exec(fuente);
  return m ? m[1].split(',').map((s) => s.trim()).filter(Boolean) : [];
}
/** Las llaves del objeto `AREA_POR_HERRAMIENTA = { ... }` del chat/orquestador. */
function nombresHerramientasChat(fuente) {
  const m = /export const AREA_POR_HERRAMIENTA\s*=\s*\{([\s\S]*?)\n\}/.exec(fuente);
  if (!m) return [];
  return [...m[1].matchAll(/^\s*([a-z_0-9]+)\s*:/gm)].map((x) => x[1]);
}

/** Todos los elementos del repo, sin clasificar. Cada uno: { superficie, id, ... }. */
export function enumerar(raiz = RAIZ_DEFECTO) {
  const el = [];
  for (const f of recorrer(raiz, 'src/app/dashboard', (n) => n === 'page.tsx')) {
    const dir = f.replace(/^src\/app/, '').replace(/\/page\.tsx$/, '');
    el.push({ superficie: 'página', id: dir, ruta: dir });
  }
  for (const r of ['v1', 'export', 'dashboard']) {
    for (const n of subcarpetasConRuta(raiz, `src/app/api/${r}`)) {
      el.push({ superficie: `API /${r}`, id: `/api/${r}/${n}`, raiz: r, nombre: n });
    }
  }
  for (const f of recorrer(raiz, 'src/app/api/mcp', (n) => n === 'route.ts')) el.push({ superficie: 'MCP endpoint', id: f, archivo: f });
  for (const f of recorrer(raiz, 'src/app/api/webhook', (n) => n === 'route.ts')) el.push({ superficie: 'webhook', id: f, archivo: f });

  // Crons: la unión del disco y de vercel.json (un cron en una sola de las dos es hallazgo).
  const enDisco = new Set(subcarpetasConRuta(raiz, 'src/app/api/cron'));
  const enVercel = new Set(
    existe(raiz, 'vercel.json')
      ? (JSON.parse(leer(raiz, 'vercel.json')).crons ?? []).map((c) => String(c.path).replace(/^\/api\/cron\//, '').split('?')[0])
      : [],
  );
  for (const n of [...new Set([...enDisco, ...enVercel])].sort()) {
    el.push({ superficie: 'cron', id: `/api/cron/${n}`, nombre: n, enDisco: enDisco.has(n), enVercel: enVercel.has(n) });
  }

  const hMcp = 'src/lib/mcp/herramientas.ts';
  if (existe(raiz, hMcp)) for (const n of nombresCatalogoMcp(leer(raiz, hMcp))) el.push({ superficie: 'herramienta MCP', id: n });
  const hChat = 'src/lib/likida/orquestador/permisos.ts';
  if (existe(raiz, hChat)) for (const n of nombresHerramientasChat(leer(raiz, hChat))) el.push({ superficie: 'herramienta del chat', id: n });
  el.push({ superficie: 'analista del chat', id: 'src/lib/agents/analista.ts', archivo: 'src/lib/agents/analista.ts' });

  for (const f of recorrer(raiz, 'src', (n, rel) => esFuente(n) && /^\s*['"]use server['"]/m.test(readFileSync(join(raiz, rel), 'utf8')))) {
    el.push({ superficie: "'use server'", id: f, archivo: f });
  }
  return el;
}

// ── Clasificación ──────────────────────────────────────────────────────────
const permitidasPag = RUTAS_PERFIL_CINCO_AGENTES;
const standByPag = new Set(RUTAS_STAND_BY_PERFIL_CINCO_AGENTES);

/** Veredicto de una ruta de página (y de la ruta que gatea una acción): exacta, o su padre si es dinámica. */
function veredictoRuta(href) {
  let clave = claveRutaPerfil(href);
  for (;;) {
    if (Object.prototype.hasOwnProperty.call(permitidasPag, clave)) return { veredicto: 'permitido', nota: `agente/módulo: ${permitidasPag[clave]}${clave === claveRutaPerfil(href) ? '' : ` (dinámica, gatea con ${clave})`}` };
    if (standByPag.has(clave)) return { veredicto: 'negado', nota: `stand-by${clave === claveRutaPerfil(href) ? '' : ` (dinámica, gatea con ${clave})`}` };
    const partes = clave.split('/');
    // Solo se sube mientras el segmento final sea dinámico: una ruta fija sin dueño NO hereda de su padre.
    if (partes.length > 2 && /^\[.+\]$/.test(partes[partes.length - 1])) { partes.pop(); clave = partes.join('/'); continue; }
    return { veredicto: NO_CLASIFICADO, nota: 'ni en RUTAS_PERFIL ni en el stand-by declarado' };
  }
}

const todasLasRoutes = (raiz, dirRel) => recorrer(raiz, dirRel, (n) => n === 'route.ts');

/** `raiz` = carpeta del repo. Devuelve filas { superficie, id, veredicto, nota }. */
export function clasificar(elementos, raiz = RAIZ_DEFECTO) {
  const fuente = (ruta) => (existe(raiz, ruta) ? leer(raiz, ruta) : '');
  const comun = fuente('src/app/api/v1/_comun.ts');
  const mcpRoute = fuente('src/app/api/mcp/route.ts');
  const mcpHerr = fuente('src/lib/mcp/herramientas.ts');
  const chatRoute = fuente('src/app/api/dashboard/chat/route.ts');
  const todoElMcpNiega = /perfilRestringido\(/.test(mcpRoute) && /perfilRestringido\(/.test(mcpHerr);
  const chatNiega = !API_PERFIL_CINCO_AGENTES.dashboard.includes('chat') && /respuestaSiPerfilNiegaApi\(/.test(chatRoute);

  return elementos.map((e) => {
    let r;
    switch (e.superficie) {
      case 'página': {
        r = veredictoRuta(e.ruta);
        // Una página dinámica sin llave propia gatea con la ruta que DECLARA en su fuente (`RUTA_PADRE`), no con una suposición.
        if (r.veredicto === NO_CLASIFICADO && /\[.+\]/.test(e.ruta)) {
          const m = /const RUTA_PADRE\s*=\s*'([^']+)'/.exec(fuente(`src/app${e.ruta}/page.tsx`));
          if (m) { const v = veredictoRuta(m[1]); r = { veredicto: v.veredicto, nota: `gatea con RUTA_PADRE ${m[1]}: ${v.nota}` }; }
        }
        // Declarada a mano: solo vale si la fuente de la página gatea de verdad con esa ruta (resolverTenantEfectivo('<ruta>')).
        const explicita = PAGINAS_GATEADAS_EXPLICITA[e.ruta];
        if (r.veredicto === NO_CLASIFICADO && explicita && fuente(`src/app${e.ruta}/page.tsx`).includes(`resolverTenantEfectivo('${explicita}'`)) {
          const v = veredictoRuta(explicita);
          r = { veredicto: v.veredicto, nota: `gatea con ${explicita} (declarada): ${v.nota}` };
        }
        break;
      }
      case 'API /v1':
      case 'API /export':
      case 'API /dashboard': {
        const lista = API_PERFIL_CINCO_AGENTES[e.raiz] ?? [];
        if (lista.includes(e.nombre)) { r = { veredicto: 'permitido', nota: 'en API_PERFIL_CINCO_AGENTES' }; break; }
        if (e.raiz === 'v1' && V1_SIN_DATOS.includes(e.nombre)) { r = { veredicto: 'permitido', nota: 'documentación pública, sin datos de flota' }; break; }
        const rutas = existe(raiz, `src/app/api/${e.raiz}/${e.nombre}`) ? todasLasRoutes(raiz, `src/app/api/${e.raiz}/${e.nombre}`) : [];
        const puerta = e.raiz === 'v1'
          ? /apiDenegadaPorPerfil\(/.test(comun) && rutas.length > 0 && rutas.every((f) => /\babrir\(/.test(fuente(f)))
          : rutas.length > 0 && rutas.every((f) => /\b(resolverTenantApi|respuestaSiPerfilNiegaApi)\(/.test(fuente(f)));
        r = puerta
          ? { veredicto: 'negado', nota: e.raiz === 'v1' ? 'stand-by; `abrir` aplica apiDenegadaPorPerfil' : 'stand-by; la puerta del perfil está en la ruta' }
          : { veredicto: NO_CLASIFICADO, nota: 'no está permitida y no se encontró la puerta del perfil en su código' };
        break;
      }
      case 'MCP endpoint':
        if (API_SIN_DATOS[e.archivo]) r = { veredicto: 'permitido', nota: API_SIN_DATOS[e.archivo] };
        else if (/perfilRestringido\(/.test(fuente(e.archivo))) r = { veredicto: 'negado', nota: 'perfilRestringido en el endpoint' };
        else r = { veredicto: NO_CLASIFICADO, nota: 'sin puerta de perfil ni declaración' };
        break;
      case 'webhook':
        if (API_SIN_DATOS[e.archivo]) r = { veredicto: 'permitido', nota: API_SIN_DATOS[e.archivo] };
        else if (e.archivo.endsWith('webhook/whatsapp/route.ts') && /perfilDeTenant\(/.test(fuente('src/lib/likida/interruptor_tenant.ts')) && /perfilDeTenant\(|perfil/.test(fuente('src/lib/likida/processor.ts'))) {
          r = { veredicto: 'permitido', nota: 'WhatsApp del chofer (A5); OCR/cuadre apagados por perfil en processor/interruptor_tenant' };
        } else r = { veredicto: NO_CLASIFICADO, nota: 'sin declaración ni evidencia del perfil' };
        break;
      case 'cron': {
        if (!e.enDisco) { r = { veredicto: NO_CLASIFICADO, nota: 'está en vercel.json pero no existe su carpeta/route.ts' }; break; }
        const prog = e.enVercel ? '' : ' (sin programar en vercel.json)';
        if (CRONS_PERFIL_CINCO_AGENTES.includes(e.nombre)) r = { veredicto: 'permitido', nota: `sigue corriendo para flotas con perfil${prog}` };
        else if (/tenantsConPerfil\w*\(/.test(fuente(`src/app/api/cron/${e.nombre}/route.ts`))) r = { veredicto: 'negado', nota: `salta flotas con perfil${prog}` };
        else if (CRONS_GLOBALES.includes(e.nombre)) r = { veredicto: 'permitido', nota: `global: no recorre datos de ninguna flota${prog}` };
        else r = { veredicto: NO_CLASIFICADO, nota: 'ni en CRONS_PERFIL ni filtra flotas con perfil ni es global declarado' };
        break;
      }
      case 'herramienta MCP':
        r = todoElMcpNiega
          ? { veredicto: 'negado', nota: 'todo o nada: endpoint y despacho aplican perfilRestringido' }
          : { veredicto: NO_CLASIFICADO, nota: 'el MCP no aplica perfilRestringido en endpoint y despacho' };
        break;
      case 'herramienta del chat':
      case 'analista del chat':
        r = chatNiega
          ? { veredicto: 'negado', nota: 'el chat (/api/dashboard/chat) está fuera de la lista y niega con respuestaSiPerfilNiegaApi' }
          : { veredicto: NO_CLASIFICADO, nota: 'el chat no está negado por el perfil' };
        break;
      case "'use server'": {
        if (ACCIONES_SIN_DATOS[e.archivo]) { r = { veredicto: 'permitido', nota: `sin datos de flota: ${ACCIONES_SIN_DATOS[e.archivo]}` }; break; }
        if (e.archivo.startsWith('src/app/admin/')) {
          r = /requireSuperadmin\(/.test(fuente('src/app/admin/layout.tsx'))
            ? { veredicto: 'negado', nota: 'solo superadmin (requireSuperadmin en el layout); lo cubre T-PER-07' }
            : { veredicto: NO_CLASIFICADO, nota: 'el layout de /admin no exige requireSuperadmin' };
          break;
        }
        if (e.archivo.startsWith('src/app/vendedor/')) {
          r = /requireVendedor\(/.test(fuente('src/app/vendedor/layout.tsx'))
            ? { veredicto: 'negado', nota: 'solo vendedor (requireVendedor en el layout); lo cubre T-PER-07' }
            : { veredicto: NO_CLASIFICADO, nota: 'el layout de /vendedor no exige requireVendedor' };
          break;
        }
        if (e.archivo.startsWith('src/app/mcp/')) {
          r = /perfilRestringido\(/.test(fuente(e.archivo))
            ? { veredicto: 'negado', nota: 'consentimiento MCP: perfilRestringido en la página' }
            : { veredicto: NO_CLASIFICADO, nota: 'sin perfilRestringido' };
          break;
        }
        if (e.archivo.startsWith('src/app/dashboard/')) {
          const ruta = ACCIONES_RUTA_EXPLICITA[e.archivo]
            ?? ('/' + e.archivo.replace(/^src\/app\//, '').replace(/\/[^/]+$/, ''));
          const v = veredictoRuta(ruta);
          r = { veredicto: v.veredicto, nota: `gatea con ${ruta}: ${v.nota}` };
          break;
        }
        r = { veredicto: NO_CLASIFICADO, nota: 'archivo con acciones fuera de dashboard/admin/vendedor/mcp sin declarar' };
        break;
      }
      default:
        r = { veredicto: NO_CLASIFICADO, nota: 'superficie desconocida' };
    }
    return { superficie: e.superficie, id: e.id, veredicto: r.veredicto, nota: r.nota };
  });
}

export function construirMatriz(raiz = RAIZ_DEFECTO) {
  return clasificar(enumerar(raiz), raiz);
}

// ── Salida markdown ────────────────────────────────────────────────────────
export function resumen(filas) {
  const por = {};
  for (const f of filas) {
    const s = (por[f.superficie] ??= { total: 0, permitido: 0, negado: 0, [NO_CLASIFICADO]: 0 });
    s.total++; s[f.veredicto]++;
  }
  return por;
}

export function aMarkdown(filas) {
  const out = ['# Matriz de superficies del perfil `cinco_agentes`', '', '## Resumen', '',
    '| Superficie | Total | Permitido | Negado | Sin clasificar |', '|---|---:|---:|---:|---:|'];
  for (const [s, c] of Object.entries(resumen(filas))) out.push(`| ${s} | ${c.total} | ${c.permitido} | ${c.negado} | ${c[NO_CLASIFICADO]} |`);
  out.push('', '## Detalle', '', '| Superficie | Elemento | Veredicto | Nota |', '|---|---|---|---|');
  for (const f of filas) out.push(`| ${f.superficie} | \`${f.id}\` | ${f.veredicto} | ${f.nota} |`);
  return out.join('\n') + '\n';
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.stdout.write(aMarkdown(construirMatriz()));
}
void relative;
