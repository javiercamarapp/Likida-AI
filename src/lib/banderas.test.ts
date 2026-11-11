/* eslint-disable security/detect-non-literal-fs-filename -- lee fuentes del propio repo */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BANDERAS } from './banderas';

const RAIZ = process.cwd();
const ejemplo = readFileSync(join(RAIZ, '.env.example'), 'utf8');
const doc = readFileSync(join(RAIZ, 'docs/operacion/banderas.md'), 'utf8');

/** Variables nombradas en `.env.example`, comentadas o no (`NOMBRE=` o `# NOMBRE=`). */
const listadasEnEjemplo = new Set([...ejemplo.matchAll(/^\s*#?\s*([A-Z][A-Z0-9_]+)=/gm)].map((m) => m[1]));

function fuentes(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) fuentes(p, acc);
    else if (/\.(ts|tsx)$/.test(e) && !/\.test\.tsx?$/.test(e) && !p.endsWith('/lib/banderas.ts')) acc.push(p);
  }
  return acc;
}

describe('registro de banderas', () => {
  it('cada bandera está listada en .env.example', () => {
    const faltan = BANDERAS.filter((b) => !listadasEnEjemplo.has(b.variable)).map((b) => b.variable);
    expect(faltan).toEqual([]);
  });

  it('cada bandera está documentada en docs/operacion/banderas.md con su valor, dueño y prueba de humo', () => {
    for (const b of BANDERAS) {
      const fila = doc.split('\n').find((l) => l.includes(`\`${b.variable}\``));
      expect(fila, `${b.variable} sin fila en banderas.md`).toBeDefined();
      expect(fila).toContain(b.valorEncendido);
      expect(fila).toContain(b.dueno);
    }
  });

  it('cada bandera tiene dueño, fechas ISO, requisito y prueba de humo; ninguna está decidida por el constructor', () => {
    for (const b of BANDERAS) {
      expect(b.dueno.trim(), b.variable).not.toBe('');
      expect(b.registrada, b.variable).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(b.efecto.trim().length, b.variable).toBeGreaterThan(20);
      expect(b.requiere.trim().length, b.variable).toBeGreaterThan(10);
      expect(b.pruebaDeHumo.trim().length, b.variable).toBeGreaterThan(20);
      expect(b.valorSinDecision).toBe('apagado');
      expect(b.valorDeploy1, `${b.variable}: la decisión es de Javier`).toBeNull();
    }
  });

  it('no hay dos banderas con el mismo nombre', () => {
    const nombres = BANDERAS.map((b) => b.variable);
    expect(new Set(nombres).size).toBe(nombres.length);
  });

  it('cada bandera la lee algún archivo del código (no se registra una palanca muerta)', () => {
    const codigo = fuentes(join(RAIZ, 'src')).map((f) => readFileSync(f, 'utf8')).join('\n');
    for (const b of BANDERAS) expect(codigo, `${b.variable} no la lee nadie`).toContain(b.variable);
  });

  it('cubre las banderas del dueño que el plan nombra', () => {
    const nombres = new Set(BANDERAS.map((b) => b.variable));
    for (const v of ['IA_GOBIERNO', 'LIKIDA_VER_COMO_SOLO_LECTURA', 'LIKIDA_TOTP_ESCALONADO', 'LIKIDA_BITACORA_ACCESO_SUPERADMIN', 'FACTURACION_PILOTO']) {
      expect(nombres.has(v), v).toBe(true);
    }
  });
});
