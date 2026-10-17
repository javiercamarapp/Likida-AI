import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => { throw new Error('esta prueba no toca la base'); } }));
vi.mock('@/lib/meta/client', () => ({ enviarSolicitudUbicacion: vi.fn(async () => ({ ok: true })) }));

// T-A5-51 (R07): antes de iniciar el viaje se le pregunta al chofer si quiere gastos de viaje / ETC para generar el vale.
// Fixtures SINTÉTICOS: ningún nombre real.
const { atenderConductor } = await import('./atender');
const { crearMemoria, viajeBase } = await import('./memoria.fixture');
const { leerBotonConductor, PREFIJO_BOTON } = await import('./tipos');
const { armarPreguntaGastos, responderGastos, puertosGastosReales } = await import('./gastos_etc');
const { plantillaDeCatalogo, validarCatalogo } = await import('@/lib/meta/plantillas_catalogo');
const { validarConfigConductor, CONFIG_CONDUCTOR_DEFAULT } = await import('./config');
import type { PuertosAsignacion } from './asignacion';
import type { PuertosGastos, ResultadoGuardarGastos } from './gastos_etc';

const V1 = '4f1f6e2e-95c1-4c52-9f9e-3f6f6bd8d046';
const AHORA = new Date('2026-10-16T14:00:00.000Z');
const base = { tenantId: 't1', operadorId: 'o1', telefono: '5219990000001', viajeAbiertoId: V1, ahora: AHORA };

interface Envio { tel: string; texto: string; botones: Array<{ id: string; titulo: string }>; plantilla: { nombre: string; parametros?: string[] }; contexto: string }

function escenario(opts: { perilla: boolean; guardar?: ResultadoGuardarGastos; guardarLanza?: boolean; envioOk?: boolean }) {
  const m = crearMemoria({
    viajes: [viajeBase({ id: V1, aceptadoEn: null, citaOrigenEn: '2026-10-16T14:00:00.000Z', entregarEn: 'Patio Norte 2' })],
    config: { validarUbicacion: false, asignacionBotonesActiva: true, gastosEtcActiva: opts.perilla },
  });
  const enviados: Envio[] = [];
  const guardados: Array<{ viajeId: string; operadorId: string; respuesta: string }> = [];
  const enviar: PuertosAsignacion['enviar'] = async (tel, msg, contexto) => {
    enviados.push({ tel, texto: msg.texto, botones: msg.botones, plantilla: msg.plantilla as never, contexto });
    return opts.envioOk === false
      ? { ok: false, motivo: 'rechazo_no_ventana', mensaje: 'rechazado', fueraDeVentana: false, reintentable: false, ventana: 'desconocida' as never }
      : { ok: true, via: 'botones', id: 'x', motivo: 'ventana_abierta', ventana: 'abierta' as never };
  };
  m.deps.asignacion = {
    aceptar: async () => 'aceptado', datos: async () => ({ caja: 'CJ-5521', rutaCarga: null, rutaPatio: null }), convenio: async () => undefined,
    reclamar: async () => 'ganado', cerrarAviso: async () => undefined, destinatarios: async () => [], enviar,
  };
  const gastos: PuertosGastos = {
    enviar,
    guardar: async (_t, viajeId, operadorId, respuesta) => {
      if (opts.guardarLanza) throw new Error('base caída');
      guardados.push({ viajeId, operadorId, respuesta });
      return opts.guardar ?? 'guardado';
    },
  };
  m.deps.gastos = gastos;
  const toca = (prefijo: string) => atenderConductor({ ...base, texto: `${prefijo}:${V1}`, waMessageId: `wa-${Math.random()}` }, m.deps);
  return { m, enviados, guardados, toca };
}
const textos = (r: Awaited<ReturnType<typeof atenderConductor>>) => (r?.mensajes ?? []).map((x) => x.texto).join('\n');

