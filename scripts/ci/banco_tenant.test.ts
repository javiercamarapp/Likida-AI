// X-02: banco "flota A contra flota B" contra Postgres real. Aqui se prueba, SIN base de datos, lo que no necesita una:
// la lista de excepciones (allowlist), la clasificacion de hallazgos, el armado del SQL por fase y la forma de los archivos SQL.
// El SQL en si lo ejecuta el CI "CI Postgres (aislamiento entre tenants)"; el modo canario prueba alli que el banco no esta ciego.
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ARCHIVOS_POR_FASE,
  CANARIO_ESPERADO,
  armarSql,
  clasificar,
  extraerResultado,
  validarAllowlist,
  verificarCanario,
  verificarCobertura,
} from './banco-tenant.mjs';

const HOY = '2026-11-04';
const temporal = (extra: Record<string, unknown> = {}) => ({
  id: 'L1K-99',
  tipo: 'funcion_anon',
  objeto: 'public.f()',
  hallazgo: 'CT-SEG-99',
  severidad: 'baja',
  justificacion: 'razon escrita',
  fecha_limite: '2026-12-31',
  ...extra,
});
const permanente = (extra: Record<string, unknown> = {}) => ({
  id: 'RLS-01',
  tipo: 'funcion_authenticated',
  objeto: 'public.is_superadmin()',
  justificacion: 'ayudante de RLS',
  permanente: true,
  ...extra,
});

describe('allowlist del banco multi-tenant', () => {
  it('acepta entradas temporales con fecha limite y permanentes justificadas', () => {
    expect(validarAllowlist({ entradas: [temporal(), permanente()] }, HOY).errores).toEqual([]);
  });

  it('rechaza una excepcion sin justificacion, sin id duplicado y sin fecha limite', () => {
    const r = validarAllowlist(
      { entradas: [temporal({ justificacion: '' }), temporal({ id: 'L1K-98', fecha_limite: undefined }), permanente(), permanente()] },
      HOY,
    );
    expect(r.errores.join('\n')).toMatch(/L1K-99.*justificacion/);
    expect(r.errores.join('\n')).toMatch(/L1K-98.*fecha_limite/);
    expect(r.errores.join('\n')).toMatch(/RLS-01.*duplicad/);
  });

  it('rechaza una temporal sin id de hallazgo y un tipo desconocido', () => {
    const r = validarAllowlist({ entradas: [temporal({ hallazgo: undefined }), temporal({ id: 'X', tipo: 'inventado' })] }, HOY);
    expect(r.errores.join('\n')).toMatch(/L1K-99.*hallazgo/);
    expect(r.errores.join('\n')).toMatch(/X.*tipo/);
  });

  it('una permanente no puede traer fecha limite (seria una temporal disfrazada)', () => {
    const r = validarAllowlist({ entradas: [permanente({ fecha_limite: '2027-01-01' })] }, HOY);
    expect(r.errores.join('\n')).toMatch(/RLS-01.*permanente/);
  });

  it('una excepcion con fecha limite vencida falla el banco', () => {
    const r = validarAllowlist({ entradas: [temporal({ fecha_limite: '2026-11-03' })] }, HOY);
    expect(r.vencidas.map((e: { id: string }) => e.id)).toEqual(['L1K-99']);
  });

  it('el archivo real es valido hoy', () => {
    const real = JSON.parse(readFileSync('scripts/ci/banco-tenant-allowlist.json', 'utf8'));
    const r = validarAllowlist(real, HOY);
    expect(r.errores).toEqual([]);
    expect(r.vencidas).toEqual([]);
    expect(real.esquemas_expuestos).toContain('public');
    expect(real.cobertura_minima_siembra).toBeGreaterThanOrEqual(0.97);
    // is_operador()/get_user_operador_id() las borra la 0086: sus excepciones no pueden volver sin recrear las funciones.
    expect(real.entradas.map((e: { objeto: string }) => e.objeto).filter((o: string) => /operador/.test(o))).toEqual([]);
  });
});

