import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';

// Guardia de CI (Ola 1 de seguridad, A1/B-08): desde la 0949 ninguna migración puede crear una tabla de `public` sin RLS ni dar
// privilegios a anon/authenticated. La 0947 dejó el default cerrado; esto impide que una migración futura lo reabra a mano.
// ES ESTÁTICA y por eso limitada (capa secundaria): el estado REAL lo vigilan capa0_grants_tablas.sql y login_bajo_grants_0947.sql en
// ci-postgres, que miran el catálogo (y por tanto ven los DO, format() y bucles).
// Excepción deliberada, revisable en el PR: una línea `-- GRANTS-ABIERTOS-OK: <razón>` o `-- RLS-OK: <razón>` en la migración.
//
// QUÉ DETECTA: `grant ... to anon|authenticated|public` en cualquier sentencia, también dentro de un DO $$ ... $$ o de un format('grant ...')
// (se separa por `;` y se mira por palabras, no por prefijo); `create [unlogged] table` de `public` sin un `alter table ... enable row level
// security` explícito sobre ese nombre.
// QUÉ NO DETECTA (límites, con casos abajo): privilegios armados con concatenación de roles en una variable (`grant ... to %I` con el rol en
// un argumento), tablas creadas y protegidas por un bucle dinámico (hay que marcarlas con `-- RLS-OK:`), tablas fuera de `public` (se ignoran
// a propósito: storage.x, auth.x), temporales.
// FALSOS POSITIVOS CONOCIDOS: `grant usage on schema public to authenticated` se marca (hay que justificarlo con el marcador).

const DIR = 'supabase/migrations';
const DESDE = '0949';

/** Quita los comentarios de línea y de bloque respetando los literales entre comillas simples (un `--` dentro de un texto no corta la línea). */
export function sinComentarios(sql: string): string {
  let salida = '';
  let i = 0;
  let enTexto = false;
  while (i < sql.length) {
    const c = sql[i];
    const sig = sql[i + 1];
    if (enTexto) {
      salida += c;
      if (c === "'") enTexto = false;
      i += 1;
    } else if (c === "'") {
      enTexto = true;
      salida += c;
      i += 1;
    } else if (c === '-' && sig === '-') {
      while (i < sql.length && sql[i] !== '\n') i += 1;
    } else if (c === '/' && sig === '*') {
      const fin = sql.indexOf('*/', i + 2);
      i = fin === -1 ? sql.length : fin + 2;
    } else {
      salida += c;
      i += 1;
    }
  }
  return salida;
}

