import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// T-A4-30: los plazos de aviso (el «5» y el «10» que se oyen en las llamadas son EJEMPLOS) se fijan por flota. Lo que cada capa
// dice que acepta tiene que ser lo mismo: la pantalla (texto de ayuda), la validación del servidor, el CHECK de la base y la
// guía de operación. Esta prueba ata las cuatro, como las pruebas de catálogo atan doc y código.
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({}) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/likida/contactos', () => ({ telefonoDeUsuario: vi.fn(), telefonoJefeDe: vi.fn() }));

const { validarConfig } = await import('@/lib/likida/vigia/repo');

const RAIZ = process.cwd();
const leer = (ruta: string) => readFileSync(join(RAIZ, ruta), 'utf8');
const num = (t: string) => Number(t.replace(/,/g, ''));

/** «Entre A y B» del texto de ayuda que sigue al campo `idCampo` en controles.tsx. */
function rangoEnPantalla(idCampo: string): [number, number] {
  const fuente = leer('src/app/dashboard/agentes/vigia/controles.tsx');
  const desde = fuente.indexOf(`id="${idCampo}"`);
  expect(desde, `campo ${idCampo} en controles.tsx`).toBeGreaterThan(-1);
  const m = /Entre ([\d,]+) y ([\d,]+)/.exec(fuente.slice(desde, desde + 900));
  expect(m, `rango «Entre A y B» tras ${idCampo}`).not.toBeNull();
  return [num(m![1]), num(m![2])];
}

/** `check (columna between A and B)` de una migración. */
function rangoEnCheck(migracion: string, columna: string): [number, number] {
  const m = new RegExp(`check \\(${columna} between (\\d+) and (\\d+)\\)`, 'i').exec(leer(`supabase/migrations/${migracion}`));
  expect(m, `CHECK de ${columna} en ${migracion}`).not.toBeNull();
  return [Number(m![1]), Number(m![2])];
}

const base = {
  habilitado: true, modoAprobacion: 'siempre', autoenviarMinAprobaciones: 5, slaRespuestaMin: 30, escalarNivel2Min: 60,
  slaCriticoMin: 10, molestiaAvisoNivel: 2, retencionDias: 180, avisoPrivacidadUrl: '',
};

describe('plazos de aviso: pantalla = validación = CHECK = guía de operación', () => {
  it('el plazo general (sla_respuesta_min) dice 5–1440 en la pantalla y en el CHECK de la 0400', () => {
    expect(rangoEnPantalla('cfg-sla')).toEqual(rangoEnCheck('0400_vigia_cliente.sql', 'sla_respuesta_min'));
    expect(rangoEnCheck('0400_vigia_cliente.sql', 'sla_respuesta_min')).toEqual([5, 1440]);
  });

  it('el plazo de clientes críticos (sla_critico_min) dice 2–1440 en la pantalla y en el CHECK de la 0484', () => {
    expect(rangoEnPantalla('cfg-crit')).toEqual(rangoEnCheck('0484_vigia_grupos_historial.sql', 'sla_critico_min'));
    expect(rangoEnCheck('0484_vigia_grupos_historial.sql', 'sla_critico_min')).toEqual([2, 1440]);
  });

  it('el servidor acepta justo los extremos del CHECK y rechaza uno más allá', () => {
    for (const [campo, [min, max]] of [['slaRespuestaMin', [5, 1440]], ['slaCriticoMin', [2, 1440]]] as const) {
      expect(validarConfig({ ...base, [campo]: min }).ok, `${campo}=${min}`).toBe(true);
      expect(validarConfig({ ...base, [campo]: max }).ok, `${campo}=${max}`).toBe(true);
      expect(validarConfig({ ...base, [campo]: min - 1 }).ok, `${campo}=${min - 1}`).toBe(false);
      expect(validarConfig({ ...base, [campo]: max + 1 }).ok, `${campo}=${max + 1}`).toBe(false);
    }
  });

  it('el default del plazo crítico es 10 en la base y en el servidor (campo vacío)', () => {
    expect(/sla_critico_min integer not null default 10/.test(leer('supabase/migrations/0484_vigia_grupos_historial.sql'))).toBe(true);
    const r = validarConfig({ ...base, slaCriticoMin: '' });
    expect(r.ok && r.valor.slaCriticoMin).toBe(10);
  });

  it('la guía de operación documenta el rango real, que 5/10 son ejemplos, que rige el menor y el solo avisar', () => {
    const doc = leer('docs/operacion/vigia-cliente.md');
    expect(doc).toMatch(/`sla_critico_min` \*\*2–1440\*\*/);
    expect(doc).toMatch(/`sla_respuesta_min`\s+\*\*5–1440\*\*/);
    expect(doc).toMatch(/ejemplos hablados/);
    expect(doc).toMatch(/\*\*menor\*\*/);
    expect(doc).toMatch(/`solo_avisar`/);
    expect(doc).not.toMatch(/`sla_critico_min`, mínimo 5/);
  });
});
