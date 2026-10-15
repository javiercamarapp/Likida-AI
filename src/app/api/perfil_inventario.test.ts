/* eslint-disable security/detect-non-literal-fs-filename -- pruebas que leen el árbol de FUENTE del propio repo; ninguna ruta ni patrón viene de entrada de usuario. */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { API_PERFIL_CINCO_AGENTES, CRONS_PERFIL_CINCO_AGENTES } from '@/lib/auth/visibilidad';

// ═══════════════════════════════════════════════════════════════════════════
// INVENTARIO DE LAS SUPERFICIES DE API Y DE LOS CRONS BAJO EL PERFIL
// `cinco_agentes` (0770). Cada recurso de /v1, cada export, cada endpoint de
// /api/dashboard y cada cron está CLASIFICADO aquí: una ruta o un cron nuevo sin
// clasificar rompe la prueba (y en runtime ya se niega: falla cerrado).
// ═══════════════════════════════════════════════════════════════════════════

const RAIZ = join(process.cwd(), 'src/app/api');
const subdirs = (d: string) =>
  readdirSync(join(RAIZ, d)).filter((n) => statSync(join(RAIZ, d, n)).isDirectory()).sort();
const leer = (ruta: string) =>
  readFileSync(join(RAIZ, ruta), 'utf8');

/** Recursos / rutas que EXISTEN y el perfil NIEGA a propósito (stand-by). */
const STAND_BY = {
  v1: ['clientes'],
  export: ['convenios', 'facturas-proveedor', 'jornada', 'poliza'],
  dashboard: ['archivo', 'chat', 'conversaciones', 'ingesta', 'onboarding-chat'],
};
/** /v1 que NO pasan por `abrir`: documentación pública, sin datos de ninguna flota. */
const V1_SIN_DATOS = ['openapi'];

describe('API: toda ruta está clasificada', () => {
  for (const raiz of ['v1', 'export', 'dashboard'] as const) {
    it(`/api/${raiz}: cada carpeta es permitida o de stand-by (ninguna sin clasificar)`, () => {
      const existentes = subdirs(raiz);
      const clasificadas = [...API_PERFIL_CINCO_AGENTES[raiz], ...STAND_BY[raiz], ...(raiz === 'v1' ? V1_SIN_DATOS : [])];
      expect(existentes.filter((r) => !clasificadas.includes(r))).toEqual([]);
    });
    it(`/api/${raiz}: nada de lo clasificado apunta a una carpeta que ya no existe`, () => {
      const existentes = subdirs(raiz);
      for (const r of [...API_PERFIL_CINCO_AGENTES[raiz], ...STAND_BY[raiz]]) expect(existentes, r).toContain(r);
    });
    it(`/api/${raiz}: ninguna ruta está a la vez permitida y en stand-by`, () => {
      expect(API_PERFIL_CINCO_AGENTES[raiz].filter((r) => STAND_BY[raiz].includes(r))).toEqual([]);
    });
  }

  it('cada endpoint de /api/dashboard en stand-by aplica el perfil en su propio código', () => {
    for (const r of STAND_BY.dashboard) {
      const dir = join('dashboard', r);
      const archivos = [join(dir, 'route.ts'), join(dir, '[id]', 'route.ts')].filter((a) => existsSync(join(RAIZ, a)));
      expect(archivos.length, r).toBeGreaterThan(0);
      for (const a of archivos) expect(leer(a), a).toMatch(/respuestaSiPerfilNiegaApi\(/);
    }
  });

  it('cada export y cada ruta de /v1 llega a una puerta que aplica el perfil (resolverTenantApi / abrir)', () => {
    for (const r of [...subdirs('export')]) {
      const ruta = existsSync(join(RAIZ, 'export', r, 'route.ts')) ? join('export', r, 'route.ts') : join('export', r, '[id]', 'route.ts');
      const fuente = leer(ruta);
      expect(fuente, `export/${r}`).toMatch(/resolverTenantApi\(/);
    }
    expect(leer(join('v1', '_comun.ts'))).toMatch(/apiDenegadaPorPerfil\(/);
    expect(leer(join('..', '..', 'lib', 'auth', 'tenant-api.ts'))).toMatch(/apiDenegadaPorPerfil\(/);
  });

  it('el MCP aplica el perfil en el endpoint, en el despacho y en la autorización', () => {
    expect(leer(join('mcp', 'route.ts'))).toMatch(/perfilRestringido\(/);
    expect(leer(join('..', '..', 'lib', 'mcp', 'herramientas.ts'))).toMatch(/perfilRestringido\(/);
    expect(leer(join('..', 'mcp', 'autorizar', 'page.tsx'))).toMatch(/perfilRestringido\(/);
  });
});

describe('crons: cada cron del repo está clasificado', () => {
  const crons = subdirs('cron');
  /** Stand-by: salta las flotas con perfil. Cada uno aplica el filtro en su ruta. */
  const SALTA: Record<string, RegExp> = {
    asistencia: /tenantsConPerfilASaltar\('asistencia'\)/,
    'descarga-sat': /tenantsConPerfilASaltar\('descarga-sat'\)/,
    facturar: /tenantsConPerfilASaltar\('facturar'\)/,
    jornada: /tenantsConPerfilASaltar\('jornada'\)/,
    'jornada-alertas': /tenantsConPerfilASaltar\('jornada-alertas'\)/,
    'buzon-entrega': /tenantsConPerfilASaltar\('buzon-entrega'\)/,
  };
  /** Mixto: sigue corriendo para los cinco agentes y salta lo de stand-by por sección. */
  const MIXTO: Record<string, RegExp> = { escalar: /tenantsConPerfil\(\)[\s\S]*tenantsConPerfil\(\)[\s\S]*tenantsConPerfil\(\)/ };
  /** Globales: no recorren datos de ninguna flota (sondean portales externos, corren agentes de la propia compañía). */
  const GLOBAL = ['portales-vivos', 'runner'];
  /** Callback de QStash del cron de facturar: procesa el lote que el cron (ya filtrado) encoló. */
  const CALLBACK = ['facturar'];

  it('ningún cron sin clasificar', () => {
    const conocidos = [...CRONS_PERFIL_CINCO_AGENTES, ...Object.keys(SALTA), ...Object.keys(MIXTO), ...GLOBAL, ...CALLBACK];
    expect(crons.filter((c) => !conocidos.includes(c))).toEqual([]);
  });
  it('la lista permitida y la de stand-by no se cruzan, y todo lo clasificado existe', () => {
    for (const c of CRONS_PERFIL_CINCO_AGENTES) expect(crons, c).toContain(c);
    for (const c of [...Object.keys(SALTA), ...GLOBAL]) {
      expect(crons, c).toContain(c);
      expect(CRONS_PERFIL_CINCO_AGENTES, `${c} es de stand-by y no puede estar en la lista permitida`).not.toContain(c);
    }
    for (const c of Object.keys(MIXTO)) expect(CRONS_PERFIL_CINCO_AGENTES, c).toContain(c);
  });
  it.each(Object.entries(SALTA))('%s aplica el filtro de flotas con perfil en su ruta', (c, re) => {
    expect(leer(join('cron', c, 'route.ts'))).toMatch(re);
  });
  it.each(Object.entries(MIXTO))('%s (mixto) filtra sus secciones de stand-by', (c, re) => {
    expect(leer(join('cron', c, 'route.ts'))).toMatch(re);
  });
});
