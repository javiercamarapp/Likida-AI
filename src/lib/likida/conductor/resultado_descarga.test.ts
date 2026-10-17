import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => { throw new Error('esta prueba no toca la base'); } }));
vi.mock('@/lib/meta/client', () => ({ enviarSolicitudUbicacion: vi.fn(async () => ({ ok: true })) }));

const { atenderConductor } = await import('./atender');
const { crearMemoria, viajeBase } = await import('./memoria.fixture');
const { leerBotonConductor, PREFIJO_BOTON } = await import('./tipos');
const { leerTextoResultadoDescarga } = await import('./interprete');
const { preguntaResultadoDescarga, acuseResultadoDescarga } = await import('./mensajes');
const { estadoResultado, regresoConCajaCargada, armarAvisoCajaCargada, NIVEL_AVISO_RESULTADO } = await import('./resultado_descarga');
const { validarConfigConductor, CONFIG_CONDUCTOR_DEFAULT } = await import('./config');
import type { PuertosResultado } from './resultado_descarga';
import type { EventoPatioFila } from './repo';

// Fixtures SINTÉTICOS: ningún nombre real.
const V1 = '4f1f6e2e-95c1-4c52-9f9e-3f6f6bd8d046';
const AHORA = new Date('2026-10-02T20:00:00.000Z');
const base = { tenantId: 't1', operadorId: 'o1', telefono: '5219990000001', viajeAbiertoId: V1, ahora: AHORA };

