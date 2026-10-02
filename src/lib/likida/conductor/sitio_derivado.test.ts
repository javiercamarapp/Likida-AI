import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import {
  barridoSitioDerivado, derivarSitio, normalizarNombre,
  type CandidatoSitio, type LadoViaje, type PuertosSitioDerivado, type SitioCatalogo,
} from './sitio_derivado';

const CATALOGO: SitioCatalogo[] = [
  { id: 'a', nombre: 'Planta Zapopan', codigo: 'PLZ-01', clienteId: 'c1' },
  { id: 'b', nombre: 'CEDIS Monterrey', codigo: 'CMTY', clienteId: 'c2' },
  { id: 'c', nombre: 'Patio Norte', codigo: null, clienteId: null },
  { id: 'd', nombre: 'Planta Zapopan Andén 3', codigo: 'PLZ-03', clienteId: 'c1' },
];

describe('normalizarNombre', () => {
  it('quita acentos, mayúsculas y puntuación y deja espacios simples', () => {
    expect(normalizarNombre('  PLANTA   Zapopán, Jal.  ')).toBe('planta zapopan jal');
    expect(normalizarNombre('Andén #3')).toBe('anden 3');
  });
});

describe('derivarSitio — solo cuando no hay duda', () => {
  it('el nombre exacto, sin importar acentos ni mayúsculas', () => {
    expect(derivarSitio('PLANTA ZAPOPÁN', CATALOGO)).toEqual({ sitioId: 'a', criterio: 'nombre_exacto' });
    expect(derivarSitio('cedis monterrey', CATALOGO)).toEqual({ sitioId: 'b', criterio: 'nombre_exacto' });
  });

  it('el código como palabra completa gana al nombre', () => {
    expect(derivarSitio('Entrega en PLZ-01 (Zapopan)', CATALOGO)).toEqual({ sitioId: 'a', criterio: 'codigo' });
  });

  it('un código que solo aparece DENTRO de otra palabra no cuenta', () => {
    expect(derivarSitio('Bodega CMTYX', [{ id: 'z', nombre: 'Otro lugar', codigo: 'CMTY', clienteId: null }])).toBeNull();
  });

  it('el nombre completo dentro del texto del viaje', () => {
    expect(derivarSitio('Carga en Patio Norte, Guadalajara', CATALOGO)).toEqual({ sitioId: 'c', criterio: 'nombre_contenido' });
  });

  it('al revés NO: un texto más corto que el nombre del sitio («Monterrey») no lo liga, aunque sea el único que lo menciona', () => {
    const m: SitioCatalogo[] = [{ id: 'm', nombre: 'CEDIS Monterrey Norte', codigo: null, clienteId: null }];
    expect(derivarSitio('Monterrey', m)).toBeNull();
    expect(derivarSitio('CEDIS Monterrey', m)).toBeNull();
    expect(derivarSitio('Entrega en CEDIS Monterrey Norte, NL', m)).toEqual({ sitioId: 'm', criterio: 'nombre_contenido' });
  });

  it('un nombre corto o genérico NO liga por contenido («Sur» no es «Planta Sur»)', () => {
    expect(derivarSitio('Carga en el Sur de la ciudad', [{ id: 's', nombre: 'Sur', codigo: null, clienteId: null }])).toBeNull();
    expect(derivarSitio('Texas', [{ id: 't', nombre: 'Texas', codigo: null, clienteId: null }])).toEqual({ sitioId: 't', criterio: 'nombre_exacto' }); // exacto sí vale
  });

  it('con el nombre exacto de un sitio y otro que lo contiene, gana el exacto (criterio más fuerte primero)', () => {
    expect(derivarSitio('Planta Zapopan Andén 3', CATALOGO)).toEqual({ sitioId: 'd', criterio: 'nombre_exacto' });
  });

  it('si DOS sitios encajan NO se asigna ninguno: un sitio equivocado valida llegadas contra el lugar equivocado', () => {
    const dos: SitioCatalogo[] = [
      { id: '1', nombre: 'Planta Guadalajara', codigo: null, clienteId: 'c1' },
      { id: '2', nombre: 'Guadalajara Centro', codigo: null, clienteId: 'c2' },
    ];
    expect(derivarSitio('Planta Guadalajara Centro', dos)).toBeNull();
  });

  it('con varios que encajan, el cliente del viaje desempata SOLO si deja a uno', () => {
    const dos: SitioCatalogo[] = [
      { id: '1', nombre: 'Planta Guadalajara', codigo: null, clienteId: 'c1' },
      { id: '2', nombre: 'Guadalajara Centro', codigo: null, clienteId: 'c2' },
    ];
    expect(derivarSitio('Planta Guadalajara Centro', dos, 'c2')).toEqual({ sitioId: '2', criterio: 'nombre_contenido' });
    expect(derivarSitio('Planta Guadalajara Centro', dos, 'c9')).toBeNull();
    const dosDelMismoCliente = dos.map((d) => ({ ...d, clienteId: 'c1' }));
    expect(derivarSitio('Planta Guadalajara Centro', dosDelMismoCliente, 'c1')).toBeNull();
  });

  it('sin texto, con texto demasiado corto o sin catálogo no hay nada que derivar', () => {
    expect(derivarSitio(null, CATALOGO)).toBeNull();
    expect(derivarSitio('', CATALOGO)).toBeNull();
    expect(derivarSitio('GDL', CATALOGO)).toBeNull();
    expect(derivarSitio('Planta Zapopan', [])).toBeNull();
  });
});

