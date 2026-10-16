import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => { throw new Error('esta prueba no toca la base'); } }));
vi.mock('@/lib/meta/client', () => ({ enviarSolicitudUbicacion: vi.fn(async () => ({ ok: true })) }));

const { atenderConductor } = await import('./atender');
const { crearMemoria, viajeBase } = await import('./memoria.fixture');
const { leerBotonConductor, PREFIJO_BOTON } = await import('./tipos');
const { armarInstrucciones, armarAvisoRechazo, NIVEL_AVISO_RECHAZO, SIN_DATO } = await import('./asignacion');
const { plantillaDeCatalogo, validarCatalogo, opcionesDeEnvio, textoRenderizado } = await import('@/lib/meta/plantillas_catalogo');
const { validarConfigConductor, CONFIG_CONDUCTOR_DEFAULT } = await import('./config');
import type { PuertosAsignacion, DatosInstrucciones } from './asignacion';
import type { ResultadoAceptarPorBoton } from '../confirmar_viaje';

// Fixtures SINTÉTICOS: ningún nombre real.
const V1 = '4f1f6e2e-95c1-4c52-9f9e-3f6f6bd8d046';
const AHORA = new Date('2026-10-16T14:00:00.000Z'); // 08:00 en el Centro de México
const base = { tenantId: 't1', operadorId: 'o1', telefono: '5219990000001', viajeAbiertoId: V1, ahora: AHORA };

interface Opc {
  /** Lo que contesta la base al aceptar (primera vez 'aceptado', luego 'ya_aceptado' como la base real). */
  aceptar?: ResultadoAceptarPorBoton;
  datos?: Partial<DatosInstrucciones>;
  datosFallan?: boolean;
  envioOk?: boolean;
  via?: 'texto' | 'botones' | 'plantilla';
  destinos?: Array<{ nombre: string; telefono: string }>;
  reclamoPerdido?: boolean;
}

function puertos(o: Opc = {}) {
  const enviados: Array<{ tel: string; texto: string; botones: Array<{ id: string; titulo: string }>; plantilla: { nombre: string; parametros?: string[] }; contexto: string }> = [];
  const aceptaciones: string[] = [];
  const claims: Array<{ clase: string; nivel: number; hitoId: string }> = [];
  const cierres: Array<{ ok: boolean; motivo: string | null }> = [];
  const convenios: string[] = [];
  let yaAceptado = false;
  const p: PuertosAsignacion = {
    aceptar: async (_t, viajeId) => {
      aceptaciones.push(viajeId);
      if (o.aceptar) return o.aceptar;
      if (yaAceptado) return 'ya_aceptado';
      yaAceptado = true;
      return 'aceptado';
    },
    datos: async () => {
      if (o.datosFallan) throw new Error('base caída');
      return { caja: 'CJ-5521', rutaCarga: null, rutaPatio: null, ...o.datos };
    },
    convenio: async (_t, viajeId) => { convenios.push(viajeId); },
    reclamar: async (a) => { claims.push({ clase: a.clase, nivel: a.nivel, hitoId: a.hitoId }); return o.reclamoPerdido ? 'perdido' : 'ganado'; },
    cerrarAviso: async (_a, c) => { cierres.push({ ok: c.ok, motivo: c.motivo }); },
    destinatarios: async () => o.destinos ?? [{ nombre: 'Despachador', telefono: '5219990009999' }],
    enviar: async (tel, m, contexto) => {
      enviados.push({ tel, texto: m.texto, botones: m.botones, plantilla: m.plantilla as never, contexto });
      return o.envioOk === false
        ? { ok: false, motivo: 'rechazo_no_ventana', mensaje: 'rechazado', fueraDeVentana: false, reintentable: false, ventana: 'desconocida' as never }
        : { ok: true, via: o.via ?? 'botones', id: 'x', motivo: 'ventana_abierta', ventana: 'abierta' as never };
    },
  };
  return { p, enviados, aceptaciones, claims, cierres, convenios };
}

/** Un viaje avisado y sin aceptar, con cita, unidad y la flota con los botones encendidos. */
function escenario(o: Opc = {}, viaje: Parameters<typeof viajeBase>[0] = {}) {
  const m = crearMemoria({
    viajes: [viajeBase({ id: V1, aceptadoEn: null, citaOrigenEn: '2026-10-16T14:00:00.000Z', entregarEn: 'Patio Norte 2', ...viaje })],
    config: { validarUbicacion: false, asignacionBotonesActiva: true },
  });
  const pu = puertos(o);
  m.deps.asignacion = pu.p;
  const toca = (prefijo: string) => atenderConductor({ ...base, texto: `${prefijo}:${V1}`, waMessageId: `wa-${Math.random()}` }, m.deps);
  return { m, pu, toca };
}
const textos = (r: Awaited<ReturnType<typeof atenderConductor>>) => (r?.mensajes ?? []).map((x) => x.texto).join('\n');

