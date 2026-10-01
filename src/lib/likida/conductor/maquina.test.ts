import { describe, it, expect } from 'vitest';
import { decidir, hitoActivo, viajeCompleto, ultimoHitoRegistrado, type Decision, type EntradaMaquina } from './maquina';
import { hitoVacio } from './memoria.fixture';
import { TIPOS_HITO, type HitoFila, type TipoHito } from './tipos';
import type { Intencion } from './interprete';

const AHORA = new Date('2026-10-02T20:00:00.000Z');
const iso = (min: number) => new Date(AHORA.getTime() - min * 60_000).toISOString();

/** Los cinco hitos del viaje con el estado dado (por tipo); lo no mencionado queda `esperado`. */
function viaje(estados: Partial<Record<TipoHito, Partial<HitoFila> & { hace?: number }>> = {}): HitoFila[] {
  return TIPOS_HITO.map((tipo, i) => {
    const e = estados[tipo];
    const base = hitoVacio({ id: `h${i}`, tipo, viajeId: 'v1' });
    if (!e) return base;
    const { hace, ...resto } = e;
    const registrado = resto.estado === 'recibido' || resto.estado === 'validado';
    return {
      ...base, ...(registrado ? { fuente: 'texto' as const, mensajeEn: iso(hace ?? 5), recibidoEn: iso(hace ?? 5) } : {}),
      ...(resto.estado === 'validado' ? { validadoEn: iso(1), validadoPor: 'oficina' as const } : {}), ...resto,
    };
  });
}

const entrada = (hitos: HitoFila[], intencion: Intencion, extra: Partial<EntradaMaquina> = {}): EntradaMaquina => ({
  hitos, intencion, contacto: null, ahora: AHORA, mensajeEn: AHORA, ventanaCorreccionMin: 60, posponerMin: 30, ...extra,
});
const llegada = (lugar: 'carga' | 'descarga' | null = null): Intencion => ({ clase: 'llegada', lugar });
const salida = (lugar: 'carga' | 'descarga' | null = null): Intencion => ({ clase: 'salida', lugar });

function registra(d: Decision) {
  if (d.accion !== 'registrar') throw new Error(`se esperaba registrar y fue ${d.accion}`);
  return d;
}

describe('«ya llegué» a secas se resuelve por el ESTADO del viaje (el defecto de la 0090)', () => {
  it('con nada registrado es la llegada a CARGAR, no al destino', () => {
    const d = registra(decidir(entrada(viaje(), llegada())));
    expect(d.objetivo).toBe('llegada_carga');
    expect(d.ambigua).toBe(true);
    expect(d.legado).toEqual([]); // `viaje.llegada_en` (destino) NO se sella con una llegada al origen
  });

  it('con la salida de carga registrada es la llegada a DESCARGAR y sella el legado `llegada`', () => {
    const d = registra(decidir(entrada(viaje({ llegada_carga: { estado: 'recibido' }, salida_carga: { estado: 'recibido' } }), llegada())));
    expect(d.objetivo).toBe('llegada_descarga');
    expect(d.ambigua).toBe(false);
    expect(d.legado).toEqual(['llegada']);
  });

  it('con la llegada a carga registrada y NADA más, es ambiguo: se pregunta (duplicado o descarga)', () => {
    const d = decidir(entrada(viaje({ llegada_carga: { estado: 'recibido' } }), llegada()));
    expect(d).toEqual({ accion: 'aclarar', pregunta: 'llegada' });
  });

  it('una llegada al ORIGEN nunca sella la llegada al DESTINO', () => {
    for (const hs of [viaje(), viaje({ llegada_carga: { estado: 'recibido' } })]) {
      const d = decidir(entrada(hs, llegada('carga')));
      expect(d.accion === 'registrar' ? d.objetivo : d.accion === 'duplicado' ? d.objetivo : null).toBe('llegada_carga');
    }
  });

  it('si ya llegó a descargar, repetirlo es un duplicado de la descarga', () => {
    const d = decidir(entrada(viaje({ llegada_carga: { estado: 'recibido' }, salida_carga: { estado: 'recibido' }, llegada_descarga: { estado: 'recibido' } }), llegada()));
    expect(d).toMatchObject({ accion: 'duplicado', objetivo: 'llegada_descarga' });
  });

  it('el lugar explícito manda sobre el estado', () => {
    expect(registra(decidir(entrada(viaje(), llegada('descarga')))).objetivo).toBe('llegada_descarga');
  });
});

