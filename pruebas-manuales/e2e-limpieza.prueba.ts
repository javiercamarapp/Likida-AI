// TEMPORAL — borra TODO lo sembrado por el e2e. Se borra a sí mismo después.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
for (const l of readFileSync('.env.local', 'utf8').split('\n')) {
  const i = l.indexOf('=');
  if (i > 0 && !l.startsWith('#')) process.env[l.slice(0, i)] ||= l.slice(i + 1).split('#')[0].trim();
}
const TENANT = '1ea1b146-8ce6-4958-be53-9d0ec83625f3';

describe('limpieza', () => {
  it('borra storage del tenant de prueba', async () => {
    const { supabaseAdmin } = await import('@/lib/supabase/admin');
    const admin = supabaseAdmin();
    for (const bucket of ['comprobantes', 'liquidaciones']) {
      const borrar: string[] = [];
      // list recursivo: prefijo tenant/, luego tenant/viaje/
      const { data: n1 } = await admin.storage.from(bucket).list(TENANT, { limit: 1000 });
      for (const e of n1 ?? []) {
        if (e.id === null) {
          const { data: n2 } = await admin.storage.from(bucket).list(`${TENANT}/${e.name}`, { limit: 1000 });
          for (const f of n2 ?? []) borrar.push(`${TENANT}/${e.name}/${f.name}`);
        } else borrar.push(`${TENANT}/${e.name}`);
      }
      if (borrar.length) {
        const { error } = await admin.storage.from(bucket).remove(borrar);
        console.log(bucket, '→ borrados', borrar.length, error ? `ERROR ${error.message}` : 'ok');
      } else console.log(bucket, '→ nada que borrar');
    }
    expect(true).toBe(true);
  }, 120_000);
});
