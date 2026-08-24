import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ESCENARIOS_QA, POLITICA_DEMO, escenarioPorId } from './qa-escenarios';

describe('los escenarios del selector', () => {
  test('el selector ofrece los que TIENEN guion, y `escenarioPorId` no inventa', () => {
    expect(ESCENARIOS_QA.map((e) => e.id).sort()).toEqual(['demo_guion', 'feliz', 'foto_duplicada']);
    expect(escenarioPorId('demo_guion')?.nombre).toMatch(/demo/i);
    expect(escenarioPorId('inexistente')).toBeNull();
  });

  test('el guion del demo trae los valores del guion REAL (catálogo §2)', () => {
    const demo = escenarioPorId('demo_guion')!;
    expect(demo.anticipoDefault).toBe(10_600);
    expect(demo.rfcEmpresaDefault).toBe('GMX0902279I1');
    expect(demo.politicaDefault.find((p) => p.concepto === 'diesel')?.topeMonto).toBe(4000);
    expect(demo.politicaDefault.find((p) => p.concepto === 'caseta')?.topeMonto).toBe(1500);
    expect(demo.politicaDefault.find((p) => p.concepto === 'factura')?.requiereCfdi).toBe(true);
  });

  test('"feliz" NO inventa anticipo — el default es null y Javier lo fija', () => {
    expect(escenarioPorId('feliz')!.anticipoDefault).toBeNull();
  });
});

describe('la política del demo no deriva de su fuente (api/demo/route.ts)', () => {
  // POLITICA_DEMO es una COPIA (el route solo exporta handlers). Esta prueba
  // fija las dos: si alguien cambia la política del demo, esto truena y
  // obliga a actualizar el escenario — el guion y el QA no pueden divergir
  // en silencio.
  const fuente = readFileSync(join(process.cwd(), 'src/app/api/demo/route.ts'), 'utf8');

  test('cada entrada copiada existe literal en la fuente', () => {
    for (const p of POLITICA_DEMO) {
      if (p.topeMonto !== undefined) {
        expect(fuente).toContain(`{ concepto: '${p.concepto}', topeMonto: ${p.topeMonto} }`);
      } else if (p.requiereCfdi) {
        expect(fuente).toContain(`{ concepto: '${p.concepto}', requiereCfdi: true }`);
      } else {
        expect(fuente).toContain(`{ concepto: '${p.concepto}' }`);
      }
    }
  });

  test('la fuente no tiene conceptos que la copia no tenga (mismo conteo)', () => {
    const enFuente = [...fuente.matchAll(/\{ concepto: '([a-z]+)'/g)].map((m) => m[1]);
    expect(new Set(enFuente)).toEqual(new Set(POLITICA_DEMO.map((p) => p.concepto)));
  });

  test('el RFC del demo también está en la fuente (empresaRfc del guion)', () => {
    expect(fuente).toContain("empresaRfc: 'GMX0902279I1'");
  });
});

describe('el guion es el contrato — un invariante declarado tiene que estar atacado', () => {
  test('todo escenario trae guion, y el guion siempre cierra', () => {
    for (const e of ESCENARIOS_QA) {
      expect(e.guion.length, e.id).toBeGreaterThan(0);
      expect(e.guion.at(-1)?.tipo, e.id).toBe('cierre');
      expect(e.minFotos, e.id).toBeGreaterThan(0);
    }
  });

  test('#3 (dedup) SOLO lo declara quien repite una foto — nadie reporta un ataque que no hizo', () => {
    for (const e of ESCENARIOS_QA) {
      const repite = e.guion.some((p) => p.tipo === 'foto_repetida');
      expect(e.invariantes.includes('#3'), `${e.id}: declara #3 sin repetir foto`).toBe(repite);
    }
  });

  test('quien cruza de viaje pide el segundo chofer, y quien no, no lo siembra', () => {
    for (const e of ESCENARIOS_QA) {
      const cruza = e.guion.some((p) => p.tipo === 'foto_repetida' && p.comoOtroChofer);
      expect(e.segundoChofer, e.id).toBe(cruza);
    }
  });

  test('el guion no puede repetir una foto que el mínimo no garantiza', () => {
    for (const e of ESCENARIOS_QA) {
      for (const p of e.guion) {
        if (p.tipo === 'foto_repetida') expect(p.indice, e.id).toBeLessThan(e.minFotos);
      }
    }
  });
});