describe('secuencia válida y mensajes fuera de orden', () => {
  it('la secuencia completa, paso a paso, registra cada hito sin omitir nada', () => {
    let hs = viaje();
    const pasos: Array<[Intencion, TipoHito]> = [
      [llegada('carga'), 'llegada_carga'], [salida('carga'), 'salida_carga'], [llegada('descarga'), 'llegada_descarga'],
      [salida('descarga'), 'salida_descarga'], [{ clase: 'regreso' }, 'regreso'],
    ];
    for (const [i, objetivo] of pasos) {
      const d = registra(decidir(entrada(hs, i)));
      expect(d.objetivo).toBe(objetivo);
      expect(d.omitir).toEqual([]);
      hs = hs.map((h) => (h.tipo === objetivo ? { ...h, estado: 'recibido' as const, fuente: 'texto' as const, recibidoEn: iso(1), mensajeEn: iso(1) } : h));
    }
    expect(viajeCompleto(hs)).toBe(true);
  });

  it('un hito posterior marca como OMITIDOS a los anteriores pendientes (dejan de perseguirse)', () => {
    const d = registra(decidir(entrada(viaje(), salida('carga'))));
    expect(d.objetivo).toBe('salida_carga');
    expect(d.omitir).toEqual(['llegada_carga']);
    const d2 = registra(decidir(entrada(viaje(), { clase: 'regreso' })));
    expect(d2.omitir).toEqual(['llegada_carga', 'salida_carga', 'llegada_descarga', 'salida_descarga']);
  });

  it('lo ya registrado o ya omitido NO se vuelve a omitir', () => {
    const hs = viaje({ llegada_carga: { estado: 'recibido' }, salida_carga: { estado: 'omitido', omitidoMotivo: 'x' } });
    expect(registra(decidir(entrada(hs, salida('descarga')))).omitir).toEqual(['llegada_descarga']);
  });

  it('un hito ANTERIOR que llega tarde llena su hueco sin tocar a los posteriores', () => {
    const hs = viaje({ llegada_carga: { estado: 'omitido', omitidoMotivo: 'inferido_por_salida_carga' }, salida_carga: { estado: 'recibido' } });
    const d = registra(decidir(entrada(hs, llegada('carga'))));
    expect(d.objetivo).toBe('llegada_carga');
    expect(d.reabre).toBe(true);
    expect(d.omitir).toEqual([]);
  });

  it('«salgo para allá» a secas: carga si no ha salido; descarga si ya llegó; duplicado si va en ruta', () => {
    expect(registra(decidir(entrada(viaje({ llegada_carga: { estado: 'recibido' } }), salida()))).objetivo).toBe('salida_carga');
    expect(registra(decidir(entrada(viaje({ llegada_carga: { estado: 'recibido' }, salida_carga: { estado: 'recibido' }, llegada_descarga: { estado: 'recibido' } }), salida()))).objetivo).toBe('salida_descarga');
    expect(decidir(entrada(viaje({ llegada_carga: { estado: 'recibido' }, salida_carga: { estado: 'recibido' } }), salida()))).toMatchObject({ accion: 'duplicado', objetivo: 'salida_carga' });
  });
});

describe('duplicados: repetir no mueve la hora', () => {
  it('cada hito ya registrado contesta duplicado', () => {
    const hs = viaje({ llegada_carga: { estado: 'recibido' } });
    expect(decidir(entrada(hs, llegada('carga')))).toMatchObject({ accion: 'duplicado', objetivo: 'llegada_carga' });
  });

  it('un hito validado también es duplicado (no se reescribe)', () => {
    const hs = viaje({ llegada_carga: { estado: 'validado' } });
    expect(decidir(entrada(hs, llegada('carga')))).toMatchObject({ accion: 'duplicado' });
  });

  it('repetir la llegada con un contacto nuevo lo ofrece para completar el registro', () => {
    const hs = viaje({ llegada_carga: { estado: 'recibido' } });
    const d = decidir(entrada(hs, llegada('carga'), { contacto: { nombre: 'Juan', area: 'recibo' } }));
    expect(d).toMatchObject({ accion: 'duplicado', contacto: { nombre: 'Juan', area: 'recibo' } });
  });

  it('«descargando» repetido solo aplaza el siguiente y estampa el legado', () => {
    const hs = viaje({ llegada_carga: { estado: 'recibido' }, salida_carga: { estado: 'recibido' }, llegada_descarga: { estado: 'recibido' } });
    expect(decidir(entrada(hs, { clase: 'en_proceso', lugar: 'descarga' }))).toMatchObject({
      accion: 'posponer', objetivo: 'salida_descarga', aplicado: true, legado: ['descarga'],
    });
  });

  it('«descargando» sin llegada registra la llegada a descarga con los dos sellos de la 0090', () => {
    const d = registra(decidir(entrada(viaje({ llegada_carga: { estado: 'recibido' }, salida_carga: { estado: 'recibido' } }), { clase: 'en_proceso', lugar: 'descarga' })));
    expect(d.objetivo).toBe('llegada_descarga');
    expect([...d.legado].sort()).toEqual(['descarga', 'llegada']);
  });
});

