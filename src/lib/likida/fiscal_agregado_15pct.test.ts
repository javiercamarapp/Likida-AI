import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { MEDIOS_LISR_27_III, FORMA_PAGO_SIN_PAGAR } from './cuadre/engine';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 20, ARQ-C1 (CRÍTICO). Este archivo lo PROMETÍA la migración 0190,
// por su nombre, y no existía:
//
//   "Si `MEDIOS_LISR_27_III` (engine.ts:126) cambia, esta lista tiene que
//    cambiar con ella — no hay forma de importar la constante de TS a SQL, así
//    que `fiscal_agregado_15pct.test.ts` fija ambas listas lado a lado para que
//    una diferencia falle ruidoso en CI, no en silencio en producción."
//                    — 0190_15pct_efectivo_lista_lisr27iii.sql:22-25
//
// Sin él, la lista que decide qué combustible entra al cubo del 15% de la RFA
// 2026 regla 2.9 vivía tecleada TRES veces —`engine.ts`, el `.sql`, y una
// tercera copia dentro del mock de `repo_acumulado.test.ts`— y ninguna prueba
// cruzaba la frontera TypeScript↔SQL: `repo_acumulado` compara TS contra su
// propia copia en TS, y `migraciones_verificadas` delega en `repo_acumulado`.
//
// El modo de falla que esto ataca: alguien agrega una forma de pago a
// `MEDIOS_LISR_27_III` y no toca el `.sql`. TS deja de contar ese gasto en el
// 15%; la RPC lo sigue contando. El panel y el acumulado del ejercicio informan
// dos cifras distintas del MISMO cubo fiscal, y la suite pasa verde.
//
// Se lee el `.sql` como texto a propósito: es la única forma de comprobar,
// sin una base de datos, que las dos implementaciones dicen lo mismo.
// ═══════════════════════════════════════════════════════════════════════════

const RUTA_SQL = 'supabase/migrations/0190_15pct_efectivo_lista_lisr27iii.sql';
const sql = readFileSync(RUTA_SQL, 'utf8');

/** El `not in (...)` del `filter` que define el numerador del 15%. */
function listaDelSql(): string[] {
  const m = sql.match(/forma_pago\s+not\s+in\s*\(([^)]*)\)/i);
  if (!m) throw new Error(`${RUTA_SQL}: no se encontró el \`forma_pago not in (...)\` que define el cubo del 15%`);
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

describe('el cubo del 15% (RFA 2026 regla 2.9) dice lo mismo en TS y en SQL', () => {
  it('la lista de medios admitidos por la LISR 27-III es la MISMA en engine.ts y en la 0190', () => {
    expect([...listaDelSql()].sort()).toEqual([...MEDIOS_LISR_27_III].sort());
  });

  it("la 0190 excluye '99 Por definir' del numerador, igual que el motor", () => {
    // RMF 2.7.1.29 fr. II: '99' no es "un medio distinto", es que la
    // contraprestación NO se ha pagado. Contarlo inflaría el numerador contra
    // la flota. En TS es `FORMA_PAGO_SIN_PAGAR`; en SQL es un `<>` aparte,
    // ANTES del `not in`, y por eso no aparece en la lista de arriba.
    expect(FORMA_PAGO_SIN_PAGAR).toBe('99');
    expect(sql).toMatch(/forma_pago\s*<>\s*'99'/);
    expect(listaDelSql()).not.toContain('99');
  });

  it('la 0190 no cuenta un gasto sin forma de pago (NULL no es efectivo)', () => {
    // Mismo criterio que `causasDe` y que `getAcumuladoCombustible`: suponer
    // efectivo donde no se sabe le quita al cliente una deducción que sí tiene.
    expect(sql).toMatch(/forma_pago\s+is\s+not\s+null/i);
  });
});