describe('reglas puras', () => {
  it('lee los tres botones con el viaje y rechaza lo inventado', () => {
    for (const pre of ['viaje_acepto', 'viaje_rechazo', 'instr_ok']) expect(leerBotonConductor(`${pre}:${V1}`)).toMatchObject({ prefijo: pre, viajeId: V1 });
    expect(leerBotonConductor('viaje_acepto:no-es-uuid')).toBeNull();
    expect(leerBotonConductor(`viaje_acepto:${V1}:extra`)).toBeNull();
  });

  it('N01 y N02 están en el catálogo, pasan las reglas de Meta y los prefijos de sus botones son los que lee el módulo', () => {
    expect(validarCatalogo()).toEqual([]);
    const n01 = plantillaDeCatalogo('viaje_asignado_confirmar_v1')!;
    expect(n01.botones.map((b) => [b.texto, (b as { payloadPrefijo: string }).payloadPrefijo])).toEqual([
      ['Acepto el viaje', PREFIJO_BOTON.viajeAcepto], ['No puedo tomarlo', PREFIJO_BOTON.viajeRechazo],
    ]);
    const n02 = plantillaDeCatalogo('viaje_instrucciones_ruta_v1')!;
    expect((n02.botones[0] as { payloadPrefijo: string }).payloadPrefijo).toBe(PREFIJO_BOTON.instruccionesOk);
    // El payload del botón lleva el viaje: lo que `leerBotonConductor` entiende.
    const op = opcionesDeEnvio('viaje_asignado_confirmar_v1', { cuerpo: ['Juan', 'F-1', 'importación', 'A', 'B', 'hoy'], idsBotones: V1 });
    expect(op.botones?.map((b) => leerBotonConductor((b as { payload: string }).payload)?.prefijo)).toEqual(['viaje_acepto', 'viaje_rechazo']);
  });

  it('las instrucciones traen caja, cita (hora de México), patio y las dos rutas; N02 lleva los mismos datos', () => {
    const v = viajeBase({ id: V1, citaOrigenEn: '2026-10-16T14:00:00.000Z', entregarEn: 'Patio Norte 2' });
    const m = armarInstrucciones(v, { caja: 'CJ-5521', rutaCarga: 'https://maps.app.goo.gl/abc123', rutaPatio: 'https://maps.app.goo.gl/def456' }, 'entregar_en', AHORA);
    expect(m.texto).toContain('Confirmado el viaje F-1042');
    expect(m.texto).toContain('Caja: CJ-5521');
    expect(m.texto).toContain('Cita: Planta Zapopan a las 08:00');
    expect(m.texto).toContain('Entrega en el patio: Patio Norte 2');
    expect(m.texto).toContain('Ruta al punto de carga: https://maps.app.goo.gl/abc123');
    expect(m.texto).toContain('Ruta al patio de entrega: https://maps.app.goo.gl/def456');
    expect(m.botones).toEqual([{ id: `instr_ok:${V1}`, titulo: 'Entendido' }]);
    expect(m.plantilla.nombre).toBe('viaje_instrucciones_ruta_v1');
    expect(m.plantilla.parametros).toEqual(['F-1042', 'Juan', 'CJ-5521', 'Planta Zapopan', '08:00', 'Patio Norte 2', 'https://maps.app.goo.gl/abc123', 'https://maps.app.goo.gl/def456']);
    // Meta rechaza saltos de línea y cuatro espacios en un parámetro.
    expect(m.plantilla.parametros!.every((x) => !/\n|\t| {4}/.test(x))).toBe(true);
    expect(textoRenderizado('viaje_instrucciones_ruta_v1', m.plantilla.parametros!)).toContain('caja CJ-5521, cita en Planta Zapopan a las 08:00');
  });

  it('lo que falta NO se inventa: se dice «por confirmar» / «consulta con tu supervisor»', () => {
    const v = viajeBase({ id: V1, citaOrigenEn: null, destino: null, entregarEn: null });
    const m = armarInstrucciones(v, { caja: null, rutaCarga: null, rutaPatio: null }, 'entregar_en', AHORA);
    expect(m.texto).toContain('Caja: por confirmar con tu supervisor');
    expect(m.texto).toContain('sin cita registrada, confírmala con tu supervisor');
    expect(m.texto).toContain('Entrega en el patio: por confirmar con tu supervisor');
    expect(m.texto).toContain(`Ruta al punto de carga: ${SIN_DATO}`);
    expect(m.texto).not.toMatch(/undefined|null|N\/A/);
  });

  it('el patio sale de «Entregar en» o del destino según lo que la flota decidió', () => {
    const v = viajeBase({ id: V1, destino: 'CEDIS Monterrey', entregarEn: 'Patio Norte 2' });
    expect(armarInstrucciones(v, { caja: null, rutaCarga: null, rutaPatio: null }, 'entregar_en', AHORA).texto).toContain('patio: Patio Norte 2');
    expect(armarInstrucciones(v, { caja: null, rutaCarga: null, rutaPatio: null }, 'destino', AHORA).texto).toContain('patio: CEDIS Monterrey');
  });

  it('una cita de otro día lo dice con el día', () => {
    const v = viajeBase({ id: V1, citaOrigenEn: '2026-10-17T15:30:00.000Z' });
    expect(armarInstrucciones(v, { caja: null, rutaCarga: null, rutaPatio: null }, 'entregar_en', AHORA).texto).toContain('a las 09:30 del 17/10');
  });

  it('el aviso del rechazo dice quién y qué viaje; fuera de ventana va la genérica de operación', () => {
    const m = armarAvisoRechazo({ id: V1, folio: 'F-9', operadorNombre: 'Chofer Uno' });
    expect(m.texto).toMatch(/Chofer Uno no puede tomar el viaje F-9/);
    expect(m.plantilla.nombre).toBe('aviso_operacion_v1');
  });

  it('la perilla es de configuración: apagada por omisión y solo `true` la enciende', () => {
    expect(CONFIG_CONDUCTOR_DEFAULT.asignacionBotonesActiva).toBe(false);
    const forma = { ...CONFIG_CONDUCTOR_DEFAULT, solicitudesMin: [...CONFIG_CONDUCTOR_DEFAULT.solicitudesMin], diasSemana: [...CONFIG_CONDUCTOR_DEFAULT.diasSemana] };
    const ok = (extra: Record<string, unknown>) => validarConfigConductor({ ...forma, ...extra } as never) as { ok: { asignacionBotonesActiva?: boolean } };
    expect(ok({}).ok.asignacionBotonesActiva).toBe(false);
    expect(ok({ asignacionBotonesActiva: 'true' }).ok.asignacionBotonesActiva).toBe(false);
    expect(ok({ asignacionBotonesActiva: true }).ok.asignacionBotonesActiva).toBe(true);
  });
});