describe('contacto en andén', () => {
  const c = { nombre: 'Juan', area: 'recibo' };

  it('llegada + contacto → el contacto viaja en el registro', () => {
    expect(registra(decidir(entrada(viaje(), llegada('carga'), { contacto: c }))).contacto).toEqual(c);
  });

  it('el contacto no viaja en hitos que no son de llegada', () => {
    expect(registra(decidir(entrada(viaje({ llegada_carga: { estado: 'recibido' } }), salida('carga'), { contacto: c }))).contacto).toBeNull();
  });

  it('«me atiende Juan de recibo» sobre una llegada ya registrada solo anota el contacto', () => {
    const hs = viaje({ llegada_carga: { estado: 'recibido' }, salida_carga: { estado: 'recibido' }, llegada_descarga: { estado: 'recibido' } });
    expect(decidir(entrada(hs, { clase: 'contacto', lugar: null }, { contacto: c }))).toEqual({ accion: 'contacto', objetivo: 'llegada_descarga', contacto: c });
  });

  it('el contacto con pista de lugar y sin llegada registrada la registra (quien te atiende ya te vio llegar)', () => {
    const d = registra(decidir(entrada(viaje(), { clase: 'contacto', lugar: 'descarga' }, { contacto: c })));
    expect(d.objetivo).toBe('llegada_descarga');
    expect(d.contacto).toEqual(c);
  });

  it('sin_contacto se aplica a la última llegada registrada; sin llegada se rechaza', () => {
    expect(decidir(entrada(viaje({ llegada_carga: { estado: 'recibido' } }), { clase: 'sin_contacto' }))).toEqual({ accion: 'sin_contacto', objetivo: 'llegada_carga' });
    expect(decidir(entrada(viaje(), { clase: 'sin_contacto' }))).toEqual({ accion: 'rechazar', motivo: 'sin_llegada' });
  });
});

describe('correcciones del chofer', () => {
  it('retira SOLO el último hito registrado (el más avanzado de la secuencia)', () => {
    const hs = viaje({ llegada_carga: { estado: 'recibido', hace: 50 }, salida_carga: { estado: 'recibido', hace: 10 } });
    expect(decidir(entrada(hs, { clase: 'correccion', como: null }))).toMatchObject({ accion: 'corregir', objetivo: 'salida_carga', revertir: ['salida_carga'] });
  });

  it('al retirar un hito regresa también a esperado a los que se OMITIERON por su causa', () => {
    const hs = viaje({ llegada_carga: { estado: 'omitido', omitidoMotivo: 'inferido_por_salida_carga' }, salida_carga: { estado: 'recibido', hace: 5 } });
    expect(decidir(entrada(hs, { clase: 'correccion', como: null }))).toMatchObject({ accion: 'corregir', objetivo: 'salida_carga', revertir: ['salida_carga', 'llegada_carga'] });
  });

  it('un omitido por OTRA causa no se toca', () => {
    const hs = viaje({ llegada_carga: { estado: 'omitido', omitidoMotivo: 'inferido_por_regreso' }, salida_carga: { estado: 'recibido', hace: 5 } });
    expect(decidir(entrada(hs, { clase: 'correccion', como: null }))).toMatchObject({ revertir: ['salida_carga'] });
  });

  it('fuera de la ventana de la flota ya no se puede retirar', () => {
    const hs = viaje({ llegada_carga: { estado: 'recibido', hace: 120 } });
    expect(decidir(entrada(hs, { clase: 'correccion', como: null }))).toEqual({ accion: 'rechazar', motivo: 'fuera_de_ventana' });
    expect(decidir(entrada(hs, { clase: 'correccion', como: null }, { ventanaCorreccionMin: 180 }))).toMatchObject({ accion: 'corregir' });
  });

  it('un hito VALIDADO no se retira desde WhatsApp', () => {
    const hs = viaje({ llegada_carga: { estado: 'validado', hace: 3 } });
    expect(decidir(entrada(hs, { clase: 'correccion', como: null }))).toEqual({ accion: 'rechazar', motivo: 'validado' });
  });

  it('sin nada registrado no hay qué corregir', () => {
    expect(decidir(entrada(viaje(), { clase: 'correccion', como: null }))).toEqual({ accion: 'rechazar', motivo: 'nada_que_corregir' });
  });

  it('«Es en descarga»: retira la llegada a carga y registra la llegada a descarga (con la carga omitida)', () => {
    const hs = viaje({ llegada_carga: { estado: 'recibido', hace: 2 } });
    const d = decidir(entrada(hs, { clase: 'correccion', como: 'llegada_descarga' }));
    expect(d).toMatchObject({ accion: 'corregir', objetivo: 'llegada_carga', revertir: ['llegada_carga'] });
    if (d.accion !== 'corregir' || d.despues?.accion !== 'registrar') throw new Error('se esperaba registrar después');
    expect(d.despues.objetivo).toBe('llegada_descarga');
    expect(d.despues.omitir).toEqual(['llegada_carga', 'salida_carga']);
  });
});

