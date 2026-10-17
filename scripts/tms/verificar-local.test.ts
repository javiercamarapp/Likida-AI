import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

// T-TMS-17: el verificador local imprime SOLO conteos. Todo sintético; las credenciales de prueba son inventadas.
const SCRIPT = resolve(process.cwd(), 'scripts/tms/verificar-local.mjs');
const carpeta = mkdtempSync(join(tmpdir(), 'tms-verificar-'));
afterAll(() => rmSync(carpeta, { recursive: true, force: true }));

function correr(args: string[], env: Record<string, string> = {}) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], {
    env: { NODE_ENV: 'test', PATH: process.env.PATH ?? '', ...env }, encoding: 'utf8', timeout: 90_000,
  });
  return { codigo: r.status, salida: `${r.stdout}\n${r.stderr}`, stdout: r.stdout };
}

function archivoCredenciales(nombre: string, contenido: string, modo: number): string {
  const ruta = join(carpeta, nombre);
  writeFileSync(ruta, contenido);
  chmodSync(ruta, modo);
  return ruta;
}

describe('verificar-local.mjs', () => {
  it('--falso: 20/20 válidas, sumas cuadran, bitácora de referencia cuadra, sin valores sensibles', () => {
    const r = correr(['--falso']);
    expect(r.codigo).toBe(0);
    expect(r.stdout).toContain('probar(): OK');
    expect(r.stdout).toContain('20/20 válidas, sumas cuadran');
    expect(r.stdout).toContain('bitácoras leídas: 20; rechazadas: 0');
    expect(r.stdout).toContain('bitácora de referencia contra el desglose impreso: cuadra');
    // Nunca valores: ni credencial, ni host, ni importes, ni nombres sintéticos de operador.
    expect(r.salida).not.toMatch(/clave-sintetica|usuario-sintetico|tms\.ejemplo|Operador|tok-sintetico/);
    expect(r.salida).not.toMatch(/\d+\.\d{2}\b/);
  }, 120_000);

  it('el ensayo es determinista: dos corridas imprimen lo mismo', () => {
    expect(correr(['--falso']).stdout).toBe(correr(['--falso']).stdout);
  }, 120_000);

  it('sin TMS_CREDENCIALES_ARCHIVO se niega (2) y no llama a nadie', () => {
    const r = correr([]);
    expect(r.codigo).toBe(2);
    expect(r.salida).toContain('Falta TMS_CREDENCIALES_ARCHIVO');
  });

  it('con un archivo de modo distinto de 600 se niega SIN leerlo', () => {
    const ruta = archivoCredenciales('abierto.env', 'base_url=https://secreto.invalid\nusuario=u-secreto\nclave=c-secreta\n', 0o644);
    const r = correr([], { TMS_CREDENCIALES_ARCHIVO: ruta });
    expect(r.codigo).toBe(2);
    expect(r.salida).toContain('modo 600');
    expect(r.salida).not.toMatch(/secreto|secreta/);
  });

  it('con modo 600 pero sin un campo obligatorio se niega y nombra el campo, no el contenido', () => {
    const ruta = archivoCredenciales('incompleto.env', 'base_url=https://secreto.invalid\nusuario=u-secreto\n', 0o600);
    const r = correr([], { TMS_CREDENCIALES_ARCHIVO: ruta });
    expect(r.codigo).toBe(2);
    expect(r.salida).toContain('le falta el campo clave');
    expect(r.salida).not.toMatch(/secreto|secreta/);
  });

  it('un argumento desconocido da el uso (2)', () => {
    expect(correr(['--real']).codigo).toBe(2);
  });
});
