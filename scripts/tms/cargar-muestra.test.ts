import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { dentroDelRepo, parsearArgs } from './cargar-muestra.mjs';
import { BITACORA_MUESTRA, PADRON_MUESTRA } from '../../src/lib/likida/liquidacion_externa/desglose_muestra_tms.fixture';

const SCRIPT = resolve(process.cwd(), 'scripts/tms/cargar-muestra.mjs');
const carpeta = mkdtempSync(join(tmpdir(), 'cargar-muestra-'));
afterAll(() => rmSync(carpeta, { recursive: true, force: true }));
function archivo(n: string, v: unknown, modo = 0o600): string {
  const p = join(carpeta, n);
  writeFileSync(p, JSON.stringify(v));
  chmodSync(p, modo);
  return p;
}
const correr = (args: string[]) => {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { env: { PATH: process.env.PATH ?? '' }, encoding: 'utf8', timeout: 90_000 });
  return { codigo: r.status, salida: `${r.stdout}\n${r.stderr}` };
};

describe('cargar-muestra.mjs', () => {
  it('detecta rutas dentro del repo y argumentos faltantes', () => {
    expect(dentroDelRepo(resolve(process.cwd(), 'src/x.json'))).toBe(true);
    expect(dentroDelRepo(join(carpeta, 'x.json'))).toBe(false);
    expect(parsearArgs(['--muestra', 'a'])).toHaveProperty('error');
  });
  it('se niega con archivos dentro del repo o con modo distinto de 600', () => {
    const m = archivo('m.json', { formato: 'muestra-tms', version: 1, bitacoras: [BITACORA_MUESTRA] });
    const p = archivo('p.json', PADRON_MUESTRA);
    expect(correr(['--muestra', resolve(process.cwd(), 'package.json'), '--padron', p, '--salida', join(carpeta, 'o1')]).codigo).toBe(2);
    expect(correr(['--muestra', m, '--padron', p, '--salida', resolve(process.cwd(), 'tmp-salida')]).codigo).toBe(2);
    const abierto = archivo('abierto.json', {}, 0o644);
    const r = correr(['--muestra', abierto, '--padron', p, '--salida', join(carpeta, 'o2')]);
    expect(r.codigo).toBe(2);
    expect(r.salida).toMatch(/modo 600/);
  });
  it('recorre el flujo hasta el Excel por correo simulado, sin imprimir nombres ni importes', () => {
    const m = archivo('m2.json', { formato: 'muestra-tms', version: 1, bitacoras: [BITACORA_MUESTRA] });
    const p = archivo('p2.json', PADRON_MUESTRA);
    const c = archivo('c2.json', { '1001': 'operador.uno@ejemplo.invalid' });
    const salida = join(carpeta, 'salida');
    const r = correr(['--muestra', m, '--padron', p, '--correos', c, '--salida', salida, '--provisional', '--simular-revision']);
    expect(r.codigo).toBe(0);
    expect(r.salida).toContain('correos simulados: 1');
    expect(r.salida).not.toMatch(/Ficticio|4000|500\.5/);
    const resumen = JSON.parse(readFileSync(join(salida, 'resumen.json'), 'utf8'));
    expect(resumen.correosSimulados[0].provisional).toBe(true);
    expect(existsSync(join(salida, resumen.correosSimulados[0].adjunto))).toBe(true);
    // sin revisión simulada nada sale
    const sin = correr(['--muestra', m, '--padron', p, '--correos', c, '--salida', join(carpeta, 'salida2'), '--provisional']);
    expect(sin.salida).toContain('correos simulados: 0');
  }, 120_000);
});
