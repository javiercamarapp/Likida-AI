import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { CAPACIDADES_WORKER } from '@/lib/worker/llaves';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 18, B10. `worker_llave.capacidades` tiene dominio en la base desde
// la 0147 (`worker_llave_capacidades_dominio`), y ese dominio ESPEJA
// `CAPACIDADES_WORKER` (llaves.ts). Son dos listas en dos lenguajes: si alguien
// agrega la quinta capacidad en TypeScript y no en SQL, la llave nueva no se
// puede crear; si la agrega en SQL y no en TS, se guarda "con permiso" y
// `llaves.ts` la rechaza con 403 — el síntoma exacto que B10 describe. Esta
// prueba falla en cuanto las dos listas dejan de ser la misma.
// ═══════════════════════════════════════════════════════════════════════════

const MIGRACION = 'supabase/migrations/0147_prospecto_ciclos_avatares_worker_rpc.sql';

function capacidadesDelCheck(): string[] {
  const sql = readFileSync(MIGRACION, 'utf8');
  const m = /constraint worker_llave_capacidades_dominio[\s\S]*?capacidades <@ array\[([^\]]+)\]::text\[\]/.exec(sql);
  if (!m) throw new Error(`no encontré el CHECK worker_llave_capacidades_dominio en ${MIGRACION}`);
  return m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, ''));
}

describe('el dominio SQL de worker_llave.capacidades espeja CAPACIDADES_WORKER (0147, B10)', () => {
  it('las dos listas son exactamente la misma, sin orden', () => {
    expect([...capacidadesDelCheck()].sort()).toEqual([...CAPACIDADES_WORKER].sort());
  });

  it('el CHECK exige al menos una capacidad', () => {
    const sql = readFileSync(MIGRACION, 'utf8');
    expect(sql).toMatch(/cardinality\(capacidades\) > 0/);
  });
});