describe('aceptar con el botón', () => {
  it('acepta, manda las instrucciones completas por el envío (botón «Entendido») y las del convenio', async () => {
    const { pu, toca } = escenario();
    const r = await toca('viaje_acepto');
    expect(pu.aceptaciones).toEqual([V1]);
    expect(pu.enviados).toHaveLength(1);
    expect(pu.enviados[0]).toMatchObject({ tel: '5219990000001', contexto: 'conductor.asignacion_instrucciones' });
    expect(pu.enviados[0].texto).toMatch(/Caja: CJ-5521[\s\S]*Cita: Planta Zapopan a las 08:00[\s\S]*Patio Norte 2/);
    expect(pu.enviados[0].botones[0].id).toBe(`instr_ok:${V1}`);
    expect(pu.convenios).toEqual([V1]);
    // El mensaje de instrucciones ES la confirmación: no se duplica con otro acuse.
    expect(r?.mensajes).toEqual([]);
  });

  it('con la ventana cerrada las instrucciones salen por la plantilla N02 (lo decide el envío con respaldo)', async () => {
    const { pu, toca } = escenario({ via: 'plantilla' });
    await toca('viaje_acepto');
    expect(pu.enviados[0].plantilla.nombre).toBe('viaje_instrucciones_ruta_v1');
    expect(pu.enviados[0].plantilla.parametros).toHaveLength(8);
  });

  it('aceptar dos veces es idempotente: la segunda no manda nada ni reescribe', async () => {
    const { pu, toca } = escenario();
    await toca('viaje_acepto');
    const r2 = await toca('viaje_acepto');
    expect(pu.enviados).toHaveLength(1);
    expect(pu.convenios).toHaveLength(1);
    expect(textos(r2)).toMatch(/Ya tengo confirmado tu viaje F-1042/);
  });

  it('si el envío de las instrucciones falla, el texto va como respuesta del turno (el chofer no se queda sin ellas)', async () => {
    const { toca } = escenario({ envioOk: false });
    const r = await toca('viaje_acepto');
    expect(r?.mensajes).toHaveLength(1);
    expect(r?.mensajes[0].texto).toMatch(/Caja: CJ-5521/);
    expect(r?.mensajes[0].botones?.[0].titulo).toBe('Entendido');
  });

  it('si no se pueden leer la caja y las rutas, igual confirma y manda las instrucciones diciendo «por confirmar»', async () => {
    const { pu, toca } = escenario({ datosFallan: true });
    await toca('viaje_acepto');
    expect(pu.enviados).toHaveLength(1);
    expect(pu.enviados[0].texto).toContain('Caja: por confirmar con tu supervisor');
  });

  it('un viaje que nunca se avisó (la 0058 lo prohíbe) o ya no está abierto no se acepta ni manda nada', async () => {
    for (const r of ['sin_aviso', 'no_encontrado'] as const) {
      const { pu, toca } = escenario({ aceptar: r });
      const sal = await toca('viaje_acepto');
      expect(textos(sal)).toMatch(/ya no está vigente/);
      expect(pu.enviados).toEqual([]);
      expect(pu.convenios).toEqual([]);
    }
  });

  it('si la base falla al aceptar, no manda instrucciones de un viaje que no quedó aceptado', async () => {
    const { pu, toca } = escenario({ aceptar: 'fallo' });
    const r = await toca('viaje_acepto');
    expect(textos(r)).toMatch(/No pude anotarlo/);
    expect(pu.enviados).toEqual([]);
  });

  it('el botón de OTRO chofer o de otro viaje nunca toca datos ajenos', async () => {
    const m = crearMemoria({ viajes: [viajeBase({ id: V1, operadorId: 'otro', aceptadoEn: null })], config: { asignacionBotonesActiva: true } });
    const pu = puertos();
    m.deps.asignacion = pu.p;
    const r = await atenderConductor({ ...base, texto: `viaje_acepto:${V1}` }, m.deps);
    expect(textos(r)).toMatch(/de otro viaje/);
    expect(pu.aceptaciones).toEqual([]);
  });

  it('un viaje liquidado contesta que ya está cerrado', async () => {
    const { pu, toca } = escenario({}, { estatus: 'liquidado' });
    expect(textos(await toca('viaje_acepto'))).toMatch(/ya está cerrado/);
    expect(pu.aceptaciones).toEqual([]);
  });

  it('«Entendido» se acusa sin tocar nada', async () => {
    const { pu, toca } = escenario();
    expect(textos(await toca('instr_ok'))).toMatch(/Anotado/);
    expect(pu.aceptaciones).toEqual([]);
    expect(pu.enviados).toEqual([]);
  });
});

