import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => { throw new Error('esta prueba no toca la base'); } }));
vi.mock('@/lib/meta/client', () => ({ enviarSolicitudUbicacion: vi.fn(async () => ({ ok: true })) }));

const { atenderConductor, atenderAcuseJefe } = await import('./atender');
const { crearMemoria, viajeBase } = await import('./memoria.fixture');
const regla = await import('./patio_regla');
const { armarTablero } = await import('./tablero');
const { leerBotonConductor } = await import('./tipos');
import type { PuertosPatio } from './patio_entrega';
import type { EventoPatioFila } from './repo';

// Fixtures SINTÉTICOS: ningún nombre de patio real.
const V1 = '4f1f6e2e-95c1-4c52-9f9e-3f6f6bd8d001';
const P_A = '11111111-1111-4111-8111-111111111111';
const P_B = '22222222-2222-4222-8222-222222222222';
const P_C = '33333333-3333-4333-8333-333333333333';
const PATIOS = [
  { id: P_A, nombre: 'Patio Alfa' }, { id: P_B, nombre: 'Patio Bravo' }, { id: P_C, nombre: 'Patio Charlie' },
];
const AHORA = new Date('2026-10-02T20:00:00.000Z');
const base = { tenantId: 't1', operadorId: 'o1', telefono: '5219990000001', viajeAbiertoId: V1, ahora: AHORA };

/** Puertos del patio en memoria: bitácora, claims y envíos visibles. */
function puertos(o: { patios?: typeof PATIOS; destinos?: Array<{ nombre: string; telefono: string }>; envioOk?: boolean; reclamoPerdido?: boolean } = {}) {
  const evs: EventoPatioFila[] = [];
  const enviados: Array<{ tel: string; texto: string; plantilla: string }> = [];
  const cierres: Array<{ ok: boolean; motivo: string | null }> = [];
  const claims: Array<{ clase: string; nivel: number }> = [];
  let n = 0;
  const p: PuertosPatio = {
    patios: async () => o.patios ?? PATIOS,
    eventos: async () => [...evs],
    evento: async (h, evento, detalle) => {
      if (evento !== 'validacion' && evento !== 'atendido') return;
      if (detalle.clase !== 'patio_entrega') return;
      evs.push({ id: ++n, viajeId: h.viajeId, hitoId: h.id, evento, detalle, creadoEn: `2026-10-02T20:0${n}:00.000Z` });
    },
    reclamar: async (a) => { claims.push({ clase: a.clase, nivel: a.nivel }); return o.reclamoPerdido ? 'perdido' : 'ganado'; },
    cerrarAviso: async (_a, c) => { cierres.push({ ok: c.ok, motivo: c.motivo }); },
    destinatarios: async () => o.destinos ?? [{ nombre: 'Supervisor', telefono: '5219990009999' }],
    enviar: async (tel, m) => {
      enviados.push({ tel, texto: m.texto, plantilla: m.plantilla.nombre });
      return o.envioOk === false
        ? { ok: false, motivo: 'rechazo_no_ventana', mensaje: 'rechazado', fueraDeVentana: false, reintentable: false, ventana: 'desconocida' as never }
        : { ok: true, via: 'plantilla', id: 'x', motivo: 'ventana_cerrada', ventana: 'cerrada' as never };
    },
  };
  return { p, evs, enviados, cierres, claims };
}

/** Un viaje en el que el chofer ya llegó a cargar y salió; con la perilla del patio encendida. */
async function escenario(o: Parameters<typeof puertos>[0] = {}, viaje: Partial<Parameters<typeof viajeBase>[0]> = {}, config: Record<string, unknown> = {}) {
  const m = crearMemoria({
    viajes: [viajeBase({ id: V1, destino: 'Patio Alfa', ...viaje })],
    config: { validarUbicacion: false, patioEntregaActivo: true, ...config },
  });
  const pu = puertos(o);
  m.deps.patio = pu.p;
  const dice = (texto: string) => atenderConductor({ ...base, texto, waMessageId: `wa-${Math.random()}` }, m.deps);
  await dice('ya llegué a cargar');
  await dice('ya cargué');
  return { m, pu, dice };
}
const textos = (r: Awaited<ReturnType<typeof atenderConductor>>) => (r?.mensajes ?? []).map((x) => x.texto).join('\n');

