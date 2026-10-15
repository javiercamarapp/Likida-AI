import { describe, it, expect } from 'vitest';
import {
  etapaDeViaje, ultimoHitoDe, folioNormalizado, candidatosDeFolio, resolverViaje,
} from './estatus_viaje';
import { resumen, VIAJE_1, VIAJE_2 } from './datos.fixture';

const sinHitos = { llegadaEn: null, descargaEn: null, regresoEn: null };

describe('etapaDeViaje', () => {
  it('sin sellos: en curso', () => expect(etapaDeViaje({ estatus: 'abierto', ...sinHitos })).toBe('en_curso'));
  it('llegada → en destino; descarga → descargando; regreso → regresando (el más avanzado gana)', () => {
    expect(etapaDeViaje({ estatus: 'abierto', ...sinHitos, llegadaEn: '2026-10-01T10:00:00Z' })).toBe('en_destino');
    expect(etapaDeViaje({ estatus: 'abierto', ...sinHitos, llegadaEn: '2026-10-01T10:00:00Z', descargaEn: '2026-10-01T11:00:00Z' })).toBe('descargando');
    expect(etapaDeViaje({ estatus: 'en_cuadre', llegadaEn: 'x', descargaEn: 'y', regresoEn: 'z' })).toBe('regresando');
  });
  it('liquidado: cerrado, aunque tenga sellos', () => {
    expect(etapaDeViaje({ estatus: 'liquidado', llegadaEn: 'x', descargaEn: null, regresoEn: null })).toBe('cerrado');
  });
});

describe('ultimoHitoDe', () => {
  it('el más tardío de los tres', () => {
    expect(ultimoHitoDe({ llegadaEn: '2026-10-01T10:00:00Z', descargaEn: '2026-10-01T12:00:00Z', regresoEn: '2026-10-01T11:00:00Z' }))
      .toEqual({ tipo: 'descarga', en: '2026-10-01T12:00:00Z' });
  });
  it('sin sellos: null (no se inventa un hito)', () => expect(ultimoHitoDe(sinHitos)).toBeNull());
});

describe('folios', () => {
  it('normaliza guiones, espacios y mayúsculas', () => {
    expect(folioNormalizado('f-1042')).toBe('F1042');
    expect(folioNormalizado(' TR 22-31 ')).toBe('TR2231');
    expect(folioNormalizado(null)).toBe('');
  });
  it('extrae candidatos del texto del cliente', () => {
    expect(candidatosDeFolio('¿Dónde va el F-1042?')).toEqual(['F1042']);
    // Un prefijo separado por espacio puede ser una palabra («el 8841»): se ofrecen las dos lecturas.
    expect(candidatosDeFolio('mi viaje tr 2231 y el 8841')).toEqual(['TR2231', '2231', 'EL8841', '8841']);
    expect(candidatosDeFolio('mi viaje 8841')).toEqual(['8841']);
    expect(candidatosDeFolio('llega en 2 horas, a las 10:30')).toEqual([]);
  });
  it('acota los candidatos (un mensaje con 500 números no abre 500 búsquedas)', () => {
    const t = Array.from({ length: 500 }, (_, i) => `F-${1000 + i}`).join(' ');
    expect(candidatosDeFolio(t).length).toBeLessThanOrEqual(8);
  });
});

