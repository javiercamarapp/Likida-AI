// EL CEREBRO DE VENTAS — el criterio de los dos porcentajes es determinista
// y estas pruebas lo FIJAN: si alguien mueve un peso, la prueba lo dice y el
// pie del mapa (que enseña CRITERIO_SCORES) se actualiza con él.
import { describe, expect, it } from 'vitest';
import {
  plazaDe, giroDe, scoreUrgencia, scoreCierre, tamanoDe, completitudDe, COLOR_EMBUDO, CRITERIO_SCORES,
} from './prospectos-mapa';

describe('plazaDe — la plaza sin adivinar', () => {
  it('ciudad, entidad → separa y normaliza la entidad al nombre del geo', () => {
    expect(plazaDe('Escobedo, Nuevo León')).toEqual({ ciudad: 'Escobedo', entidad: 'Nuevo León' });
    expect(plazaDe('San Pedro Tlaquepaque, Jalisco')).toEqual({ ciudad: 'San Pedro Tlaquepaque', entidad: 'Jalisco' });
  });
  it('ciudad sola conocida → entidad por catálogo; desconocida → sin plaza declarada', () => {
    expect(plazaDe('Guadalajara')).toEqual({ ciudad: 'Guadalajara', entidad: 'Jalisco' });
    expect(plazaDe('Villa Inventada')).toEqual({ ciudad: 'Villa Inventada', entidad: null });
  });
  it('el ruido del censo (nacional/bolsas) NO es una plaza', () => {
    expect(plazaDe('Computrabajo (nacional)')).toEqual({ ciudad: null, entidad: null });
    expect(plazaDe(null)).toEqual({ ciudad: null, entidad: null });
  });
  it('CDMX en sus tres nombres cae a Ciudad de México', () => {
    expect(plazaDe('Azcapotzalco, CDMX').entidad).toBe('Ciudad de México');
    expect(plazaDe('Iztapalapa, Distrito Federal').entidad).toBe('Ciudad de México');
  });
});

describe('giroDe — transportista o qué', () => {
  it('el nombre confiesa el giro', () => {
    expect(giroDe('Transportes Castores', null, null)).toBe('transportista');
    expect(giroDe('KN Logistics', null, null)).toBe('logistica');
    expect(giroDe('Del Fruto Distribuidora', 'Cajero Liquidador', 'reparto y cedis')).toBe('flota_propia');
    expect(giroDe('Grupo Herdez', null, null)).toBe('otro');
  });
  it('la actividad DENUE en notas también clasifica', () => {
    expect(giroDe('AVE', null, 'DENUE: Autotransporte foráneo de carga general')).toBe('transportista');
  });
  it('las categorías del TAM del 17-ago: embotelladora y mayoreo', () => {
    expect(giroDe('Bebidas del Bajío', null, 'UNIVERSO DENUE: Elaboración de refrescos y otras bebidas')).toBe('embotelladora');
    expect(giroDe('Grupo Surtidor', null, 'UNIVERSO DENUE: Comercio al por mayor de abarrotes')).toBe('abarrotes_mayoreo');
    // La embotelladora gana al mayoreo cuando ambas señales aparecen: fabrica ella.
    expect(giroDe('Embotelladora X', null, 'comercio al por mayor de bebidas · elaboración de refrescos')).toBe('embotelladora');
  });
});

describe('scoreUrgencia — la conducta del prospecto, no un vibe', () => {
  it('dolor directo + anuncios + recencia suma más que señal suelta', () => {
    const caliente = scoreUrgencia({
      vacante: 'Auxiliar de Liquidaciones',
      notas: 'DOLOR DIRECTO: la vacante nombra la liquidación · 5 anuncios en el censo · último anuncio: Hace 8 hor',
    });
    const tibio = scoreUrgencia({ vacante: 'Mecánico diésel', notas: 'SEÑAL DEL GIRO: diésel · 1 anuncio en el censo' });
    expect(caliente).toBeGreaterThan(75);
    expect(tibio).toBeLessThan(40);
    expect(caliente).toBeLessThanOrEqual(100);
  });
  it('sin notas ni vacante → 0, no un número inventado', () => {
    expect(scoreUrgencia({ vacante: null, notas: null })).toBe(0);
  });
});

describe('scoreCierre — alcanzabilidad + fit + embudo', () => {
  const base = {
    telefono: null, correo: null, contacto_nombre: null,
    estado: 'nuevo', fuente: 'censo', empresa: 'Transportes X', vacante: null, notas: null,
  };
  it('cada dato de contacto sube; el decisor pesa como el teléfono', () => {
    const solo = scoreCierre(base);
    const conTel = scoreCierre({ ...base, telefono: '5512345678' });
    const completo = scoreCierre({ ...base, telefono: '55', correo: 'a@b.mx', contacto_nombre: 'Juan, DG' });
    expect(conTel).toBeGreaterThan(solo);
    expect(completo).toBeGreaterThan(conTel);
  });
  it('el embudo manda: cliente=100, perdido=0 — sin importar lo demás', () => {
    expect(scoreCierre({ ...base, estado: 'cerrado' })).toBe(100);
    expect(scoreCierre({ ...base, telefono: '55', correo: 'a@b.mx', estado: 'perdido' })).toBe(0);
  });
});