describe('retraso y «sigo cargando»', () => {
  it('«voy con retraso» pospone el hito ACTIVO por los minutos pedidos (acotados)', () => {
    expect(decidir(entrada(viaje(), { clase: 'retraso', minutos: 20 }))).toMatchObject({ accion: 'posponer', objetivo: 'llegada_carga', minutos: 20, aplicado: true });
    expect(decidir(entrada(viaje(), { clase: 'retraso', minutos: null }))).toMatchObject({ minutos: 30 });
    expect(decidir(entrada(viaje(), { clase: 'retraso', minutos: 9999 }))).toMatchObject({ minutos: 240 });
  });

  it('tras dos aplazamientos ya no calla al agente (aplicado:false)', () => {
    const hs = viaje({ llegada_carga: { estado: 'esperado', pospuestoVeces: 2 } });
    expect(decidir(entrada(hs, { clase: 'retraso', minutos: 30 }))).toMatchObject({ accion: 'posponer', aplicado: false });
  });

  it('sin hito pendiente no hay qué aplazar', () => {
    const todo = Object.fromEntries(TIPOS_HITO.map((t) => [t, { estado: 'recibido' as const }]));
    expect(decidir(entrada(viaje(todo), { clase: 'retraso', minutos: 10 }))).toEqual({ accion: 'rechazar', motivo: 'sin_hito_pendiente' });
  });

  it('«Sigo cargando» sin llegada registra la llegada; con ella aplaza la salida de carga', () => {
    expect(registra(decidir(entrada(viaje(), { clase: 'sigue', lugar: 'carga' }))).objetivo).toBe('llegada_carga');
    expect(decidir(entrada(viaje({ llegada_carga: { estado: 'recibido' } }), { clase: 'sigue', lugar: 'carga' }))).toMatchObject({ accion: 'posponer', objetivo: 'salida_carga' });
  });

  it('«Registrar ahora» registra el hito activo', () => {
    const hs = viaje({ llegada_carga: { estado: 'recibido' } });
    expect(registra(decidir(entrada(hs, { clase: 'registrar_activo' }))).objetivo).toBe('salida_carga');
  });
});

describe('la hora del mensaje', () => {
  it('un timestamp del FUTURO se recorta al reloj del servidor y se marca', () => {
    const d = registra(decidir(entrada(viaje(), llegada('carga'), { mensajeEn: new Date(AHORA.getTime() + 3 * 3_600_000) })));
    expect(d.mensajeEn.getTime()).toBe(AHORA.getTime());
    expect(d.ajustadaPorFuturo).toBe(true);
  });

  it('una hora válida del pasado se respeta tal cual', () => {
    const hace = new Date(AHORA.getTime() - 20 * 60_000);
    const d = registra(decidir(entrada(viaje(), llegada('carga'), { mensajeEn: hace })));
    expect(d.mensajeEn.getTime()).toBe(hace.getTime());
    expect(d.ajustadaPorFuturo).toBe(false);
  });

  it('una fecha inválida no produce NaN en la decisión', () => {
    const d = registra(decidir(entrada(viaje(), llegada('carga'), { mensajeEn: new Date('no es fecha') })));
    expect(Number.isNaN(d.mensajeEn.getTime())).toBe(false);
  });
});

describe('ayudantes', () => {
  it('hitoActivo es el primer pendiente; ultimoHitoRegistrado el más avanzado resuelto', () => {
    const hs = viaje({ llegada_carga: { estado: 'recibido' }, salida_carga: { estado: 'omitido', omitidoMotivo: 'x' } });
    expect(hitoActivo(hs)?.tipo).toBe('llegada_descarga');
    expect(ultimoHitoRegistrado(hs)?.tipo).toBe('llegada_carga');
  });

  it('un hito escalado sigue siendo el activo', () => {
    const hs = viaje({ llegada_carga: { estado: 'escalado', escaladoEn: iso(10), escalacionNivel: 1 } });
    expect(hitoActivo(hs)?.tipo).toBe('llegada_carga');
  });

  it('un viaje con filas faltantes no truena', () => {
    expect(decidir(entrada([], llegada('carga')))).toMatchObject({ accion: 'registrar', objetivo: 'llegada_carga' });
  });
});