describe('reglas puras', () => {
  it('lee los botones gastos_si / gastos_no con el viaje y rechaza lo inventado', () => {
    for (const pre of ['gastos_si', 'gastos_no']) expect(leerBotonConductor(`${pre}:${V1}`)).toMatchObject({ prefijo: pre, viajeId: V1 });
    expect(leerBotonConductor('gastos_si:no-es-uuid')).toBeNull();
    expect(leerBotonConductor(`gastos_no:${V1}:extra`)).toBeNull();
  });

  it('N03 está en el catálogo, pasa las reglas de Meta, tiene llamador y sus botones son los que lee el módulo', () => {
    expect(validarCatalogo()).toEqual([]);
    const n03 = plantillaDeCatalogo('viaje_gastos_etc_v1')!;
    expect(n03.llamador).toBe('src/lib/likida/conductor/gastos_etc.ts');
    expect(n03.botones.map((b) => [b.texto, (b as { payloadPrefijo: string }).payloadPrefijo])).toEqual([
      ['Sí, necesito gastos', PREFIJO_BOTON.gastosSi], ['No necesito', PREFIJO_BOTON.gastosNo],
    ]);
  });

  it('la pregunta lleva los dos botones con el viaje y la plantilla N03 con nombre y folio; no pide montos', () => {
    const m = armarPreguntaGastos(viajeBase({ id: V1 }));
    expect(m.botones).toEqual([{ id: `gastos_si:${V1}`, titulo: 'Sí, necesito gastos' }, { id: `gastos_no:${V1}`, titulo: 'No necesito' }]);
    expect(m.plantilla.nombre).toBe('viaje_gastos_etc_v1');
    expect(m.plantilla.parametros).toEqual(['Juan', 'F-1042']);
    expect(m.texto).toContain('F-1042');
    expect(m.texto).toMatch(/gastos de viaje o ETC/);
    expect(m.texto).not.toMatch(/\$|monto|cuánto|cuanto/i);
    // Texto y plantilla dicen lo mismo y la plantilla cumple las reglas de Meta (sin saltos de línea en parámetros).
    expect(m.plantilla.parametros!.every((x) => !/\n|\t| {4}/.test(x))).toBe(true);
  });

  it('config: la perilla viene apagada y solo un booleano verdadero la enciende', () => {
    expect(CONFIG_CONDUCTOR_DEFAULT.gastosEtcActiva).toBe(false);
    const forma = { ...CONFIG_CONDUCTOR_DEFAULT };
    const ok = (extra: Record<string, unknown>) => validarConfigConductor({ ...forma, ...extra } as never) as { ok: { gastosEtcActiva?: boolean } };
    expect(ok({}).ok.gastosEtcActiva).toBe(false);
    expect(ok({ gastosEtcActiva: 'true' }).ok.gastosEtcActiva).toBe(false);
    expect(ok({ gastosEtcActiva: true }).ok.gastosEtcActiva).toBe(true);
  });
});

describe('la pregunta sale al aceptar el viaje (cableado de salida)', () => {
  it('con la perilla encendida: tras las instrucciones sale la pregunta N03 con sus dos botones', async () => {
    const { toca, enviados } = escenario({ perilla: true });
    await toca('viaje_acepto');
    const pregunta = enviados.filter((e) => e.contexto === 'conductor.gastos_etc_pregunta');
    expect(pregunta).toHaveLength(1);
    expect(pregunta[0].tel).toBe(base.telefono);
    expect(pregunta[0].botones.map((b) => b.id)).toEqual([`gastos_si:${V1}`, `gastos_no:${V1}`]);
    expect(pregunta[0].plantilla.nombre).toBe('viaje_gastos_etc_v1');
    // Las instrucciones salen ANTES: la pregunta no las retiene ni las reemplaza.
    expect(enviados.map((e) => e.contexto)).toEqual(['conductor.asignacion_instrucciones', 'conductor.gastos_etc_pregunta']);
  });

  it('perilla apagada: no pregunta nada (solo las instrucciones de siempre)', async () => {
    const { toca, enviados } = escenario({ perilla: false });
    await toca('viaje_acepto');
    expect(enviados.map((e) => e.contexto)).toEqual(['conductor.asignacion_instrucciones']);
  });

  it('un segundo toque de «Acepto» no repite la pregunta', async () => {
    const { m, toca, enviados } = escenario({ perilla: true });
    await toca('viaje_acepto');
    expect(enviados.filter((e) => e.contexto === 'conductor.gastos_etc_pregunta')).toHaveLength(1);
    // El puerto de aceptar del escenario siempre dice 'aceptado'; para el segundo toque dice «ya aceptado», como la base real.
    m.deps.asignacion!.aceptar = async () => 'ya_aceptado';
    const r = await toca('viaje_acepto');
    expect(textos(r)).toContain('Ya tengo confirmado');
    expect(enviados.filter((e) => e.contexto === 'conductor.gastos_etc_pregunta')).toHaveLength(1);
  });

  it('si la pregunta no se puede mandar, la aceptación y las instrucciones siguen valiendo (no bloquea)', async () => {
    const { toca, enviados } = escenario({ perilla: true, envioOk: false });
    const r = await toca('viaje_acepto');
    expect(r).not.toBeNull();
    expect(textos(r)).toContain('Confirmado el viaje');
    expect(enviados.some((e) => e.contexto === 'conductor.gastos_etc_pregunta')).toBe(true);
  });
});

