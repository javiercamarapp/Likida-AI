import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';

// Guardia de CI (Ola 1 de seguridad, A1/B-08): desde la 0949 ninguna migración puede crear una tabla de `public` sin RLS ni dar
// privilegios a anon/authenticated. La 0947 dejó el default cerrado; esto impide que una migración futura lo reabra a mano. Estático
// (sin base): el estado real lo vigila supabase/pruebas-aislamiento/capa0_grants_tablas.sql en ci-postgres.
// Excepción deliberada: una línea `-- GRANTS-ABIERTOS-OK: <razón>` en la migración (revisable en el PR) o, para RLS, `-- RLS-OK: <razón>`.

const DIR = 'supabase/migrations';
const DESDE = '0949';

/** Quita los comentarios de línea y de bloque para no analizar prosa. */
export function sinComentarios(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');
}

export function tablasCreadas(sql: string): string[] {
  const limpio = sinComentarios(sql);
  return [...limpio.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?([a-z0-9_]+)"?/gi)].map((m) => m[1].toLowerCase());
}

export function tablasSinRls(sql: string): string[] {
  const limpio = sinComentarios(sql).toLowerCase();
  if (/-- rls-ok:/i.test(sql)) return [];
  const generico = /enable\s+row\s+level\s+security\s*'?\s*,?\s*\w*\)/.test(limpio) && /format\s*\(/.test(limpio);
  return tablasCreadas(sql).filter((t) => {
    if (t.startsWith('_') || t === 'tmp' ) return false;
    const re = new RegExp(`alter\\s+table\\s+(?:if\\s+exists\\s+)?(?:only\\s+)?(?:public\\.)?"?${t}"?\\s+enable\\s+row\\s+level\\s+security`);
    return !re.test(limpio) && !generico;
  });
}

/** Líneas `grant ... to ... anon|authenticated` (también `alter default privileges ... grant`). */
export function grantsAbiertos(sql: string): string[] {
  if (/-- grants-abiertos-ok:/i.test(sql)) return [];
  const limpio = sinComentarios(sql);
  return limpio
    .split(';')
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter((s) => /^(alter default privileges .*? )?grant /i.test(s) && /\bto\b[^;]*\b(anon|authenticated|public)\b/i.test(s));
}

describe('guardia: migraciones futuras no abren tablas', () => {
  const nuevas = readdirSync(DIR).filter((f) => /^\d{4}_.*\.sql$/.test(f) && f.slice(0, 4) >= DESDE);

  it('detecta una tabla sin RLS y un grant a anon (casos sintéticos)', () => {
    expect(tablasSinRls('create table public.x (id int);')).toEqual(['x']);
    expect(tablasSinRls('create table public.x (id int); alter table public.x enable row level security;')).toEqual([]);
    expect(tablasSinRls('-- create table public.y (id int);\nselect 1;')).toEqual([]);
    expect(grantsAbiertos('grant select on public.x to anon;')).toHaveLength(1);
    expect(grantsAbiertos('grant select on public.x to authenticated, service_role;')).toHaveLength(1);
    expect(grantsAbiertos('alter default privileges in schema public grant all on tables to anon;')).toHaveLength(1);
    expect(grantsAbiertos('grant select on public.x to service_role;')).toEqual([]);
    expect(grantsAbiertos('revoke all on public.x from anon, authenticated;')).toEqual([]);
  });

  it.each(nuevas.length ? nuevas : ['(ninguna todavía)'])('%s: tablas con RLS y sin grants a anon/authenticated', (f) => {
    if (f.startsWith('(')) return;
    const sql = readFileSync(`${DIR}/${f}`, 'utf8');
    expect(tablasSinRls(sql), `${f}: crea tablas sin \`enable row level security\``).toEqual([]);
    expect(grantsAbiertos(sql), `${f}: concede privilegios a anon/authenticated (usa service_role, o documenta con \`-- GRANTS-ABIERTOS-OK: razón\`)`).toEqual([]);
  });
});
