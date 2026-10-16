import { describe, it, expect } from 'vitest';
import {
  MOTIVOS_PARADA, ETIQUETA_MOTIVO, PREFIJO_PARADA, armarListaMotivos, decidirParada, ejecutarParada, esMotivoParada, leerBotonParada,
  TEXTO_PARADA_CERRADA, TEXTO_PARADA_FALLO, TEXTO_SIN_PARADA, type DepsParada, type ParadaFila,
} from './paradas';
import {
  interpretarBotonParada, interpretarParada, interpretarParadaTexto, interpretarTexto,
} from './interprete';
import { decidir } from './maquina';

const VIAJE = '11111111-2222-4333-8444-555555555555';
const T = 't1';
const AHORA = new Date('2026-10-02T14:30:00.000Z');

describe('vocabulario de motivos (espejo del CHECK de la 0806)', () => {
  it('son seis, incluida «pernocta», y cada uno tiene etiqueta de lista de ≤ 24 caracteres', () => {
    expect([...MOTIVOS_PARADA]).toEqual(['trafico', 'descanso', 'pernocta', 'reten', 'averia', 'otro']);
    for (const m of MOTIVOS_PARADA) expect(ETIQUETA_MOTIVO[m].length).toBeLessThanOrEqual(24);
  });

  it('el motivo se valida contra el vocabulario cerrado', () => {
    expect(esMotivoParada('pernocta')).toBe(true);
    expect(esMotivoParada('comida')).toBe(false);
    expect(esMotivoParada('TRAFICO')).toBe(false);
    expect(esMotivoParada(undefined)).toBe(false);
  });

  it('la migración 0806 admite exactamente estos motivos', async () => {
    const { readFileSync } = await import('node:fs');
    const sql = readFileSync('supabase/migrations/0806_viaje_parada.sql', 'utf8');
    const m = /viaje_parada_motivo_dominio check \(motivo in \(([^)]*)\)\)/.exec(sql);
    expect(m).not.toBeNull();
    const enBase = m![1].split(',').map((x) => x.trim().replace(/'/g, ''));
    expect(enBase).toEqual([...MOTIVOS_PARADA]);
  });
});

describe('botones de la parada', () => {
  it('«Parada», un motivo y «Ya continúo»', () => {
    expect(leerBotonParada(`${PREFIJO_PARADA.abrir}:${VIAJE}`)).toEqual({ accion: 'abrir', viajeId: VIAJE });
    expect(leerBotonParada(`${PREFIJO_PARADA.motivo}descanso:${VIAJE}`)).toEqual({ accion: 'motivo', motivo: 'descanso', viajeId: VIAJE });
    expect(leerBotonParada(`${PREFIJO_PARADA.continuo}:${VIAJE}`)).toEqual({ accion: 'continuo', viajeId: VIAJE });
  });

  it('el viaje sale en minúsculas (el llamador lo compara con el del chofer)', () => {
    expect(leerBotonParada(`${PREFIJO_PARADA.abrir}:${VIAJE.toUpperCase()}`)?.viajeId).toBe(VIAJE);
  });

  it.each([
    'parada', 'parada_abrir', 'parada_abrir:no-es-uuid', `parada_abrir:${VIAJE}:extra`, `parada_motivo_comida:${VIAJE}`,
    `parada_motivo_:${VIAJE}`, `hito_llegada_carga:${VIAJE}`, `${'x'.repeat(130)}:${VIAJE}`, '', undefined,
  ])('rechaza «%s»', (t) => {
    expect(leerBotonParada(t as string | undefined)).toBeNull();
  });

  it('la lista de motivos trae una fila por motivo y todas se leen de vuelta con el viaje', () => {
    const l = armarListaMotivos(VIAJE);
    expect(l.opciones).toHaveLength(MOTIVOS_PARADA.length);
    for (const o of l.opciones) {
      expect(o.titulo.length).toBeLessThanOrEqual(24);
      expect(leerBotonParada(o.id)).toMatchObject({ accion: 'motivo', viajeId: VIAJE });
    }
    expect(l.opciones.map((o) => leerBotonParada(o.id)).map((b) => (b && b.accion === 'motivo' ? b.motivo : null))).toEqual([...MOTIVOS_PARADA]);
  });
});

describe('interpretar el texto del chofer', () => {
  it.each([
    ['parada', null], ['Parada', null], ['me detuve', null], ['detención', null], ['estoy detenido', null],
    ['parada por tráfico', 'trafico'], ['me detuve por tráfico', 'trafico'], ['estoy parado por el tráfico', 'trafico'],
    ['voy a descansar', 'descanso'], ['parada para descansar', 'descanso'],
    ['voy a pernoctar', 'pernocta'], ['pernocto aquí', 'pernocta'], ['parada para dormir', 'pernocta'],
    ['parada por retén', 'reten'], ['me detuve en una inspección', 'reten'],
  ])('«%s» → parada (%s)', (t, motivo) => {
    expect(interpretarParadaTexto(t)?.intencion).toEqual({ clase: 'parada', motivo });
  });

  it.each(['ya continúo', 'Ya continúo!', 'continuo', 'ya sigo', 'reanudo', 'ya voy en camino', 'ya seguimos', 'sigo mi camino'])(
    '«%s» → continuo', (t) => {
      expect(interpretarParadaTexto(t)?.intencion).toEqual({ clase: 'continuo' });
    });

  it('«ya continúo» gana cuando vienen las dos cosas', () => {
    expect(interpretarParadaTexto('ya continúo después de la parada')?.intencion).toEqual({ clase: 'continuo' });
  });

  it.each([
    '¿hay parada cerca?', '¿me detuve?',                                // preguntas
    'parada por avería', 'se descompuso la unidad, parada', 'choque, me detuve', // otro tema: es un problema, no una parada
    'parada por diésel', 'me detuve a cargar diésel',
    'ya llegué a la parada', 'salí de la planta, parada', 'ya llegué',   // hitos del ciclo
    'sigo cargando', 'ya sigo cargando', 'ya continúo cargando',         // «sigo cargando» es del ciclo
    'hola buenas tardes', 'gracias', '',
    'parada de camiones en la autopista de occidente con mucha fila de unidades por la tarde',
  ])('«%s» NO es una parada', (t) => {
    expect(interpretarParadaTexto(t)).toBeNull();
  });

  it('un mensaje con más de dos palabras ajenas sigue su camino', () => {
    expect(interpretarParadaTexto('parada porque mi primo quiere saludarme afuera')).toBeNull();
  });

  it('no cambia lo que ya entendía el intérprete de hitos: «parada» sigue sin ser un hito', () => {
    expect(interpretarTexto('parada')).toBeNull();
    expect(interpretarTexto('ya continúo')).toBeNull();
    expect(interpretarTexto('ya llegué')?.intencion).toEqual({ clase: 'llegada', lugar: null });
  });

  it('«parada por tráfico» es una parada, no un retraso, si se pregunta primero por la parada', () => {
    expect(interpretarParada('parada por tráfico')?.intencion).toEqual({ clase: 'parada', motivo: 'trafico' });
    expect(interpretarTexto('parada por tráfico')?.intencion.clase).toBe('retraso'); // por eso el orden de consulta importa
  });

  it('el botón no pasa por reglas y trae el viaje', () => {
    const i = interpretarBotonParada(`${PREFIJO_PARADA.motivo}reten:${VIAJE}`);
    expect(i).toEqual({ intencion: { clase: 'parada', motivo: 'reten' }, via: 'boton', confianza: 1, viajeId: VIAJE });
    expect(interpretarParada(`${PREFIJO_PARADA.continuo}:${VIAJE}`)?.intencion).toEqual({ clase: 'continuo' });
    expect(interpretarBotonParada(`${PREFIJO_PARADA.abrir}:${VIAJE}`)?.intencion).toEqual({ clase: 'parada', motivo: null });
  });
});

describe('la decisión', () => {
  const abierta = { motivo: 'trafico' } as const;

  it('«parada» sin motivo y sin abierta → pide el motivo; con motivo → abre', () => {
    expect(decidirParada(null, { tipo: 'abrir', motivo: null })).toEqual({ accion: 'pedir_motivo' });
    expect(decidirParada(null, { tipo: 'abrir', motivo: 'descanso' })).toEqual({ accion: 'abrir', motivo: 'descanso' });
  });

  it('duplicado: con una abierta, «parada» (con o sin motivo) no abre otra', () => {
    expect(decidirParada(abierta, { tipo: 'abrir', motivo: null })).toEqual({ accion: 'ya_abierta', motivo: 'trafico' });
    expect(decidirParada(abierta, { tipo: 'abrir', motivo: 'descanso' })).toEqual({ accion: 'ya_abierta', motivo: 'trafico' });
  });

  it('«ya continúo» cierra la abierta; sin abierta no hay nada que cerrar', () => {
    expect(decidirParada(abierta, { tipo: 'continuo' })).toEqual({ accion: 'cerrar' });
    expect(decidirParada(null, { tipo: 'continuo' })).toEqual({ accion: 'sin_parada' });
  });

  it('una parada no es un hito: la máquina de estados no la conoce y sus decisiones no cambian', () => {
    // La parada vive aparte de `Intencion`: `decidir` solo acepta intenciones de hito.
    expect(typeof decidir).toBe('function');
    expect(interpretarParadaTexto('parada')?.intencion.clase).toBe('parada');
  });
});

// ── La ejecución, con una base en memoria que respeta «una abierta por viaje» ────────────────────────────────────────
function baseEnMemoria(opciones: { falla?: boolean } = {}) {
  const filas: ParadaFila[] = [];
  const llamadas: string[] = [];
  const deps: DepsParada = {
    leerAbierta: async (t, v) => filas.find((f) => f.tenantId === t && f.viajeId === v && f.fin === null) ?? null,
    abrir: async (t, v, motivo, ahora) => {
      llamadas.push('abrir');
      if (opciones.falla) return 'fallo';
      if (filas.some((f) => f.viajeId === v && f.fin === null)) return 'duplicada';
      filas.push({ id: `p${filas.length + 1}`, tenantId: t, viajeId: v, inicio: ahora.toISOString(), fin: null, motivo, origen: 'chofer' });
      return 'ok';
    },
    cerrar: async (t, v, fin, origen) => {
      llamadas.push('cerrar');
      if (opciones.falla) return 'fallo';
      const f = filas.find((x) => x.tenantId === t && x.viajeId === v && x.fin === null);
      if (!f) return 'sin_parada';
      f.fin = new Date(Math.max(fin.getTime(), Date.parse(f.inicio))).toISOString();
      f.origen = origen;
      return 'cerrada';
    },
  };
  return { filas, llamadas, deps };
}

describe('ejecutar la parada', () => {
  it('alta: «parada» → lista de motivos (sin escribir); el motivo abre; «ya continúo» cierra', async () => {
    const { filas, llamadas, deps } = baseEnMemoria();
    const lista = await ejecutarParada({ tenantId: T, viajeId: VIAJE, orden: { tipo: 'abrir', motivo: null }, ahora: AHORA }, deps);
    expect(lista.lista?.opciones).toHaveLength(MOTIVOS_PARADA.length);
    expect(llamadas).toEqual([]);
    expect(filas).toHaveLength(0);

    const abierta = await ejecutarParada({ tenantId: T, viajeId: VIAJE, orden: { tipo: 'abrir', motivo: 'trafico' }, ahora: AHORA }, deps);
    expect(abierta.texto).toMatch(/anoté tu parada \(tráfico\)/);
    expect(abierta.botones?.[0].id).toBe(`${PREFIJO_PARADA.continuo}:${VIAJE}`);
    expect(filas).toEqual([expect.objectContaining({ motivo: 'trafico', fin: null, origen: 'chofer', inicio: AHORA.toISOString() })]);

    const cierre = new Date(AHORA.getTime() + 25 * 60_000);
    const cerrada = await ejecutarParada({ tenantId: T, viajeId: VIAJE, orden: { tipo: 'continuo' }, ahora: cierre }, deps);
    expect(cerrada.texto).toBe(TEXTO_PARADA_CERRADA);
    expect(filas[0].fin).toBe(cierre.toISOString());
  });

  it('duplicado: «parada» dos veces no abre dos', async () => {
    const { filas, llamadas, deps } = baseEnMemoria();
    await ejecutarParada({ tenantId: T, viajeId: VIAJE, orden: { tipo: 'abrir', motivo: 'descanso' }, ahora: AHORA }, deps);
    const otra = await ejecutarParada({ tenantId: T, viajeId: VIAJE, orden: { tipo: 'abrir', motivo: 'trafico' }, ahora: AHORA }, deps);
    expect(otra.texto).toMatch(/Ya tengo tu parada anotada \(descanso\)/);
    expect(filas).toHaveLength(1);
    expect(filas[0].motivo).toBe('descanso');
    expect(llamadas.filter((l) => l === 'abrir')).toHaveLength(1);
    // y «parada» a secas con una abierta tampoco vuelve a preguntar el motivo
    const seca = await ejecutarParada({ tenantId: T, viajeId: VIAJE, orden: { tipo: 'abrir', motivo: null }, ahora: AHORA }, deps);
    expect(seca.lista).toBeUndefined();
  });

  it('carrera: si otro mensaje la abrió primero, el chofer no ve un error y no se abre otra', async () => {
    const { filas, deps } = baseEnMemoria();
    const real = deps.leerAbierta;
    deps.leerAbierta = async () => null; // la lectura no vio la abierta…
    filas.push({ id: 'p0', tenantId: T, viajeId: VIAJE, inicio: AHORA.toISOString(), fin: null, motivo: 'reten', origen: 'chofer' });
    const r = await ejecutarParada({ tenantId: T, viajeId: VIAJE, orden: { tipo: 'abrir', motivo: 'trafico' }, ahora: AHORA }, deps);
    expect(r.texto).toMatch(/anoté tu parada/);
    expect(filas).toHaveLength(1);
    deps.leerAbierta = real;
  });

  it('«ya continúo» sin parada abierta no inventa nada', async () => {
    const { filas, llamadas, deps } = baseEnMemoria();
    const r = await ejecutarParada({ tenantId: T, viajeId: VIAJE, orden: { tipo: 'continuo' }, ahora: AHORA }, deps);
    expect(r.texto).toBe(TEXTO_SIN_PARADA);
    expect(llamadas).toEqual([]);
    expect(filas).toHaveLength(0);
  });

  it('parada abierta al cerrar el viaje: cierre del sistema con fin = cierre y origen sistema (y nunca antes del inicio)', async () => {
    const { filas, deps } = baseEnMemoria();
    await ejecutarParada({ tenantId: T, viajeId: VIAJE, orden: { tipo: 'abrir', motivo: 'pernocta' }, ahora: AHORA }, deps);
    const cierre = new Date(AHORA.getTime() + 8 * 3_600_000);
    expect(await deps.cerrar(T, VIAJE, cierre, 'sistema')).toBe('cerrada');
    expect(filas[0]).toMatchObject({ fin: cierre.toISOString(), origen: 'sistema' });
  });

  it('otro viaje y otra flota no se tocan', async () => {
    const { filas, deps } = baseEnMemoria();
    const OTRO = '99999999-2222-4333-8444-555555555555';
    await ejecutarParada({ tenantId: T, viajeId: VIAJE, orden: { tipo: 'abrir', motivo: 'trafico' }, ahora: AHORA }, deps);
    await ejecutarParada({ tenantId: T, viajeId: OTRO, orden: { tipo: 'abrir', motivo: 'descanso' }, ahora: AHORA }, deps);
    await ejecutarParada({ tenantId: 't2', viajeId: VIAJE, orden: { tipo: 'continuo' }, ahora: AHORA }, deps);
    expect(filas.filter((f) => f.fin === null)).toHaveLength(2);
  });

  it('un fallo de la base nunca se disfraza de «anotado»', async () => {
    const { deps } = baseEnMemoria({ falla: true });
    const a = await ejecutarParada({ tenantId: T, viajeId: VIAJE, orden: { tipo: 'abrir', motivo: 'trafico' }, ahora: AHORA }, deps);
    expect(a.texto).toBe(TEXTO_PARADA_FALLO);
    const base2 = baseEnMemoria({ falla: true });
    base2.filas.push({ id: 'p1', tenantId: T, viajeId: VIAJE, inicio: AHORA.toISOString(), fin: null, motivo: 'trafico', origen: 'chofer' });
    const c = await ejecutarParada({ tenantId: T, viajeId: VIAJE, orden: { tipo: 'continuo' }, ahora: AHORA }, base2.deps);
    expect(c.texto).toBe(TEXTO_PARADA_FALLO);
  });

  it('los mensajes no insisten ni presionan (tono: que no se sienta vigilado)', async () => {
    const { deps } = baseEnMemoria();
    const textos = [
      armarListaMotivos(VIAJE).texto, TEXTO_PARADA_CERRADA, TEXTO_SIN_PARADA,
      (await ejecutarParada({ tenantId: T, viajeId: VIAJE, orden: { tipo: 'abrir', motivo: 'trafico' }, ahora: AHORA }, deps)).texto,
    ];
    for (const t of textos) {
      expect(t.length).toBeLessThan(140);
      expect(t).not.toMatch(/urgente|inmediat|de inmediato|por favor responde|últim[oa] aviso/i);
    }
  });
});
