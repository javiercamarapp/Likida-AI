import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { RUTAS_PERFIL_CINCO_AGENTES, rutaPermitidaEnPerfil } from '@/lib/auth/visibilidad';

// ═══════════════════════════════════════════════════════════════════════════
// ESCANEO DE LAS SERVER ACTIONS (`'use server'`) BAJO EL PERFIL `cinco_agentes`.
//
// Una server action es un POST invocable por quien conozca su id, con o sin la
// página: redirigir la página NO la cierra. Lo que sí la cierra es que pase por
// una de las dos puertas con perfil —`resolverTenantEfectivo` o
// `requireSessionTenant`, que niegan la ruta de una pantalla en stand-by— y
// esta prueba lo exige para CADA archivo con `'use server'` bajo
// src/app/dashboard:
//
//  1. el archivo está CLASIFICADO aquí (`permitido` o `standby`): un archivo
//     nuevo con acciones y sin clasificar rompe la prueba;
//  2. cada acción pasa por una puerta con perfil (directa o por una ayudante
//     del mismo archivo que la llama) — nada de leer la sesión por otro lado;
//  3. la ruta que pasa a la puerta coincide con la clase declarada: una
//     pantalla `standby` solo puede gatear con rutas que el perfil NIEGA, y
//     una `permitido` solo con rutas que el perfil deja pasar.
//
// El segundo punto es el que importa si alguien agrega una acción y se le olvida
// la puerta: la acción quedaría viva para un tenant con perfil.
// ═══════════════════════════════════════════════════════════════════════════

type Clase = 'permitido' | 'standby' | 'sin_datos';

/** Clasificación de CADA archivo con `'use server'` (ruta relativa a src/app/dashboard). */
const ARCHIVOS: Record<string, Clase> = {
  // ── Permitidos: los cinco agentes y la base mínima ─────────────────────
  '[id]/page.tsx': 'permitido',                             // detalle de liquidación (A1)
  'agentes/liquidacion/formato/page.tsx': 'permitido',
  'agentes/liquidacion/page.tsx': 'permitido',
  'agentes/peajes/configuracion/page.tsx': 'permitido',
  'agentes/peajes/page.tsx': 'permitido',
  'agentes/vigia/historial/page.tsx': 'permitido',
  'agentes/vigia/page.tsx': 'permitido',
  'agentes/conductores/configuracion/page.tsx': 'permitido',
  'agentes/conductores/page.tsx': 'permitido',
  'agentes/conductores/sitios/page.tsx': 'permitido',
  'carta-porte/documentos/[id]/page.tsx': 'permitido',
  'carta-porte/documentos/page.tsx': 'permitido',
  'carta-porte/page.tsx': 'permitido',
  'conexiones/page.tsx': 'permitido',
  'despacho/page.tsx': 'permitido',
  'inicio-contenido.tsx': 'permitido',                      // el Resumen de siempre: bajo el perfil no se monta
  'legal/page.tsx': 'permitido',
  'mi-perfil/page.tsx': 'permitido',
  'operadores/page.tsx': 'permitido',
  'soporte/page.tsx': 'permitido',
  'unidades/page.tsx': 'permitido',
  'unidades/taller.tsx': 'permitido',
  'viajes-en-vivo/page.tsx': 'permitido',
  'viajes/page.tsx': 'permitido',
  // El aviso por agente: gatea con la ruta del agente del que se trate (dinámica); ver prueba aparte.
  'agentes/seccion-notificaciones.tsx': 'permitido',

  // ── Stand-by: sus acciones se rechazan bajo el perfil ──────────────────
  'agentes/cobranza/page.tsx': 'standby',
  'agentes/facturas/acciones-control.ts': 'standby',
  'agentes/facturas/acciones-vinculacion.ts': 'standby',
  'agentes/facturas/page.tsx': 'standby',
  'agentes/proveedores/page.tsx': 'standby',
  'arco/page.tsx': 'standby',
  'asistencia/page.tsx': 'standby',
  'clientes/page.tsx': 'standby',
  'combustible-casetas/page.tsx': 'standby',
  'configuracion/page.tsx': 'standby',
  'contador/estimulo-peaje.tsx': 'standby',
  'contador/perfil-erp.tsx': 'standby',
  'contador/timbrado.tsx': 'standby',
  'convenios/page.tsx': 'standby',
  'cotizaciones/page.tsx': 'standby',
  'descarga-sat/bandeja/vista.tsx': 'standby',
  'descarga-sat/vista.tsx': 'standby',
  'emergencias/page.tsx': 'standby',
  'facturacion/estadias.tsx': 'standby',
  'facturacion/page.tsx': 'standby',
  'facturacion/portal.tsx': 'standby',
  'huerfanos/page.tsx': 'standby',
  'jornada/page.tsx': 'standby',
  'llaves-api/page.tsx': 'standby',
  'onboarding/page.tsx': 'standby',
  'patios/page.tsx': 'standby',
  'politicas/page.tsx': 'standby',
  'reglas/page.tsx': 'standby',
  'sesiones-mcp/page.tsx': 'standby',
  'suscripcion/page.tsx': 'standby',
  'timbrado/[viajeId]/timbrar.tsx': 'standby',
  'usuarios/page.tsx': 'standby',

  // ── Sin datos de ninguna flota ─────────────────────────────────────────
  // `cerrarSesion` solo cierra la sesión de quien la pide; no lee ni escribe datos del tenant.
  'layout.tsx': 'sin_datos',
};

