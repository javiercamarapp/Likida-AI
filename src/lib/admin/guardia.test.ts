import { describe, it, expect } from 'vitest';
import { clasificarBandeja, decidirAvisos, decidirBaseCaida, estadoDeDetalle, claveDeItem, huellaDeClave, lineasDeAviso, estadoTrasAviso, decidirApp, ESTADO_GUARDIA_INICIAL } from './guardia';
import type { BandejaEscalaciones, ItemEscalacion, FuenteLeida } from './escalaciones';

// ═══════════════════════════════════════════════════════════════════════════
// EL GUARDIA (A0) — la clasificación es DETERMINISTA y se prueba sin base:
// la matriz del runbook aplicada a items reales de la bandeja, las fuentes
// ciegas como S2 por sí mismas, y el límite declarado (S1 no se deriva).
// ═══════════════════════════════════════════════════════════════════════════

const AHORA = Date.parse('2026-08-16T12:00:00Z');
const HACE_2H = new Date(AHORA - 2 * 3_600_000).toISOString();
const EN_2_DIAS = new Date(AHORA + 2 * 86_400_000).toISOString();
const EN_10_DIAS = new Date(AHORA + 10 * 86_400_000).toISOString();
const VENCIO_AYER = new Date(AHORA - 86_400_000).toISOString();

function item(fuente: ItemEscalacion['fuente'], vence: string | null): ItemEscalacion {
  return { fuente, titulo: `item de ${fuente}`, detalle: null, tenantNombre: 'Flota X', desde: HACE_2H, vence, href: null };
}
const leida = (items: ItemEscalacion[]): FuenteLeida => ({ items, error: null });
const ciega = (error: string): FuenteLeida => ({ items: null, error });

function bandeja(cola: ItemEscalacion[], fuentes: Partial<Record<string, FuenteLeida>> = {}): BandejaEscalaciones {
  return {
    fuentes: {
      arco: leida([]), corridas: leida([]), talachas: leida([]),
      facturas_proveedor: leida([]), tickets: leida([]), liquidaciones: leida([]),
      ...fuentes,
    } as BandejaEscalaciones['fuentes'],
    cola,
    conteos: { arco: 0, corridasFallo: 0, talachas: 0, facturasProveedor: 0, ticketsAbiertos: 0, ticketsVencidos: 0, liquidacionesRevisar: 0 },
  };
}

describe('la matriz del runbook, determinista', () => {
  it('una corrida en fallo es S2: una función dejó de operar, nada miente', () => {
    const c = clasificarBandeja(bandeja([item('corridas', null)]), AHORA);
    expect(c.items[0].severidad).toBe('S2');
    expect(c.items[0].regla).toMatch(/nada miente/);
  });

  it('ARCO dentro de plazo es S3; a <5 días o vencida SUBE a S2 con el artículo citado', () => {
    const c = clasificarBandeja(bandeja([
      item('arco', EN_10_DIAS),
      item('arco', EN_2_DIAS),
      item('arco', VENCIO_AYER),
    ]), AHORA);
    expect(c.items.map((i) => i.severidad)).toEqual(['S3', 'S2', 'S2']);
    expect(c.items[2].regla).toMatch(/VENCIDO.*art\. 31/s);
  });

  it('un ticket dentro de SLA es S3; vencido sube a S2', () => {
    const c = clasificarBandeja(bandeja([item('tickets', EN_2_DIAS), item('tickets', VENCIO_AYER)]), AHORA);
    expect(c.items.map((i) => i.severidad)).toEqual(['S3', 'S2']);
  });

  it('talachas, facturas de proveedor y liquidaciones son S3: decisión humana con el sistema operando', () => {
    const c = clasificarBandeja(bandeja([
      item('talachas', null), item('facturas_proveedor', null), item('liquidaciones', null),
    ]), AHORA);
    expect(c.items.every((i) => i.severidad === 'S3')).toBe(true);
  });
});