function candidato(p: Partial<CandidatoSitio> = {}): CandidatoSitio {
  return { tenantId: 't1', viajeId: 'v1', origen: 'Planta Zapopan', destino: 'CEDIS Monterrey', clienteId: null, conSitio: new Set<LadoViaje>(), yaDerivados: new Set<LadoViaje>(), ...p };
}

function mundo(cs: CandidatoSitio[], asignar?: PuertosSitioDerivado['asignar']) {
  const asignados: Array<{ viaje: string; lado: string; sitio: string; criterio: string }> = [];
  const puertos: PuertosSitioDerivado = {
    candidatos: async () => cs,
    catalogo: async () => new Map([['t1', CATALOGO]]),
    asignar: asignar ?? (async (_t, v, lado, sitio, criterio) => { asignados.push({ viaje: v, lado, sitio, criterio }); return 'ok'; }),
  };
  return { puertos, asignados };
}

describe('barridoSitioDerivado', () => {
  it('deriva origen y destino de un viaje sin sitio, con el criterio a la vista', async () => {
    const w = mundo([candidato()]);
    const r = await barridoSitioDerivado(w.puertos, new Date());
    expect(r).toMatchObject({ candidatos: 1, derivados: 2, sinCoincidencia: 0, fallos: 0 });
    expect(w.asignados).toEqual([
      { viaje: 'v1', lado: 'origen', sitio: 'a', criterio: 'nombre_exacto' },
      { viaje: 'v1', lado: 'destino', sitio: 'b', criterio: 'nombre_exacto' },
    ]);
  });

  it('NUNCA toca el lado que el viaje ya trae (convenio o captura manual) ni el que ya se derivó una vez', async () => {
    const w = mundo([candidato({ conSitio: new Set<LadoViaje>(['origen']), yaDerivados: new Set<LadoViaje>(['destino']) })]);
    const r = await barridoSitioDerivado(w.puertos, new Date());
    expect(w.asignados).toHaveLength(0);
    expect(r.derivados).toBe(0);
  });

  it('lo que no coincide queda como estaba (la excepción «sin sitio» es el aviso honesto) y se cuenta', async () => {
    const w = mundo([candidato({ origen: 'Bodega desconocida', destino: null })]);
    const r = await barridoSitioDerivado(w.puertos, new Date());
    expect(r).toMatchObject({ derivados: 0, sinCoincidencia: 2 });
  });

  it('«ya» (otra corrida o la oficina llegaron primero) y un fallo se cuentan aparte y no frenan al resto', async () => {
    let n = 0;
    const w = mundo([candidato(), candidato({ viajeId: 'v2' })], async () => (['ya', 'fallo', 'ok', 'ok'] as const)[n++]);
    const r = await barridoSitioDerivado(w.puertos, new Date());
    expect(r).toMatchObject({ yaAsignados: 1, fallos: 1, derivados: 2 });
  });

  it('una excepción al asignar cuenta como fallo y sigue con los demás', async () => {
    let n = 0;
    const w = mundo([candidato()], async () => { if (n++ === 0) throw new Error('boom'); return 'ok'; });
    const r = await barridoSitioDerivado(w.puertos, new Date());
    expect(r).toMatchObject({ fallos: 1, derivados: 1 });
  });

  it('sin candidatos no lee el catálogo; con el reloj vencido corta y lo dice', async () => {
    const w = mundo([]);
    const catalogo = vi.spyOn(w.puertos, 'catalogo');
    expect((await barridoSitioDerivado(w.puertos, new Date())).candidatos).toBe(0);
    expect(catalogo).not.toHaveBeenCalled();
    const w2 = mundo([candidato(), candidato({ viajeId: 'v2' })]);
    const r = await barridoSitioDerivado(w2.puertos, new Date(), Date.now() - 1);
    expect(r.cortadosPorReloj).toBe(2);
    expect(w2.asignados).toHaveLength(0);
  });
});
