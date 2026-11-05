import { describe, expect, it } from 'vitest';
import type { ContextoEvento } from './repo';
import { procesarLoteEventos, type EntradaLote } from './lote_eventos';
import type { EventoNormalizado } from './eventos';

const ev = (extra: Record<string, unknown> = {}) => ({ tipo: 'guia_inicio', canal: 'movil', ...extra });

function entrada(parcial: Partial<EntradaLote> = {}) {
  const guardados: Array<{ ctx: ContextoEvento; lote: readonly EventoNormalizado[] }> = [];
  const e: EntradaLote = {
    activo: true, lote: [ev()], sesion: { userId: 'u1', tenantId: 't1', rol: 'flota_admin' }, secreto: 'secreto', perfil: 'cinco_agentes', ahora: 1_000_000,
    ventana: new Map(), guardar: async (ctx, lote) => { guardados.push({ ctx, lote }); return lote.length; }, ...parcial,
  };
  return { e, guardados };
}

describe('procesarLoteEventos', () => {
  it('guarda con la identidad del SERVIDOR: seudónimo, rol y pista; nunca el id del usuario', async () => {
    const { e, guardados } = entrada();
    expect(await procesarLoteEventos(e)).toEqual({ ok: true, guardados: 1 });
    expect(guardados[0].ctx).toMatchObject({ tenantId: 't1', rol: 'flota_admin', pista: 'dueno_ca', perfil: 'cinco_agentes' });
    expect(guardados[0].ctx.actor).toMatch(/^[0-9a-f]{16}$/);
    expect(JSON.stringify(guardados[0])).not.toContain('u1');
  });
  it('apagado, sin sesión, sin flota, sin secreto, «ver como» o lote que no es lista: no guarda nada', async () => {
    for (const p of [{ activo: false }, { sesion: null }, { sesion: { userId: 'u', tenantId: null, rol: 'flota_admin' } }, { secreto: undefined }, { sesion: { userId: 'u', tenantId: 't', rol: 'superadmin' } }, { lote: 'x' }] as Array<Partial<EntradaLote>>) {
      const { e, guardados } = entrada(p);
      expect(await procesarLoteEventos(e)).toEqual({ ok: false, guardados: 0 });
      expect(guardados).toHaveLength(0);
    }
  });
  it('descarta los eventos inválidos y los repetidos del mismo paso', async () => {
    const { e, guardados } = entrada({ lote: [ev({ tipo: 'inventado' }), ev({ tipo: 'paso_visto', pasoId: 'P1' }), ev({ tipo: 'paso_visto', pasoId: 'P1' }), ev({ tipo: 'paso_visto', pasoId: 'P2' }), 5] });
    expect(await procesarLoteEventos(e)).toEqual({ ok: true, guardados: 2 });
    expect(guardados[0].lote.map((x) => x.paso_id)).toEqual(['P1', 'P2']);
  });
  it('un lote entra con a lo más 20 eventos', async () => {
    const { e, guardados } = entrada({ lote: Array.from({ length: 50 }, (_, i) => ev({ tipo: 'paso_visto', pasoId: `P${i}` })) });
    await procesarLoteEventos(e);
    expect(guardados[0].lote).toHaveLength(20);
  });
  it('tope de 60 por usuario y minuto; pasada la ventana se reinicia', async () => {
    const ventana: EntradaLote['ventana'] = new Map();
    const lote = (n: number, base: number) => Array.from({ length: 20 }, (_, i) => ev({ tipo: 'paso_visto', pasoId: `P${base + n * 20 + i}` }));
    for (let n = 0; n < 3; n++) expect((await procesarLoteEventos(entrada({ ventana, lote: lote(n, 0) }).e)).ok).toBe(true);
    expect(await procesarLoteEventos(entrada({ ventana, lote: lote(3, 0) }).e)).toEqual({ ok: false, guardados: 0 });
    expect((await procesarLoteEventos(entrada({ ventana, lote: lote(4, 0), ahora: 1_000_000 + 61_000 }).e)).ok).toBe(true);
  });
  it('si la base no guarda nada, no se reporta éxito; sin pista conocida va «sin_pista»', async () => {
    const { e } = entrada({ guardar: async () => 0 });
    expect(await procesarLoteEventos(e)).toEqual({ ok: false, guardados: 0 });
    const r = entrada({ sesion: { userId: 'u', tenantId: 't', rol: 'rol_raro' } });
    await procesarLoteEventos(r.e);
    expect(r.guardados[0].ctx.pista).toBe('sin_pista');
  });
});