describe('las fuentes ciegas y los límites', () => {
  it('una fuente ciega es S2 POR SÍ MISMA — no ver no es no haber (§6)', () => {
    const c = clasificarBandeja(bandeja([], { tickets: ciega('db down'), arco: ciega('timeout') }), AHORA);
    expect(c.fuentesCiegas).toHaveLength(2);
    expect(c.porSeveridad.S2).toBe(2);
  });

  it('el límite se DECLARA: S1 no se deriva de la bandeja, y la clasificación lo dice', () => {
    const c = clasificarBandeja(bandeja([]), AHORA);
    expect(c.porSeveridad.S1).toBe(0);
    expect(c.limites.join(' ')).toMatch(/S1.*no se deriva/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// E1-A (P0-8): la decisión de AVISAR vive en `guardia.ts` y la comparten el
// cron del servidor y el script de la Mac. Pura: se prueba sin base.
// ═══════════════════════════════════════════════════════════════════════════

describe('decidirAvisos — se avisa el CAMBIO, no el estado', () => {
  const corrida = bandeja([item('corridas', null)]);
  const clasif = clasificarBandeja(corrida, AHORA);

  it('un S2 nuevo se avisa y queda como visto (por huella, sin guardar el título ni la flota)', () => {
    const d = decidirAvisos(clasif, ESTADO_GUARDIA_INICIAL);
    expect(d.nuevos).toHaveLength(1);
    // la huella lleva su fuente (`fuente~hash`, B1) y nunca el título ni la flota
    expect(d.estado.vistos).toEqual([`corridas~${huellaDeClave(claveDeItem(clasif.items[0]))}`]);
    expect(JSON.stringify(d.estado)).not.toMatch(/Flota X|item de corridas/);
  });

  it('el mismo incidente en la pasada siguiente NO vuelve a sonar (y sigue como visto)', () => {
    const d1 = decidirAvisos(clasif, ESTADO_GUARDIA_INICIAL);
    const d2 = decidirAvisos(clasif, d1.estado);
    expect(d2.nuevos).toHaveLength(0);
    expect(d2.urgentes).toHaveLength(1);
    expect(d2.estado.vistos).toEqual(d1.estado.vistos);
  });

  it('lo resuelto sale del estado: si reaparece, es incidente NUEVO y vuelve a sonar', () => {
    const d1 = decidirAvisos(clasif, ESTADO_GUARDIA_INICIAL);
    const vacio = decidirAvisos(clasificarBandeja(bandeja([]), AHORA), d1.estado);
    expect(vacio.estado.vistos).toEqual([]);
    expect(decidirAvisos(clasif, vacio.estado).nuevos).toHaveLength(1);
  });

  it('reconoce las claves CRUDAS que dejó el script de la Mac: migrar al cron no repite lo ya avisado', () => {
    const cruda = claveDeItem(clasif.items[0]);
    expect(decidirAvisos(clasif, { ...ESTADO_GUARDIA_INICIAL, vistos: [cruda] }).nuevos).toHaveLength(0);
  });

  it('S3 no interrumpe: lo que espera decisión humana no es un aviso', () => {
    const d = decidirAvisos(clasificarBandeja(bandeja([item('talachas', null)]), AHORA), ESTADO_GUARDIA_INICIAL);
    expect(d.nuevos).toHaveLength(0);
    expect(d.urgentes).toHaveLength(0);
  });

  it('una fuente ciega nueva se avisa UNA vez y su huella queda como vista', () => {
    const c = clasificarBandeja(bandeja([], { tickets: ciega('db down') }), AHORA);
    const d1 = decidirAvisos(c, ESTADO_GUARDIA_INICIAL);
    expect(d1.ciegasNuevas).toHaveLength(1);
    expect(decidirAvisos(c, d1.estado).ciegasNuevas).toHaveLength(0);
    expect(lineasDeAviso(d1)[0]).toMatch(/Fuente CIEGA: tickets.*db down/);
  });

  it('si la base estaba caída en la pasada anterior, avisa que volvió y limpia la racha', () => {
    const d = decidirAvisos(clasificarBandeja(bandeja([]), AHORA), { ...ESTADO_GUARDIA_INICIAL, baseCaidaDesde: '2026-10-03T00:00:00Z' });
    expect(d.baseVolvio).toBe(true);
    expect(d.estado.baseCaidaDesde).toBeNull();
  });

  it('el estado persistido tiene tope: no crece sin límite dentro del jsonb del latido', () => {
    const muchos = Array.from({ length: 300 }, (_, i) => ({ ...item('corridas', null), titulo: `c${i}` }));
    expect(decidirAvisos(clasificarBandeja(bandeja(muchos), AHORA), ESTADO_GUARDIA_INICIAL).estado.vistos.length).toBeLessThanOrEqual(200);
  });
});

describe('decidirBaseCaida — una vez por racha', () => {
  it('la primera pasada ciega avisa y marca desde cuándo; las siguientes callan', () => {
    const a = decidirBaseCaida(ESTADO_GUARDIA_INICIAL, '2026-10-03T00:00:00Z');
    expect(a).toMatchObject({ avisar: true, estado: { baseCaidaDesde: '2026-10-03T00:00:00Z' } });
    expect(decidirBaseCaida(a.estado, '2026-10-03T00:05:00Z')).toMatchObject({ avisar: false, estado: { baseCaidaDesde: '2026-10-03T00:00:00Z' } });
  });
});

describe('estadoDeDetalle — no confía en la forma del jsonb', () => {
  it('basura → estado inicial; lo válido se conserva; lo inválido se descarta', () => {
    expect(estadoDeDetalle(null)).toEqual(ESTADO_GUARDIA_INICIAL);
    expect(estadoDeDetalle('x')).toEqual(ESTADO_GUARDIA_INICIAL);
    expect(estadoDeDetalle({ vistos: ['a', 3, null, 'b'], baseCaidaDesde: 'no es fecha' })).toEqual({ ...ESTADO_GUARDIA_INICIAL, vistos: ['a', 'b'] });
    expect(estadoDeDetalle({ vistos: 'x', baseCaidaDesde: '2026-10-03T00:00:00Z' })).toEqual({ ...ESTADO_GUARDIA_INICIAL, baseCaidaDesde: '2026-10-03T00:00:00Z' });
    // A3: la racha y el inicio de la caída de la app viajan en el detalle; basura (negativos, fechas, tipos) se descarta.
    expect(estadoDeDetalle({ rachaApp: 1, appCaidaDesde: '2026-10-03T00:00:00Z', appAvisada: true, rachaBandeja: 2 }))
      .toEqual({ ...ESTADO_GUARDIA_INICIAL, rachaApp: 1, appCaidaDesde: '2026-10-03T00:00:00Z', appAvisada: true, rachaBandeja: 2 });
    expect(estadoDeDetalle({ rachaApp: -3, appCaidaDesde: 'x', appAvisada: 'si', rachaBandeja: 1.5 })).toEqual(ESTADO_GUARDIA_INICIAL);
  });
});

describe('estadoTrasAviso — «visto» solo si el aviso salió (M5, ronda 19)', () => {
  const uno = () => decidirAvisos(clasificarBandeja(bandeja([item('corridas', null)]), AHORA), ESTADO_GUARDIA_INICIAL);

  it('con el aviso enviado, todo lo vigente queda visto', () => {
    const d = uno();
    expect(estadoTrasAviso(d, true).vistos).toHaveLength(1);
  });
  it('sin aviso, lo NUEVO no se anota (se reintenta); lo ya avisado antes se conserva', () => {
    const d = uno();
    expect(estadoTrasAviso(d, false).vistos).toHaveLength(0);
    const d2 = decidirAvisos(clasificarBandeja(bandeja([item('corridas', null)]), AHORA), d.estado);
    expect(d2.nuevos).toHaveLength(0);
    expect(estadoTrasAviso(d2, false).vistos).toHaveLength(1);
  });
});

describe('decidirApp — histéresis de la app (A3, ronda 19)', () => {
  const T1 = '2026-10-03T10:00:00Z';
  const T2 = '2026-10-03T10:05:00Z';

  it('un fallo aislado: racha 1, ni avisa ni marca caída', () => {
    expect(decidirApp(ESTADO_GUARDIA_INICIAL, true, T1)).toEqual({ racha: 1, desde: T1, caida: false, avisar: false });
  });
  it('dos seguidos: caída y aviso (una vez); el desde es el del PRIMER fallo', () => {
    const a = decidirApp(ESTADO_GUARDIA_INICIAL, true, T1);
    const b = decidirApp({ ...ESTADO_GUARDIA_INICIAL, rachaApp: a.racha, appCaidaDesde: a.desde }, true, T2);
    expect(b).toEqual({ racha: 2, desde: T1, caida: true, avisar: true });
    // ya avisada: sigue caída pero calla
    expect(decidirApp({ ...ESTADO_GUARDIA_INICIAL, rachaApp: 2, appCaidaDesde: T1, appAvisada: true }, true, T2)).toMatchObject({ caida: true, avisar: false });
    // si el aviso no salió, se reintenta
    expect(decidirApp({ ...ESTADO_GUARDIA_INICIAL, rachaApp: 2, appCaidaDesde: T1, appAvisada: false }, true, T2)).toMatchObject({ avisar: true });
  });
  it('un sondeo sano reinicia la racha', () => {
    expect(decidirApp({ ...ESTADO_GUARDIA_INICIAL, rachaApp: 1, appCaidaDesde: T1 }, false, T2)).toEqual({ racha: 0, desde: null, caida: false, avisar: false });
  });
});

describe('B1 (ronda 19): una fuente ciega no hace flapping de sus incidentes', () => {
  it('lo ya avisado de una fuente que queda ciega se CONSERVA; al volver no se reavisa como nuevo', () => {
    const conIncidente = bandeja([item('corridas', null)]);
    const d1 = decidirAvisos(clasificarBandeja(conIncidente, AHORA), ESTADO_GUARDIA_INICIAL);
    expect(d1.nuevos).toHaveLength(1);
    // la fuente de corridas queda ciega: sus items desaparecen de la bandeja
    const ciegaYa = bandeja([], { corridas: ciega('timeout') });
    const d2 = decidirAvisos(clasificarBandeja(ciegaYa, AHORA), d1.estado);
    expect(d2.ciegasNuevas).toHaveLength(1);
    // vuelve la fuente con el MISMO incidente: ya estaba avisado, no suena otra vez
    const d3 = decidirAvisos(clasificarBandeja(conIncidente, AHORA), d2.estado);
    expect(d3.nuevos).toHaveLength(0);
  });
  it('lo que NO es de una fuente ciega y ya no está vigente sí sale de vistos (si reaparece, es nuevo)', () => {
    const d1 = decidirAvisos(clasificarBandeja(bandeja([item('corridas', null)]), AHORA), ESTADO_GUARDIA_INICIAL);
    const d2 = decidirAvisos(clasificarBandeja(bandeja([]), AHORA), d1.estado); // resuelto, fuente sana
    expect(d2.estado.vistos).toHaveLength(0);
    expect(decidirAvisos(clasificarBandeja(bandeja([item('corridas', null)]), AHORA), d2.estado).nuevos).toHaveLength(1);
  });
  it('sigue reconociendo los estados viejos: huella pelona y clave cruda (script de la Mac)', () => {
    const it0 = item('corridas', null);
    const c = clasificarBandeja(bandeja([it0]), AHORA);
    const clave = claveDeItem(c.items[0]);
    expect(decidirAvisos(c, { ...ESTADO_GUARDIA_INICIAL, vistos: [huellaDeClave(clave)] }).nuevos).toHaveLength(0);
    expect(decidirAvisos(c, { ...ESTADO_GUARDIA_INICIAL, vistos: [clave] }).nuevos).toHaveLength(0);
  });
});
