/* eslint-disable security/detect-non-literal-fs-filename -- solo pruebas: SQL del propio repo por rutas armadas sobre constantes de este archivo. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const DIR = fileURLToPath(new URL('../../../../scripts/demo/innovativos/', import.meta.url));

describe('vaciar.sql solo toca filas sembradas', () => {
  const sql = readFileSync(`${DIR}vaciar.sql`, 'utf8').replace(/--[^\n]*/g, '');
  const sentencias = sql.split(/;\s*(?:\n|$)/).filter((x) => /(^|\s)(delete\s+from|update\s+\w+\s+set)\s/i.test(x));
  it('hay sentencias de borrado que revisar', () => {
    expect(sentencias.length).toBeGreaterThanOrEqual(10);
  });
  it.each(sentencias.map((x) => [x.replace(/\s+/g, ' ').trim().slice(0, 90), x] as const))('acotada por una marca del demo, no solo por el tenant: %s', (_t, x) => {
    // Quitado el filtro por tenant, tiene que quedar OTRA condición (proveedor/origen/modelo/nombre/ids deterministas).
    const donde = /\bwhere\b([\s\S]*)$/i.exec(x)?.[1] ?? '';
    expect(donde.trim(), 'sin WHERE').not.toBe('');
    expect(/proveedor\s*=|sistema_origen\s*=|modelo\s*=|\blike\b|innovativos_sim\.uid\(|recibida_en\s*-\s*medida_en/i.test(x), x).toBe(true);
  });
  it('ya no borra «todo lo csv» ni «todo lo de tabla_propia» del tenant', () => {
    expect(sql).not.toMatch(/delete from geocerca where tenant_id = :'t' and fuente = 'csv'/);
    expect(sql).not.toMatch(/delete from vigia_(mensaje|conversacion|contacto) where tenant_id = :'t';/);
    expect(sql).not.toMatch(/update unidad set gps_visto_en = null where tenant_id = :'t';/);
  });
});