describe('resolverViaje — SOLO entre los viajes del propio cliente', () => {
  const v1 = resumen('F-1042', VIAJE_1);
  const v2 = resumen('F-2000', VIAJE_2);

  it('el cliente omite las letras del folio («el 1042» por «F-1042»): mismo viaje', () => {
    expect(resolverViaje('¿dónde va el 1042?', [v1, v2], null)).toEqual({ tipo: 'uno', viajeId: VIAJE_1 });
    expect(resolverViaje('¿dónde va el 2000?', [v1, v2], null)).toEqual({ tipo: 'uno', viajeId: VIAJE_2 });
    // «el 104» (3 dígitos tras una palabra) no es un folio contra el que se pueda afirmar nada: se contesta del único viaje propio.
    expect(resolverViaje('¿dónde va el 104?', [v1], null)).toEqual({ tipo: 'uno', viajeId: VIAJE_1 });
  });
  it('un solo viaje en curso: ese', () => expect(resolverViaje('¿dónde va?', [v1], null)).toEqual({ tipo: 'uno', viajeId: VIAJE_1 }));
  it('menciona un folio propio entre varios: ese', () => {
    expect(resolverViaje('¿dónde va el F-2000?', [v1, v2], null)).toEqual({ tipo: 'uno', viajeId: VIAJE_2 });
    expect(resolverViaje('donde va el f 1042', [v1, v2], null)).toEqual({ tipo: 'uno', viajeId: VIAJE_1 });
  });
  it('varios viajes y no dice cuál: se le pregunta, listando solo los suyos', () => {
    expect(resolverViaje('¿dónde va mi carga?', [v1, v2], null)).toEqual({ tipo: 'ambiguo', viajes: [v1, v2] });
  });
  it('el viaje en foco de la conversación desempata', () => {
    expect(resolverViaje('¿y a qué hora llega?', [v1, v2], VIAJE_2)).toEqual({ tipo: 'uno', viajeId: VIAJE_2 });
    expect(resolverViaje('¿y a qué hora llega?', [v1, v2], 'otro-id')).toMatchObject({ tipo: 'ambiguo' });
  });
  it('ninguno en curso', () => expect(resolverViaje('¿dónde va mi viaje?', [], null)).toEqual({ tipo: 'ninguno' }));

  it('AISLAMIENTO: pregunta por el folio de OTRO cliente → «no encontrado», aunque tenga un solo viaje propio', () => {
    expect(resolverViaje('¿dónde va el viaje F-9999?', [v1], null)).toEqual({ tipo: 'folio_no_encontrado' });
    expect(resolverViaje('dime del viaje 88421', [v1, v2], VIAJE_1)).toEqual({ tipo: 'folio_no_encontrado' });
  });
  it('AISLAMIENTO: sin viajes propios y con folio ajeno, no se dice «ninguno» (no se confirma nada)', () => {
    expect(resolverViaje('¿dónde va el F-9999?', [], null)).toEqual({ tipo: 'folio_no_encontrado' });
  });
  it('un número suelto que no parece folio (2, 30) no dispara «folio no encontrado»', () => {
    expect(resolverViaje('llevo 2 horas esperando, 30 minutos más', [v1], null)).toEqual({ tipo: 'uno', viajeId: VIAJE_1 });
  });
  it('mezcla un folio propio con uno ajeno: contesta SOLO del propio', () => {
    expect(resolverViaje('F-1042 y también F-9999', [v1, v2], null)).toEqual({ tipo: 'uno', viajeId: VIAJE_1 });
  });
});

describe('datosUnidadVisibles (T-A4-24): solo pasa lo que la política de privacidad deja ver', () => {
  const crudos = {
    caja: 'CJ-100', placasCaja: 'ABC123', estadoCaja: 'cargada', unidad: 'C2-08', placasUnidad: 'XYZ789', operadorNombre: 'Operador Uno',
  };

  it('con la política de por defecto pasan los seis campos', async () => {
    const { datosUnidadVisibles } = await import('./estatus_viaje');
    const { camposVisibles } = await import('./aviso/privacidad');
    expect(datosUnidadVisibles(crudos, camposVisibles(null, 'c1'))).toEqual({
      caja: 'CJ-100', placasCaja: 'ABC123', estadoCaja: 'cargada', unidad: 'C2-08', placasUnidad: 'XYZ789', operador: 'Operador Uno',
    });
  });

  it('un campo no visible queda en null y NO arrastra a los demás', async () => {
    const { datosUnidadVisibles } = await import('./estatus_viaje');
    const visibles = new Set(['caja', 'unidad'] as const);
    expect(datosUnidadVisibles(crudos, visibles)).toEqual({
      caja: 'CJ-100', placasCaja: null, estadoCaja: null, unidad: 'C2-08', placasUnidad: null, operador: null,
    });
  });

  it('texto vacío o de puros espacios es «sin dato» (null), no una cadena vacía', async () => {
    const { datosUnidadVisibles } = await import('./estatus_viaje');
    const { camposVisibles } = await import('./aviso/privacidad');
    const r = datosUnidadVisibles({ ...crudos, caja: '   ', operadorNombre: '' }, camposVisibles(null, 'c1'));
    expect(r.caja).toBeNull();
    expect(r.operador).toBeNull();
  });

  it('el resultado no tiene dónde guardar licencia, vigencia ni teléfono del operador', async () => {
    const { datosUnidadVisibles } = await import('./estatus_viaje');
    const { camposVisibles } = await import('./aviso/privacidad');
    const llaves = Object.keys(datosUnidadVisibles(crudos, camposVisibles(null, 'c1'))).sort();
    expect(llaves).toEqual(['caja', 'estadoCaja', 'operador', 'placasCaja', 'placasUnidad', 'unidad']);
  });
});
