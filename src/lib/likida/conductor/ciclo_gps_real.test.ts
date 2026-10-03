import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
// El módulo real importa Supabase y Meta por las cadenas de repo/avisos; aquí solo se ejercen las dependencias inyectadas.
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => { throw new Error('no se toca la base en esta prueba'); } }));
vi.mock('./avisos_oficina', () => ({ avisarOficinaDeHito: vi.fn() }));

const { aplicarDeteccion } = await import('./ciclo_gps_real');
import { CONFIG_CONDUCTOR_DEFAULT } from './config';
import type { Deteccion } from './ciclo_gps';
import type { DepsAplicarDeteccion } from './ciclo_gps_real';
import { hitoVacio, viajeBase } from './memoria.fixture';

const AHORA = new Date('2026-10-02T14:30:00.000Z');
const DET = new Date('2026-10-02T14:05:00.000Z');
const viaje = viajeBase({ id: 'v1', unidadId: 'u1' });
const SITIO = { id: 's1', nombre: 'Planta Zapopan', lat: 20.5, lng: -103.3, radioM: 300 };

function deps(sobre: Partial<DepsAplicarDeteccion> = {}) {
  const llamadas: Record<string, unknown[][]> = { registrar: [], veredicto: [], validar: [], legado: [], evento: [], oficina: [] };
  const d: DepsAplicarDeteccion = {
    registrarHito: async (x) => { llamadas.registrar.push([x]); return 'ok'; },
    aplicarVeredicto: async (t, h, v) => { llamadas.veredicto.push([t, h, v]); return 'nuevo'; },
    validarHito: async (h, por) => { llamadas.validar.push([h, por]); return 'ok'; },
    sincronizarLegado: async (t, v, sellos, cuando) => { llamadas.legado.push([t, v, sellos, cuando]); },
    evento: async (h, e, det) => { llamadas.evento.push([h, e, det]); },
    avisarOficina: async (a) => { llamadas.oficina.push([a]); return 'enviado'; },
    ...sobre,
  };
  return { d, llamadas };
}

const det = (tipo: Deteccion['tipo'], extra: Partial<Deteccion> = {}): Deteccion => ({
  tipo, entrada: tipo.startsWith('llegada'), sitio: SITIO, detectadoEn: DET, distanciaM: 42, omitir: [], fueraDeOrden: false, ...extra,
});
const hito = (tipo: Deteccion['tipo']) => hitoVacio({ id: `h-${tipo}`, viajeId: 'v1', tipo, tenantId: 't1' });

