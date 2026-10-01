import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// ═══════════════════════════════════════════════════════════════════════════
// EL REPO ES PÚBLICO: NADA PRIVADO SE RASTREA.
//
// Auditoría ola 1 (hallazgos 0 y 1): `staging_canacar/` (1,018 archivos, ~2,900
// correos y 867 nombres de director de terceros que no consintieron) y los
// informes `docs/auditoria-*/` (mapas de ataque con riesgos abiertos) estaban
// RASTREADOS en un repo público, aunque `.gitignore` ya declaraba
// `docs/auditoria-*/`: un .gitignore no des-rastrea lo que ya estaba en el índice.
//
// Esta prueba mira el ÍNDICE de git (no el disco) y el .gitignore. Si alguien
// vuelve a hacer `git add -f` o `git add -A` con el .gitignore roto, CI falla.
//
// La purga del HISTORIAL (git filter-repo + force-push) NO se hace aquí: la
// decide Javier. Ver ~/likida-loop/runbook-purga-historial.md.
// ═══════════════════════════════════════════════════════════════════════════

const PROHIBIDOS = [
  'staging_canacar',
  'docs/auditoria-*',
  'docs/comercial',
  'docs/REPORTE-ESTADO.md',
  'PROMPT-SESION-NUEVA.md',
];

function rastreados(): string[] | null {
  try {
    const salida = execFileSync('git', ['ls-files', '-z', '--', ...PROHIBIDOS], {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return salida.split('\0').filter(Boolean);
  } catch {
    return null; // sin git (tarball): no hay índice que auditar
  }
}

describe('el índice de git no contiene datos privados', () => {
  it('ningún archivo de staging_canacar/, docs/auditoria-*/ ni material comercial está rastreado', () => {
    const lista = rastreados();
    if (lista === null) return;
    expect(
      lista,
      lista.length === 0 ? '' :
        `Hay ${lista.length} archivos privados rastreados en un repo PÚBLICO (p. ej. ${lista[0]}). ` +
        'Corrige con `git rm -r --cached <ruta>`; no uses `git add -f`.',
    ).toEqual([]);
  });

  it('.gitignore declara cada ruta privada', () => {
    const gi = readFileSync(join(process.cwd(), '.gitignore'), 'utf8')
      .split('\n').map((l) => l.trim());
    for (const patron of ['staging_canacar/', 'docs/auditoria-*/', 'docs/comercial/']) {
      expect(gi, `falta ${patron} en .gitignore`).toContain(patron);
    }
  });
});