describe('la paleta del embudo cubre el dominio completo del CHECK 0105', () => {
  it('los 6 estados tienen color y nombre — un estado sin color sería un pin invisible', () => {
    for (const e of ['nuevo', 'contactado', 'demo', 'negociacion', 'cerrado', 'perdido']) {
      expect(COLOR_EMBUDO[e]?.color).toMatch(/^#/);
      expect(COLOR_EMBUDO[e]?.nombre.length).toBeGreaterThan(3);
    }
  });
  it('el criterio publicado dice "estimación", porque lo es', () => {
    expect(CRITERIO_SCORES.urgencia).toMatch(/[Ee]stimación/);
    expect(CRITERIO_SCORES.cierre).toMatch(/[Ee]stimación/);
  });
});

describe('tamaño y completitud — los filtros de la ronda 2 (17-ago)', () => {
  it('el estrato DENUE de las notas se vuelve etiqueta de tamaño', () => {
    expect(tamanoDe('UNIVERSO DENUE: Autotransporte · 11 a 30 personas')).toBe('11-30');
    expect(tamanoDe('algo · 101 a 250 personas · más')).toBe('101-250');
    expect(tamanoDe('gigante · 251 y más personas')).toBe('250+');
    expect(tamanoDe('DOLOR DIRECTO: sin estrato')).toBeNull();
  });
  it('la completitud suma solo lo que existe y llega a 100 con todo', () => {
    expect(completitudDe({ telefono: null, correo: null, contacto_nombre: null, lat: null, notas: null })).toBe(0);
    // Desde la 0139 el 100 exige el sitio VERIFICADO, no solo presente: ver
    // "tener un sitio no es tener el sitio correcto" más abajo.
    expect(completitudDe({ telefono: '55', correo: 'a@b.mx', contacto_nombre: 'Ana, DG', lat: 20, notas: 'sitio: x.mx', sitioVerificado: true })).toBe(100);
    expect(completitudDe({ telefono: '55', correo: 'a@b.mx', contacto_nombre: 'Ana, DG', lat: 20, notas: 'sitio: x.mx' })).toBe(90);
    expect(completitudDe({ telefono: '55', correo: null, contacto_nombre: null, lat: 20, notas: null })).toBe(45);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// LO QUE EL PROSPECTO DICE DE SÍ MISMO (18-ago-2026)
// ═══════════════════════════════════════════════════════════════════════════
describe('la declaración del prospecto manda sobre la inferencia', () => {
  const vacanteQueGrita = { vacante: 'Cajero Liquidador de viajes', notas: 'DOLOR DIRECTO · 5 anuncios en el censo' };

  it('quien dijo "ya" queda en 100 aunque no tenga ni vacante', () => {
    expect(scoreUrgencia({ vacante: null, notas: null, urgenciaDeclarada: 'inmediata' })).toBe(100);
  });

  it('quien dijo "estoy explorando" NO se ordena arriba del que dijo "ya"', () => {
    // Es el punto entero: si la declaración solo sumara, este —que avisó que
    // no corre prisa— treparía por su vacante y desplazaría al que sí urge.
    const explorando = scoreUrgencia({ ...vacanteQueGrita, urgenciaDeclarada: 'explorando' });
    const inmediato = scoreUrgencia({ vacante: null, notas: null, urgenciaDeclarada: 'inmediata' });
    expect(explorando).toBeLessThan(inmediato);
  });

  it('sin declaración se sigue infiriendo de la vacante, como siempre', () => {
    expect(scoreUrgencia(vacanteQueGrita)).toBeGreaterThan(50);
  });
});

describe('quien llegó solo pesa más que uno scrapeado', () => {
  const base = {
    telefono: '8112345678', correo: 'a@b.mx', contacto_nombre: 'Ana',
    estado: 'nuevo', empresa: 'Autotransportes X', vacante: null, notas: null,
  };

  it('un lead de anuncio pagado supera al mismo prospecto sacado del censo', () => {
    expect(scoreCierre({ ...base, fuente: 'ads-meta' }))
      .toBeGreaterThan(scoreCierre({ ...base, fuente: 'censo' }));
  });

  it('un decisor con contacto verificado suma; el inferido no llega aquí', () => {
    // `personasVerificadas` cuenta SOLO lo no inferido (0138). Un correo
    // adivinado pintaría de verde un camino que rebota.
    expect(scoreCierre({ ...base, fuente: 'censo', personasVerificadas: 2 }))
      .toBeGreaterThan(scoreCierre({ ...base, fuente: 'censo', personasVerificadas: 0 }));
  });

  it('nunca se pasa de 100 por más señales que se acumulen', () => {
    expect(scoreCierre({ ...base, fuente: 'ads-meta', estado: 'negociacion', personasVerificadas: 9 }))
      .toBeLessThanOrEqual(100);
  });
});

describe('tener un sitio no es tener el sitio correcto', () => {
  const base = { telefono: null, correo: null, contacto_nombre: null, lat: null, notas: 'sitio: grupomodelo.com' };

  it('un sitio SIN verificar ya no regala puntos', () => {
    // Es el caso medido: 820 filas con el dominio del corporativo padre o de
    // un tercero. Antes puntuaban igual que una fila correcta y subían en el
    // tablero — el error de scraping se volvía prioridad de venta.
    expect(completitudDe(base)).toBe(0);
    expect(completitudDe({ ...base, sitioVerificado: false })).toBe(0);
  });

  it('verificado sí los da', () => {
    expect(completitudDe({ ...base, sitioVerificado: true })).toBe(10);
  });
});
