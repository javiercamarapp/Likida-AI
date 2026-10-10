import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

type Respuesta = { data?: unknown; error?: { message: string; code?: string } | null };
interface Registro { tabla: string; ops: Array<[string, ...unknown[]]> }
const registros: Registro[] = [];
let respuestas: Respuesta[] = [];

/** Un constructor de consultas de mentira: registra cada llamada encadenada y responde con lo que se haya encolado. */
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (tabla: string) => {
      const reg: Registro = { tabla, ops: [] };
      registros.push(reg);
      const proxy: unknown = new Proxy({}, {
        get: (_t, prop: string) => {
          if (prop === 'then') return (res: (r: Respuesta) => unknown) => res(respuestas.shift() ?? { data: [], error: null });
          return (...args: unknown[]) => { if (prop !== 'abortSignal') reg.ops.push([prop, ...args]); return proxy; };
        },
      });
      return proxy;
    },
  }),
}));

const repo = await import('./repo');
const AHORA = new Date('2026-10-02T14:30:00.000Z');
const D = { tenantId: 't1', viajeId: 'v1', geocercaId: 's1', hitoTipo: 'llegada_carga', tipo: 'entrada' as const, detectadoEn: new Date('2026-10-02T14:05:00.000Z'), distanciaM: 42 };
const filtros = (r: Registro) => r.ops.filter(([o]) => ['eq', 'is', 'lt', 'in', 'gte'].includes(o)).map(([o, ...a]) => `${o}:${a.map(String).join(",")}`);

beforeEach(() => { registros.length = 0; respuestas = []; });

describe('reclamarCruce — insertar es reclamar (único por viaje y hito)', () => {
  it('la primera corrida gana e inserta la fila con el sitio, la hora de la muestra y la distancia (sin coordenadas)', async () => {
    respuestas = [{ error: null }];
    expect(await repo.reclamarCruce(D, AHORA, 10)).toBe('ganado');
    const insert = registros[0].ops.find(([o]) => o === 'insert')![1] as Record<string, unknown>;
    expect(registros[0].tabla).toBe('viaje_cruce_geocerca');
    expect(insert).toMatchObject({ tenant_id: 't1', viaje_id: 'v1', geocerca_id: 's1', hito_tipo: 'llegada_carga', tipo: 'entrada', detectado_en: D.detectadoEn.toISOString(), distancia_m: 42 });
    expect(Object.keys(insert).some((k) => /lat|lng/.test(k))).toBe(false);
  });

  it('la segunda corrida (unique 23505) pierde si el claim ya se completó o está reciente: no hay nada que retomar', async () => {
    respuestas = [{ error: { message: 'duplicate key', code: '23505' } }, { data: [], error: null }];
    expect(await repo.reclamarCruce(D, AHORA, 10)).toBe('perdido');
    // el retomar solo toca claims SIN completar y VENCIDOS, acotado por flota
    expect(filtros(registros[1])).toEqual(expect.arrayContaining(['eq:tenant_id,t1', 'eq:viaje_id,v1', 'eq:hito_tipo,llegada_carga', 'is:completado_en,null', `lt:registrado_en,${new Date(AHORA.getTime() - 10 * 60_000).toISOString()}`]));
  });

  it('un claim que la corrida anterior dejó sin completar y ya venció SE RETOMA (la corrida murió a media)', async () => {
    respuestas = [{ error: { message: 'duplicate key', code: '23505' } }, { data: [{ id: 'c1' }], error: null }];
    expect(await repo.reclamarCruce(D, AHORA, 10)).toBe('ganado');
  });

  it('una base SIN la 0635 no es un fallo: sigue sin claim (el candado es la transición condicional del hito)', async () => {
    respuestas = [{ error: { message: 'Could not find the table \'public.viaje_cruce_geocerca\' in the schema cache', code: 'PGRST205' } }];
    expect(await repo.reclamarCruce(D, AHORA, 10)).toBe('sin_tabla');
  });

  it('otro error de la base SÍ es fallo (no se registra un hito sobre un claim que no existe)', async () => {
    respuestas = [{ error: { message: 'conexión rota', code: '08006' } }];
    expect(await repo.reclamarCruce(D, AHORA, 10)).toBe('fallo');
    respuestas = [{ error: { message: 'duplicate key', code: '23505' } }, { error: { message: 'conexión rota' } }];
    expect(await repo.reclamarCruce(D, AHORA, 10)).toBe('fallo');
  });
});

