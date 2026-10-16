/* eslint-disable security/detect-non-literal-fs-filename -- rutas armadas de una lista fija de crons del repo */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// ═══════════════════════════════════════════════════════════════════════════
// T-PER-06 · FUGA DE LOS CRONS BAJO EL PERFIL `cinco_agentes` (mig. 0770).
//
// Los crons barren TODAS las flotas. Con el perfil, los de stand-by deben
// saltarse la flota que lo tiene y SEGUIR procesando a las demás; los que sirven
// a los cinco agentes y la plomería NO se saltan a nadie. Esta prueba usa el
// `perfil_tenant.ts` REAL (solo se simula la tabla `tenant_perfil`) con dos
// flotas sintéticas —una con perfil, otra sin—, y enumera los crons desde
// `vercel.json` (no desde un número fijo): un cron nuevo sin clasificar la pone
// en rojo. Ningún cron real corre; el cableado ruta→motor lo prueba cada
// `route.test.ts` (bloque «el perfil de tenant»).
// ═══════════════════════════════════════════════════════════════════════════

const CON = 'flota-con-perfil';
const SIN = 'flota-sin-perfil';

let tabla: Array<{ tenant_id: string; perfil: string }> = [];
let errorTabla: { code?: string; message: string } | null = null;
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (nombre: string) => {
      if (nombre !== 'tenant_perfil') throw new Error(`tabla inesperada en la prueba: ${nombre}`);
      let id: string | null = null;
      const b: Record<string, unknown> = {};
      b.select = () => b;
      b.eq = (_c: string, v: string) => { id = v; return b; };
      b.maybeSingle = async () => {
        if (errorTabla) return { data: null, error: errorTabla };
        return { data: tabla.find((f) => f.tenant_id === id) ?? null, error: null };
      };
      // `await tabla.select('tenant_id')` (lista completa, sin eq)
      b.then = (ok: (v: unknown) => unknown) =>
        Promise.resolve(errorTabla ? { data: null, error: errorTabla } : { data: tabla, error: null }).then(ok);
      return b;
    },
  }),
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));

const {
  tenantsConPerfilASaltar, tenantsConPerfil, sinTenantsDePerfil, cronAplicaAPerfil, nombreDeCron, reiniciarCachePerfil,
} = await import('@/lib/auth/perfil_tenant');
const { CRONS_PERFIL_CINCO_AGENTES, CRONS_PROXIMAMENTE_PERFIL } = await import('@/lib/auth/visibilidad');

// ── La clasificación (la ficha T-PER-06 + B1) ───────────────────────────────
/**
 * Stand-by: el motor recibe `excluirTenants` de `tenantsConPerfilASaltar(<cron>)`.
 * `vigia` y `conductor-hitos` son los crons de los módulos «Próximamente» (fase 1, decisión del 15-oct-2026):
 * la flota con perfil los salta igual que a un stand-by (`CRONS_PROXIMAMENTE_PERFIL`).
 */
const STANDBY = ['facturar', 'descarga-sat', 'jornada', 'jornada-alertas', 'asistencia', 'buzon-entrega', 'vigia', 'conductor-hitos'] as const;
/** MIXTO: sigue para el Conductor, y sus secciones de stand-by piden `tenantsConPerfil()`. */
const MIXTOS = ['escalar'] as const;
/** Sirven a los cinco agentes o son plomería compartida: NO se saltan a nadie. */
const PERMITIDOS = [
  'gps', 'peajes', 'carta-porte-docs', 'liquidaciones-externas',
  'wa-outbox', 'wa-pendientes', 'guardia', 'purgar',
] as const;
/**
 * PLATAFORMA: no iteran flotas con datos operativos. `runner` despacha los agentes de Likida (CRM/prospección con
 * tenant NULL y reportes internos de Likida) y `portales-vivos` mide la salud de portales públicos. No hay flota que
 * saltar; se declaran aquí para que la clasificación sea explícita y no un olvido.
 */
