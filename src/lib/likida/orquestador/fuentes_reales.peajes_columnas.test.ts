import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

// A39-S51-01: `reclamacionPeajes` ordenaba `desglose_peaje` por `created_at`, que NO existe (la columna es `creado_en`, 0106).
// PostgREST contestaba 42703, `esSinTabla` lo trataba como «base sin migrar» y la herramienta decía siempre «peajes no activos».
// Un doble que contesta lo que se le pida no ve eso: aquí el doble RECUERDA las columnas usadas y se cotejan con el esquema real.
const llamadas: Array<{ tabla: string; op: string; arg: unknown }> = [];
function cadena(tabla: string): unknown {
  const p: unknown = new Proxy(function () { /* encadenable */ }, {
    get: (_t, k) => {
      if (k === 'then') return (ok: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null, count: null }).then(ok);
      return (...args: unknown[]) => { llamadas.push({ tabla, op: String(k), arg: args[0] }); return p; };
    },
    apply: () => p,
  });
  return p;
}
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: (t: string) => cadena(t), rpc: () => cadena('rpc') }) }));

const { crearFuentesReales } = await import('./fuentes_reales');

describe('reclamacionPeajes contra el esquema real de desglose_peaje', () => {
  it('A39-S51-01: ordena por una columna que EXISTE en la migración 0106 (creado_en), no por created_at', async () => {
    const sql = readFileSync('supabase/migrations/0106_desglose_peaje.sql', 'utf8');
    const bloque = sql.slice(sql.indexOf('create table if not exists public.desglose_peaje ('), sql.indexOf('create table if not exists public.desglose_peaje_linea'));
    llamadas.length = 0;
    await crearFuentesReales().reclamacionPeajes('00000000-0000-4000-8000-000000000001');
    const ordenes = llamadas.filter((l) => l.tabla === 'desglose_peaje' && l.op === 'order').map((l) => String(l.arg));
    expect(ordenes.length).toBeGreaterThan(0);
    for (const col of ordenes) expect(bloque, `la columna «${col}» no existe en desglose_peaje`).toMatch(new RegExp(`\\n\\s+${col}\\s`));
  });
});