describe('clasificar hallazgos', () => {
  const lista = { entradas: [temporal(), permanente()] };

  it('lo que esta en la allowlist se permite; lo demas es no listado', () => {
    const r = clasificar(
      [
        { tipo: 'funcion_anon', objeto: 'public.f()' },
        { tipo: 'funcion_anon', objeto: 'public.g()' },
        { tipo: 'fuga_lectura', objeto: 'public.viaje' },
      ],
      lista,
      HOY,
    );
    expect(r.permitidos).toHaveLength(1);
    expect(r.noListados.map((h: { objeto: string }) => h.objeto)).toEqual(['public.g()', 'public.viaje']);
  });

  it('la misma funcion en otro tipo NO queda cubierta por la excepcion de otro tipo', () => {
    const r = clasificar([{ tipo: 'funcion_authenticated', objeto: 'public.f()' }], lista, HOY);
    expect(r.noListados).toHaveLength(1);
  });

  it('una excepcion que ya no coincide con ningun hallazgo se reporta como obsoleta', () => {
    const r = clasificar([], lista, HOY);
    expect(r.obsoletas.map((e: { id: string }) => e.id).sort()).toEqual(['L1K-99', 'RLS-01']);
  });

  it('una excepcion de otra fase NO se reporta como obsoleta (la dinamica no mide funciones; la estatica no mide fugas)', () => {
    expect(clasificar([], lista, HOY, 'dinamica').obsoletas).toEqual([]);
    expect(clasificar([], { entradas: [permanente({ id: 'F-9', tipo: 'fuga_lectura', objeto: 'public.v', permanente: false, hallazgo: 'CT-1', fecha_limite: '2026-12-31' })] }, HOY, 'estatica').obsoletas).toEqual([]);
    expect(clasificar([], lista, HOY, 'estatica').obsoletas.map((e: { id: string }) => e.id).sort()).toEqual(['L1K-99', 'RLS-01']);
  });

  it('una excepcion vencida no protege al hallazgo', () => {
    const r = clasificar([{ tipo: 'funcion_anon', objeto: 'public.f()' }], { entradas: [temporal({ fecha_limite: '2026-01-01' })] }, HOY);
    expect(r.noListados).toHaveLength(1);
    expect(r.vencidas).toHaveLength(1);
  });

  it('una fuga de lectura entre flotas jamas se permite como permanente', () => {
    const r = validarAllowlist({ entradas: [permanente({ id: 'F-1', tipo: 'fuga_lectura', objeto: 'public.viaje' })] }, HOY);
    expect(r.errores.join('\n')).toMatch(/F-1.*fuga_lectura/);
  });
});

