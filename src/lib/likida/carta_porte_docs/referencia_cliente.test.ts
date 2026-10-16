import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  REFERENCIA_MAX,
  avisosReferencia,
  compararConSin,
  leerReferencia,
  tableroReferenciasPendientes,
  type ClienteRef,
  type ReglaReferencia,
  type ViajeReferencia,
} from './referencia_cliente';

// Datos sintéticos: ningún nombre ni referencia real.
const AHORA = new Date('2026-10-15T12:00:00Z');
const C1 = 'c-1';
const C2 = 'c-2';
const CLIENTES: ClienteRef[] = [{ id: C1, nombre: 'Cliente Sintetico 1' }, { id: C2, nombre: 'Cliente Sintetico 2' }];
const hace = (h: number): string => new Date(AHORA.getTime() - h * 3_600_000).toISOString();
const viaje = (id: string, cliente: string | null, carga: string | null, referencia: string | null = null, cap: string | null = null): ViajeReferencia =>
  ({ viajeId: id, clienteId: cliente, cargaHechaEn: carga, referencia, referenciaCapturadaEn: cap });
const EXIGE_C1: ReglaReferencia[] = [{ clienteId: C1, exige: true }, { clienteId: C2, exige: false }];

describe('T-A3-65 leerReferencia', () => {
  it('vacía o solo espacios = sin referencia (es opcional, no error)', () => {
    expect(leerReferencia('')).toEqual({ ok: true, referencia: null });
    expect(leerReferencia('   ')).toEqual({ ok: true, referencia: null });
    expect(leerReferencia(null)).toEqual({ ok: true, referencia: null });
  });
  it('limpia espacios de más', () => {
    expect(leerReferencia('  REF   0001 ')).toEqual({ ok: true, referencia: 'REF 0001' });
  });
  it('rechaza lo muy largo y los caracteres de control', () => {
    expect(leerReferencia('x'.repeat(REFERENCIA_MAX))).toEqual({ ok: true, referencia: 'x'.repeat(REFERENCIA_MAX) });
    expect(leerReferencia('x'.repeat(REFERENCIA_MAX + 1))).toEqual({ ok: false, motivo: 'larga' });
    expect(leerReferencia('RE\u0000F')).toEqual({ ok: false, motivo: 'caracteres_invalidos' });
  });
});

describe('T-A3-65 tablero de referencias pendientes', () => {
  it('cliente con exige_referencia y viaje cargado sin referencia → aparece, con su antigüedad', () => {
    const t = tableroReferenciasPendientes([viaje('v1', C1, hace(30))], EXIGE_C1, CLIENTES, AHORA);
    expect(t.total).toBe(1);
    expect(t.clientes).toEqual([{ clienteId: C1, clienteNombre: 'Cliente Sintetico 1', pendientes: 1, masAntiguoHoras: 30, viajes: [{ viajeId: 'v1', cargaHechaEn: hace(30), antiguedadHoras: 30 }] }]);
  });

  it('al capturar la referencia desaparece del tablero', () => {
    const t = tableroReferenciasPendientes([viaje('v1', C1, hace(30), 'REF-0001', hace(2))], EXIGE_C1, CLIENTES, AHORA);
    expect(t).toEqual({ total: 0, clientes: [] });
  });

  it('una referencia en blanco cuenta como faltante', () => {
    expect(tableroReferenciasPendientes([viaje('v1', C1, hace(5), '   ')], EXIGE_C1, CLIENTES, AHORA).total).toBe(1);
  });

  it('cliente sin la exigencia (regla en false o sin regla) → nada', () => {
    const viajes = [viaje('v1', C2, hace(30)), viaje('v2', 'c-3', hace(30))];
    expect(tableroReferenciasPendientes(viajes, EXIGE_C1, CLIENTES, AHORA)).toEqual({ total: 0, clientes: [] });
    expect(tableroReferenciasPendientes([viaje('v1', C1, hace(30))], [], CLIENTES, AHORA).total).toBe(0);
  });

  it('viaje sin carga hecha, sin cliente o con fecha ilegible no es pendiente', () => {
    const viajes = [viaje('v1', C1, null), viaje('v2', null, hace(10)), viaje('v3', C1, 'no-es-fecha')];
    expect(tableroReferenciasPendientes(viajes, EXIGE_C1, CLIENTES, AHORA).total).toBe(0);
  });

  it('ordena: cliente con el pendiente más antiguo primero, y dentro el viaje más antiguo', () => {
    const reglas: ReglaReferencia[] = [{ clienteId: C1, exige: true }, { clienteId: C2, exige: true }];
    const t = tableroReferenciasPendientes([viaje('a', C1, hace(10)), viaje('b', C2, hace(50)), viaje('c', C1, hace(20)), viaje('d', C2, hace(5))], reglas, CLIENTES, AHORA);
    expect(t.clientes.map((c) => c.clienteId)).toEqual([C2, C1]);
    expect(t.clientes[0].viajes.map((v) => v.viajeId)).toEqual(['b', 'd']);
    expect(t.clientes[1].viajes.map((v) => v.viajeId)).toEqual(['c', 'a']);
    expect(t.total).toBe(4);
  });

  it('una carga «en el futuro» (reloj desfasado) no da antigüedad negativa', () => {
    const t = tableroReferenciasPendientes([viaje('v1', C1, new Date(AHORA.getTime() + 3_600_000).toISOString())], EXIGE_C1, CLIENTES, AHORA);
    expect(t.clientes[0].masAntiguoHoras).toBe(0);
  });
});

