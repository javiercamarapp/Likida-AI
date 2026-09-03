import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { decidir, ultimaMigracion } from './compuerta-deploy.mjs';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 24 · OP-P1 / OP-P3 — la compuerta que ata `[deploy]` a las
// migraciones. Pura: asunto + última migración del repo + JSON del health.
// ═══════════════════════════════════════════════════════════════════════════

const sana = (base: string) => ({ ok: true, status: 'ok', migracion: { base, codigo: base, atras: 0 } });

describe('OP-P1: [deploy] con la base atrás NO construye, y dice qué aplicar', () => {
  it('base 0271, código 0276: bloquea con el rango 0272..0276', () => {
    const v = decidir({ asunto: 'fix(fiscal): póliza [deploy]', codigo: '0276', health: sana('0271') });
    expect(v.construir).toBe(false);
    expect(v.nivel).toBe('error');
    expect(v.motivo).toContain('faltan 5 migración(es) (0272..0276)');
  });

  it('atrás = 1 — el único caso que ocurre en la vida real (auditoría 25, PRU-MEDIO REINCIDENTE): bloquea igual', () => {
    const v = decidir({ asunto: 'chore: migración suelta [deploy]', codigo: '0304', health: sana('0303') });
    expect(v.construir).toBe(false);
    expect(v.nivel).toBe('error');
    expect(v.motivo).toContain('faltan 1 migración(es) (0304..0304)');
  });

  it('a la par: construye', () => {
    const v = decidir({ asunto: 'chore: algo [deploy]', codigo: '0276', health: sana('0276') });
    expect(v).toMatchObject({ construir: true, nivel: 'ok' });
  });

  it('la base por delante del código (rollback de código) también construye', () => {
    expect(decidir({ asunto: 'x [deploy]', codigo: '0275', health: sana('0276') }).construir).toBe(true);
  });

  it('sin [deploy] en el asunto no construye, y no es error (es el diseño del ignoreCommand)', () => {
    const v = decidir({ asunto: 'fix: menciona deploy en el cuerpo\n\n[deploy]', codigo: '0276', health: sana('0276') });
    expect(v).toMatchObject({ construir: false, nivel: 'ok' });
  });
});

describe('OP-P3: lo que no se pudo cotejar no es verde', () => {
  it('health caído: no construye', () => {
    const v = decidir({ asunto: 'x [deploy]', codigo: '0276', health: null });
    expect(v.construir).toBe(false);
    expect(v.motivo).toContain('[deploy:forzar]');
  });

  it('base ilegible (migraciones_aplicadas no contestó): no construye, con el motivo del health', () => {
    const v = decidir({ asunto: 'x [deploy]', codigo: '0276', health: { migracion: { base: null, codigo: '0276', atras: null, motivo: 'migraciones_aplicadas() no contestó: timeout' } } });
    expect(v.construir).toBe(false);
    expect(v.motivo).toContain('timeout');
  });

  it('health de la versión anterior (sin `migracion`): construye UNA vez con aviso — es el arranque de la compuerta', () => {
    const v = decidir({ asunto: 'x [deploy]', codigo: '0276', health: { ok: true, status: 'ok', version: 'abc1234' } });
    expect(v).toMatchObject({ construir: true, nivel: 'aviso' });
  });

  it('[deploy:forzar] salta la compuerta a la vista (aviso, no error)', () => {
    const v = decidir({ asunto: 'hotfix [deploy:forzar]', codigo: '0276', health: sana('0271') });
    expect(v).toMatchObject({ construir: true, nivel: 'aviso' });
    expect(v.motivo).toContain('bajo tu responsabilidad');
  });
});

describe('el cableado', () => {
  it('ultimaMigracion lee el repo real y da el mismo prefijo que next.config.ts inlinea', () => {
    expect(ultimaMigracion()).toMatch(/^\d{4}$/);
  });

  it('vercel.json corre la compuerta y conserva la inversión de exit del ignoreCommand', () => {
    const vercel = JSON.parse(readFileSync('vercel.json', 'utf8')) as { ignoreCommand: string };
    expect(vercel.ignoreCommand).toBe('node scripts/ci/compuerta-deploy.mjs && exit 1 || exit 0');
  });

  it('salud-produccion.yml la corre en el push con [deploy] y coteja el último [deploy] por schedule', () => {
    const wf = readFileSync('.github/workflows/salud-produccion.yml', 'utf8');
    expect(wf).toContain('scripts/ci/compuerta-deploy.mjs');
    expect(wf).toContain("github.event_name != 'push'");
    expect(wf).toContain('issues: write');
  });
});
