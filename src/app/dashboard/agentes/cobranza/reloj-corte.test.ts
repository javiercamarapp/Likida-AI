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

  // FE-31C2-A1: el acuse de `controles.tsx` vive en `useActionState` y se
  // evapora con el primer `router.refresh()`. Lo DURABLE es el renglón que
  // `registrarCorrida` escribe, y ese renglón decía «OK · 40/40» sobre una cola
  // de 400 que el reloj cortó a los 40. El veredicto se calcula ahora en
  // `corridaDeCobranza` (probado con valores en
  // `lib/likida/agentes/cobranza_bitacora.test.ts`); aquí se fija que la página
  // lo USE, porque una función correcta que nadie llama no arregla nada.
  it('la bitácora durable deriva su estado del resultado COMPLETO, no solo de `fallos`', () => {
    const src = leer('./page.tsx');
    const llamada = src.slice(src.indexOf("registrarCorrida(tenantId, 'cobranza'"));
    const fin = llamada.indexOf('});');
    const cuerpo = llamada.slice(0, fin > 0 ? fin : undefined);
    expect(cuerpo).toContain('corridaDeCobranza(resultado)');
    expect(
      cuerpo,
      'un `estado:` literal aquí es el bug de vuelta: el veredicto se deriva, no se teclea',
    ).not.toMatch(/\n\s*estado:/);
    expect(cuerpo).not.toMatch(/\n\s*tareasTotal:/);
  });
});
