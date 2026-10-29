import { describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// OP40-02 (cierre100, ola 10): el pulso de salud lee la historia de git. Con `execSync` y maxBuffer 1 MiB reventaba (ENOBUFS)
// hacia ~8 000 commits; debe soportar 20 000 (y más) sin tope.
const script = resolve('scripts/ci/ultimo-deploy-en-asunto.mjs');

/** Un repo temporal con `n` commits creados con `git fast-import` (segundos, no minutos). El más VIEJO lleva `[deploy]`. */
function repoConCommits(n: number, flagEn: 'viejo' | 'ninguno' | 'reciente'): { dir: string; shaFlag: string | null } {
  const dir = mkdtempSync(join(tmpdir(), 'pulso-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  const lineas: string[] = [];
  for (let i = 1; i <= n; i++) {
    const asunto = `cambio numero ${i} con un asunto razonablemente largo para parecerse a un historial real del repositorio`
      + (i === 1 && flagEn === 'viejo' ? ' [deploy]' : '') + (i === n && flagEn === 'reciente' ? ' [deploy]' : '');
    lineas.push('commit refs/heads/main', `mark :${i}`, 'committer T <t@example.invalid> ' + (1_700_000_000 + i) + ' +0000', `data ${Buffer.byteLength(asunto)}`, asunto);
    if (i > 1) lineas.push(`from :${i - 1}`);
    lineas.push('');
  }
  lineas.push('done', '');
  execFileSync('git', ['fast-import', '--quiet', '--done', '--export-marks=marcas.txt'], { cwd: dir, input: lineas.join('\n'), maxBuffer: 256 * 1024 * 1024 });
  execFileSync('git', ['symbolic-ref', 'HEAD', 'refs/heads/main'], { cwd: dir });
  execFileSync('git', ['reset', '-q', '--hard', 'main'], { cwd: dir });
  let shaFlag: string | null = null;
  if (flagEn !== 'ninguno') {
    const marcas = execFileSync('cat', ['marcas.txt'], { cwd: dir, encoding: 'utf8' }).split('\n');
    const marca = flagEn === 'viejo' ? ':1 ' : `:${n} `;
    shaFlag = marcas.find((m) => m.startsWith(marca))!.split(' ')[1]!;
  }
  return { dir, shaFlag };
}

describe('OP40-02: ultimo-deploy-en-asunto.mjs con un historial grande', () => {
  it('20 000 commits (más de 1 MiB de git log) y el [deploy] en el commit más viejo: lo encuentra', () => {
    const { dir, shaFlag } = repoConCommits(20_000, 'viejo');
    try {
      const salidaLog = execFileSync('git', ['log', '--format=%H%x1f%s'], { cwd: dir, maxBuffer: 256 * 1024 * 1024 }).length;
      expect(salidaLog).toBeGreaterThan(1024 * 1024);   // si no pasa de 1 MiB, la prueba no prueba nada
      const r = spawnSync('node', [script], { cwd: dir, encoding: 'utf8' });
      expect(r.status).toBe(0);
      expect(r.stdout.trim()).toBe(shaFlag);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 120_000);

  it('20 000 commits sin ninguna bandera: no imprime nada y sale bien (antes ENOBUFS)', () => {
    const { dir } = repoConCommits(20_000, 'ninguno');
    try {
      const r = spawnSync('node', [script], { cwd: dir, encoding: 'utf8' });
      expect(r.status).toBe(0);
      expect(r.stdout.trim()).toBe('');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 120_000);

  it('con la bandera en el commit más reciente corta de inmediato y devuelve ese sha', () => {
    const { dir, shaFlag } = repoConCommits(2_000, 'reciente');
    try {
      const r = spawnSync('node', [script], { cwd: dir, encoding: 'utf8' });
      expect(r.status).toBe(0);
      expect(r.stdout.trim()).toBe(shaFlag);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 60_000);

  it('fuera de un repo de git sale con error (no finge que no hay [deploy])', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sin-git-'));
    try {
      const r = spawnSync('node', [script], { cwd: dir, encoding: 'utf8' });
      expect(r.status).not.toBe(0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
