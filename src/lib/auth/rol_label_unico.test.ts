import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { ROL_LABEL, type RolAppUser } from './provisionar';

// ═══════════════════════════════════════════════════════════════════════════
// ARQUITECTURA 25 (BAJO, REINCIDENTE) — cuatro copias de `ROL_LABEL` que ya
// habían divergido: dos seguían nombrando `operador` (retirado en la 0086) y
// las tres sin tipar no traían `vendedor` (0105) — un superadmin `vendedor`
// salía con su rol crudo en pantalla. `provisionar.ts` ahora exporta la
// ÚNICA `ROL_LABEL`, exhaustiva (`Record<RolAppUser, string>`, TypeScript
// avisa si falta un rol). Este barrido evita que nazca una quinta copia
// declarada en otra pantalla.
// ═══════════════════════════════════════════════════════════════════════════

describe('ROL_LABEL tiene UNA sola fuente', () => {
  it('ningún archivo fuera de provisionar.ts declara su propio ROL_LABEL', () => {
    // `-w` para no atrapar `ROL_LABEL[` (el USO, que sí debe estar en varios
    // archivos) ni nombres parecidos.
    let salida = '';
    try {
      salida = execSync("grep -rln --include='*.ts' --include='*.tsx' -E '(const|let) ROL_LABEL' src", { encoding: 'utf8' });
    } catch (e) {
      // grep sale 1 cuando no encuentra nada — es el caso BUENO.
      const err = e as { status?: number; stdout?: string };
      if (err.status !== 1) throw e;
      salida = err.stdout ?? '';
    }
    const archivos = salida.split('\n').map((l) => l.trim()).filter(Boolean)
      .filter((f) => !f.endsWith('src/lib/auth/provisionar.ts'));
    expect(archivos, `estos archivos declaran su propio ROL_LABEL en vez de importar el de provisionar.ts: ${archivos.join(', ')}`).toEqual([]);
  });

  it('cubre TODO RolAppUser, incluye vendedor y NO nombra operador (retirado en la 0086)', () => {
    const roles: RolAppUser[] = ['superadmin', 'flota_admin', 'contador', 'encargado', 'vendedor'];
    for (const r of roles) expect(ROL_LABEL[r], `falta el rótulo de "${r}"`).toBeTruthy();
    expect(Object.keys(ROL_LABEL)).not.toContain('operador');
  });
});