describe('completar y liberar el cruce', () => {
  it('completar marca SOLO el claim sin completar de esa flota, viaje y hito', async () => {
    await repo.completarCruce(D, AHORA);
    expect(registros[0].ops.find(([o]) => o === 'update')![1]).toEqual({ completado_en: AHORA.toISOString() });
    expect(filtros(registros[0])).toEqual(expect.arrayContaining(['eq:tenant_id,t1', 'eq:viaje_id,v1', 'eq:hito_tipo,llegada_carga', 'is:completado_en,null']));
  });

  it('liberar borra solo el claim SIN completar (uno ya completado es la constancia de un hito que sí se registró)', async () => {
    await repo.liberarCruce(D);
    expect(registros[0].ops.some(([o]) => o === 'delete')).toBe(true);
    expect(filtros(registros[0])).toContain('is:completado_en,null');
  });

  it('ni completar ni liberar lanzan: perder la bitácora no puede romper el hito (y una base sin la tabla no es ruido)', async () => {
    respuestas = [{ error: { message: 'relation "viaje_cruce_geocerca" does not exist', code: '42P01' } }, { error: { message: 'boom' } }];
    await expect(repo.completarCruce(D, AHORA)).resolves.toBeUndefined();
    await expect(repo.liberarCruce(D)).resolves.toBeUndefined();
  });
});

describe('asignarSitioDerivado — una vez por (viaje, lado) y solo si el viaje sigue sin sitio', () => {
  it('reclama la derivación, asigna el sitio SOLO si la columna sigue vacía y el viaje abierto, acotado por flota', async () => {
    respuestas = [{ error: null }, { data: [{ id: 'v1' }], error: null }];
    expect(await repo.asignarSitioDerivado('t1', 'v1', 'destino', 's9', 'nombre_exacto', AHORA)).toBe('ok');
    expect(registros[0].tabla).toBe('viaje_sitio_derivado');
    expect(registros[0].ops.find(([o]) => o === 'insert')![1]).toMatchObject({ tenant_id: 't1', viaje_id: 'v1', lado: 'destino', geocerca_id: 's9', criterio: 'nombre_exacto' });
    expect(registros[1].tabla).toBe('viaje');
    expect(registros[1].ops.find(([o]) => o === 'update')![1]).toEqual({ destino_geocerca_id: 's9' });
    expect(filtros(registros[1])).toEqual(expect.arrayContaining(['eq:id,v1', 'eq:tenant_id,t1', 'eq:estatus,abierto', 'is:destino_geocerca_id,null']));
  });

  it('el lado «origen» escribe origen_geocerca_id', async () => {
    respuestas = [{ error: null }, { data: [{ id: 'v1' }], error: null }];
    await repo.asignarSitioDerivado('t1', 'v1', 'origen', 's9', 'codigo', AHORA);
    expect(registros[1].ops.find(([o]) => o === 'update')![1]).toEqual({ origen_geocerca_id: 's9' });
  });

  it('si ese lado YA se derivó una vez (23505) NO se vuelve a pisar la decisión de la oficina', async () => {
    respuestas = [{ error: { message: 'duplicate key', code: '23505' } }];
    expect(await repo.asignarSitioDerivado('t1', 'v1', 'origen', 's9', 'codigo', AHORA)).toBe('ya');
    expect(registros).toHaveLength(1); // no llegó a tocar el viaje
  });

  it('si alguien le puso sitio entre la lectura y el UPDATE (cero filas) es «ya» y la constancia se queda', async () => {
    respuestas = [{ error: null }, { data: [], error: null }];
    expect(await repo.asignarSitioDerivado('t1', 'v1', 'origen', 's9', 'codigo', AHORA)).toBe('ya');
    expect(registros).toHaveLength(2);
  });

  it('si el UPDATE falla se SUELTA la constancia (no debe quedar diciendo que se asignó) y es fallo', async () => {
    respuestas = [{ error: null }, { error: { message: 'boom' } }, { error: null }];
    expect(await repo.asignarSitioDerivado('t1', 'v1', 'origen', 's9', 'codigo', AHORA)).toBe('fallo');
    expect(registros[2].tabla).toBe('viaje_sitio_derivado');
    expect(registros[2].ops.some(([o]) => o === 'delete')).toBe(true);
  });

  it('una base sin la 0637 asigna igual, sin constancia', async () => {
    respuestas = [{ error: { message: 'Could not find the table \'public.viaje_sitio_derivado\' in the schema cache', code: 'PGRST205' } }, { data: [{ id: 'v1' }], error: null }];
    expect(await repo.asignarSitioDerivado('t1', 'v1', 'origen', 's9', 'codigo', AHORA)).toBe('ok');
  });

  it('un error que no es de esquema ni de unicidad en la constancia es fallo y no toca el viaje', async () => {
    respuestas = [{ error: { message: 'conexión rota', code: '08006' } }];
    expect(await repo.asignarSitioDerivado('t1', 'v1', 'origen', 's9', 'codigo', AHORA)).toBe('fallo');
    expect(registros).toHaveLength(1);
  });
});

