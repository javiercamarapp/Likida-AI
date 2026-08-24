// ═══════════════════════════════════════════════════════════════════════════
// LOS ORÁCULOS DEL PANEL — qué se corre y, sobre todo, QUÉ NO.
//
// El agujero que esta prueba cierra: la Fase A importaba cinco oráculos y
// disparaba tres. Los otros dos estaban en el árbol, se veían en el import, y
// no juzgaban nada. La tentación obvia —correrlos siempre— es peor que no
// tenerlos: un "ok" de dedup sobre una corrida que nunca repitió una foto es
// una afirmación inventada, y este panel existe para no inventar ninguna.
//
// La regla queda fijada aquí: #3 se corre SI Y SOLO SI el guion repitió una
// foto (lo que llega como `dedup`). Los oráculos van mockeados a propósito —
// lo que se prueba es el CRITERIO de qué se corre, no la lógica de cada uno,
// que ya tiene sus pruebas en el ejército.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, test, expect, vi, beforeEach } from 'vitest';

const llamadas: string[] = [];
const veredicto = (oraculo: string) => ({ oraculo, estado: 'ok' as const, esperado: 1, real: 1 });

vi.mock('../../../scripts/qa-agentes/oraculos/cuadre_balancea.oraculo', () => ({
  oraculoCuadreBalancea: async () => { llamadas.push('#1'); return veredicto('cuadre_balancea (#1)'); },
}));
vi.mock('../../../scripts/qa-agentes/oraculos/cifras_con_fuente.oraculo', () => ({
  oraculoCifrasConFuente: () => { llamadas.push('#5'); return veredicto('cifras_con_fuente (#5)'); },
  respaldoDesdeFuentes: () => new Set<string>(),
}));
vi.mock('../../../scripts/qa-agentes/oraculos/bitacora_registro.oraculo', () => ({
  oraculoBitacoraRegistro: () => { llamadas.push('#8'); return veredicto('bitacora_registro (#8)'); },
}));
vi.mock('../../../scripts/qa-agentes/oraculos/dedup_comprobante.oraculo', () => ({
  oraculoDedupComprobante: async (_t: string, viaje: string, hash: string) => {
    llamadas.push(`#3(${viaje}|${hash})`);
    return veredicto('dedup_comprobante (#3)');
  },
}));

import { correrOraculos, INVARIANTES } from './qa-oraculos';

const BASE = {
  tenantId: 'aaaaaaaa-0000-4000-8000-000000009901',
  viajeId: 'viaje-1',
  textosBot: ['van $1,200 comprobados'],
  fuentesRespaldo: [{ gasto: [] }],
  eventosBitacora: [{ msg: 'agent.run' }],
  eventosEsperados: ['agent.run'],
};

beforeEach(() => { llamadas.length = 0; });

describe('qué oráculos corre una corrida', () => {
  test('sin ataque de dedup corre #1, #5 y #8 — y NO #3', async () => {
    const filas = await correrOraculos(BASE);
    expect(llamadas).toEqual(['#1', '#5', '#8']);
    expect(filas.map((f) => f.oraculo)).toEqual([
      'cuadre_balancea (#1)', 'cifras_con_fuente (#5)', 'bitacora_registro (#8)',
    ]);
  });

  test('con ataque de dedup SÍ corre #3, con el viaje y el hash del ataque', async () => {
    const filas = await correrOraculos({
      ...BASE,
      dedup: { imgHash: 'sha-de-la-foto', viajeIntentoId: 'viaje-2' },
    });
    expect(llamadas).toEqual(['#1', '#5', '#3(viaje-2|sha-de-la-foto)', '#8']);
    expect(filas.map((f) => f.oraculo)).toContain('dedup_comprobante (#3)');
  });

  test('#3 se juzga contra el viaje al que la SEGUNDA foto intentó entrar, no el primero', async () => {
    // Si se pasara el viaje original, el oráculo sondearía el índice sobre un
    // viaje que ya tiene la foto legítima y el veredicto no significaría nada.
    await correrOraculos({ ...BASE, dedup: { imgHash: 'h', viajeIntentoId: 'viaje-2' } });
    expect(llamadas.some((l) => l.startsWith('#3(viaje-2'))).toBe(true);
    expect(llamadas.some((l) => l.startsWith('#3(viaje-1'))).toBe(false);
  });

  test('toda fila del veredicto trae su invariante y su severidad — nada sale como "—"', async () => {
    const filas = await correrOraculos({ ...BASE, dedup: { imgHash: 'h', viajeIntentoId: 'v2' } });
    for (const f of filas) {
      expect(INVARIANTES[f.oraculo], f.oraculo).toBeDefined();
      expect(f.severidad).not.toBe('—');
      expect(f.invariante).toMatch(/^#\d/);
    }
  });
});
