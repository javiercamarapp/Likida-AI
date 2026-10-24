import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';

describe('A37-S03-10 exportar-archivos.mjs usa la guarda de host', () => {
  it('con una base remota se rechaza (exit 3) antes de abrir conexión', () => {
    const r = spawnSync('node', ['scripts/demo/cinco-agentes/exportar-archivos.mjs'], {
      env: { ...process.env, DEMO_DATABASE_URL: 'postgresql://u:p@db.ejemplo.invalid:5432/postgres' },
      encoding: 'utf8',
    });
    expect(r.status).toBe(3);
    expect(r.stderr).toContain('RECHAZADO');
  });
});
