import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AVISO_AUTOMATICO_CONECTADO } from './conexion';
import { crearDepsVigia } from '../deps';

// CT-A345-03: la bandera de las pantallas debe decir lo mismo que el cableado real.
describe('el aviso automático de viaje: la bandera dice lo que el cableado hace', () => {
  it('crearDepsVigia() sin puerto real deja avisos en null: la pasada de avisos no corre y la bandera es false', () => {
    const sinPuerto = crearDepsVigia().avisos == null;
    expect(AVISO_AUTOMATICO_CONECTADO).toBe(!sinPuerto);
  });

  it('la ruta real del cron llama crearDepsVigia() sin puerto de avisos (si se cablea ahí, esta prueba obliga a subir la bandera)', () => {
    const ruta = readFileSync(join(process.cwd(), 'src/app/api/cron/vigia/route.ts'), 'utf8');
    const llamadas = ruta.match(/crearDepsVigia\(([^)]*)\)/g) ?? [];
    expect(llamadas.length).toBeGreaterThan(0);
    const conPuerto = llamadas.some((l) => !/^crearDepsVigia\(\s*\)$/.test(l));
    expect(AVISO_AUTOMATICO_CONECTADO).toBe(conPuerto);
  });
});