const PLATAFORMA = ['runner', 'portales-vivos'] as const;

const cronsDeVercel: string[] = (JSON.parse(readFileSync('vercel.json', 'utf8')).crons as Array<{ path: string }>)
  .map((c) => nombreDeCron(c.path));

beforeEach(() => {
  reiniciarCachePerfil();
  tabla = [{ tenant_id: CON, perfil: 'cinco_agentes' }];
  errorTabla = null;
});

describe('T-PER-06 · el inventario de crons está clasificado', () => {
  it('vercel.json lista los crons y cada uno cae en UNA sola clase (un cron nuevo sin clasificar falla)', () => {
    const clases = [...STANDBY, ...MIXTOS, ...PERMITIDOS, ...PLATAFORMA];
    expect(new Set(clases).size).toBe(clases.length); // sin duplicados entre clases
    expect(cronsDeVercel.length).toBeGreaterThanOrEqual(19);
    for (const c of cronsDeVercel) expect(clases, `cron sin clasificar: ${c}`).toContain(c);
    for (const c of clases) expect(cronsDeVercel, `clasificado pero ausente de vercel.json: ${c}`).toContain(c);
  });

  it('la lista de permitidos del perfil (visibilidad.ts) es exactamente permitidos + mixtos; ninguno de stand-by ni plataforma', () => {
    expect([...CRONS_PERFIL_CINCO_AGENTES].sort()).toEqual([...PERMITIDOS, ...MIXTOS].sort());
    for (const c of [...STANDBY, ...PLATAFORMA]) expect(cronAplicaAPerfil(c)).toBe(false);
  });

  it('los crons de los módulos «Próximamente» (vigia, conductor-hitos) están declarados aparte y no figuran entre los permitidos', () => {
    expect([...CRONS_PROXIMAMENTE_PERFIL].sort()).toEqual(['conductor-hitos', 'vigia']);
    for (const c of CRONS_PROXIMAMENTE_PERFIL) {
      expect(CRONS_PERFIL_CINCO_AGENTES, c).not.toContain(c);
      expect(STANDBY as readonly string[], c).toContain(c);
    }
  });

  it('cada ruta de cron del disco está en vercel.json (no hay cron huérfano sin clasificar)', () => {
    const enDisco = readdirSync('src/app/api/cron', { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
    for (const c of enDisco) expect(cronsDeVercel, `ruta sin programar en vercel.json: ${c}`).toContain(c);
  });
});

describe('T-PER-06 · (a) crons de stand-by: la flota con perfil se SALTA, la otra se PROCESA', () => {
  it.each(STANDBY)('%s', async (cron) => {
    const saltar = await tenantsConPerfilASaltar(cron);
    const procesadas = sinTenantsDePerfil([{ tenantId: CON }, { tenantId: SIN }], saltar, (f) => f.tenantId);
    expect(saltar.has(CON)).toBe(true);
    expect(saltar.has(SIN)).toBe(false);
    expect(procesadas).toEqual([{ tenantId: SIN }]);
  });

  it.each(STANDBY)('%s · el nombre de la ruta coincide con el que pide al perfil (un typo lo dejaría correr)', (cron) => {
    const fuente = readFileSync(join('src/app/api/cron', cron, 'route.ts'), 'utf8');
    expect(fuente).toContain(`tenantsConPerfilASaltar('${cron}')`);
  });

  it('sin flota con perfil (tabla vacía) ningún cron de stand-by salta a nadie: «sin perfil nada cambia»', async () => {
    tabla = [];
    for (const c of STANDBY) expect((await tenantsConPerfilASaltar(c)).size).toBe(0);
  });

  it('escalar (mixto): sus secciones de stand-by (cobranza, relojes legales, reglas) piden TODAS las flotas con perfil', async () => {
    const fuente = readFileSync('src/app/api/cron/escalar/route.ts', 'utf8');
    expect(fuente.match(/tenantsConPerfil\(\)/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
    const saltar = await tenantsConPerfil();
    expect(saltar.has(CON)).toBe(true);
    expect(saltar.has(SIN)).toBe(false);
  });
});

describe('T-PER-06 · (b) crons que SIRVEN a los cinco agentes: NO se saltan a la flota con perfil', () => {
  it.each(PERMITIDOS)('%s', async (cron) => {
    const saltar = await tenantsConPerfilASaltar(cron);
    expect(saltar.size).toBe(0);
    expect(sinTenantsDePerfil([{ tenantId: CON }, { tenantId: SIN }], saltar, (f) => f.tenantId)).toHaveLength(2);
  });

  it.each(PERMITIDOS)('%s · su ruta no se filtra por perfil con el nombre de otro cron', (cron) => {
    const fuente = readFileSync(join('src/app/api/cron', cron, 'route.ts'), 'utf8');
    expect(fuente).not.toMatch(/tenantsConPerfilASaltar\(/);
  });

  it.each(PLATAFORMA)('%s (plataforma) no filtra por flota ni lee la tabla del perfil', (cron) => {
    const fuente = readFileSync(join('src/app/api/cron', cron, 'route.ts'), 'utf8');
    expect(fuente).not.toMatch(/perfil_tenant/);
  });
});

describe('T-PER-06 · falla cerrada y compatibilidad', () => {
  it('si la tabla no se puede leer, un cron de stand-by NO corre para nadie esa vuelta (lanza)', async () => {
    errorTabla = { code: '57014', message: 'timeout' };
    await expect(tenantsConPerfilASaltar('facturar')).rejects.toThrow(/no se pudo leer la lista/);
  });

  it('…pero un cron permitido sigue sin tocar la tabla: un bache de lectura no lo detiene', async () => {
    errorTabla = { code: '57014', message: 'timeout' };
    for (const c of PERMITIDOS) expect((await tenantsConPerfilASaltar(c)).size).toBe(0);
  });

  it('tabla ausente (0770 sin aplicar): ninguna flota con perfil, nada se salta', async () => {
    errorTabla = { code: '42P01', message: 'relation does not exist' };
    for (const c of STANDBY) expect((await tenantsConPerfilASaltar(c)).size).toBe(0);
    expect((await tenantsConPerfil()).size).toBe(0);
  });

  it('el perfil solo QUITA: ninguna clase de cron le añade trabajo a una flota sin perfil', async () => {
    for (const c of [...STANDBY, ...PERMITIDOS, ...PLATAFORMA]) expect((await tenantsConPerfilASaltar(c)).has(SIN)).toBe(false);
  });
});

describe('T-PER-06 · tabla cron × perfil (la que se imprime en la nota)', () => {
  it('imprime la matriz y confirma que cada celda coincide con la clasificación', async () => {
    const filas: string[] = ['cron | con perfil | sin perfil | clase'];
    for (const c of cronsDeVercel) {
      const saltar = await tenantsConPerfilASaltar(c);
      const mixto = (MIXTOS as readonly string[]).includes(c);
      const plataforma = (PLATAFORMA as readonly string[]).includes(c);
      const conPerfil = mixto ? 'corre (secciones de stand-by se saltan)' : plataforma ? 'corre (no itera flotas)' : saltar.has(CON) ? 'SE SALTA' : 'corre';
      const sinPerfil = saltar.has(SIN) ? 'SE SALTA' : 'corre';
      const clase = (STANDBY as readonly string[]).includes(c) ? 'stand-by' : mixto ? 'mixto' : (PLATAFORMA as readonly string[]).includes(c) ? 'plataforma' : 'permitido';
      filas.push(`${c} | ${conPerfil} | ${sinPerfil} | ${clase}`);
      expect(sinPerfil).toBe('corre');
      if (clase === 'stand-by') expect(conPerfil).toBe('SE SALTA');
      if (clase === 'permitido') expect(conPerfil).toBe('corre');
    }
    console.log(`\n${filas.join('\n')}\n`);
    expect(filas).toHaveLength(cronsDeVercel.length + 1);
  });
});
