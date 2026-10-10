/* eslint-disable security/detect-non-literal-fs-filename -- solo pruebas: scripts del propio repo por rutas armadas sobre constantes de este archivo. */
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// LOS VERIFICADORES NO PUEDEN PASAR EN FALSO. Un verificador que sale 0 con 0 filas «verifica» una base vacía.
// Se prueban con un psql de mentira que contesta lo que se le diga.
// ═══════════════════════════════════════════════════════════════════════════

const DIR = fileURLToPath(new URL('../../../../scripts/demo/innovativos/', import.meta.url));

/** Corre un script .mjs con un `psql` que imprime `salida` (JSON) sin importar qué se le pida. */
function conPsqlFalso(script: string, salida: string, args: string[] = []) {
  const bin = mkdtempSync(join(tmpdir(), 'psqlfalso-'));
  writeFileSync(join(bin, 'psql'), `#!/bin/sh\ncat <<'FIN'\n${salida}\nFIN\n`);
  chmodSync(join(bin, 'psql'), 0o755);
  return spawnSync('node', [`${DIR}${script}`, ...args], {
    env: { PATH: `${bin}:${process.env.PATH ?? ''}`, HOME: process.env.HOME ?? '', DEMO_DATABASE_URL: 'postgresql:///x' } as unknown as NodeJS.ProcessEnv,
    encoding: 'utf8',
  });
}

describe('verificar-cruces-con-motor.mjs', () => {
  it('con 0 líneas FALLA (antes imprimía «OK: las 0 líneas coinciden» y salía 0)', () => {
    const r = conPsqlFalso('verificar-cruces-con-motor.mjs', '[]');
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toMatch(/0 líneas|sin líneas/i);
    expect(r.stdout).not.toMatch(/^OK/m);
  });
  it('una línea cuyo veredicto sembrado no es el del motor FALLA', () => {
    // Sin posiciones el motor dice «sin_datos»; el sembrado dice «coincide»: tienen que diferir.
    const fila = JSON.stringify([{ indice: 1, sembrado: 'coincide', origen: 'normal', cruce_ms: 1760000000000, lat: 20, lng: -101, radio_m: 300, muestras: [] }]);
    const r = conPsqlFalso('verificar-cruces-con-motor.mjs', fila);
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/FALLA/);
  });
});

describe('verificar-hechos-del-guion.mjs', () => {
  it('contra una base vacía (psql que devuelve []) FALLA: no hay nada que verificar y no «pasa»', () => {
    const r = conPsqlFalso('verificar-hechos-del-guion.mjs', '[]');
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/FALLA/);
    expect(r.stdout).not.toMatch(/^OK/m);
  });
  it('una cifra de la base que el documento no dice FALLA (la verdad es la base, no el texto)', () => {
    // 140 viajes en curso en la base «falsa»; los documentos dicen otra cosa en el resto de conteos → debe fallar.
    const fila = JSON.stringify([{ terminales: 9, tractos: 9, operadores: 9, clientes: 9, geocercas: 9, en_curso: 9, cerrados: 9, hitos: 9, posiciones: 9, casetas: 9, tags: 9, veredictos: 9, validados: 9, sin_coincidencia: 9, contactos_escalamiento: 9, vigia_contactos: 9, vigia_conversaciones: 9, vigia_mensajes: 9, convenios: 9, instrucciones: 9 }]);
    const r = conPsqlFalso('verificar-hechos-del-guion.mjs', fila);
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/FALLA {2}140 viajes en curso|FALLA {2}terminales/);
  });
});