const RAIZ = join(process.cwd(), 'src/app/dashboard');
const PUERTA = /\b(resolverTenantEfectivo|requireSessionTenant|exigirVerRuta)\(\s*([^,)]+)/g;

function conUseServer(dir: string, salida: string[] = []): string[] {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- recorre el árbol de FUENTE del propio repo en tiempo de prueba.
  for (const nombre of readdirSync(dir)) {
    const ruta = join(dir, nombre);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- ídem.
    if (statSync(ruta).isDirectory()) conUseServer(ruta, salida);
    else if (/\.(ts|tsx)$/.test(nombre) && !/\.test\./.test(nombre)) {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- ídem.
      if (/['"]use server['"]/.test(readFileSync(ruta, 'utf8'))) salida.push(relative(RAIZ, ruta));
    }
  }
  return salida;
}

/** Cuerpo (por llaves balanceadas) que empieza en la primera `{` desde `desde`. */
function cuerpoDesde(fuente: string, desde: number): string {
  const abre = fuente.indexOf('{', desde);
  if (abre < 0) return '';
  let prof = 0;
  for (let i = abre; i < fuente.length; i++) {
    if (fuente[i] === '{') prof++;
    else if (fuente[i] === '}') { prof--; if (prof === 0) return fuente.slice(abre, i + 1); }
  }
  return fuente.slice(abre);
}

/**
 * Cuerpo de una función a partir del índice justo DESPUÉS de su nombre: salta
 * los parámetros (que pueden traer tipos con llaves, `{ error?: string }`) por
 * paréntesis balanceados, luego el tipo de retorno (llaves dentro de `<...>`) y
 * toma la primera `{` de nivel cero — o la de la flecha.
 */
function cuerpoDeFuncion(fuente: string, trasNombre: number): string {
  const abreParen = fuente.indexOf('(', trasNombre);
  if (abreParen < 0) return '';
  let p = 0;
  let i = abreParen;
  for (; i < fuente.length; i++) {
    if (fuente[i] === '(') p++;
    else if (fuente[i] === ')') { p--; if (p === 0) break; }
  }
  let angulo = 0;
  for (let j = i + 1; j < fuente.length; j++) {
    const c = fuente[j];
    if (c === '<') angulo++;
    else if (c === '>' && fuente[j - 1] !== '=') angulo--;
    else if (c === '{' && angulo <= 0) return cuerpoDesde(fuente, j);
  }
  return '';
}

/** Resuelve el argumento de una puerta a una ruta literal (con constantes RUTA* del archivo). */
function rutasDePuertas(fuente: string): { rutas: string[]; dinamicas: string[] } {
  const consts = new Map<string, string>();
  for (const m of fuente.matchAll(/const (RUTA\w*)\s*=\s*['"`]([^'"`]+)['"`]/g)) consts.set(m[1], m[2]);
  const rutas: string[] = [];
  const dinamicas: string[] = [];
  for (const m of fuente.matchAll(PUERTA)) {
    const arg = m[2].trim();
    if (consts.has(arg)) rutas.push(consts.get(arg)!);
    else if (/^['"`]/.test(arg)) {
      // Plantilla `/dashboard/${id}` → un uuid de muestra (es el detalle dinámico de liquidación).
      rutas.push(arg.slice(1, -1).replace(/\$\{[^}]+\}/g, '0f8fad5b-d9cb-469f-a165-70867728950e'));
    } else dinamicas.push(arg);
  }
  return { rutas, dinamicas };
}

/** ¿Cada `'use server'` del archivo llega a una puerta, directo o por una ayudante del mismo archivo? */
function accionesSinPuerta(fuente: string): string[] {
  const sinPuerta: string[] = [];
  // Mapa nombre → cuerpo de TODA función nombrada del archivo (módulo o inline).
  const cuerpos = new Map<string, string>();
  for (const m of fuente.matchAll(/(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g)) cuerpos.set(m[1], cuerpoDeFuncion(fuente, m.index! + m[0].length));

  const llegaAPuerta = (cuerpo: string, visto: Set<string>): boolean => {
    if (new RegExp(PUERTA.source).test(cuerpo)) return true;
    for (const [nombre, c] of cuerpos) {
      if (visto.has(nombre) || !new RegExp(`\\b${nombre.replace(/\$/g, '\\$')}\\s*\\(`).test(cuerpo)) continue;
      visto.add(nombre);
      if (llegaAPuerta(c, visto)) return true;
    }
    return false;
  };

  const esModulo = /^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*['"]use server['"]/.test(fuente);
  if (esModulo) {
    // Archivo de acciones: cada `export async function` es una acción.
    for (const m of fuente.matchAll(/export\s+async\s+function\s+([A-Za-z_$][\w$]*)/g)) {
      if (!llegaAPuerta(cuerpoDeFuncion(fuente, m.index! + m[0].length), new Set([m[1]]))) sinPuerta.push(m[1]);
    }
    return sinPuerta;
  }
  for (const m of fuente.matchAll(/^[ \t]*['"]use server['"];/gm)) {
    // La función que lleva la directiva es la última declaración anterior.
    const previas = [...fuente.slice(0, m.index).matchAll(/(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g)];
    const d = previas.pop();
    if (!d) { sinPuerta.push('(directiva sin función)'); continue; }
    if (!llegaAPuerta(cuerpoDeFuncion(fuente, d.index! + d[0].length), new Set([d[1]]))) sinPuerta.push(d[1]);
  }
  return sinPuerta;
}

const ENCONTRADOS = conUseServer(RAIZ).sort();

describe('escaneo de server actions bajo el perfil cinco_agentes', () => {
  it('hay archivos que revisar (la prueba no se salta en silencio)', () => {
    expect(ENCONTRADOS.length).toBeGreaterThanOrEqual(58);
  });

  it('TODO archivo con \'use server\' está clasificado, y la clasificación no apunta a archivos que ya no existen', () => {
    expect(ENCONTRADOS.filter((a) => !(a in ARCHIVOS))).toEqual([]);
    expect(Object.keys(ARCHIVOS).filter((a) => !ENCONTRADOS.includes(a))).toEqual([]);
  });

  it('ninguna acción lee la sesión por otro camino que las puertas con perfil (y las de stand-by no tocan ni la sesión de Supabase)', () => {
    const culpables = ENCONTRADOS.filter((a) => {
      if (ARCHIVOS[a] === 'sin_datos') return false;
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- ídem.
      const fuente = readFileSync(join(RAIZ, a), 'utf8');
      // mi-perfil usa supabaseServer para el segundo factor y las sesiones PROPIAS, después de su puerta.
      return /\bgetSessionTenant\s*\(/.test(fuente) || (ARCHIVOS[a] === 'standby' && /\bsupabaseServer\s*\(/.test(fuente));
    });
    expect(culpables).toEqual([]);
  });

  it.each(ENCONTRADOS.filter((a) => ARCHIVOS[a] !== 'sin_datos'))('%s: cada acción pasa por una puerta con perfil', (a) => {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- ídem.
    const fuente = readFileSync(join(RAIZ, a), 'utf8');
    expect(accionesSinPuerta(fuente), `acciones sin puerta en ${a}`).toEqual([]);
  });

  it.each(ENCONTRADOS.filter((a) => ARCHIVOS[a] === 'permitido' || ARCHIVOS[a] === 'standby'))('%s: la ruta que gatea coincide con su clase', (a) => {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- ídem.
    const { rutas, dinamicas } = rutasDePuertas(readFileSync(join(RAIZ, a), 'utf8'));
    if (a === 'agentes/seccion-notificaciones.tsx') {
      // Gatea con la ruta del agente del que se configuran los avisos: se prueba abajo contra el catálogo.
      expect([...new Set(dinamicas)]).toEqual(['objetivo.ruta']);
      return;
    }
    expect(dinamicas, 'argumento de puerta no resoluble: usa una constante RUTA o un literal').toEqual([]);
    expect(rutas.length).toBeGreaterThan(0);
    for (const r of rutas) {
      expect(rutaPermitidaEnPerfil('cinco_agentes', r), `${a} gatea con ${r}`).toBe(ARCHIVOS[a] === 'permitido');
    }
  });

  it('el aviso por agente solo queda vivo para los agentes del perfil (su ruta es la del catálogo)', async () => {
    const { AGENTES_NOTIFICABLES } = await import('@/lib/likida/agentes/notificaciones');
    const permitidos = AGENTES_NOTIFICABLES.filter((ag: { ruta: string }) => rutaPermitidaEnPerfil('cinco_agentes', ag.ruta));
    const negados = AGENTES_NOTIFICABLES.filter((ag: { ruta: string }) => !rutaPermitidaEnPerfil('cinco_agentes', ag.ruta));
    expect(permitidos.length).toBeGreaterThan(0);
    expect(negados.length).toBeGreaterThan(0);
  });

  it('la lista permitida del perfil no incluye ninguna pantalla clasificada como stand-by aquí', () => {
    const standby = ENCONTRADOS.filter((a) => ARCHIVOS[a] === 'standby');
    const permitidasRutas = Object.keys(RUTAS_PERFIL_CINCO_AGENTES);
    for (const a of standby) {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- ídem.
      for (const r of rutasDePuertas(readFileSync(join(RAIZ, a), 'utf8')).rutas) expect(permitidasRutas).not.toContain(r);
    }
  });
});