describe('armado del SQL por fase', () => {
  it('la fase estatica corre prologo, politicas, funciones y vistas, y cierra con rollback', () => {
    const sql = armarSql('estatica', { esquemas: ['public'] });
    expect(sql).toMatch(/ci_banco\.esquemas/);
    expect(sql.indexOf('POLITICAS')).toBeLessThan(sql.indexOf('FUNCIONES'));
    expect(sql.trim().endsWith('rollback;')).toBe(true);
    expect(sql).not.toMatch(/\bcommit\b/i);
  });

  it('la fase dinamica siembra dos flotas y lee como usuario autenticado y como anon', () => {
    const sql = armarSql('dinamica', { esquemas: ['public'] });
    expect(sql).toMatch(/set local role authenticated/);
    expect(sql).toMatch(/set local role anon/);
    expect(sql).toMatch(/session_replication_role/);
    expect(sql.trim().endsWith('rollback;')).toBe(true);
  });

  it('el canario crea objetos abiertos a proposito antes de correr ambas fases', () => {
    const sql = armarSql('canario', { esquemas: ['public'] });
    expect(sql).toMatch(/zz_canario_fuga/);
    expect(sql.indexOf('zz_canario_fuga')).toBeLessThan(sql.indexOf('POLITICAS'));
    expect(sql.indexOf('FUNCIONES')).toBeLessThan(sql.indexOf('SIEMBRA'));
  });

  it('la fase dinamica carga los candidatos de la siembra justo despues del prologo', () => {
    const sql = armarSql('dinamica', { esquemas: ['public'], candidatos: [{ tabla: 'public.t', columna: 'c', ord: 0, va: 'x', vb: 'x' }] });
    expect(sql.indexOf('create table ci_banco.candidatos')).toBeLessThan(sql.indexOf('insert into ci_banco.candidatos'));
    expect(sql.indexOf('insert into ci_banco.candidatos')).toBeLessThan(sql.indexOf('SIEMBRA'));
  });

  it('la fase dinamica prueba el telefono del chofer (operador_telefono_forma) despues de sembrar, y carga las bases explicitas', () => {
    const sql = armarSql('dinamica', { esquemas: ['public'] });
    expect(sql.indexOf('SIEMBRA')).toBeLessThan(sql.indexOf('BANCO:OPERADOR'));
    expect(sql).toMatch(/operador_telefono_forma/);
    expect(sql).toMatch(/insert into ci_banco\.bases/);
    expect(ARCHIVOS_POR_FASE.estatica).not.toContain('25_operador_telefono_rol.sql');
    expect(ARCHIVOS_POR_FASE.canario).toContain('25_operador_telefono_rol.sql');
    expect(armarSql('estatica', { esquemas: ['public'] })).not.toMatch(/insert into ci_banco\.bases/);
  });

  it('rechaza una fase desconocida y esquemas con caracteres peligrosos', () => {
    expect(() => armarSql('otra', { esquemas: ['public'] })).toThrow(/fase/);
    expect(() => armarSql('estatica', { esquemas: ["public'; drop"] })).toThrow(/esquema/);
  });

  it('todos los archivos SQL referidos existen y no hay SQL huerfano en la carpeta', () => {
    const usados = new Set(Object.values(ARCHIVOS_POR_FASE).flat() as string[]);
    const enDisco = readdirSync('supabase/tests/banco_tenant').filter((f) => f.endsWith('.sql'));
    expect([...usados].sort()).toEqual(enDisco.sort());
  });

  it('los archivos SQL nunca escriben de forma permanente ni tocan produccion', () => {
    for (const f of readdirSync('supabase/tests/banco_tenant').filter((x) => x.endsWith('.sql'))) {
      const s = readFileSync(`supabase/tests/banco_tenant/${f}`, 'utf8');
      expect(s, f).not.toMatch(/^\s*commit\s*;/im);
      expect(s, f).not.toMatch(/\balter\s+system\b|\bdrop\s+(database|role)\b|\bcreate\s+role\b/i);
    }
  });
});

describe('lectura del resultado y cobertura', () => {
  it('extrae el JSON de la linea marcada y tolera ruido alrededor', () => {
    const out = 'ruido\nBANCO_JSON {"hallazgos":[{"tipo":"sin_rls","objeto":"public.t"}],"cobertura":{"tablas":4,"sembradas":3}}\n';
    const r = extraerResultado(out);
    expect(r.hallazgos).toHaveLength(1);
    expect(r.cobertura.sembradas).toBe(3);
  });

  it('sin la linea marcada es un error (el banco no corrio)', () => {
    expect(() => extraerResultado('nada')).toThrow(/BANCO_JSON/);
  });

  it('la cobertura por debajo del minimo falla y se explica', () => {
    expect(verificarCobertura({ tablas: 10, sembradas: 4 }, 0.5).ok).toBe(false);
    expect(verificarCobertura({ tablas: 10, sembradas: 5 }, 0.5).ok).toBe(true);
    expect(verificarCobertura({ tablas: 0, sembradas: 0 }, 0.5).ok).toBe(false);
  });

  it('el canario falla si el banco no detecto alguno de los objetos abiertos a proposito', () => {
    const todos = CANARIO_ESPERADO.map(([tipo, objeto]: string[]) => ({ tipo, objeto }));
    expect(verificarCanario(todos).faltantes).toEqual([]);
    expect(verificarCanario(todos.slice(1)).faltantes).toHaveLength(1);
  });
});