describe('rechazar con el botón', () => {
  it('avisa UNA vez al despachador (claim nivel 9 sobre un hito del viaje) y acusa al chofer', async () => {
    const { pu, toca } = escenario();
    const r = await toca('viaje_rechazo');
    expect(pu.claims).toHaveLength(1);
    expect(pu.claims[0]).toMatchObject({ clase: 'escalacion', nivel: NIVEL_AVISO_RECHAZO });
    expect(NIVEL_AVISO_RECHAZO).toBe(9);
    expect(pu.enviados).toHaveLength(1);
    expect(pu.enviados[0]).toMatchObject({ tel: '5219990009999', contexto: 'conductor.asignacion_rechazo' });
    expect(pu.enviados[0].texto).toMatch(/no puede tomar el viaje F-1042/);
    expect(pu.cierres).toEqual([{ ok: true, motivo: null }]);
    expect(textos(r)).toMatch(/Ya le avisé al despachador/);
    // Rechazar no acepta: el viaje no cambia de estado.
    expect(pu.aceptaciones).toEqual([]);
  });

  it('tocar dos veces no duplica el aviso (el claim ya está ganado por la primera)', async () => {
    const { pu, toca } = escenario({ reclamoPerdido: true });
    const r = await toca('viaje_rechazo');
    expect(pu.enviados).toEqual([]);
    expect(textos(r)).toMatch(/Ya le avisé al despachador/);
  });

  it('sin destinatario no es silencio: el claim queda cerrado con el motivo y al chofer se le dice que avise directo', async () => {
    const { pu, toca } = escenario({ destinos: [] });
    const r = await toca('viaje_rechazo');
    expect(pu.cierres).toEqual([{ ok: false, motivo: 'sin_destinatario' }]);
    expect(textos(r)).toMatch(/no pude avisarle al despachador/);
  });

  it('un viaje que ya aceptó no se rechaza por botón: se le dice que avise a su supervisor', async () => {
    const { pu, toca } = escenario({}, { aceptadoEn: '2026-10-16T13:00:00.000Z' });
    const r = await toca('viaje_rechazo');
    expect(pu.enviados).toEqual([]);
    expect(textos(r)).toMatch(/Ya habías aceptado/);
  });

  it('con el envío rechazado el acuse no afirma que se avisó', async () => {
    const { toca } = escenario({ envioOk: false });
    expect(textos(await toca('viaje_rechazo'))).toMatch(/no pude avisarle al despachador/);
  });
});
