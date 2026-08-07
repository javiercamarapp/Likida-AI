import { describe, it, expect, afterEach } from 'vitest';
import { esperarIntake } from './conv';

// Prueba de RÁFAGA (barrera de intake). Se inyecta un `probe` (lector del contador)
// para no tocar la DB. Modela la carrera fotos+"listo": el "listo" puede leer el
// contador ANTES de que una foto registre su +1.
//
// `probe` devuelve valores de una secuencia: cada llamada consume el siguiente.
const secuencia = (vals: number[]) => {
  let i = 0;
  return async () => vals[Math.min(i++, vals.length - 1)];
};

const GRACE = 'CUADRA_INTAKE_GRACE_MS';
afterEach(() => { delete process.env[GRACE]; });

describe('esperarIntake — ráfaga', () => {
  it('EN LOTE con gracia ON: espera a la foto que registró tarde (no cierra sobre parciales)', async () => {
    process.env[GRACE] = '30';
    // contador arranca en 0 (foto aún no incrementa) → tras la gracia aparece en 1
    // (foto ya registró) → luego 0 (foto terminó). Debe ESPERAR a ese 1→0.
    const probe = secuencia([0, 1, 0]);
    const ok = await esperarIntake('v', 5_000, probe);
    expect(ok).toBe(true); // se vació, pero DESPUÉS de ver la foto tardía
  });

  it('SIN gracia (default): un 0 inicial cierra de inmediato (comportamiento actual)', async () => {
    // Sin CUADRA_INTAKE_GRACE_MS, un contador 0 se toma al pie de la letra.
    const probe = secuencia([0]);
    const ok = await esperarIntake('v', 5_000, probe);
    expect(ok).toBe(true);
  });

  it('SEPARADA con gracia ON y sin fotos: la gracia no estorba, cierra en true', async () => {
    process.env[GRACE] = '30';
    const probe = secuencia([0, 0]);
    const ok = await esperarIntake('v', 5_000, probe);
    expect(ok).toBe(true);
  });

  it('barrera normal: espera mientras el contador sea > 0 y cierra al llegar a 0', async () => {
    const probe = secuencia([3, 2, 0]);
    const ok = await esperarIntake('v', 5_000, probe);
    expect(ok).toBe(true);
  });

  it('timeout: si el contador nunca baja, devuelve false (no espera infinito)', async () => {
    const probe = secuencia([5]); // siempre 5
    const ok = await esperarIntake('v', 80, probe); // tope corto
    expect(ok).toBe(false);
  });
});
