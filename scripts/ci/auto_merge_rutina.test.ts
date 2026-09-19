import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, mkdtempSync, chmodSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ═══════════════════════════════════════════════════════════════════════════
// OP-32C3-A1 (auditoría 32 c3, ALTO) — LA RAMA DE REINTENTO ES CÓDIGO MUERTO
// POR SEGUNDA VEZ, AHORA POR `set -e`.
//
// El propio comentario del paso cuenta la primera vuelta: `CODE=$?` vivía
// DESPUÉS del `fi` de un `if COMANDO; then …; fi`, así que nunca veía el 8 real
// de `gh pr checks`. Se arregló separando el comando del `if`… y con eso el
// comando quedó DESNUDO en el cuerpo de un `for`.
//
// GitHub corre los `run:` de Linux con `bash -e {0}` cuando el paso no declara
// `shell:`, y este no lo declara. Bajo `set -e`, un comando suelto que devuelve
// distinto de cero mata el paso EN ESA LÍNEA: `CODE=$?` no llega a ejecutarse,
// el `if [ "$CODE" = "8" ]` no existe, y el comentario «🔴 no se mergea»
// tampoco. El paso muere con `exit 8` y SIN UNA SOLA LÍNEA DE SALIDA.
//
// Medido en dos corridas fechadas de `auto-merge-rutina.yml`: #1678
// (11-sep 03:39:47Z) y #1480 (8-sep 03:44:44Z), las dos con exit code 8 y cero
// salida del script.
//
// Consecuencia: los PR de las rutinas NO se mergean solos cuando los checks
// siguen en curso —que es el caso normal, porque el workflow se dispara al
// terminar UNO de ellos— y nadie se entera de por qué. Se apilan abiertos.
//
// ESTA PRUEBA NO ES UN `grep` DEL FUENTE: extrae el script real del YAML y lo
// EJECUTA bajo `bash -e` con un `gh` de mentira, que es la única forma de
// distinguir «la rama existe en el texto» de «la rama se alcanza».
// ═══════════════════════════════════════════════════════════════════════════

/**
 * El `run:` del paso que mergea, tal cual vive en el workflow.
 *
 * Se extrae con el indentado, SIN un parser de YAML: meter `@types/js-yaml`
 * para leer un bloque literal sería una dependencia nueva por una prueba.
 */
function guionDelMerge(): string {
  const yml = readFileSync('.github/workflows/auto-merge-rutina.yml', 'utf8').split('\n');
  const ini = yml.findIndex((l) => /^\s*- name: .*Mergear el PR/.test(l));
  expect(ini, 'no se encontró el paso que mergea en auto-merge-rutina.yml').toBeGreaterThan(-1);
  const sangriaPaso = (/^(\s*)- /.exec(yml[ini]) ?? ['', ''])[1].length;

  // El paso termina donde empieza el siguiente al mismo nivel, o el siguiente job.
  let fin = yml.length;
  for (let i = ini + 1; i < yml.length; i++) {
    const l = yml[i];
    if (l.trim() === '') continue;
    const sangria = l.length - l.trimStart().length;
    if (sangria <= sangriaPaso && /^\s*(- |[a-zA-Z_-]+:)/.test(l)) { fin = i; break; }
  }
  const paso = yml.slice(ini, fin);

  expect(
    paso.some((l) => /^\s*shell:/.test(l)),
    'si el paso declarara `shell:` habría que revisar este invariante entero: el bug depende del `bash -e` que GitHub pone por omisión',
  ).toBe(false);

  const iRun = paso.findIndex((l) => /^\s*run:\s*\|/.test(l));
  expect(iRun, 'el paso que mergea ya no tiene un bloque `run: |`').toBeGreaterThan(-1);
  const cuerpo = paso.slice(iRun + 1);
  const sangriaCuerpo = Math.min(
    ...cuerpo.filter((l) => l.trim() !== '').map((l) => l.length - l.trimStart().length),
  );
  return cuerpo.map((l) => l.slice(sangriaCuerpo)).join('\n');
}

/**
 * Corre el guion bajo `bash -e` —el shell que GitHub usa cuando el paso no
 * declara `shell:`— con un `gh` de mentira cuyos códigos de salida se dictan
 * por parámetro, y con `sleep` en no-op para no esperar los 20 s de verdad.
 */
function correr(codigosDeChecks: number[]): { code: number; salida: string } {
  const dir = mkdtempSync(join(tmpdir(), 'auto-merge-'));
  const guion = guionDelMerge();

  // `gh` de mentira: `pr list` devuelve un número de PR; `pr checks` consume la
  // lista de códigos, uno por llamada; lo demás sale 0 y se anota.
  writeFileSync(join(dir, 'gh'), [
    '#!/usr/bin/env bash',
    `CODIGOS=(${codigosDeChecks.join(' ')})`,
    'CONT_FILE="$TMPDIR_GH/cuenta"',
    'if [ "$1" = "pr" ] && [ "$2" = "list" ]; then echo 477; exit 0; fi',
    'if [ "$1" = "pr" ] && [ "$2" = "checks" ]; then',
    '  n=$(cat "$CONT_FILE"); echo $((n+1)) > "$CONT_FILE"',
    '  echo "gh pr checks (llamada $((n+1)))"',
    '  exit "${CODIGOS[$n]:-0}"',
    'fi',
    'echo "gh $*" >> "$TMPDIR_GH/otras"',
    'exit 0',
  ].join('\n'));
  chmodSync(join(dir, 'gh'), 0o755);
  // `sleep` en no-op: el guion espera 20 s entre intentos.
  writeFileSync(join(dir, 'sleep'), '#!/usr/bin/env bash\nexit 0\n');
  chmodSync(join(dir, 'sleep'), 0o755);
  writeFileSync(join(dir, 'cuenta'), '0\n');
  writeFileSync(join(dir, 'guion.sh'), guion);

  let code = 0;
  let salida = '';
  try {
    salida = execFileSync('bash', ['-e', join(dir, 'guion.sh')], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${dir}:${process.env.PATH ?? ''}`, TMPDIR_GH: dir, REPO: 'x/y', RAMA: 'claude/x' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    code = err.status ?? -1;
    salida = `${err.stdout ?? ''}${err.stderr ?? ''}`;
  }
  return { code, salida };
}

describe('OP-32C3-A1 · auto-merge-rutina: la rama de «checks en curso» se ALCANZA bajo `bash -e`', () => {
  it('EL FALLO MEDIDO: con los checks en curso (8) el paso no puede morir en la primera vuelta', () => {
    // 8 = «alguno sigue en curso». El guion debe esperar y reintentar, no morir.
    const { code, salida } = correr([8, 8, 0]);
    expect(
      salida,
      'las corridas #1678 y #1480 murieron con exit 8 y CERO líneas de salida: la rama de reintento nunca se alcanzó',
    ).toContain('Checks todavía en curso');
    expect(code, 'un 8 es «espera», no «falló»').toBe(0);
    expect(salida).toContain('Todos los checks en verde');
  });

  it('un check en ROJO sigue rechazando el merge, y lo dice', () => {
    const { code, salida } = correr([1]);
    expect(salida).toContain('🔴 Hay checks en ROJO');
    expect(code).toBe(1);
  });

  it('todo en verde a la primera: se mergea', () => {
    const { code, salida } = correr([0]);
    expect(salida).toContain('Todos los checks en verde');
    expect(salida).toContain('merge squash');
    expect(code).toBe(0);
  });
});