describe('reglas puras', () => {
  it('el campo que manda es configuración: «Entregar en» por omisión, con el destino de respaldo', () => {
    expect(regla.textoEsperado({ entregarEn: 'Patio Bravo', destino: 'Patio Alfa' }, 'entregar_en')).toEqual({ texto: 'Patio Bravo', campoUsado: 'entregar_en' });
    expect(regla.textoEsperado({ entregarEn: 'Patio Bravo', destino: 'Patio Alfa' }, 'destino')).toEqual({ texto: 'Patio Alfa', campoUsado: 'destino' });
    expect(regla.textoEsperado({ entregarEn: null, destino: 'Patio Alfa' }, 'entregar_en')).toEqual({ texto: 'Patio Alfa', campoUsado: 'destino' });
    expect(regla.textoEsperado({ destino: null }, 'destino').texto).toBeNull();
  });

  it('compara: igual, distinto, «otro» con texto libre, texto que es un patio del catálogo, y sin referencia', () => {
    expect(regla.compararPatio({ id: P_A }, 'Transportes, entregar en Patio Alfa', PATIOS)).toMatchObject({ resultado: 'igual', elegido: 'Patio Alfa', esperado: 'Patio Alfa' });
    expect(regla.compararPatio({ id: P_B }, 'Patio Alfa', PATIOS).resultado).toBe('distinto');
    expect(regla.compararPatio({ texto: 'Bodega Delta' }, 'Patio Alfa', PATIOS)).toMatchObject({ resultado: 'otro', elegido: 'Bodega Delta' });
    expect(regla.compararPatio({ texto: 'patio alfa' }, 'Patio Alfa', PATIOS).resultado).toBe('igual');
    expect(regla.compararPatio({ id: P_B }, 'un lugar que no está en el catálogo', PATIOS).resultado).toBe('sin_referencia');
    expect(regla.compararPatio({ id: P_B }, null, PATIOS).resultado).toBe('sin_referencia');
  });

  it('Meta admite 3 botones: 2 patios por página y «Más» u «Otro»; ids con el viaje y títulos únicos de ≤ 20', () => {
    const o = regla.ordenarPatios(PATIOS, P_C);
    expect(o[0].id).toBe(P_C);
    const p0 = regla.armarPreguntaPatio({ id: V1, folio: 'F-1' }, o, 0);
    expect(p0.botones).toHaveLength(3);
    expect(p0.botones![2]).toEqual({ id: `hito_patio:${V1}:mas1`, titulo: 'Más patios' });
    const p1 = regla.armarPreguntaPatio({ id: V1, folio: 'F-1' }, o, 1);
    expect(p1.botones!.map((b) => b.titulo)).toEqual(['Patio Bravo', 'Otro, especifique']);
    expect(p1.botones![1].id).toBe(`hito_patio:${V1}:otro`);
    const largos = regla.armarPreguntaPatio({ id: V1, folio: null }, [{ id: P_A, nombre: 'Patio con un nombre larguísimo uno' }, { id: P_B, nombre: 'Patio con un nombre larguísimo dos' }], 0);
    const t = largos.botones!.map((b) => b.titulo);
    expect(new Set(t).size).toBe(t.length);
    expect(t.every((x) => x.length <= 20)).toBe(true);
  });

  it('lee el botón del patio y rechaza ids inventados', () => {
    expect(leerBotonConductor(`hito_patio:${V1}:${P_A}`)).toMatchObject({ prefijo: 'hito_patio', opcion: P_A });
    expect(leerBotonConductor(`hito_patio:${V1}:otro`)?.opcion).toBe('otro');
    expect(leerBotonConductor(`hito_patio:${V1}:mas2`)?.opcion).toBe('mas2');
    expect(leerBotonConductor(`hito_patio:${V1}:x`)).toBeNull();
    expect(leerBotonConductor(`hito_patio:${V1}`)?.opcion).toBeUndefined();
  });

  it('«patio <nombre>» al inicio del mensaje, nada más', () => {
    expect(regla.leerTextoPatio('patio Delta')).toBe('Delta');
    expect(regla.leerTextoPatio('Patio de Norte')).toBe('Norte');
    expect(regla.leerTextoPatio('ya llegué al patio')).toBeNull();
    expect(regla.leerTextoPatio('patio?')).toBeNull();
  });
});

