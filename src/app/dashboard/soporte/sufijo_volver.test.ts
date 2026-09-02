import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 24 · H25 — "← Volver a mis tickets" perdía la previsualización.
//
// `SoportePage` (page.tsx) ya construye `sufijo` (tenant=/vista=) para que el
// link AL HILO de un ticket ("Ver hilo →" / el asunto) conserve la
// previsualización del superadmin — la trampa que `dashboard/sufijo.ts`
// documenta: `requireSessionTenant` arma su redirect con un string fijo, así
// que cualquier link crudo a una ruta del panel la pierde. El link
// "← Volver a mis tickets", que un superadmin usa DESPUÉS de leer el hilo, iba
// crudo a `/dashboard/soporte` — al volver, la previsualización desaparecía a
// media revisión.
//
// `page.tsx` es un Server Component async con lecturas reales de Supabase
// (comercial.ts, soporte.ts): probar el JSX renderizado exige mockear toda
// esa cadena para una sola línea de un link. Se prueba la fuente, como ya
// hace este repo para casos equivalentes (ver FE-1 en el informe de
// auditoría, "test que lee next.config.ts…") — el contrato es que el href
// del botón de volver use la MISMA variable `sufijo` que ya usa `enlaceHilo`,
// no una ruta pelada.
// ═══════════════════════════════════════════════════════════════════════════

const fuente = readFileSync(path.join(__dirname, 'page.tsx'), 'utf8');

describe('soporte/page.tsx — "Volver a mis tickets" conserva la previsualización', () => {
  it('declara enlaceVolver a partir del mismo `sufijo` que enlaceHilo', () => {
    expect(fuente).toMatch(/const enlaceVolver = `\/dashboard\/soporte\$\{sufijo \? `\?\$\{sufijo\}` : ''\}`;/);
  });

  it('el Link de "Volver a mis tickets" usa enlaceVolver, no la ruta pelada', () => {
    // Ancla el JSX real (el hijo de texto del <Link>), no la prosa del
    // comentario de arriba que también nombra "Volver a mis tickets" entre
    // comillas.
    const idx = fuente.indexOf('← Volver a mis tickets\n');
    expect(idx, 'debe existir el JSX del link').toBeGreaterThan(-1);
    const antes = fuente.slice(Math.max(0, idx - 200), idx);
    expect(antes).toMatch(/href=\{enlaceVolver\}/);
    expect(antes).not.toMatch(/href="\/dashboard\/soporte"/);
  });
});