function puertos(o: { destinos?: Array<{ nombre: string; telefono: string }>; envioOk?: boolean; reclamoPerdido?: boolean } = {}) {
  const evs: EventoPatioFila[] = [];
  const enviados: Array<{ tel: string; texto: string; plantilla: string }> = [];
  const cierres: Array<{ ok: boolean; motivo: string | null }> = [];
  const claims: Array<{ clase: string; nivel: number; hitoId: string }> = [];
  let n = 0;
  const p: PuertosResultado = {
    eventos: async () => [...evs],
    evento: async (h, evento, detalle) => {
      if (evento !== 'validacion' || detalle.clase !== 'resultado_descarga') return;
      evs.push({ id: ++n, viajeId: h.viajeId, hitoId: h.id, evento, detalle, creadoEn: `2026-10-02T20:0${n}:00.000Z` });
    },
    reclamar: async (a) => { claims.push({ clase: a.clase, nivel: a.nivel, hitoId: a.hitoId }); return o.reclamoPerdido ? 'perdido' : 'ganado'; },
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

/** Un viaje con el chofer ya en la descarga; la perilla del resultado encendida salvo que se diga lo contrario. */
async function escenario(o: Parameters<typeof puertos>[0] = {}, config: Record<string, unknown> = {}) {
  const m = crearMemoria({ viajes: [viajeBase({ id: V1 })], config: { validarUbicacion: false, resultadoDescargaActivo: true, ...config } });
  const pu = puertos(o);
  m.deps.resultado = pu.p;
  const dice = (texto: string) => atenderConductor({ ...base, texto, waMessageId: `wa-${Math.random()}` }, m.deps);
  await dice('ya llegué a cargar');
  await dice('ya cargué');
  await dice('ya llegué a descargar');
  return { m, pu, dice };
}
const textos = (r: Awaited<ReturnType<typeof atenderConductor>>) => (r?.mensajes ?? []).map((x) => x.texto).join('\n');
const boton = (opcion: string) => `${PREFIJO_BOTON.resultadoDescarga}:${V1}:${opcion}`;
const estadoDe = (m: Awaited<ReturnType<typeof escenario>>['m'], tipo: string) => m.de(V1).find((h) => h.tipo === tipo)!.estado;

describe('reglas puras', () => {
  it('lee el botón con sus tres opciones y rechaza lo inventado', () => {
    for (const op of ['completa', 'no_recibida', 'caja_cargada']) expect(leerBotonConductor(boton(op))).toMatchObject({ prefijo: 'resultado_descarga', opcion: op });
    expect(leerBotonConductor(boton('otra'))).toBeNull();
    expect(leerBotonConductor(`resultado_descarga:no-es-uuid:completa`)).toBeNull();
  });

  it('la pregunta cabe en Meta: 3 botones con título de ≤ 20 y ids con el viaje', () => {
    const q = preguntaResultadoDescarga({ id: V1, folio: 'F-1' });
    expect(q.botones).toHaveLength(3);
    expect(q.botones!.every((b) => b.titulo.length <= 20 && b.id.startsWith(`resultado_descarga:${V1}:`))).toBe(true);
    expect(new Set(q.botones!.map((b) => b.titulo)).size).toBe(3);
  });

  it('el texto libre se entiende con rigor: sin preguntas ni frases ajenas', () => {
    expect(leerTextoResultadoDescarga('no me recibieron la mercancía')).toBe('no_recibida');
    expect(leerTextoResultadoDescarga('me rechazaron la carga')).toBe('no_recibida');
    expect(leerTextoResultadoDescarga('regreso con la caja cargada')).toBe('caja_cargada');
    expect(leerTextoResultadoDescarga('la caja va cargada a patio')).toBe('caja_cargada');
    expect(leerTextoResultadoDescarga('descarga completa')).toBe('completa');
    expect(leerTextoResultadoDescarga('ya descargué todo')).toBe('completa');
    expect(leerTextoResultadoDescarga('¿no me recibieron?')).toBeNull();
    expect(leerTextoResultadoDescarga('ya llegué')).toBeNull();
    expect(leerTextoResultadoDescarga(undefined)).toBeNull();
  });

  it('el estado sale de la bitácora y la bandera se lee del regreso', () => {
    const evs: EventoPatioFila[] = [
      { id: 1, viajeId: 'v', hitoId: 'h1', evento: 'validacion', detalle: { clase: 'resultado_descarga', estado: 'preguntado', ciclo: 1 }, creadoEn: 'x' },
      { id: 2, viajeId: 'v', hitoId: 'h1', evento: 'validacion', detalle: { clase: 'resultado_descarga', estado: 'respondido', ciclo: 1, opcion: 'caja_cargada' }, creadoEn: 'x' },
      { id: 3, viajeId: 'v', hitoId: 'h1', evento: 'validacion', detalle: { clase: 'resultado_descarga', estado: 'alertado', ciclo: 1, entregados: 0 }, creadoEn: 'x' },
      { id: 4, viajeId: 'v', hitoId: 'h2', evento: 'validacion', detalle: { clase: 'resultado_descarga', estado: 'caja_cargada', ciclo: 1 }, creadoEn: 'x' },
    ];
    expect(estadoResultado(evs, 'h1', 1)).toEqual({ preguntado: true, respondido: 'caja_cargada', alertado: true, entregados: 0 });
    expect(estadoResultado(evs, 'h1', 2).preguntado).toBe(false);
    expect(regresoConCajaCargada(evs, 'h2')).toBe(true);
    expect(regresoConCajaCargada(evs, 'h1')).toBe(false);
  });

  it('el aviso dice la rama, el folio y lleva «Ya lo atiendo»; el acuse distingue si el supervisor lo recibió', () => {
    const v = { id: V1, folio: 'F-9', operadorNombre: 'Chofer Uno' };
    expect(armarAvisoCajaCargada(v, 'no_recibida').texto).toMatch(/F-9.*no le recibieron/);
    expect(armarAvisoCajaCargada(v, 'caja_cargada').texto).not.toMatch(/no le recibieron/);
    expect(armarAvisoCajaCargada(v, 'caja_cargada').botones[0].id).toBe(`jefe_atiendo:${V1}`);
    expect(acuseResultadoDescarga('caja_cargada', true).texto).toMatch(/le avisé a tu supervisor/);
    expect(acuseResultadoDescarga('caja_cargada', false).texto).toMatch(/avísale directo/);
  });

  it('la perilla es de configuración: apagada por omisión y solo `true` la enciende', () => {
    expect(CONFIG_CONDUCTOR_DEFAULT.resultadoDescargaActivo).toBe(false);
    expect(validarConfigConductor({ resultadoDescargaActivo: true } as never)).toMatchObject({ ok: { resultadoDescargaActivo: true } });
    expect(validarConfigConductor({ resultadoDescargaActivo: 'si' } as never)).toMatchObject({ ok: { resultadoDescargaActivo: false } });
  });
});

describe('cableado: salida de descarga → pregunta → respuesta', () => {
  it('con la perilla apagada (por omisión) no se pregunta nada', async () => {
    const { dice, pu } = await escenario({}, { resultadoDescargaActivo: false });
    const r = await dice('ya descargué');
    expect(r?.mensajes.some((x) => x.botones?.some((b) => b.id.startsWith('resultado_descarga')))).toBe(false);
    expect(pu.evs).toHaveLength(0);
  });

  it('tras «ya terminé» se acusa la salida y se pregunta UNA vez con tres botones', async () => {
    const { dice, pu } = await escenario();
    const r = await dice('ya terminé de descargar');
    expect(r?.mensajes).toHaveLength(2);
    expect(r!.mensajes[1].botones!.map((b) => b.id.split(':')[2])).toEqual(['completa', 'no_recibida', 'caja_cargada']);
    expect(pu.evs.filter((e) => e.detalle.estado === 'preguntado')).toHaveLength(1);
    const otra = await dice('ya terminé de descargar');
    expect(textos(otra)).not.toMatch(/Cómo terminó/);
  });

  it('«completa»: acuse, sin aviso y el ciclo sigue normal (el regreso sigue pendiente y se registra después)', async () => {
    const { m, pu, dice } = await escenario();
    await dice('ya terminé de descargar');
    const r = await dice(boton('completa'));
    expect(textos(r)).toMatch(/descarga completa/);
    expect(pu.enviados).toHaveLength(0);
    expect(estadoDe(m, 'regreso')).toBe('esperado');
    expect(pu.evs.some((e) => e.detalle.estado === 'caja_cargada')).toBe(false);
    await dice('voy de regreso');
    expect(estadoDe(m, 'regreso')).toBe('recibido');
  });

  it('«caja cargada»: avisa al supervisor (un solo claim nivel 6), marca la bandera y registra el regreso', async () => {
    const { m, pu, dice } = await escenario();
    await dice('ya terminé de descargar');
    const r = await dice(boton('caja_cargada'));
    expect(textos(r)).toMatch(/Ya le avisé a tu supervisor/);
    expect(pu.enviados).toHaveLength(1);
    expect(pu.enviados[0].texto).toMatch(/regresa a patio con la caja cargada/);
    expect(pu.claims).toEqual([expect.objectContaining({ clase: 'escalacion', nivel: NIVEL_AVISO_RESULTADO })]);
    const regreso = m.de(V1).find((h) => h.tipo === 'regreso')!;
    expect(regreso.estado).toBe('recibido');
    expect(regresoConCajaCargada(pu.evs, regreso.id)).toBe(true);
    expect(pu.cierres).toEqual([{ ok: true, motivo: null }]);
  });

  it('«no me recibieron» por BOTÓN y por TEXTO con la pregunta abierta: aviso con la rama correcta', async () => {
    const a = await escenario();
    await a.dice('ya terminé de descargar');
    await a.dice(boton('no_recibida'));
    expect(a.pu.enviados[0].texto).toMatch(/no le recibieron la mercancía/);

    const b = await escenario();
    await b.dice('ya terminé de descargar');
    const r = await b.dice('no me recibieron la mercancía');
    expect(textos(r)).toMatch(/no te recibieron/);
    expect(b.pu.enviados).toHaveLength(1);
    expect(estadoDe(b.m, 'regreso')).toBe('recibido');
  });

  it('sin pregunta abierta, el mismo texto NO es de este módulo (sigue su camino) y no avisa a nadie', async () => {
    const { pu, dice } = await escenario();
    const r = await dice('no me recibieron la mercancía');
    expect(textos(r)).not.toMatch(/Ya le avisé a tu supervisor/);
    expect(pu.enviados).toHaveLength(0);
  });

  it('dos toques o dos opciones no duplican el aviso; la segunda respuesta solo se reconoce', async () => {
    const { pu, dice } = await escenario();
    await dice('ya terminé de descargar');
    await dice(boton('caja_cargada'));
    const dos = await dice(boton('no_recibida'));
    expect(textos(dos)).toMatch(/Ya tengo anotada tu respuesta/);
    expect(pu.enviados).toHaveLength(1);
  });

  it('claim perdido (otro ya avisó): no manda otro y el chofer igual queda atendido', async () => {
    const { m, pu, dice } = await escenario({ reclamoPerdido: true });
    await dice('ya terminé de descargar');
    const r = await dice(boton('caja_cargada'));
    expect(pu.enviados).toHaveLength(0);
    expect(textos(r)).toMatch(/Anotado/);
    expect(estadoDe(m, 'regreso')).toBe('recibido');
  });

  it('destinatario faltante → alerta interna: claim cerrado con el motivo, bitácora con 0 entregados y el chofer sabe que debe avisar directo', async () => {
    const { pu, dice } = await escenario({ destinos: [] });
    await dice('ya terminé de descargar');
    const r = await dice(boton('no_recibida'));
    expect(pu.cierres).toEqual([{ ok: false, motivo: 'sin_destinatario' }]);
    expect(pu.evs.find((e) => e.detalle.estado === 'alertado')?.detalle.entregados).toBe(0);
    expect(textos(r)).toMatch(/avísale directo a tu supervisor/);
  });

  it('el envío rechazado no rompe nada: el regreso se fija y el chofer queda atendido', async () => {
    const { m, pu, dice } = await escenario({ envioOk: false });
    await dice('ya terminé de descargar');
    const r = await dice(boton('caja_cargada'));
    expect(textos(r)).toMatch(/avísale directo/);
    expect(pu.cierres[0].ok).toBe(false);
    expect(estadoDe(m, 'regreso')).toBe('recibido');
  });

  it('SIN respuesta no bloquea el cierre: el regreso se registra igual con su texto de siempre', async () => {
    const { m, dice } = await escenario();
    await dice('ya terminé de descargar');
    const r = await dice('voy de regreso');
    expect(textos(r)).toMatch(/de regreso/);
    expect(estadoDe(m, 'regreso')).toBe('recibido');
  });

  it('un botón de otro viaje, o de un viaje cerrado, no toca nada', async () => {
    const { pu, dice } = await escenario();
    await dice('ya terminé de descargar');
    const ajeno = await dice(`resultado_descarga:11111111-1111-4111-8111-111111111111:caja_cargada`);
    expect(textos(ajeno)).toMatch(/otro viaje/);
    expect(pu.enviados).toHaveLength(0);
  });

  it('botón con la perilla apagada: «ya no está vigente» y nada se escribe', async () => {
    const { pu, dice } = await escenario({}, { resultadoDescargaActivo: false });
    const r = await dice(boton('caja_cargada'));
    expect(textos(r)).toMatch(/ya no está vigente/);
    expect(pu.enviados).toHaveLength(0);
    expect(pu.evs).toHaveLength(0);
  });
});
