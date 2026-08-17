import { describe, it, expect, beforeEach } from 'vitest';
import {
  crearIntent, reclamarIntent, hashArgsAccion,
  INTENT_TTL_MS, _vaciarIntentsParaPruebas,
} from './copiloto-intents';

// ═══════════════════════════════════════════════════════════════════════════
// AdminActionIntent — lo que se fija:
//  1. Un intent es de UN SOLO USO y de UN SOLO ACTOR: replay, otro actor,
//     expirado o inexistente se rechazan con el MISMO mensaje (no filtra
//     cuáles intents existen ni de quién son).
//  2. argsHash amarra la ejecución a la previsualización EXACTA.
//  3. 'doble' deja de ser metadata: motivo obligatorio + dos reclamos.
// El reloj se INYECTA (ahoraMs) — los bordes del TTL no dependen de la
// máquina que corre las pruebas (mismo criterio que verificarFirma).
// ═══════════════════════════════════════════════════════════════════════════

const T0 = 1_700_000_000_000;
const BASE = { actorId: 'u-javier', accion: 'apagar_agente', objetivo: 'agente:cobranza', gateo: 'confirma' as const };
const HASH = hashArgsAccion('apagar_agente', 'agente:cobranza');

beforeEach(() => _vaciarIntentsParaPruebas());

describe('crearIntent', () => {
  it('nace sin usar, sin armar y con el TTL de 2 minutos', async () => {
    const it0 = await crearIntent({ ...BASE, ahoraMs: T0 });
    expect(it0.usado).toBe(false);
    expect(it0.armado).toBe(false);
    expect(it0.expiresAt - it0.createdAt).toBe(INTENT_TTL_MS);
    expect(it0.argsHash).toBe(HASH);
  });

  it('cada intent trae su propio id', async () => {
    const a = await crearIntent({ ...BASE, ahoraMs: T0 });
    const b = await crearIntent({ ...BASE, ahoraMs: T0 });
    expect(a.id).not.toBe(b.id);
  });
});

describe('hashArgsAccion', () => {
  it('mismos args, mismo hash; args distintos, hash distinto', async () => {
    expect(hashArgsAccion('apagar_agente', 'agente:cobranza')).toBe(HASH);
    expect(hashArgsAccion('apagar_agente', 'agente:proveedores')).not.toBe(HASH);
    expect(hashArgsAccion('correr_runner', 'agente:cobranza')).not.toBe(HASH);
  });
});

describe("reclamar un intent 'confirma'", () => {
  it('válido: ejecuta y queda GASTADO — el segundo reclamo es replay', async () => {
    const i = await crearIntent({ ...BASE, ahoraMs: T0 });
    const r1 = await reclamarIntent({ intentId: i.id, actorId: 'u-javier', argsHash: HASH, motivo: 'manda de más', ahoraMs: T0 + 1000 });
    expect(r1).toMatchObject({ ok: true, fase: 'ejecutar', accion: 'apagar_agente', motivo: 'manda de más' });

    const r2 = await reclamarIntent({ intentId: i.id, actorId: 'u-javier', argsHash: HASH, motivo: 'otra vez', ahoraMs: T0 + 2000 });
    expect(r2).toMatchObject({ ok: false, codigo: 'invalido' });
  });

  it('expirado (2 min + 1 ms) → rechazo; justo en el borde todavía vale', async () => {
    const enBorde = await crearIntent({ ...BASE, ahoraMs: T0 });
    const ok = await reclamarIntent({ intentId: enBorde.id, actorId: 'u-javier', argsHash: HASH, ahoraMs: T0 + INTENT_TTL_MS });
    expect(ok.ok).toBe(true);

    const tarde = await crearIntent({ ...BASE, ahoraMs: T0 });
    const r = await reclamarIntent({ intentId: tarde.id, actorId: 'u-javier', argsHash: HASH, ahoraMs: T0 + INTENT_TTL_MS + 1 });
    expect(r).toMatchObject({ ok: false, codigo: 'invalido' });
  });

  it('de OTRO actor → rechazo, con el MISMO mensaje que un intent inexistente', async () => {
    const i = await crearIntent({ ...BASE, ahoraMs: T0 });
    const ajeno = await reclamarIntent({ intentId: i.id, actorId: 'u-atacante', argsHash: HASH, ahoraMs: T0 + 1 });
    const fantasma = await reclamarIntent({ intentId: 'no-existe', actorId: 'u-atacante', argsHash: HASH, ahoraMs: T0 + 1 });
    expect(ajeno.ok).toBe(false);
    expect(fantasma.ok).toBe(false);
    if (!ajeno.ok && !fantasma.ok) expect(ajeno.error).toBe(fantasma.error);
    // Y el intento ajeno NO gastó el intent: su dueño todavía puede usarlo.
    const dueno = await reclamarIntent({ intentId: i.id, actorId: 'u-javier', argsHash: HASH, ahoraMs: T0 + 2 });
    expect(dueno.ok).toBe(true);
  });

  it('argsHash cambiado (otro objetivo que el previsualizado) → rechazo sin gastar', async () => {
    const i = await crearIntent({ ...BASE, ahoraMs: T0 });
    const r = await reclamarIntent({
      intentId: i.id, actorId: 'u-javier',
      argsHash: hashArgsAccion('apagar_agente', 'agente:proveedores'), ahoraMs: T0 + 1,
    });
    expect(r).toMatchObject({ ok: false, codigo: 'args' });
    // El intent sigue vivo para los args CORRECTOS — el rechazo no lo quema.
    const bien = await reclamarIntent({ intentId: i.id, actorId: 'u-javier', argsHash: HASH, ahoraMs: T0 + 2 });
    expect(bien.ok).toBe(true);
  });

  it("sin motivo, un 'confirma' pasa igual (el ejecutor de cada acción decide si lo exige)", async () => {
    const i = await crearIntent({ ...BASE, ahoraMs: T0 });
    const r = await reclamarIntent({ intentId: i.id, actorId: 'u-javier', argsHash: HASH, ahoraMs: T0 + 1 });
    expect(r).toMatchObject({ ok: true, fase: 'ejecutar', motivo: null });
  });
});