describe('cableado: llegada a descargar → pregunta → respuesta', () => {
  it('con la perilla apagada (por omisión) no se pregunta nada', async () => {
    const { dice } = await escenario({}, {}, { patioEntregaActivo: false });
    const r = await dice('ya llegué');
    expect(r?.mensajes).toHaveLength(1);
    expect(r?.mensajes[0].botones).toBeUndefined();
  });

  it('encendida: tras el acuse de la llegada a descargar sale la pregunta con botones, y queda en bitácora', async () => {
    const { dice, pu } = await escenario();
    const r = await dice('ya llegué');
    expect(r?.mensajes).toHaveLength(2);
    expect(r?.mensajes[0].texto).toMatch(/llegaste a DESCARGAR/);
    expect(r?.mensajes[1].texto).toMatch(/¿En qué patio vas a entregar/);
    expect(r?.mensajes[1].botones).toHaveLength(3);
    expect(pu.evs.map((e) => e.detalle.estado)).toEqual(['preguntado']);
  });

  it('sin patios en el catálogo no pregunta (no hay qué ofrecer)', async () => {
    const { dice } = await escenario({ patios: [] });
    expect((await dice('ya llegué'))?.mensajes).toHaveLength(1);
  });

  it('patio IGUAL al asignado → sigue, sin aviso al supervisor', async () => {
    const { dice, pu } = await escenario();
    await dice('ya llegué');
    const r = await dice(`hito_patio:${V1}:${P_A}`);
    expect(textos(r)).toMatch(/Anotado ✅ entregas en Patio Alfa/);
    expect(pu.enviados).toHaveLength(0);
    expect(pu.claims).toHaveLength(0);
    expect(regla.estadoPatio(pu.evs, pu.evs[0].hitoId, 1).respondido?.resultado).toBe('igual');
  });

  it('patio DISTINTO → aviso al supervisor de la terminal con claim primero, y excepción en el tablero', async () => {
    const { dice, pu, m } = await escenario({}, { terminalId: 'term-1' });
    await dice('ya llegué');
    const r = await dice(`hito_patio:${V1}:${P_B}`);
    expect(textos(r)).toMatch(/distinto al patio de tu instrucción/);
    expect(pu.claims).toEqual([{ clase: 'escalacion', nivel: 7 }]);
    expect(pu.enviados).toHaveLength(1);
    expect(pu.enviados[0]).toMatchObject({ tel: '5219990009999', plantilla: 'aviso_supervisor_patio_distinto_v1' });
    expect(pu.enviados[0].texto).toMatch(/entrega en «Patio Bravo».*dice «Patio Alfa»/);
    expect(pu.cierres).toEqual([{ ok: true, motivo: null }]);
    const ex = regla.excepcionesPatio(pu.evs);
    expect(ex).toHaveLength(1);
    expect(ex[0]).toMatchObject({ viajeId: V1, sinAvisar: false });
    expect(m.de(V1)).toBeTruthy();
  });

  it('«Otro»: pide el nombre, y el texto «patio <nombre>» desconocido es «otro» y avisa', async () => {
    const { dice, pu } = await escenario();
    await dice('ya llegué');
    // «Más» pagina sin guardar respuesta.
    const mas = await dice(`hito_patio:${V1}:mas1`);
    expect(mas?.mensajes[0].botones?.map((b) => b.titulo)).toEqual(['Patio Charlie', 'Otro, especifique']);
    const otro = await dice(`hito_patio:${V1}:otro`);
    expect(textos(otro)).toMatch(/empezando con la palabra «patio»/);
    expect(pu.enviados).toHaveLength(0);
    const r = await dice('patio Delta');
    expect(textos(r)).toMatch(/entregas en Delta/);
    expect(pu.enviados).toHaveLength(1);
    expect(regla.estadoPatio(pu.evs, pu.evs[0].hitoId, 1).respondido).toMatchObject({ resultado: 'otro', elegido: 'Delta' });
  });

  it('un «patio X» sin pregunta abierta no es de este módulo: sigue su camino', async () => {
    const { dice } = await escenario();
    const r = await dice('patio Delta');
    expect(r).toBeNull();
  });

  it('responder dos veces no repite el aviso (ya quedó anotado)', async () => {
    const { dice, pu } = await escenario();
    await dice('ya llegué');
    await dice(`hito_patio:${V1}:${P_B}`);
    const r = await dice(`hito_patio:${V1}:${P_C}`);
    expect(textos(r)).toMatch(/Ya tengo anotado tu patio de entrega: Patio Bravo/);
    expect(pu.enviados).toHaveLength(1);
  });

  it('el claim perdido (otra corrida ya avisó) no manda un segundo aviso', async () => {
    const { dice, pu } = await escenario({ reclamoPerdido: true });
    await dice('ya llegué');
    await dice(`hito_patio:${V1}:${P_B}`);
    expect(pu.enviados).toHaveLength(0);
  });

  it('SIN destinatario: no es silencio — el claim se cierra con el motivo y la excepción del tablero dice que nadie recibió el aviso', async () => {
    const { dice, pu } = await escenario({ destinos: [] });
    await dice('ya llegué');
    const r = await dice(`hito_patio:${V1}:${P_B}`);
    expect(textos(r)).toMatch(/Anotado/);
    expect(pu.cierres).toEqual([{ ok: false, motivo: 'sin_destinatario' }]);
    const ex = regla.excepcionesPatio(pu.evs);
    expect(ex[0].sinAvisar).toBe(true);
    expect(ex[0].texto).toMatch(/Nadie recibió el aviso/);
  });

  it('un envío rechazado deja el claim cerrado con ok=false y la excepción visible', async () => {
    const { dice, pu } = await escenario({ envioOk: false });
    await dice('ya llegué');
    await dice(`hito_patio:${V1}:${P_B}`);
    expect(pu.cierres[0]).toMatchObject({ ok: false, motivo: 'rechazado' });
    expect(regla.excepcionesPatio(pu.evs)[0].sinAvisar).toBe(true);
  });

  it('las dos configuraciones de D-5: «Entregar en» manda (por omisión) o el destino', async () => {
    // «Entregar en» = Patio Bravo, destino = Patio Alfa; el chofer elige Patio Alfa.
    const a = await escenario({}, { entregarEn: 'Patio Bravo' });
    await a.dice('ya llegué');
    await a.dice(`hito_patio:${V1}:${P_A}`);
    expect(a.pu.enviados).toHaveLength(1); // distinto de «Entregar en»
    const b = await escenario({}, { entregarEn: 'Patio Bravo' }, { patioQueManda: 'destino' });
    await b.dice('ya llegué');
    await b.dice(`hito_patio:${V1}:${P_A}`);
    expect(b.pu.enviados).toHaveLength(0); // igual al destino
  });

  it('un botón de otro viaje no toca datos ajenos', async () => {
    const { dice } = await escenario();
    await dice('ya llegué');
    const r = await dice(`hito_patio:4f1f6e2e-95c1-4c52-9f9e-3f6f6bd8d999:${P_B}`);
    expect(textos(r)).toMatch(/otro viaje/);
  });

  it('el catálogo cambió entre la pregunta y el toque: se vuelve a ofrecer, no se guarda un patio inexistente', async () => {
    const { dice, pu } = await escenario();
    await dice('ya llegué');
    const r = await dice(`hito_patio:${V1}:99999999-9999-4999-8999-999999999999`);
    expect(textos(r)).toMatch(/ya no está en la lista/);
    expect(pu.evs.some((e) => e.detalle.estado === 'respondido')).toBe(false);
  });
});

