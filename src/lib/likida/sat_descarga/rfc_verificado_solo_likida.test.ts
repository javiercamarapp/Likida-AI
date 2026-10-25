// A39-S57-01 (CRÍTICO): `tenant.rfc_sat_verificado` es el único RFC que autoriza
// un buzón del SAT. Ningún código de flota (pantallas, acciones, chat, APIs del
// dashboard) puede escribirlo: solo el alta de Likida (administracion.ts) y los
// lectores. Si alguien lo añade a un update/upsert de una ruta de flota, el
// candado vuelve a quedar vacío (la misma trampa que tenía `tenant.rfc`).
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';

describe('A39-S57-01 · rfc_sat_verificado no lo escribe ninguna ruta de flota', () => {
  it('solo lo menciona el alta de Likida, el lector del buzón y sus pruebas', () => {
    const salida = execFileSync('git', ['grep', '-l', 'rfc_sat_verificado', '--', 'src'], { encoding: 'utf8' });
    const archivos = salida.split('\n').filter((f) => f !== '' && !/\.test\.tsx?$/.test(f)).sort();
    expect(archivos).toEqual([
      'src/lib/likida/administracion.ts',
      'src/lib/likida/sat_descarga/rfc_tenant.ts',
    ]);
  });
});