describe('la respuesta del chofer (cableado de entrada)', () => {
  it('«Sí, necesito gastos» se guarda como si y se le agradece sin prometer montos', async () => {
    const { toca, guardados } = escenario({ perilla: true });
    const r = await toca('gastos_si');
    expect(guardados).toEqual([{ viajeId: V1, operadorId: 'o1', respuesta: 'si' }]);
    expect(textos(r)).toMatch(/gastos/i);
    expect(textos(r)).not.toMatch(/\$|monto/i);
  });

  it('«No necesito» se guarda como no', async () => {
    const { toca, guardados } = escenario({ perilla: true });
    const r = await toca('gastos_no');
    expect(guardados).toEqual([{ viajeId: V1, operadorId: 'o1', respuesta: 'no' }]);
    expect(textos(r)).toMatch(/no necesitas/i);
  });

  it('contestar otra vez no cambia lo ya guardado: se le dice que ya quedó', async () => {
    const { toca } = escenario({ perilla: true, guardar: 'ya_respondio' });
    const r = await toca('gastos_no');
    expect(textos(r)).toMatch(/ya tengo tu respuesta/i);
  });

  it('un botón de un viaje que no es suyo o que ya no existe no guarda nada', async () => {
    const { m, guardados } = escenario({ perilla: true });
    const otro = '7b0c7d52-7f8e-4b0c-8f3c-2f6f6bd8d099';
    const r = await atenderConductor({ ...base, texto: `gastos_si:${otro}`, waMessageId: 'wa-x' }, m.deps);
    expect(textos(r)).toMatch(/otro viaje|ya no está vigente/);
    expect(guardados).toEqual([]);
  });

  it('la perilla apagada después de preguntar no deja un botón muerto: la respuesta se atiende igual', async () => {
    const { m, guardados } = escenario({ perilla: false });
    await atenderConductor({ ...base, texto: `gastos_si:${V1}`, waMessageId: 'wa-y' }, m.deps);
    expect(guardados).toHaveLength(1);
  });

  it('viaje liquidado: no se guarda', async () => {
    const m = crearMemoria({ viajes: [viajeBase({ id: V1, estatus: 'liquidado' })], config: { gastosEtcActiva: true } });
    const guardados: string[] = [];
    m.deps.gastos = { enviar: async () => ({ ok: true, via: 'botones', id: 'x', motivo: 'ventana_abierta', ventana: 'abierta' as never }), guardar: async (_t, v) => { guardados.push(v); return 'guardado'; } };
    const r = await atenderConductor({ ...base, texto: `gastos_si:${V1}`, waMessageId: 'wa-z' }, m.deps);
    expect(textos(r)).toMatch(/cerrado/);
    expect(guardados).toEqual([]);
  });

  it('si la base falla, no finge: pide reintentar y nunca lanza', async () => {
    const { toca } = escenario({ perilla: true, guardarLanza: true });
    const r = await toca('gastos_si');
    expect(textos(r)).toMatch(/no pude anotarlo/i);
  });

  it('sin dónde guardar (falta el slot de migración) no finge que quedó anotado', async () => {
    const { toca } = escenario({ perilla: true, guardar: 'sin_almacen' });
    const r = await toca('gastos_si');
    expect(textos(r)).toMatch(/recibí tu respuesta/i);
    expect(textos(r)).not.toMatch(/anotad/i);
  });
});

describe('puertos reales', () => {
  it('hasta que exista el slot de migración, guardar devuelve sin_almacen y NO toca la base', async () => {
    const p = puertosGastosReales();
    await expect(p.guardar('t1', V1, 'o1', 'si', AHORA)).resolves.toBe('sin_almacen');
  });

  it('responderGastos nunca lanza aunque el puerto lance', async () => {
    const p: PuertosGastos = { enviar: async () => { throw new Error('x'); }, guardar: async () => { throw new Error('x'); } };
    const r = await responderGastos(p, { viaje: viajeBase({ id: V1 }), respuesta: 'si', ahora: AHORA });
    expect(r[0].texto).toMatch(/no pude anotarlo/i);
  });
});
