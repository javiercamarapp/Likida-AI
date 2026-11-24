import { describe, it, expect, vi } from 'vitest';
import { atenderMensajeCliente, type MensajeEntrante } from './servicio';
import { escenario, RepoEnMemoria } from './repo.fixture';
import { AHORA, T1 } from './datos.fixture';
import { sombraActiva, evaluarDecisionSombra } from './sombra';
import type { DepsVigia } from './puertos';

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('./conocimiento/decidir', async (orig) => {
  const real = await orig<typeof import('./conocimiento/decidir')>();
  return { ...real, decidirAccion: vi.fn(real.decidirAccion) };
});
import { decidirAccion } from './conocimiento/decidir';

// Mismo id en cada corrida: cada una usa su propio repo y así las claves de evento son comparables.
const msg = (texto: string): MensajeEntrante => ({ from: '525511110001', type: 'text', text: texto, waMessageId: 'wamid.sombra.1', timestampMs: AHORA.getTime() });

async function correr(texto: string, extra: Partial<DepsVigia> = {}) {
  const { repo } = escenario();
  const alCliente: unknown[] = [];
  const deps: DepsVigia = {
    repo, ahora: () => AHORA,
    enviarCliente: async (e) => { alCliente.push(e); return { ok: true, via: 'texto', id: 'wamid.CLI', ventana: 'abierta' }; },
    enviar: (async () => ({ ok: true, via: 'botones', id: 'wamid.GER', motivo: 'ventana_abierta', ventana: 'abierta' })) as unknown as DepsVigia['enviar'],
    ...extra,
  };
  await atenderMensajeCliente(msg(texto), deps);
  return { repo: repo as RepoEnMemoria, alCliente };
}

// Todo lo observable salvo la clave `sombra` del evento.
const observable = (repo: RepoEnMemoria) => ({
  mensajes: [...repo.mensajes.values()].map(({ id: _id, ...m }) => m),
  eventos: repo.eventos.map(({ id: _id, detalle, ...e }) => ({ ...e, detalle: { ...detalle, sombra: undefined } })),
});

describe('sombraActiva', () => {
  it('apagado por omisión y con valores vacíos o «no»', () => {
    for (const v of [undefined, null, '', ' ', 'no', 'false', '0']) expect(sombraActiva(v, T1)).toBe(false);
  });
  it('«si» enciende todas las flotas; una lista solo las nombradas', () => {
    expect(sombraActiva('si', T1)).toBe(true);
    expect(sombraActiva(`otra, ${T1}`, T1)).toBe(true);
    expect(sombraActiva('otra', T1)).toBe(false);
  });
});

describe('evaluarDecisionSombra', () => {
  it('registra acción, motivo y regla sin aplicar nada', () => {
    const r = evaluarDecisionSombra({ texto: '¿cuál es el sello de la caja?', datosDisponibles: [] });
    expect(r.aplicado).toBe(false);
    expect(r.regla.length).toBeGreaterThan(0);
    expect(r.endurece).not.toBeNull();
  });
  it('si decidirAccion lanza, falla cerrado y registra el error sin lanzar', () => {
    vi.mocked(decidirAccion).mockImplementationOnce(() => { throw new Error('boom'); });
    const r = evaluarDecisionSombra({ texto: 'hola', datosDisponibles: [] });
    expect(r).toMatchObject({ accionSugerida: 'escalar_gerente', endurece: 'escalar', aplicado: false, error: 'boom' });
  });
});

describe('modo sombra dentro del servicio', () => {
  it('apagado (sin puerto o puerto en falso): el evento no trae `sombra` y decidirAccion ni se llama', async () => {
    vi.mocked(decidirAccion).mockClear();
    const a = await correr('¿dónde va mi viaje?');
    const b = await correr('¿dónde va mi viaje?', { decisionSombra: () => false });
    for (const { repo } of [a, b]) {
      const [ev] = repo.eventosDe('borrador');
      expect(ev).toBeDefined();
      expect(ev.detalle).not.toHaveProperty('sombra');
    }
    expect(decidirAccion).not.toHaveBeenCalled();
  });

  it('equivalencia: encendido produce lo mismo que apagado salvo el registro `sombra`', async () => {
    const off = await correr('¿dónde va mi viaje?');
    const on = await correr('¿dónde va mi viaje?', { decisionSombra: () => true });
    expect(observable(on.repo)).toEqual(observable(off.repo));
    expect(on.alCliente).toEqual(off.alCliente);
  });

  it('encendido: el detalle del borrador trae la decisión sugerida y aplicado=false', async () => {
    const { repo } = await correr('¿dónde va mi viaje?', { decisionSombra: () => true });
    const [ev] = repo.eventosDe('borrador');
    expect(ev.detalle?.sombra).toMatchObject({ aplicado: false });
    expect(ev.detalle?.sombra).toHaveProperty('accionSugerida');
    expect(ev.detalle?.sombra).toHaveProperty('motivo');
    expect(ev.detalle?.sombra).toHaveProperty('regla');
  });

  it('encendido y decidirAccion falla: no lanza, el flujo sigue igual y se registra el error cerrado', async () => {
    const off = await correr('¿dónde va mi viaje?');
    vi.mocked(decidirAccion).mockImplementationOnce(() => { throw new Error('fallo simulado'); });
    const on = await correr('¿dónde va mi viaje?', { decisionSombra: () => true });
    expect(on.repo.eventosDe('borrador')[0].detalle?.sombra).toMatchObject({ error: 'fallo simulado', accionSugerida: 'escalar_gerente', aplicado: false });
    expect(observable(on.repo)).toEqual(observable(off.repo));
  });
});