describe('los episodios de «sin señal de vida»', () => {
  const EP = { id: 'e1', tenantId: 't1' };

  it('cada nivel se reclama con UPDATE condicional «nivel_enviado = k-1» y sin cerrar, acotado por flota', async () => {
    for (const [nivel, columna] of [[1, 'aviso_1_en'], [2, 'aviso_2_en'], [3, 'escalado_en']] as const) {
      registros.length = 0;
      respuestas = [{ data: [{ id: 'e1' }], error: null }];
      expect(await repo.reclamarNivelSenalVida(EP, nivel, AHORA)).toBe('ganado');
      expect(registros[0].ops.find(([o]) => o === 'update')![1]).toEqual({ nivel_enviado: nivel, [columna]: AHORA.toISOString() });
      expect(filtros(registros[0])).toEqual(expect.arrayContaining(['eq:id,e1', 'eq:tenant_id,t1', `eq:nivel_enviado,${nivel - 1}`, 'is:cerrado_en,null']));
    }
  });

  it('el que pierde el UPDATE (cero filas) no manda nada; un error es fallo', async () => {
    respuestas = [{ data: [], error: null }];
    expect(await repo.reclamarNivelSenalVida(EP, 2, AHORA)).toBe('perdido');
    respuestas = [{ error: { message: 'boom' } }];
    expect(await repo.reclamarNivelSenalVida(EP, 2, AHORA)).toBe('fallo');
  });

  it('abrir devuelve el episodio y, si otro lo abrió primero (único abierto por viaje), devuelve null sin ruido', async () => {
    respuestas = [{ data: { id: 'e1', tenant_id: 't1', viaje_id: 'v1', motivo: 'gps_detenido', abierto_en: AHORA.toISOString(), nivel_enviado: 0, aviso_1_en: null, aviso_2_en: null, escalado_en: null }, error: null }];
    expect(await repo.abrirEpisodioSenalVida('t1', 'v1', 'gps_detenido', AHORA)).toMatchObject({ id: 'e1', motivo: 'gps_detenido', nivelEnviado: 0 });
    respuestas = [{ error: { message: 'duplicate key', code: '23505' } }];
    expect(await repo.abrirEpisodioSenalVida('t1', 'v1', 'gps_detenido', AHORA)).toBeNull();
  });

  it('la respuesta del chofer cierra el episodio ABIERTO de ese viaje y de esa flota y lo silencia (2 h; «voy a cargar», 1 h)', async () => {
    respuestas = [{ data: [{ id: 'e1' }], error: null }];
    expect(await repo.responderEpisodioSenalVida('t1', 'v1', 'estoy', 120, AHORA)).toBe('cerrado');
    expect(registros[0].ops.find(([o]) => o === 'update')![1]).toMatchObject({
      respuesta: 'estoy', cierre_motivo: 'respondio', cerrado_en: AHORA.toISOString(), silenciado_hasta: new Date(AHORA.getTime() + 120 * 60_000).toISOString(),
    });
    expect(filtros(registros[0])).toEqual(expect.arrayContaining(['eq:tenant_id,t1', 'eq:viaje_id,v1', 'is:cerrado_en,null']));
  });

  it('un botón viejo (sin episodio abierto) o una base sin la 0636 es «sin_episodio»; un error real es fallo', async () => {
    respuestas = [{ data: [], error: null }];
    expect(await repo.responderEpisodioSenalVida('t1', 'v1', 'estoy', 120, AHORA)).toBe('sin_episodio');
    respuestas = [{ error: { message: 'Could not find the table \'public.viaje_senal_vida\' in the schema cache', code: 'PGRST205' } }];
    expect(await repo.responderEpisodioSenalVida('t1', 'v1', 'estoy', 120, AHORA)).toBe('sin_episodio');
    respuestas = [{ error: { message: 'boom' } }];
    expect(await repo.responderEpisodioSenalVida('t1', 'v1', 'estoy', 120, AHORA)).toBe('fallo');
  });

  it('el «Ya lo atiendo» del jefe cierra el episodio abierto y cuenta cuántos cerró', async () => {
    respuestas = [{ data: [{ id: 'e1' }], error: null }];
    expect(await repo.cerrarEpisodioPorJefe('t1', 'v1', AHORA)).toBe(1);
    expect(registros[0].ops.find(([o]) => o === 'update')![1]).toMatchObject({ cierre_motivo: 'atendido_por_jefe' });
    respuestas = [{ error: { message: 'relation "viaje_senal_vida" does not exist', code: '42P01' } }];
    expect(await repo.cerrarEpisodioPorJefe('t1', 'v1', AHORA)).toBe(0);
  });
});
