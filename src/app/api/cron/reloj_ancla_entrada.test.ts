import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// A37-S09-06 — el reloj `venceEn` de un cron se ancla a la ENTRADA de la invocación, no después del prólogo
// (puerta + lecturas de interruptor). Con la base degradada el prólogo tarda 20-28 s y, anclado después,
// `venceEn` caía fuera del `maxDuration`: Vercel mataba la corrida a mitad de un barrido ya reclamado.
// (`asistencia` ya lo tenía: REN-31-C1.)
const CRONS = ['asistencia', 'conductor-hitos', 'jornada-alertas', 'descarga-sat', 'gps', 'tms', 'carta-porte-docs', 'runner'];

describe('A37-S09-06: venceEn parte de la entrada del GET', () => {
  for (const nombre of CRONS) {
    const fuente = readFileSync(join(__dirname, nombre, 'route.ts'), 'utf8');
    const get = fuente.slice(fuente.indexOf('export async function GET'));

    it(`${nombre}: captura la entrada antes de la puerta`, () => {
      const iEntrada = get.indexOf('const entrada = Date.now()');
      const iPuerta = get.indexOf('await puertaCron(');
      expect(iEntrada).toBeGreaterThan(-1);
      expect(iPuerta).toBeGreaterThan(iEntrada);
    });

    it(`${nombre}: ningún venceEn se calcula con Date.now() suelto`, () => {
      const lineas = get.split('\n').filter((l) => /\bvenceEn\s*=/.test(l) && !l.trim().startsWith('//'));
      expect(lineas.length).toBeGreaterThan(0);
      for (const l of lineas) expect(l).not.toMatch(/Date\.now\(\)/);
    });
  }
});
