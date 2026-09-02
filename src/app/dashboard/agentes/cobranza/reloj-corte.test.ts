import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// ═══════════════════════════════════════════════════════════════════════════
// FE-14 (auditoría 24) · "Ejecutar ahora" llamaba `ejecutarCobranza(tenantId,
// new Date(), { ignorarVentana: true })` SIN `venceEn` — con cientos de
// choferes en tier, la function podía cortarse a la mitad (timeout de la
// plataforma) antes de que `registrarCorrida` se escribiera: la bitácora
// quedaba muda y el usuario veía un error genérico sin saber si algo salió.
// `ejecutarCobranza` ya sabía cortarse sola con `venceEn` (el cron global ya
// lo usa) y reportar `cortadosPorReloj`; solo faltaba pasarlo desde aquí.
// ═══════════════════════════════════════════════════════════════════════════

function leer(ruta: string): string {
  return readFileSync(fileURLToPath(new URL(ruta, import.meta.url)), 'utf8');
}

describe('Cobranza "Ejecutar ahora": reloj de corte declarado (FE-14)', () => {
  it('page.tsx pasa venceEn a ejecutarCobranza', () => {
    const src = leer('./page.tsx');
    expect(src).toMatch(/ejecutarCobranza\(tenantId,\s*new Date\(\),\s*\{[\s\S]{0,80}venceEn:/);
  });

  it('controles.tsx declara cortadosPorReloj cuando la corrida se cortó', () => {
    const src = leer('./controles.tsx');
    expect(src).toMatch(/r\.cortadosPorReloj/);
  });
});