describe('«Ya lo atiendo» y el tablero', () => {
  it('el acuse del supervisor cierra la excepción de patio aunque ningún hito esté escalado', async () => {
    const { dice, pu, m } = await escenario();
    await dice('ya llegué');
    await dice(`hito_patio:${V1}:${P_B}`);
    expect(regla.excepcionesPatio(pu.evs)).toHaveLength(1);
    const { marcarPatioAtendido } = await import('./patio_entrega');
    const r = await atenderAcuseJefe('5219990009999', `jefe_atiendo:${V1}`, AHORA, {
      viajePorId: async () => ({ tenantId: 't1' }),
      puedeAcusar: async () => true,
      marcar: async () => [],
      evento: m.deps.evento,
      hitosDe: async () => m.de(V1),
      cerrarPatio: (t, hs) => marcarPatioAtendido(pu.p, t, hs),
    });
    expect(r).toMatch(/Anotado/);
    expect(regla.excepcionesPatio(pu.evs)).toHaveLength(0);
  });

  it('el tablero muestra la excepción «patio_entrega_distinto» con gravedad urgente', async () => {
    const { dice, pu } = await escenario();
    await dice('ya llegué');
    await dice(`hito_patio:${V1}:${P_B}`);
    const ex = regla.excepcionesPatio(pu.evs);
    const viaje = { id: V1, folio: 'F-1042', terminalId: null, terminalNombre: null } as never;
    const t = armarTablero({
      viajes: [viaje], hayMas: false, hitos: [], veredictos: [], evidencias: [], acciones: [], sitios: new Map(), patiosDistintos: ex,
    } as never, { ...(await import('./config')).CONFIG_CONDUCTOR_DEFAULT }, AHORA);
    const e = t.excepciones.find((x) => x.tipo === 'patio_entrega_distinto');
    expect(e).toMatchObject({ viajeId: V1, gravedad: 3, hitoTipo: 'llegada_descarga' });
    expect(e?.texto).toMatch(/Patio Bravo/);
  });
});