describe('T-A3-65 aviso al ejecutivo', () => {
  it('un aviso por cliente con pendientes y NUNCA bloquea', () => {
    const t = tableroReferenciasPendientes([viaje('v1', C1, hace(30)), viaje('v2', C1, hace(8))], EXIGE_C1, CLIENTES, AHORA);
    const avisos = avisosReferencia(t);
    expect(avisos).toHaveLength(1);
    expect(avisos[0].bloquea).toBe(false);
    expect(avisos[0].texto).toContain('2 viajes cargados sin referencia');
    expect(avisos[0].texto).toContain('30 h');
    expect(avisos[0].texto).toContain('siguen su curso');
  });
  it('sin pendientes, sin avisos', () => {
    expect(avisosReferencia({ total: 0, clientes: [] })).toEqual([]);
  });
});

describe('T-A3-65 comparación «con y sin» la exigencia', () => {
  it('por cliente: cuántos la traen y cuánto tardan en capturarla', () => {
    const viajes = [
      viaje('v1', C1, hace(40), 'R1', hace(30)), // 10 h
      viaje('v2', C1, hace(20), 'R2', hace(16)), // 4 h
      viaje('v3', C1, hace(10)),
      viaje('v4', C2, hace(10), 'R4'), // sin marca de captura
      viaje('v5', C2, null), // sin carga: no cuenta
    ];
    const c = compararConSin(viajes, EXIGE_C1, CLIENTES);
    expect(c).toEqual([
      { clienteId: C1, clienteNombre: 'Cliente Sintetico 1', exige: true, cargados: 3, conReferencia: 2, sinReferencia: 1, pctConReferencia: 66.7, horasPromedioHastaCaptura: 7 },
      { clienteId: C2, clienteNombre: 'Cliente Sintetico 2', exige: false, cargados: 1, conReferencia: 1, sinReferencia: 0, pctConReferencia: 100, horasPromedioHastaCaptura: null },
    ]);
  });
  it('sin viajes cargados no hay filas', () => {
    expect(compararConSin([], EXIGE_C1, CLIENTES)).toEqual([]);
  });
});

describe('T-A3-65 la referencia no es del CCP', () => {
  const dir = __dirname;
  const fuentes = readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && !f.startsWith('referencia_cliente'));
  it('ningún módulo del documento fiscal (XML, convertidor, plantilla, exportación, campos) la menciona', () => {
    const fiscales = ['convertidor.ts', 'exportacion.ts', 'plantilla_tms.ts', 'campos.ts', 'derivar.ts', 'envio.ts'].filter((f) => fuentes.includes(f));
    expect(fiscales.length).toBeGreaterThanOrEqual(4);
    for (const f of fiscales) {
      expect(readFileSync(join(dir, f), 'utf8'), f).not.toMatch(/referencia_cliente|cp_viaje_referencia|exige_referencia/);
    }
  });
  it('el módulo no depende de nada fiscal ni bloquea: sin import de validación ni de envío', () => {
    const src = readFileSync(join(dir, 'referencia_cliente.ts'), 'utf8');
    expect(src).not.toMatch(/from '\.\/(validacion|envio|convertidor|exportacion)'/);
  });
});

describe('T-A3-65 migración 0832 (forma)', () => {
  const sql = readFileSync(join(process.cwd(), 'supabase/migrations/0832_cp_referencia_cliente.sql'), 'utf8');
  it('aditiva e idempotente, con default no y deny-all', () => {
    expect(sql).toMatch(/exige_referencia\s+boolean not null default false/);
    expect(sql.match(/create table if not exists/g)).toHaveLength(2);
    expect(sql).not.toMatch(/\bdrop\b|\balter table public\.(viaje|cliente|cp_documento)\b/i);
    expect(sql).toMatch(/revoke all on public\.cp_cliente_referencia from public, anon, authenticated/);
    expect(sql).toMatch(/revoke all on public\.cp_viaje_referencia from public, anon, authenticated/);
  });
});
