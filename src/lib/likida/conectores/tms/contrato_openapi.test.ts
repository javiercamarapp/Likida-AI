import { describe, expect, it, vi } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../../presupuesto', async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), acotada: (q: unknown) => q }));

import { CONTRATO_TMS_SUPUESTO } from './contrato';
import { openapiDeContrato } from './contrato_openapi';

const RUTA_DOC = join(process.cwd(), 'docs', 'operacion', 'conexion-tms-openapi.json');

describe('OpenAPI del contrato SUPUESTO', () => {
  const doc = openapiDeContrato(CONTRATO_TMS_SUPUESTO) as Record<string, unknown>;
  it('es OpenAPI 3.1 y cada operación se declara SUPUESTO', () => {
    expect(String(doc.openapi)).toMatch(/^3\.1/);
    expect(String((doc.info as { description: string }).description)).toMatch(/NO es su especificaci/);
    for (const item of Object.values(doc.paths as Record<string, Record<string, Record<string, unknown>>>)) {
      for (const op of Object.values(item)) expect(op['x-supuesto']).toBe(true);
    }
  });
  it('cubre login, viajes, peajes, posiciones y las tres tablas de liquidaciones', () => {
    expect(Object.keys(doc.paths as object).sort()).toEqual([
      '/api/conceptos-nomina', '/api/login', '/api/nomina-bitacora', '/api/operadores', '/api/peajes', '/api/posiciones', '/api/viajes',
    ]);
  });
  it('no afirma conexión real ni lleva una URL real', () => {
    expect(JSON.stringify(doc)).not.toMatch(/https:\/\/(?!SUPUESTO)/);
    expect(doc['x-estado']).toBe('SUPUESTO');
    expect(doc['x-modos']).toEqual({ api: false, archivos: true, push: false });
  });
  it('es determinista', () => {
    expect(JSON.stringify(openapiDeContrato(CONTRATO_TMS_SUPUESTO))).toBe(JSON.stringify(doc));
  });
  it('el archivo publicado en docs/operacion coincide con lo que genera el contrato', () => {
    if (process.env.TMS_OPENAPI_ACTUALIZAR === '1') writeFileSync(RUTA_DOC, `${JSON.stringify(doc, null, 2)}\n`);
    const publicado = readFileSync(RUTA_DOC, 'utf8');
    expect(publicado, 'regenerar: ver docs/operacion/conexion-tms.md §7').toBe(`${JSON.stringify(doc, null, 2)}\n`);
  });
});