describe('aplicarDeteccion — registrar, validar, sellar y avisar', () => {
  it('una LLEGADA entra con fuente «sistema», la hora de la MUESTRA y su veredicto «validado» por GPS', async () => {
    const { d, llamadas } = deps();
    const r = await aplicarDeteccion(viaje, hito('llegada_carga'), det('llegada_carga'), CONFIG_CONDUCTOR_DEFAULT, AHORA, d);
    expect(r).toBe('ok');
    expect(llamadas.registrar[0][0]).toMatchObject({ fuente: 'sistema', interpretacion: 'sistema', mensajeEn: DET, ahora: AHORA, waMessageId: null, texto: null, contacto: null, omitir: [] });
    const [tenant, registrado, veredicto] = llamadas.veredicto[0] as [string, { estado: string; fuente: string }, Record<string, unknown>];
    expect(tenant).toBe('t1');
    expect(registrado).toMatchObject({ estado: 'recibido', fuente: 'sistema' });
    expect(veredicto).toMatchObject({ resultado: 'validado', fuente: 'gps', distanciaM: 42, sitioId: 's1', radioM: 300, toleranciaM: CONFIG_CONDUCTOR_DEFAULT.toleranciaUbicacionM, medidaEn: DET, metodo: 'circulo' });
    expect(llamadas.validar).toHaveLength(0); // el veredicto ya valida el hito
    expect(llamadas.evento[0][1]).toBe('recibido');
    expect(llamadas.evento[0][2]).toMatchObject({ fuente: 'sistema', por: 'geocerca', cruce: 'entrada', distancia_m: 42 });
  });

  it('un sitio con polígono se anota como decidido con polígono', async () => {
    const { d, llamadas } = deps();
    const sitio = { ...SITIO, poligono: [{ lat: 20.49, lng: -103.31 }, { lat: 20.49, lng: -103.29 }, { lat: 20.51, lng: -103.29 }] };
    await aplicarDeteccion(viaje, hito('llegada_carga'), det('llegada_carga', { sitio }), CONFIG_CONDUCTOR_DEFAULT, AHORA, d);
    expect((llamadas.veredicto[0][2] as { metodo: string }).metodo).toBe('poligono');
  });

  it('una SALIDA no se compara contra el sitio: se valida por «gps» y listo', async () => {
    const { d, llamadas } = deps();
    await aplicarDeteccion(viaje, hito('salida_carga'), det('salida_carga'), CONFIG_CONDUCTOR_DEFAULT, AHORA, d);
    expect(llamadas.veredicto).toHaveLength(0);
    expect(llamadas.validar).toHaveLength(1);
    expect(llamadas.validar[0][1]).toBe('gps');
    expect(llamadas.evento[0][2]).toMatchObject({ cruce: 'salida' });
  });

  it('si el veredicto no se pudo escribir, el hito igual se valida por GPS (no queda a medias)', async () => {
    const { d, llamadas } = deps({ aplicarVeredicto: async () => 'fallo' });
    await aplicarDeteccion(viaje, hito('llegada_carga'), det('llegada_carga'), CONFIG_CONDUCTOR_DEFAULT, AHORA, d);
    expect(llamadas.validar).toHaveLength(1);
  });

  it('si el chofer o la oficina ya lo registraron (carrera) no se toca NADA más: ni validación, ni sellos, ni aviso', async () => {
    const { d, llamadas } = deps({ registrarHito: async () => 'carrera' });
    const r = await aplicarDeteccion(viaje, hito('llegada_descarga'), det('llegada_descarga'), { ...CONFIG_CONDUCTOR_DEFAULT, avisarOficinaLlegada: true }, AHORA, d);
    expect(r).toBe('carrera');
    for (const k of ['veredicto', 'validar', 'legado', 'evento', 'oficina']) expect(llamadas[k], k).toHaveLength(0);
  });

  it('un fallo al registrar es fallo (el barrido suelta el claim)', async () => {
    const { d } = deps({ registrarHito: async () => 'fallo' });
    expect(await aplicarDeteccion(viaje, hito('llegada_carga'), det('llegada_carga'), CONFIG_CONDUCTOR_DEFAULT, AHORA, d)).toBe('fallo');
  });

  it('los sellos que lee el Vigía: llegada_descarga sella `llegada`, salida_descarga sella `descarga`, y la carga no sella nada', async () => {
    const a = deps(); await aplicarDeteccion(viaje, hito('llegada_descarga'), det('llegada_descarga'), CONFIG_CONDUCTOR_DEFAULT, AHORA, a.d);
    expect(a.llamadas.legado).toEqual([['t1', 'v1', ['llegada'], DET]]);
    const b = deps(); await aplicarDeteccion(viaje, hito('salida_descarga'), det('salida_descarga'), CONFIG_CONDUCTOR_DEFAULT, AHORA, b.d);
    expect(b.llamadas.legado).toEqual([['t1', 'v1', ['descarga'], DET]]);
    const c = deps(); await aplicarDeteccion(viaje, hito('llegada_carga'), det('llegada_carga'), CONFIG_CONDUCTOR_DEFAULT, AHORA, c.d);
    await aplicarDeteccion(viaje, hito('salida_carga'), det('salida_carga'), CONFIG_CONDUCTOR_DEFAULT, AHORA, c.d);
    expect(c.llamadas.legado).toHaveLength(0);
  });

  it('los hitos anteriores que se dan por omitidos viajan en la MISMA escritura y la bitácora dice que fue fuera de orden', async () => {
    const { d, llamadas } = deps();
    const omitir = [hito('llegada_carga'), hito('salida_carga')];
    await aplicarDeteccion(viaje, hito('llegada_descarga'), det('llegada_descarga', { omitir, fueraDeOrden: true }), CONFIG_CONDUCTOR_DEFAULT, AHORA, d);
    expect((llamadas.registrar[0][0] as { omitir: unknown[] }).omitir).toHaveLength(2);
    expect(llamadas.evento[0][2]).toMatchObject({ fuera_de_orden: true });
  });

  it('el aviso a la oficina sale solo si la flota lo pidió: llegada con `avisarOficinaLlegada`, salida con `avisarOficinaSalida`', async () => {
    const a = deps();
    await aplicarDeteccion(viaje, hito('llegada_carga'), det('llegada_carga'), { ...CONFIG_CONDUCTOR_DEFAULT, avisarOficinaSalida: true }, AHORA, a.d);
    expect(a.llamadas.oficina).toHaveLength(0);
    await aplicarDeteccion(viaje, hito('llegada_carga'), det('llegada_carga'), { ...CONFIG_CONDUCTOR_DEFAULT, avisarOficinaLlegada: true }, AHORA, a.d);
    expect(a.llamadas.oficina).toHaveLength(1);
    expect(a.llamadas.oficina[0][0]).toMatchObject({ mensajeEn: DET, contacto: null });

    const b = deps();
    await aplicarDeteccion(viaje, hito('salida_carga'), det('salida_carga'), { ...CONFIG_CONDUCTOR_DEFAULT, avisarOficinaSalida: true }, AHORA, b.d);
    expect(b.llamadas.oficina).toHaveLength(1);
  });

  it('un aviso a la oficina que revienta no deshace el hito ya registrado', async () => {
    const { d } = deps({ avisarOficina: async () => { throw new Error('Meta caído'); } });
    expect(await aplicarDeteccion(viaje, hito('llegada_carga'), det('llegada_carga'), { ...CONFIG_CONDUCTOR_DEFAULT, avisarOficinaLlegada: true }, AHORA, d)).toBe('ok');
  });
});