describe("reclamar un intent 'doble' — deja de ser metadata", () => {
  const DOBLE = { actorId: 'u-javier', accion: 'encender_agente', objetivo: 'agente:cobranza', gateo: 'doble' as const };
  const HASH_DOBLE = hashArgsAccion('encender_agente', 'agente:cobranza');

  it('sin motivo NO se arma — rechazo con código propio', async () => {
    const i = await crearIntent({ ...DOBLE, ahoraMs: T0 });
    const r = await reclamarIntent({ intentId: i.id, actorId: 'u-javier', argsHash: HASH_DOBLE, motivo: '   ', ahoraMs: T0 + 1 });
    expect(r).toMatchObject({ ok: false, codigo: 'motivo' });
  });

  it('primer reclamo ARMA (no ejecuta); el segundo ejecuta con el motivo del armado', async () => {
    const i = await crearIntent({ ...DOBLE, ahoraMs: T0 });
    const arma = await reclamarIntent({ intentId: i.id, actorId: 'u-javier', argsHash: HASH_DOBLE, motivo: 'cliente lo pidió', ahoraMs: T0 + 1 });
    expect(arma).toEqual({ ok: true, fase: 'armado' });

    // El segundo POST puede venir con otro texto — firma el motivo que se
    // LEYÓ al armar, no uno cambiado en el camino.
    const ejecuta = await reclamarIntent({ intentId: i.id, actorId: 'u-javier', argsHash: HASH_DOBLE, motivo: 'otro texto', ahoraMs: T0 + 2 });
    expect(ejecuta).toMatchObject({ ok: true, fase: 'ejecutar', motivo: 'cliente lo pidió' });

    // Y el tercero es replay.
    const replay = await reclamarIntent({ intentId: i.id, actorId: 'u-javier', argsHash: HASH_DOBLE, motivo: 'x', ahoraMs: T0 + 3 });
    expect(replay).toMatchObject({ ok: false, codigo: 'invalido' });
  });

  it('armado pero expirado antes del segundo POST → rechazo (armar no extiende el TTL)', async () => {
    const i = await crearIntent({ ...DOBLE, ahoraMs: T0 });
    await reclamarIntent({ intentId: i.id, actorId: 'u-javier', argsHash: HASH_DOBLE, motivo: 'ok', ahoraMs: T0 + 1 });
    const r = await reclamarIntent({ intentId: i.id, actorId: 'u-javier', argsHash: HASH_DOBLE, motivo: 'ok', ahoraMs: T0 + INTENT_TTL_MS + 1 });
    expect(r).toMatchObject({ ok: false, codigo: 'invalido' });
  });
});

describe('el barrido del Map (fase A: memoria del proceso)', () => {
  it('crear un intent nuevo barre los expirados — el Map no crece sin techo', async () => {
    const viejo = await crearIntent({ ...BASE, ahoraMs: T0 });
    await crearIntent({ ...BASE, ahoraMs: T0 + INTENT_TTL_MS + 1 });
    const r = await reclamarIntent({ intentId: viejo.id, actorId: 'u-javier', argsHash: HASH, ahoraMs: T0 + INTENT_TTL_MS + 2 });
    expect(r).toMatchObject({ ok: false, codigo: 'invalido' });
  });
});
