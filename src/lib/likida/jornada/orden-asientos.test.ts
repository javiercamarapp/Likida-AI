import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// ═══════════════════════════════════════════════════════════════════════════
// REN-9 (auditoría 24, rendimiento.md) · `leerJornadas` paginaba los asientos
// con `traerTodo` (order + range) ordenados SOLO por `momento` — dos marcas
// con el mismo `momento` (dos sellos en el mismo milisegundo, posible en un
// flujo de WhatsApp) podían caer en páginas de `.range()` distintas en
// cualquier orden, duplicándose o saltándose entre vueltas. `pg.ts` documenta
// el contrato: `traerTodo` necesita un orden ÚNICO (desempate) para ser
// reproducible — el mismo patrón que ya se corrigió en `emergencias/page.tsx`
// (FE-31) y `bandeja.ts` (`.order('fecha').order('id')`).
// ═══════════════════════════════════════════════════════════════════════════

describe('jornada/repo.ts: los asientos paginan con orden único (REN-9)', () => {
  it('order(momento) va seguido de order(id) — desempate determinista', () => {
    const src = readFileSync(fileURLToPath(new URL('./repo.ts', import.meta.url)), 'utf8');
    expect(src).toMatch(/\.order\('momento',\s*\{\s*ascending:\s*true\s*\}\)\s*\n\s*\.order\('id',\s*\{\s*ascending:\s*true\s*\}\)/);
  });
});
