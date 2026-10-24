import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

describe('A37-S01-04 limpieza de la carga 250', () => {
  const sql = readFileSync('scripts/carga/250-camiones/04-limpiar.sql', 'utf8');
  it('se niega si la base tiene tenants que no son sintéticos', () => {
    expect(sql).toMatch(/exists \(select 1 from tenant where nombre not like 'ZZZ CARGA%'\)[\s\S]*raise exception/);
  });
  it('borra por ids exactos, no solo por like', () => {
    expect(sql).toContain("'aaaaaaaa-0000-4000-8000-000000000250'");
    expect(sql).toContain("md5('zzz-chica-'");
  });
});
