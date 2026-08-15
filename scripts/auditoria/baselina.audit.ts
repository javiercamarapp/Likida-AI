// ═══════════════════════════════════════════════════════════════════════════
// FASE 0 — LÍNEA BASE REAL. Sin esto, la ronda no tiene piso.
//
// Corre las compuertas del repo y guarda la EVIDENCIA (salida exacta) en
// docs/auditoria-N/evidencia/. Nada de "la suite pasó": el .log lo prueba.
// `AUDIT_SKIP_BASELINE=1` la salta (rondas iterativas) pero avisa.
// `AUDIT_SKIP_BUILD=1` salta únicamente el `next build` (pesado).
// ═══════════════════════════════════════════════════════════════════════════

import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirRonda, rondaActual, CLAVAS_INYECTADAS } from './config.audit';

export interface BaselineResultado {
  ok: boolean;
  corrida: boolean;
  resumen: string[];
}

function cComando(cmd: string, args: string[], rutaLog: string, quitar: string[] = []): boolean {
  const t0 = Date.now();
  const env = { ...process.env };
  for (const k of quitar) delete env[k];
  const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 90 * 60_000, maxBuffer: 96 * 1024 * 1024, cwd: process.cwd(), env });
  const salida = `$ ${cmd} ${args.join(' ')}\n[TIMING ${((Date.now() - t0) / 1000).toFixed(1)}s] exit=${r.status}\n\n${r.stdout ?? ''}\n${r.stderr ?? ''}`;
  mkdirSync(rutaLog.slice(0, rutaLog.lastIndexOf('/')), { recursive: true });
  writeFileSync(rutaLog, salida);
  return r.status === 0;
}

export function correrBaseline(n = rondaActual()): BaselineResultado {
  if (process.env.AUDIT_SKIP_BASELINE === '1') {
    process.stderr.write('[audit] AUDIT_SKIP_BASELINE=1 → baseline saltado\n');
    return { ok: true, corrida: false, resumen: ['baseline saltado (flag)'] };
  }
  const dir = `${dirRonda(n)}/evidencia`;
  const resumen: string[] = [];
  // Baseline con env LIMPIO: las claves que inyectó cargaEnvLocal NO deben
  // llegar al demonio de suite (o la prueba “sin llave no está configurado”
  // ve la llave y falla). Solo limpiamos lo que nosotros inyectamos.
  const okVitest = cComando('npx', ['vitest', 'run', '--reporter=dot'], `${dir}/baseline-vitest.log`, CLAVAS_INYECTADAS);
  resumen.push(`vitest: ${okVitest ? '✅' : '❌'}`);
  const okTsc = cComando('npx', ['tsc', '--noEmit'], `${dir}/baseline-tsc.log`, CLAVAS_INYECTADAS);
  resumen.push(`tsc: ${okTsc ? '✅' : '❌'}`);
  const okLint = cComando('npm', ['run', 'lint'], `${dir}/baseline-eslint.log`, CLAVAS_INYECTADAS);
  resumen.push(`eslint: ${okLint ? '✅' : '❌'}`);
  let okBuild = true;
  if (process.env.AUDIT_SKIP_BUILD === '1') {
    writeFileSync(`${dir}/baseline-build.log`, '[SKIP] AUDIT_SKIP_BUILD=1');
    resumen.push('build: ⏭️ (flag)');
  } else {
    okBuild = cComando('npm', ['run', 'build'], `${dir}/baseline-build.log`, CLAVAS_INYECTADAS);
    resumen.push(`build: ${okBuild ? '✅' : '❌'}`);
  }
  return { ok: okVitest && okTsc && okLint && okBuild, corrida: true, resumen };
}