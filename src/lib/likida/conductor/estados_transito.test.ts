import { describe, it, expect } from 'vitest';
import { normalizarEstadoTransito, type ReglaTransito } from './estados_transito';
import { interpretarFilasViajes } from '../importar_viajes';

describe('normalizarEstadoTransito — tabla de textos', () => {
  const casos: Array<[string, string | null]> = [
    ['PATIO', 'en_patio'],
    ['PATIO NLD', 'en_patio'],
    ['patio sur', 'en_patio'],
    ['  Patio   Norte ', 'en_patio'],
    ['EN RUTA', 'en_ruta'],
    ['en  ruta', 'en_ruta'],
    ['PEND CRUCE', 'pendiente_cruce'],
    ['Pendiente de Cruce', 'pendiente_cruce'],
    ['PENDIENTE DE CRUCÉ', 'pendiente_cruce'],
    ['OK', null],
    ['', null],
    ['EN TALLER', 'otro'],
  ];
  it.each(casos)('«%s» → %s', (texto, esperado) => {
    const r = normalizarEstadoTransito(texto);
    expect(r === null ? null : r.estado).toBe(esperado);
  });

  it('desconocido → otro, conservando el texto crudo para auditar', () => {
    expect(normalizarEstadoTransito('  EN  TALLER ')).toEqual({ estado: 'otro', textoOrigen: 'EN TALLER' });
  });
  it('el texto de origen conserva mayúsculas y acentos tal como vinieron', () => {
    expect(normalizarEstadoTransito('Pendiente de Cruce')).toEqual({ estado: 'pendiente_cruce', textoOrigen: 'Pendiente de Cruce' });
  });
  it('vacío, espacios, null, undefined y «OK» no se infieren: null', () => {
    for (const v of ['', '   ', null, undefined, 'ok', ' Ok ', 'O.K.'.replace(/\./g, '')]) expect(normalizarEstadoTransito(v)).toBeNull();
  });
  it('«patio» no se confunde con una palabra que solo empieza igual', () => {
    expect(normalizarEstadoTransito('PATIOS CERRADOS')?.estado).toBe('otro');
  });
  it('el diccionario de la flota manda sobre el de fábrica y puede ignorar textos', () => {
    const flota: ReglaTransito[] = [
      { texto: 'en frontera', tipo: 'exacto', estado: 'pendiente_cruce' },
      { texto: 'patio', tipo: 'exacto', estado: 'en_ruta' },
      { texto: 's/d', tipo: 'exacto', estado: null },
    ];
    expect(normalizarEstadoTransito('EN FRONTERA', flota)?.estado).toBe('pendiente_cruce');
    expect(normalizarEstadoTransito('PATIO', flota)?.estado).toBe('en_ruta');
    expect(normalizarEstadoTransito('PATIO NLD', flota)?.estado).toBe('en_patio');
    expect(normalizarEstadoTransito('S/D', flota)).toBeNull();
  });
});

describe('proporciones del programa de despacho de referencia (fixture sintético de 1 087 filas)', () => {
  // Misma distribución que el oráculo; folios y demás columnas inventados.
  const reparto: Array<[string, number]> = [
    ['PATIO NLD', 234], ['EN RUTA', 190], ['PEND CRUCE', 68], ['PATIO SUR', 3], ['PATIO NORTE', 2], ['OK', 2], ['', 588],
  ];
  const textos = reparto.flatMap(([t, n]) => Array.from({ length: n }, () => t));
  it('suma 1 087 filas', () => expect(textos).toHaveLength(1087));

  it('la función reproduce los conteos sembrados', () => {
    const c = { en_patio: 0, en_ruta: 0, pendiente_cruce: 0, otro: 0, nulo: 0 };
    for (const t of textos) { const r = normalizarEstadoTransito(t); c[r ? r.estado : 'nulo']++; }
    expect(c).toEqual({ en_patio: 239, en_ruta: 190, pendiente_cruce: 68, otro: 0, nulo: 590 });
  });

  it('el importador de viajes lleva los mismos conteos a las filas importadas', () => {
    const matriz: unknown[][] = [['Folio', 'Origen', 'Destino', 'TRANSITO'],
      ...textos.map((t, i) => [`V-${i + 1}`, 'ORIGEN SINTETICO', 'DESTINO SINTETICO', t])];
    const r = interpretarFilasViajes(matriz);
    expect(r.viajes).toHaveLength(1087);
    expect(r.descartadas).toEqual([]);
    const conteo: Record<string, number> = {};
    for (const v of r.viajes) { const k = v.transito?.estado ?? 'nulo'; conteo[k] = (conteo[k] ?? 0) + 1; }
    expect(conteo).toEqual({ en_patio: 239, en_ruta: 190, pendiente_cruce: 68, nulo: 590 });
  });
});

describe('importador — columna opcional de tránsito', () => {
  it('reconoce «transito» y «estatus transito»; sin columna o celda vacía la llave no existe', () => {
    for (const enc of ['Transito', 'TRÁNSITO', 'Estatus Tránsito']) {
      const r = interpretarFilasViajes([['Folio', 'Origen', 'Destino', enc], ['V-1', 'A', 'B', 'pend cruce'], ['V-2', 'A', 'B', ''], ['V-3', 'A', 'B', 'OK']]);
      expect(r.viajes[0].transito).toEqual({ estado: 'pendiente_cruce', textoOrigen: 'pend cruce' });
      expect(r.viajes[1]).not.toHaveProperty('transito');
      expect(r.viajes[2]).not.toHaveProperty('transito');
    }
    const sin = interpretarFilasViajes([['Folio', 'Origen', 'Destino'], ['V-1', 'A', 'B']]);
    expect(sin.viajes[0]).not.toHaveProperty('transito');
  });
  it('acepta el diccionario de la flota', () => {
    const r = interpretarFilasViajes([['Folio', 'Transito'], ['V-1', 'En frontera']], { diccionarioTransito: [{ texto: 'en frontera', tipo: 'exacto', estado: 'pendiente_cruce' }] });
    expect(r.viajes[0].transito?.estado).toBe('pendiente_cruce');
  });
});