function palabras(trozo: string): string[] {
  return trozo.toLowerCase().split(/[^a-z0-9_."]+/).filter(Boolean);
}

/** Nombre sin comillas; `{esquema, tabla}` (esquema = 'public' si no viene). */
function partir(nombre: string): { esquema: string; tabla: string } {
  const limpio = nombre.split('"').join('');
  const punto = limpio.indexOf('.');
  return punto === -1 ? { esquema: 'public', tabla: limpio } : { esquema: limpio.slice(0, punto), tabla: limpio.slice(punto + 1) };
}

export function tablasCreadas(sql: string): string[] {
  const p = palabras(sinComentarios(sql));
  const salida: string[] = [];
  for (let i = 0; i < p.length; i += 1) {
    if (p[i] !== 'create') continue;
    let j = i + 1;
    let temporal = false;
    while (p[j] === 'unlogged' || p[j] === 'temp' || p[j] === 'temporary' || p[j] === 'global' || p[j] === 'local') {
      if (p[j] !== 'unlogged') temporal = true;
      j += 1;
    }
    if (p[j] !== 'table') continue;
    j += 1;
    if (p[j] === 'if' && p[j + 1] === 'not' && p[j + 2] === 'exists') j += 3;
    if (!p[j] || temporal) continue;
    const { esquema, tabla } = partir(p[j]);
    if (esquema === 'public' && !tabla.startsWith('_')) salida.push(tabla);
  }
  return salida;
}

export function tablasConRls(sql: string): Set<string> {
  const p = palabras(sinComentarios(sql));
  const con = new Set<string>();
  for (let i = 0; i + 3 < p.length; i += 1) {
    if (p[i] !== 'enable' || p[i + 1] !== 'row' || p[i + 2] !== 'level' || p[i + 3] !== 'security') continue;
    for (let k = i - 1; k >= 0; k -= 1) {
      if (p[k] !== 'table') continue;
      let j = k + 1;
      if (p[j] === 'if' && p[j + 1] === 'exists') j += 2;
      if (p[j] === 'only') j += 1;
      if (p[j]) con.add(partir(p[j]).tabla);
      break;
    }
  }
  return con;
}

export function tablasSinRls(sql: string): string[] {
  if (sql.toLowerCase().includes('-- rls-ok:')) return [];
  const con = tablasConRls(sql);
  return tablasCreadas(sql).filter((t) => !con.has(t));
}

/** Sentencias (separadas por `;`, incluidas las de dentro de un DO o de un format()) que conceden a anon/authenticated/public. */
export function grantsAbiertos(sql: string): string[] {
  if (sql.toLowerCase().includes('-- grants-abiertos-ok:')) return [];
  return sinComentarios(sql)
    .split(';')
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter((s) => {
      const p = palabras(s);
      const g = p.indexOf('grant');
      if (g === -1) return false;
      const a = p.indexOf('to', g);
      if (a === -1) return false;
      return p.slice(a + 1).some((w) => w === 'anon' || w === 'authenticated' || w === 'public');
    });
}

describe('guardia: migraciones futuras no abren tablas', () => {
  const nuevas = readdirSync(DIR).filter((f) => /^\d{4}_.*\.sql$/.test(f) && f.slice(0, 4) >= DESDE);

  it('detecta tablas sin RLS (casos sintéticos y falsos positivos)', () => {
    expect(tablasSinRls('create table public.x (id int);')).toEqual(['x']);
    expect(tablasSinRls('create unlogged table if not exists public.x (id int);')).toEqual(['x']);
    expect(tablasSinRls('create table public.x (id int); alter table public.x enable row level security;')).toEqual([]);
    expect(tablasSinRls('create table "public"."x" (id int); alter table only "public"."x" enable row level security;')).toEqual([]);
    expect(tablasSinRls('-- create table public.y (id int);\nselect 1;')).toEqual([]);
    expect(tablasSinRls('create table storage.x (id int);')).toEqual([]);
    expect(tablasSinRls('create temp table t (id int);')).toEqual([]);
    expect(tablasSinRls("select 'a -- b'; create table public.z (id int);")).toEqual(['z']);
    // Límite documentado: un bucle dinámico no se entiende; hace falta el marcador.
    expect(tablasSinRls("create table public.w (id int); do $$ begin execute format('alter table %I enable row level security', 'w'); end $$;")).toEqual(['w']);
    expect(tablasSinRls('-- RLS-OK: bucle dinámico\ncreate table public.w (id int);')).toEqual([]);
  });

  it('detecta grants a anon/authenticated/public (también dentro de DO y de format)', () => {
    expect(grantsAbiertos('grant select on public.x to anon;')).toHaveLength(1);
    expect(grantsAbiertos('grant select on public.x to authenticated, service_role;')).toHaveLength(1);
    expect(grantsAbiertos('alter default privileges in schema public grant all on tables to anon;')).toHaveLength(1);
    expect(grantsAbiertos('do $$ begin grant select on public.x to authenticated; end $$;')).toHaveLength(1);
    expect(grantsAbiertos("do $$ begin execute 'grant select on public.x to anon'; end $$;")).toHaveLength(1);
    expect(grantsAbiertos("do $$ begin execute format('grant select on %I to anon', 'x'); end $$;")).toHaveLength(1);
    expect(grantsAbiertos('grant select on public.x to service_role;')).toEqual([]);
    expect(grantsAbiertos('revoke all on public.x from anon, authenticated;')).toEqual([]);
    expect(grantsAbiertos('-- grant select on x to anon;\nselect 1;')).toEqual([]);
    expect(grantsAbiertos('-- GRANTS-ABIERTOS-OK: lectura pública del catálogo\ngrant select on public.x to anon;')).toEqual([]);
    // Falso positivo conocido (necesita marcador).
    expect(grantsAbiertos('grant usage on schema public to authenticated;')).toHaveLength(1);
    // Límite documentado: el rol llega por una variable.
    expect(grantsAbiertos("do $$ begin execute format('grant select on %I to %I', 'x', 'anon'); end $$;")).toHaveLength(1);
    expect(grantsAbiertos("do $$ declare r text := 'anon'; begin execute format('grant select on x to %I', r); end $$;")).toEqual([]);
  });

  it.each(nuevas.length ? nuevas : ['(ninguna todavía)'])('%s: tablas con RLS y sin grants a anon/authenticated', (f) => {
    if (f.startsWith('(')) return;
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- ruta derivada de readdirSync sobre un directorio fijo del repo
    const sql = readFileSync(`${DIR}/${f}`, 'utf8');
    expect(tablasSinRls(sql), `${f}: crea tablas sin \`enable row level security\``).toEqual([]);
    expect(grantsAbiertos(sql), `${f}: concede privilegios a anon/authenticated (usa service_role, o documenta con \`-- GRANTS-ABIERTOS-OK: razón\`)`).toEqual([]);
  });
});
