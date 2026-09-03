import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 25 · OP-C1 (CRÍTICO) — el `[deploy]` de un PR abierto para
// publicar se perdía en el merge commit sin que nada lo avisara ANTES. Este
// workflow no toca la compuerta (que sigue leyendo solo la primera línea a
// propósito): solo avisa con tiempo de sobra. Prueba de cableado, no de
// comportamiento en vivo (correr un workflow de verdad no cabe en `npm test`).
// ═══════════════════════════════════════════════════════════════════════════

describe('aviso-deploy-en-pr.yml — cableado', () => {
  const wf = readFileSync('.github/workflows/aviso-deploy-en-pr.yml', 'utf8');

  it('dispara en el PR (no en el push): es un aviso previo al merge, no un cotejo posterior', () => {
    expect(wf).toContain('pull_request:');
    expect(wf).toMatch(/types:\s*\[opened, edited, synchronize, reopened\]/);
  });

  it('mira el TÍTULO del PR con la misma regex que decidir() aplica al asunto', () => {
    expect(wf).toContain('PR_TITLE: ${{ github.event.pull_request.title }}');
    expect(wf).toContain(String.raw`\[deploy(:forzar)?\]`);
  });

  it('no falla el job (no es bloqueante): solo avisa por comentario y ::warning::', () => {
    expect(wf).not.toContain('exit 1');
    expect(wf).toContain('::warning::');
    expect(wf).toContain('gh pr comment');
  });

  it('no duplica el aviso en cada push a la misma rama', () => {
    expect(wf).toContain('no se duplica');
  });

  it('permisos acotados a comentar el PR, nada de contents/issues de más', () => {
    expect(wf).toMatch(/permissions:\s*\n\s*pull-requests:\s*write/);
  });
});
