import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';

// ═══════════════════════════════════════════════════════════════════════════
// INGENIERÍA (0234) — los cuatro que miran la BASE: migraciones, seguridad,
// rendimiento y releases.
//
// Las pruebas son de COMPORTAMIENTO y, sobre todo, de HONESTIDAD DE ALCANCE:
// lo que se afirma es que una fuente ciega jamás se lee como «no hay nada»,
// que NULL nunca se lee como 0, que ningún parte dice haber revisado el
// código, y que los detectores caen justo sobre los incidentes reales de este
// proyecto (0218/0219 aplicadas al revés, la palanca que falta en el CHECK,
// «mergeado ≠ desplegado»).
// ═══════════════════════════════════════════════════════════════════════════

type Resp = { data?: unknown; error?: { message: string } | null; count?: number };
const respuestas = new Map<string, Resp[]>();
const rpcs = new Map<string, Resp[]>();
const llamadasRpc: string[] = [];
const escrituras: Array<{ tabla: string; op: string; fila: unknown }> = [];

function builder(tabla: string) {
  const responder = (): Resp => {
    const cola = respuestas.get(tabla);
    return cola && cola.length > 0 ? cola.shift() as Resp : { data: [], error: null, count: 0 };
  };
  const b: Record<string, unknown> = {};
  Object.assign(b, {
    select: () => b, eq: () => b, is: () => b, neq: () => b, not: () => b,
    gte: () => b, lt: () => b, order: () => b, limit: () => b,
    insert: (fila: unknown) => { escrituras.push({ tabla, op: 'insert', fila }); return b; },
    update: (fila: unknown) => { escrituras.push({ tabla, op: 'update', fila }); return b; },
    then: (res: (x: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve().then(responder).then(res, rej),
  });
  return b;
}
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (t: string) => builder(t),
    rpc: (fn: string) => {
      llamadasRpc.push(fn);
      const cola = rpcs.get(fn);
      return Promise.resolve(cola && cola.length > 0 ? cola.shift() as Resp : { data: null, error: { message: `sin respuesta encolada para ${fn}` } });
    },
  }),
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/likida/presupuesto', () => ({ acotada: (q: unknown) => q }));

const encolar = vi.fn(async (_p: unknown) => 'pieza-1');
vi.mock('./cola', () => ({ encolarPieza: (p: unknown) => encolar(p) }));

const registrar = vi.fn(async (..._a: unknown[]) => undefined);
vi.mock('./corridas', () => ({ registrarCorrida: (...a: unknown[]) => registrar(...a) }));

const alertar = vi.fn(async (..._a: unknown[]) => undefined);
vi.mock('@/lib/observability/alerta', () => ({ alertarOperador: (...a: unknown[]) => alertar(...a) }));

const {
  AGENTES_INGENIERIA, esAgenteIngenieria, correrAgenteIngenieria,
  MIGRACIONES_EXIGIDAS, lunesDe, masDias, muestra, recortar, pintarHallazgos,
  prefijoDe, aplicadaEn, inversionesDeOrden, nombresRepetidos, prefijosChocados,
  verificarExigidas, hallazgosDeExigidas,
  huecosDeNumeracion, evaluarMigraciones, armarParteMigraciones,
  evaluarSeguridad, armarParteSeguridad,
  evaluarRendimiento, armarParteRendimiento, mb,
  shaDesplegado, entornoDesplegado, ramaDesplegada,
  evaluarReleases, armarParteReleases, registrarDespliegue,
  porValor, lineaFuentesCiegas, autonomos,
} = await import('./ingenieria');

const HOY = '2026-08-27'; // jueves
const LUNES = '2026-08-24';

function ultimo(): { titulo: string; cuerpo: string; fuentes: Record<string, unknown> } {
  const p = encolar.mock.calls.at(-1)?.[0] as { titulo: string; cuerpo: string; fuentes: Record<string, unknown> } | undefined;
  return p ?? { titulo: '', cuerpo: '', fuentes: {} };
}

/** El catálogo mínimo con un agente autónomo. */
const CATALOGO_OK = [{
  id: 'migraciones', nombre: 'Vigía', departamento: 'ingenieria', estado: 'vivo',
  runner_habilitado: true, disparador: 'cron', presupuesto_dia_usd: 0.1,
}];

const POSTURA_LIMPIA = {
  tablas: [{ tabla: 'viaje', rls: true, politicas: 1, tiene_tenant_id: true, anon_lee: false, auth_lee: true, anon_escribe: false, auth_escribe: true }],
  funciones: [{ funcion: 'ayuda', definer: true, anon_ejecuta: true, auth_ejecuta: true, search_path_fijo: true, ayudante_rls: true }],
  vistas: [{ vista: 'factura_saldo', security_invoker: true }],
  columnas_sensibles: [],
};

/** La respuesta de postura_seguridad() cuyas tablas cubren el contrato entero:
 *  el HECHO presente, para las corridas que no ejercitan la faltante. */
const POSTURA_CONTRATO = () => ({
  tablas: MIGRACIONES_EXIGIDAS.flatMap((m) => [...m.tablas]).map((t) => ({
    tabla: t, rls: true, politicas: 0, tiene_tenant_id: false,
    anon_lee: false, auth_lee: false, anon_escribe: false, auth_escribe: false,
  })),
  funciones: [], vistas: [], columnas_sensibles: [],
});

const PERFIL_LIMPIO = {
  tablas: [{ tabla: 'viaje', bytes: 2_000_000, filas_estimadas: 1000, seq_scan: 5, seq_tup_read: 10, idx_scan: 900, indices: 3 }],
  consultas: { disponible: true, motivo: null, filas: [] },
};

beforeEach(() => {
  respuestas.clear();
  rpcs.clear();
  llamadasRpc.length = 0;
  escrituras.length = 0;
  encolar.mockClear();
  encolar.mockResolvedValue('pieza-1');
  registrar.mockClear();
  alertar.mockClear();
  vi.unstubAllEnvs();
});

// ── El catálogo, la aritmética y los helpers ───────────────────────────────

describe('el catálogo de ingeniería', () => {
  it('son exactamente los ocho del departamento y el predicado los reconoce', () => {
    expect(AGENTES_INGENIERIA).toHaveLength(8);
    expect(new Set(AGENTES_INGENIERIA).size).toBe(8);
    for (const id of AGENTES_INGENIERIA) expect(esAgenteIngenieria(id)).toBe(true);
    expect(esAgenteIngenieria('redactor')).toBe(false);
  });

  it('lunesDe cae en lunes cualquier día, y masDias no cruza de mes al revés', () => {
    for (const d of ['2026-08-24', '2026-08-27', '2026-08-30']) expect(lunesDe(d)).toBe(LUNES);
    expect(masDias('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('muestra y recortar nunca esconden el total ni revientan con null', () => {
    expect(muestra([])).toBe('—');
    expect(muestra(['a', 'b', 'c'], 2)).toBe('a · b y 1 más');
    expect(recortar(null, 5)).toBe('');
    expect(recortar('   hola   mundo ', 40)).toBe('hola mundo');
    expect(recortar('abcdefgh', 4)).toBe('abcd…');
  });

  it('pintarHallazgos ordena ROJO antes que ÁMBAR y ÁMBAR antes que nota', () => {
    const lineas = pintarHallazgos([
      { semaforo: 'NOTA', codigo: 'X', objeto: 'n', detalle: 'd', evidencia: 'e' },
      { semaforo: 'ROJO', codigo: 'Y', objeto: 'r', detalle: 'd', evidencia: 'e' },
      { semaforo: 'AMBAR', codigo: 'Z', objeto: 'a', detalle: 'd', evidencia: 'e' },
    ], 'nada');
    const texto = lineas.join('\n');
    expect(texto).toContain('1 ROJO · 1 ÁMBAR · 1 nota(s)');
    expect(texto.indexOf('[ROJO]')).toBeLessThan(texto.indexOf('[AMBAR]'));
    expect(texto.indexOf('[AMBAR]')).toBeLessThan(texto.indexOf('[NOTA]'));
  });

  it('sin hallazgos dice la frase de «nada disparó», no una lista vacía', () => {
    expect(pintarHallazgos([], 'todo tranquilo').join('\n')).toContain('todo tranquilo');
  });
});

describe('el contrato de migraciones que este bundle exige', () => {
  // La dirección importa: se verifica que cada nombre EXIGIDO exista como
  // archivo. La contraria (que todo archivo esté en la lista) rompería master
  // cada vez que otra rama agrega una migración, y esta lista es curada a
  // propósito, no un espejo del directorio.
  it('cada migración exigida existe como archivo en supabase/migrations', () => {
    const archivos = new Set(readdirSync('supabase/migrations')
      .filter((f) => f.endsWith('.sql'))
      .map((f) => f.replace(/\.sql$/, '')));
    for (const m of MIGRACIONES_EXIGIDAS) expect(archivos.has(m.nombre), `${m.nombre} no existe en supabase/migrations`).toBe(true);
  });

  it('la ola de ingeniería se exige a sí misma: sin la 0234 no hay ni funciones ni despliegue_visto', () => {
    expect(MIGRACIONES_EXIGIDAS.map((m) => m.nombre)).toContain('0234_agentes_ingenieria');
  });

  // El incidente del 28-ago-2026: el contrato dejó de ser una lista de rótulos.
  it('cada exigida declara su prefijo (coherente con su nombre) y al menos una tabla que crea — el HECHO contra el que se acusa', () => {
    for (const m of MIGRACIONES_EXIGIDAS) {
      expect(prefijoDe(m.nombre), `${m.nombre} sin prefijo legible`).toBe(m.prefijo);
      expect(m.tablas.length, `${m.nombre} sin tablas declaradas`).toBeGreaterThan(0);
      // Y la tabla declarada de verdad se crea en ese archivo: la evidencia
      // del ROJO no puede apuntar a una tabla que la migración no crea.
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- lee las migraciones del propio repo en tiempo de prueba; el nombre sale de la constante MIGRACIONES_EXIGIDAS, no de ninguna entrada de usuario.
      const sql = readFileSync(`supabase/migrations/${m.nombre}.sql`, 'utf8');
      for (const t of m.tablas) {
        expect(sql, `${m.nombre} no crea ${t}`).toMatch(new RegExp(`create table( if not exists)? (public\\.)?${t}\\b`));
      }
    }
  });
});

describe('las lecturas por valor', () => {
  it('una fuente que truena NO se colapsa a vacío: se dice con su nombre', async () => {
    const l = await porValor('la base', async () => { throw new Error('caída'); });
    expect(l.valor).toBeNull();
    expect(l.error).toBe('la base');
    expect(lineaFuentesCiegas([l])).toContain('la base');
    expect(lineaFuentesCiegas([l])).toContain('NO CONTESTARON');
  });

  it('sin fuentes ciegas no se escribe la línea', async () => {
    const l = await porValor('ok', async () => 1);
    expect(lineaFuentesCiegas([l])).toBeNull();
  });
});

// ── 1 · MIGRACIONES ────────────────────────────────────────────────────────

describe('la aritmética de migraciones', () => {
  it('prefijoDe saca el número del archivo y devuelve null cuando no lo trae', () => {
    expect(prefijoDe('0230_agentes_crecimiento')).toBe(230);
    expect(prefijoDe('sin_numero')).toBeNull();
  });

  it('aplicadaEn traduce el version a instante UTC, y null si no es un sello', () => {
    expect(aplicadaEn('20260828022443')).toBe('2026-08-28T02:24:43Z');
    expect(aplicadaEn('lo-que-sea')).toBeNull();
  });

  it('detecta la inversión REAL de producción: la 0231 aplicada después de la 0232', () => {
    // La función devuelve `version` descendente, o sea la más reciente primero.
    const filas = [
      { version: '20260828025724', nombre: '0231_descarga_masiva_sat' },
      { version: '20260828023755', nombre: '0232_sesion_portal' },
      { version: '20260828022443', nombre: '0230_agentes_crecimiento' },
    ];
    expect(inversionesDeOrden(filas)).toEqual([{ antes: '0232_sesion_portal', despues: '0231_descarga_masiva_sat' }]);
  });

  it('un orden limpio no inventa inversiones', () => {
    expect(inversionesDeOrden([
      { version: '3', nombre: '0003_c' },
      { version: '2', nombre: '0002_b' },
      { version: '1', nombre: '0001_a' },
    ])).toEqual([]);
  });

  it('caza el nombre aplicado dos veces y el número que dos ramas se pelearon (intercalado)', () => {
    const filas = [
      { version: '5', nombre: '0231_una' },
      { version: '4', nombre: '0232_ajena' }, // intercalada: esto SÍ es choque de ramas
      { version: '3', nombre: '0231_otra' },
      { version: '2', nombre: '0230_x' },
      { version: '1', nombre: '0230_x' },
    ];
    expect(nombresRepetidos(filas)).toEqual(['0230_x']);
    expect(prefijosChocados(filas)).toEqual(['0231: 0231_otra + 0231_una']);
  });

  // La corrección del 28-ago-2026: la 0150 y la 0155 se aplicaron partidas en
  // piezas contiguas Y ESO NO ES UN CHOQUE — el detector viejo las acusaba.
  it('una migración aplicada en PIEZAS CONTIGUAS no es un choque de prefijos', () => {
    const filas = [
      { version: '20260822235122', nombre: '0155_purgas_permisos' },
      { version: '20260822235040', nombre: '0155_resumen_costo_ia_latido_bucket' },
      { version: '20260822235020', nombre: '0155_purgas_parte2' },
      { version: '20260822234956', nombre: '0155_purgas_parte1' },
      { version: '20260822234647', nombre: '0150_agregados_analytics_permisos' },
      { version: '20260822234558', nombre: '0150_agregados_analytics_cuerpo2' },
      { version: '20260822234446', nombre: '0150_agregados_analytics_cuerpo' },
    ];
    expect(prefijosChocados(filas)).toEqual([]);
  });

  it('los huecos se listan pero NO se afirman como migración faltante', () => {
    expect(huecosDeNumeracion([
      { version: '3', nombre: '0005_c' },
      { version: '1', nombre: '0002_a' },
    ])).toEqual([3, 4]);
    expect(huecosDeNumeracion([])).toEqual([]);
  });
});

describe('la verificación por hecho de las exigidas (incidente 28-ago-2026)', () => {
  const TABLAS = MIGRACIONES_EXIGIDAS.flatMap((m) => [...m.tablas]);

  it('cruza rótulo y hecho: nombre exacto, piezas por prefijo, o ausente — y el hecho manda', () => {
    const filas = [
      { version: '3', nombre: '0155_purgas_parte1' },
      { version: '2', nombre: '0155_purgas_parte2' },
      { version: '1', nombre: '0234_agentes_ingenieria' },
    ];
    const v = verificarExigidas(filas, TABLAS);
    const por = new Map(v.map((x) => [x.exigida.nombre, x]));
    expect(por.get('0234_agentes_ingenieria')).toMatchObject({ registro: 'nombre', hecho: 'objetos_presentes' });
    expect(por.get('0155_purgas_y_bucket_comprobantes')).toMatchObject({
      registro: 'prefijo', hecho: 'objetos_presentes', piezas: ['0155_purgas_parte1', '0155_purgas_parte2'],
    });
    expect(por.get('0102_agente_corrida')).toMatchObject({ registro: 'ausente', hecho: 'objetos_presentes' });
  });

  it('el catálogo en null es «no se pudo mirar», no «no hay tablas»', () => {
    const v = verificarExigidas([], null);
    expect(v.every((x) => x.hecho === 'sin_catalogo')).toBe(true);
    // Y con eso, cero ROJOS: sin hecho verificado no hay acusación.
    expect(hallazgosDeExigidas(v, 'G1').every((h) => h.semaforo !== 'ROJO')).toBe(true);
  });

  it('registrada por NOMBRE pero con la tabla borrada sigue siendo ROJO: el rótulo no salva al hecho', () => {
    const filas = MIGRACIONES_EXIGIDAS.map((m, i) => ({ version: String(i), nombre: m.nombre }));
    const sinCorrida = TABLAS.filter((t) => t !== 'agente_corrida');
    const h = hallazgosDeExigidas(verificarExigidas(filas, sinCorrida), 'G1');
    const rojo = h.find((x) => x.semaforo === 'ROJO');
    expect(rojo?.evidencia).toContain('agente_corrida');
  });
});

describe('el detector de migraciones', () => {
  const contratoLimpio = {
    valor: {
      interruptor_check: "CHECK (id = ANY (ARRAY['global'::text, 'agente:migraciones'::text]))",
      tenant_sin_rls: [], fks_simples_entre_tenantizadas: [], indices_unicos_parciales_cola: [],
    }, error: null,
  };
  const catalogoLimpio = {
    valor: [{ id: 'migraciones', nombre: 'V', departamento: 'ingenieria', estado: 'vivo', runnerHabilitado: true, disparador: 'cron', presupuestoDiaUsd: 0.1 }],
    error: null,
  };
  // La función devuelve `version` DESCENDENTE (lo más reciente primero) y el
  // orden de aplicación coincide con el numérico: el caso sano.
  const filasSanas = MIGRACIONES_EXIGIDAS
    .map((m, i) => ({ version: String(20260101000000 + i), nombre: m.nombre })).reverse();
  const aplicadasCompletas = { valor: { disponible: true, motivo: null, filas: filasSanas }, error: null };
  /** El HECHO completo: todas las tablas que el contrato exige, presentes. */
  const TABLAS_OK = MIGRACIONES_EXIGIDAS.flatMap((m) => [...m.tablas]);
  const tablasCompletas = { valor: TABLAS_OK, error: null };
  const tablasCiegas = { valor: null, error: 'tablas del catálogo (postura_seguridad)' };

  it('sin registro de migraciones NO afirma que el esquema esté al día', () => {
    const h = evaluarMigraciones(
      { valor: { disponible: false, motivo: 'no existe el esquema', filas: [] }, error: null },
      contratoLimpio, catalogoLimpio, tablasCompletas,
    );
    const g0 = h.find((x) => x.codigo === 'G0');
    expect(g0?.semaforo).toBe('NOTA');
    expect(g0?.evidencia).toContain('no existe el esquema');
    // Y NO se inventa un G1 de migraciones faltantes sobre una lista vacía.
    expect(h.some((x) => x.codigo === 'G1')).toBe(false);
  });

  it('una exigida sin rótulo Y con su tabla AUSENTE del catálogo es ROJO, citando la tabla', () => {
    const filas = filasSanas.filter((f) => f.nombre !== MIGRACIONES_EXIGIDAS[0].nombre);
    const tablas = TABLAS_OK.filter((t) => !MIGRACIONES_EXIGIDAS[0].tablas.includes(t));
    const h = evaluarMigraciones({ valor: { disponible: true, motivo: null, filas }, error: null },
      contratoLimpio, catalogoLimpio, { valor: tablas, error: null });
    const g1 = h.find((x) => x.codigo === 'G1');
    expect(g1?.semaforo).toBe('ROJO');
    expect(g1?.evidencia).toContain(MIGRACIONES_EXIGIDAS[0].nombre);
    expect(g1?.evidencia).toContain(MIGRACIONES_EXIGIDAS[0].tablas[0]);
    expect(g1?.evidencia).toContain('VERIFICADO CONTRA EL ESQUEMA');
  });

  // ── LA PRUEBA QUE FALTABA (incidente 28-ago-2026, correos 1 y 2) ─────────
  it('una migración aplicada EN PIEZAS con otros nombres NO se reporta como faltante', () => {
    // El caso real de producción: la 0155 entró como cuatro piezas.
    const filas = [
      ...filasSanas.filter((f) => f.nombre !== '0155_purgas_y_bucket_comprobantes'),
      { version: '20260822235122', nombre: '0155_purgas_permisos' },
      { version: '20260822235040', nombre: '0155_resumen_costo_ia_latido_bucket' },
      { version: '20260822235020', nombre: '0155_purgas_parte2' },
      { version: '20260822234956', nombre: '0155_purgas_parte1' },
    ];
    const h = evaluarMigraciones({ valor: { disponible: true, motivo: null, filas }, error: null },
      contratoLimpio, catalogoLimpio, tablasCompletas);
    expect(h.filter((x) => x.codigo === 'G1')).toEqual([]);
    // Y las piezas contiguas tampoco se acusan como choque de prefijos (G4).
    expect(h.some((x) => x.codigo === 'G4')).toBe(false);
  });

  it('una migración registrada BAJO OTRO NOMBRE (sin prefijo) con su tabla presente es NOTA de bookkeeping, jamás ROJO', () => {
    // El caso real: 0102/0116/0117/0123 constan como 'agente_corrida',
    // 'agente_definicion', 'cola_aprobacion' y 'runner_y_campanas'.
    const filas = [
      ...filasSanas.filter((f) => f.nombre !== '0102_agente_corrida'),
      { version: '20260814202259', nombre: 'agente_corrida' },
    ];
    const h = evaluarMigraciones({ valor: { disponible: true, motivo: null, filas }, error: null },
      contratoLimpio, catalogoLimpio, tablasCompletas);
    const g1 = h.filter((x) => x.codigo === 'G1');
    expect(g1).toHaveLength(1);
    expect(g1[0].semaforo).toBe('NOTA');
    expect(g1[0].detalle).toContain('APLICADAS');
    expect(g1[0].evidencia).toContain('bookkeeping');
  });

  it('rótulo ausente + catálogo CIEGO = ÁMBAR que manda verificar, nunca ROJO por el rótulo solo', () => {
    const filas = filasSanas.filter((f) => f.nombre !== MIGRACIONES_EXIGIDAS[0].nombre);
    const h = evaluarMigraciones({ valor: { disponible: true, motivo: null, filas }, error: null },
      contratoLimpio, catalogoLimpio, tablasCiegas);
    const g1 = h.filter((x) => x.codigo === 'G1');
    expect(g1).toHaveLength(1);
    expect(g1[0].semaforo).toBe('AMBAR');
    expect(g1[0].evidencia).toContain('NO se acusa');
  });

  it('un agente vivo fuera del dominio del interruptor es ROJO — candado 1 lo saltaría siempre', () => {
    const h = evaluarMigraciones(aplicadasCompletas, {
      valor: { interruptor_check: "CHECK (id = ANY (ARRAY['global'::text]))", tenant_sin_rls: [], fks_simples_entre_tenantizadas: [], indices_unicos_parciales_cola: [] },
      error: null,
    }, catalogoLimpio, tablasCompletas);
    const g6 = h.find((x) => x.codigo === 'G6');
    expect(g6?.semaforo).toBe('ROJO');
    expect(g6?.objeto).toContain('migraciones');
  });

  it('el CHECK ausente es ROJO por sí solo: sin dominio, el candado 1 no significa nada', () => {
    const h = evaluarMigraciones(aplicadasCompletas, {
      valor: { interruptor_check: null, tenant_sin_rls: [], fks_simples_entre_tenantizadas: [], indices_unicos_parciales_cola: [] },
      error: null,
    }, catalogoLimpio, tablasCompletas);
    expect(h.find((x) => x.codigo === 'G6')?.detalle).toContain('NO EXISTE');
  });

  it('tenant_id sin RLS es ROJO, y las FK a app_user van APARTE de las de datos', () => {
    const h = evaluarMigraciones(aplicadasCompletas, {
      valor: {
        interruptor_check: "CHECK (id = ANY (ARRAY['agente:migraciones'::text]))",
        tenant_sin_rls: ['gasto'],
        fks_simples_entre_tenantizadas: [
          { origen: 'cola_aprobacion', destino: 'prospecto', constraint_: 'fk_a' },
          { origen: 'viaje', destino: 'app_user', constraint_: 'fk_b' },
        ],
        indices_unicos_parciales_cola: [],
      }, error: null,
    }, catalogoLimpio, tablasCompletas);
    expect(h.find((x) => x.codigo === 'G7')?.semaforo).toBe('ROJO');
    const g8 = h.filter((x) => x.codigo === 'G8');
    expect(g8).toHaveLength(2);
    expect(g8.find((x) => x.semaforo === 'AMBAR')?.objeto).toContain('cola_aprobacion→prospecto');
    expect(g8.find((x) => x.semaforo === 'NOTA')?.detalle).toContain('ACTOR');
  });

  it('todo en orden: ni un ROJO ni un ÁMBAR — solo la nota de huecos, que es ambigua a propósito', () => {
    const h = evaluarMigraciones(aplicadasCompletas, contratoLimpio, catalogoLimpio, tablasCompletas);
    expect(h.filter((x) => x.semaforo !== 'NOTA')).toEqual([]);
    // Los huecos existen SIEMPRE (la lista exigida es curada, no un rango) y
    // por eso son NOTA: afirmar «falta la 0103» sin el repo sería inventar.
    expect(h.find((x) => x.codigo === 'G5')?.evidencia).toContain('AMBIGUO A PROPÓSITO');
  });

  it('el parte NUNCA dice haber revisado el contenido de una migración', () => {
    const cuerpo = armarParteMigraciones([], LUNES, aplicadasCompletas, null);
    expect(cuerpo).toContain('LO QUE ESTE PARTE NO MIRA: el CONTENIDO de una migración');
    expect(cuerpo).toContain('NO tiene el repo');
  });
});

describe('la corrida de migraciones', () => {
  function prepararOk() {
    respuestas.set('cola_aprobacion', [{ data: [], error: null, count: 0 }]);
    respuestas.set('agente_definicion', [{ data: CATALOGO_OK, error: null }]);
    rpcs.set('migraciones_aplicadas', [{ data: { disponible: true, motivo: null, filas: MIGRACIONES_EXIGIDAS.map((m, i) => ({ version: String(20260101000000 + i), nombre: m.nombre })).reverse() }, error: null }]);
    rpcs.set('contrato_de_esquema', [{ data: { interruptor_check: "ARRAY['agente:migraciones'::text]", tenant_sin_rls: [], fks_simples_entre_tenantizadas: [], indices_unicos_parciales_cola: [] }, error: null }]);
    rpcs.set('postura_seguridad', [{ data: POSTURA_CONTRATO(), error: null }]);
  }

  it('fabrica el parte de la semana, lo anota con costo 0 MEDIDO y no alerta sin ROJOS', async () => {
    prepararOk();
    const r = await correrAgenteIngenieria('migraciones', 'cron', HOY);
    expect(r).toMatchObject({ resultado: 'corrio', piezas: 1, costoUsd: 0 });
    expect(ultimo().titulo).toBe(`Migraciones — semana del ${LUNES}`);
    expect(registrar.mock.calls[0][2]).toMatchObject({ costoUsd: 0, estado: 'ok' });
    expect(alertar).not.toHaveBeenCalled();
  });

  it('si el parte del periodo ya está, no fabrica otro', async () => {
    respuestas.set('cola_aprobacion', [{ data: [], error: null, count: 1 }]);
    const r = await correrAgenteIngenieria('migraciones', 'cron', HOY);
    expect(r).toMatchObject({ resultado: 'saltado', piezas: 0 });
    expect(encolar).not.toHaveBeenCalled();
  });

  it('el conteo que PostgREST no devuelve NO se lee como 0: la corrida falla y queda anotada', async () => {
    respuestas.set('cola_aprobacion', [{ data: [], error: null, count: undefined }]);
    await expect(correrAgenteIngenieria('migraciones', 'cron', HOY)).rejects.toThrow(/no devolvió el conteo/);
    expect(registrar.mock.calls.at(-1)?.[2]).toMatchObject({ estado: 'fallo' });
  });

  it('con un ROJO, alerta al operador sin esperar a que alguien abra la bandeja', async () => {
    respuestas.set('cola_aprobacion', [{ data: [], error: null, count: 0 }]);
    respuestas.set('agente_definicion', [{ data: CATALOGO_OK, error: null }]);
    rpcs.set('migraciones_aplicadas', [{ data: { disponible: true, motivo: null, filas: [] }, error: null }]);
    rpcs.set('contrato_de_esquema', [{ data: { interruptor_check: 'ARRAY[]', tenant_sin_rls: [], fks_simples_entre_tenantizadas: [], indices_unicos_parciales_cola: [] }, error: null }]);
    // El catálogo contesta SIN las tablas del contrato: la faltante es un
    // HECHO verificado, no un rótulo — por eso el ROJO y el correo proceden.
    rpcs.set('postura_seguridad', [{ data: { tablas: [], funciones: [], vistas: [], columnas_sensibles: [] }, error: null }]);
    await correrAgenteIngenieria('migraciones', 'cron', HOY);
    expect(alertar).toHaveBeenCalled();
  });

  it('el duplicado del índice único se lee como «ya existía», no como fallo', async () => {
    prepararOk();
    encolar.mockRejectedValueOnce(new Error('duplicate key value violates unique constraint "cola_parte_ingenieria_por_periodo"'));
    const r = await correrAgenteIngenieria('migraciones', 'cron', HOY);
    expect(r).toMatchObject({ resultado: 'corrio', piezas: 0, motivo: 'otra corrida ganó el periodo' });
  });
});

// ── 2 · SEGURIDAD ──────────────────────────────────────────────────────────

describe('el detector de seguridad', () => {
  it('una postura limpia no inventa hallazgos', () => {
    expect(evaluarSeguridad(POSTURA_LIMPIA)).toEqual([]);
  });

  it('separa la tabla sin RLS EXPUESTA (ROJO) de la que solo está sin RLS (ÁMBAR)', () => {
    const h = evaluarSeguridad({
      ...POSTURA_LIMPIA,
      tablas: [
        { tabla: 'fuga', rls: false, politicas: 0, tiene_tenant_id: true, anon_lee: true, auth_lee: true, anon_escribe: false, auth_escribe: false },
        { tabla: 'latente', rls: false, politicas: 0, tiene_tenant_id: false, anon_lee: false, auth_lee: false, anon_escribe: false, auth_escribe: false },
      ],
    });
    expect(h.find((x) => x.codigo === 'S1')?.semaforo).toBe('ROJO');
    expect(h.find((x) => x.codigo === 'S1')?.objeto).toBe('fuga');
    expect(h.find((x) => x.codigo === 'S2')?.semaforo).toBe('AMBAR');
    expect(h.find((x) => x.codigo === 'S2')?.objeto).toBe('latente');
  });

  it('una DEFINER que alguna policy usa como ayudante NO es hallazgo — revocarla rompería la RLS', () => {
    const h = evaluarSeguridad({
      ...POSTURA_LIMPIA,
      funciones: [{ funcion: 'get_user_tenant_ids', definer: true, anon_ejecuta: true, auth_ejecuta: true, search_path_fijo: true, ayudante_rls: true }],
    });
    expect(h.some((x) => x.codigo === 'S3' || x.codigo === 'S4')).toBe(false);
  });

  it('una DEFINER abierta a anon y sin exención es ROJO; a authenticated, ÁMBAR', () => {
    const h = evaluarSeguridad({
      ...POSTURA_LIMPIA,
      funciones: [
        { funcion: 'peligrosa', definer: true, anon_ejecuta: true, auth_ejecuta: true, search_path_fijo: true, ayudante_rls: false },
        { funcion: 'media', definer: true, anon_ejecuta: false, auth_ejecuta: true, search_path_fijo: true, ayudante_rls: false },
      ],
    });
    expect(h.find((x) => x.codigo === 'S3')?.objeto).toBe('peligrosa');
    expect(h.find((x) => x.codigo === 'S4')?.objeto).toBe('media');
  });

  it('DEFINER sin search_path fijo se reporta aunque no esté expuesta', () => {
    const h = evaluarSeguridad({
      ...POSTURA_LIMPIA,
      funciones: [{ funcion: 'suelta', definer: true, anon_ejecuta: false, auth_ejecuta: false, search_path_fijo: false, ayudante_rls: false }],
    });
    expect(h.find((x) => x.codigo === 'S5')?.objeto).toBe('suelta');
  });

  it('una vista sin security_invoker es ROJO — es la regresión de la 0054', () => {
    const h = evaluarSeguridad({ ...POSTURA_LIMPIA, vistas: [{ vista: 'saldo', security_invoker: false }] });
    expect(h.find((x) => x.codigo === 'S6')?.semaforo).toBe('ROJO');
  });

  it('las columnas cuyo nombre YA declara el valor derivado se descuentan y se dicen', () => {
    const h = evaluarSeguridad({
      ...POSTURA_LIMPIA,
      columnas_sensibles: [
        { tabla: 'invitacion', columna: 'token_hash', tipo: 'text' },
        { tabla: 'rastreo', columna: 'token_cifrado', tipo: 'text' },
        { tabla: 'tenant', columna: 'buzon_token', tipo: 'text' },
      ],
    });
    const s7 = h.find((x) => x.codigo === 'S7');
    expect(s7?.objeto).toBe('tenant.buzon_token');
    expect(s7?.evidencia).toContain('HEURÍSTICA DE NOMBRE');
    expect(s7?.evidencia).toContain('2 candidata(s) más se descartaron');
  });

  it('el parte declara que NO audita dependencias, secretos del repo ni IDOR', () => {
    const cuerpo = armarParteSeguridad([], { valor: POSTURA_LIMPIA, error: null }, LUNES, null);
    expect(cuerpo).toContain('npm audit');
    expect(cuerpo).toContain('RUTINA LOCAL');
    expect(cuerpo).toContain('deniega-todo');
  });
});

describe('la corrida de seguridad', () => {
  it('un catálogo CIEGO tumba la corrida: no se firma «nada disparó umbral» sobre lo que no se miró', async () => {
    respuestas.set('cola_aprobacion', [{ data: [], error: null, count: 0 }]);
    rpcs.set('postura_seguridad', [{ data: null, error: { message: 'base caída' } }]);
    await expect(correrAgenteIngenieria('seguridad', 'cron', HOY)).rejects.toThrow(/catálogo ciego/);
    expect(encolar).not.toHaveBeenCalled();
    expect(registrar.mock.calls.at(-1)?.[2]).toMatchObject({ estado: 'fallo' });
  });

  it('con postura legible, fabrica el parte y su título es el de la semana', async () => {
    respuestas.set('cola_aprobacion', [{ data: [], error: null, count: 0 }]);
    rpcs.set('postura_seguridad', [{ data: POSTURA_LIMPIA, error: null }]);
    const r = await correrAgenteIngenieria('seguridad', 'cron', HOY);
    expect(r.piezas).toBe(1);
    expect(ultimo().titulo).toBe(`Seguridad — semana del ${LUNES}`);
  });
});

// ── 3 · RENDIMIENTO ────────────────────────────────────────────────────────

describe('el detector de rendimiento', () => {
  it('sin censo previo declara LÍNEA BASE y NO inventa un delta', () => {
    const h = evaluarRendimiento(PERFIL_LIMPIO, null, []);
    const r1 = h.find((x) => x.codigo === 'R1');
    expect(r1?.detalle).toContain('LÍNEA BASE');
    expect(r1?.evidencia).toContain('nadie midió');
  });

  it('con censo previo mide el crecimiento y nombra las tablas nuevas aparte', () => {
    const h = evaluarRendimiento(
      { ...PERFIL_LIMPIO, tablas: [
        { tabla: 'viaje', bytes: 4_000_000, filas_estimadas: 10, seq_scan: 1, seq_tup_read: 1, idx_scan: 100, indices: 2 },
        { tabla: 'nueva', bytes: 3_000_000, filas_estimadas: 10, seq_scan: 1, seq_tup_read: 1, idx_scan: 100, indices: 1 },
      ] },
      { viaje: 2_000_000 }, [],
    );
    const crecio = h.filter((x) => x.codigo === 'R1');
    expect(crecio[0].evidencia).toContain('100%');
    expect(crecio[1].detalle).toContain('no estaban en el censo anterior');
    expect(crecio[1].evidencia).toContain('no es «creció desde 0»');
  });

  it('seq_scan NULL se declara «no consta» y queda FUERA del análisis de índice', () => {
    const h = evaluarRendimiento(
      { ...PERFIL_LIMPIO, tablas: [{ tabla: 'sinstats', bytes: 9_000_000, filas_estimadas: -1, seq_scan: null, seq_tup_read: null, idx_scan: null, indices: 1 }] },
      {}, [],
    );
    const r2 = h.filter((x) => x.codigo === 'R2');
    expect(r2).toHaveLength(1);
    expect(r2[0].evidencia).toContain('NUNCA «cero escaneos»');
  });

  it('una tabla pesada con escaneo secuencial dominante sale como sospecha, no como diagnóstico', () => {
    const h = evaluarRendimiento(
      { ...PERFIL_LIMPIO, tablas: [{ tabla: 'gasto', bytes: 50_000_000, filas_estimadas: 900000, seq_scan: 5000, seq_tup_read: 900000, idx_scan: 10, indices: 1 }] },
      {}, [],
    );
    const r2 = h.find((x) => x.codigo === 'R2');
    expect(r2?.semaforo).toBe('AMBAR');
    expect(r2?.evidencia).toContain('SOSPECHA con evidencia, no un diagnóstico');
  });

  it('sin pg_stat_statements lo DICE en vez de callar', () => {
    const h = evaluarRendimiento(
      { tablas: [], consultas: { disponible: false, motivo: 'la extensión no está', filas: [] } }, {}, [],
    );
    const r3 = h.find((x) => x.codigo === 'R3');
    expect(r3?.evidencia).toContain('la extensión no está');
  });

  it('con pg_stat_statements cita el top por tiempo total', () => {
    const h = evaluarRendimiento(
      { tablas: [], consultas: { disponible: true, motivo: null, filas: [{ consulta: 'select 1', llamadas: 10, ms_total: 500, ms_media: 50, filas: 10 }] } }, {}, [],
    );
    expect(h.find((x) => x.codigo === 'R3')?.evidencia).toContain('select 1');
  });

  it('un agente que corrió y NUNCA anotó costo se dice: NULL no es $0', () => {
    const h = evaluarRendimiento(PERFIL_LIMPIO, {}, [
      { agente: 'mudo', corridas: 9, conCosto: 0, totalUsd: 0 },
      { agente: 'caro', corridas: 10, conCosto: 10, totalUsd: 2 },
    ]);
    const r4 = h.filter((x) => x.codigo === 'R4');
    expect(r4.find((x) => x.objeto === 'caro')?.evidencia).toContain('corrida(s) con costo medido');
    expect(r4.find((x) => x.objeto === 'mudo')?.evidencia).toContain('jamás $0');
  });

  it('mb pinta bytes, kB y MB sin mentir de escala', () => {
    expect(mb(500)).toBe('500 B');
    expect(mb(2048)).toBe('2.0 kB');
    expect(mb(3 * 1024 * 1024)).toBe('3.0 MB');
  });

  it('el parte declara que NO mide build, bundle ni cold starts', () => {
    const cuerpo = armarParteRendimiento([], PERFIL_LIMPIO, LUNES, null);
    expect(cuerpo).toContain('NO MIDE: tiempos de build');
    expect(cuerpo).toContain('SOSPECHA con evidencia');
  });
});

describe('la corrida de rendimiento', () => {
  it('deja el censo de bytes en fuentes: sin él, el siguiente parte sería línea base para siempre', async () => {
    respuestas.set('cola_aprobacion', [
      { data: [], error: null, count: 0 },   // parteExistente
      { data: [], error: null },             // censoPrevio: sin parte anterior
    ]);
    respuestas.set('agente_corrida', [{ data: [{ agente: 'x', costo_usd: null }], error: null }]);
    rpcs.set('perfil_almacenamiento', [{ data: PERFIL_LIMPIO, error: null }]);
    const r = await correrAgenteIngenieria('rendimiento', 'cron', HOY);
    expect(r.piezas).toBe(1);
    expect(ultimo().fuentes.censo_bytes).toEqual({ viaje: 2_000_000 });
  });

  it('el perfil CIEGO tumba la corrida en vez de afirmar que nada creció', async () => {
    respuestas.set('cola_aprobacion', [{ data: [], error: null, count: 0 }]);
    rpcs.set('perfil_almacenamiento', [{ data: null, error: { message: 'caída' } }]);
    await expect(correrAgenteIngenieria('rendimiento', 'cron', HOY)).rejects.toThrow(/base ciega/);
  });
});

// ── 4 · RELEASES ───────────────────────────────────────────────────────────

describe('el despliegue que este servidor ve', () => {
  it('sin VERCEL_GIT_COMMIT_SHA no se inventa un SHA', () => {
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', '');
    expect(shaDesplegado()).toBeNull();
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', 'no-es-un-sha');
    expect(shaDesplegado()).toBeNull();
  });

  it('un SHA válido se normaliza a minúsculas, y la rama ausente NO se rellena con master', () => {
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', 'ABC1234DEF');
    vi.stubEnv('VERCEL_GIT_COMMIT_REF', '');
    vi.stubEnv('VERCEL_ENV', '');
    expect(shaDesplegado()).toBe('abc1234def');
    expect(ramaDesplegada()).toBeNull();
    expect(entornoDesplegado()).toBe('local');
  });

  it('la primera vista se INSERTA; la segunda solo mueve ultima_vista y nunca pisa primera_vista', async () => {
    respuestas.set('despliegue_visto', [{ data: [], error: null }]);
    const alta = await registrarDespliegue('abc1234');
    expect(escrituras.at(-1)).toMatchObject({ tabla: 'despliegue_visto', op: 'insert' });
    expect(alta?.vistas).toBe(1);

    escrituras.length = 0;
    respuestas.set('despliegue_visto', [{ data: [{ sha: 'abc1234', entorno: 'production', rama: 'master', primera_vista: '2026-08-01T00:00:00Z', ultima_vista: '2026-08-02T00:00:00Z', vistas: 3 }], error: null }]);
    const tocada = await registrarDespliegue('abc1234');
    expect(escrituras.at(-1)).toMatchObject({ op: 'update' });
    expect((escrituras.at(-1)?.fila as Record<string, unknown>).primera_vista).toBeUndefined();
    expect(tocada?.primeraVista).toBe('2026-08-01T00:00:00Z');
    expect(tocada?.vistas).toBe(4);
  });

  it('dos corridas simultáneas: el choque de PK NO es fallo — la base arbitra', async () => {
    respuestas.set('despliegue_visto', [
      { data: [], error: null },
      { data: null, error: { message: 'duplicate key value violates unique constraint' } },
    ]);
    await expect(registrarDespliegue('abc1234')).resolves.toMatchObject({ sha: 'abc1234' });
  });
});

describe('el detector de releases', () => {
  const DESPLIEGUE = { sha: 'abc1234', entorno: 'production', rama: 'master', primeraVista: '2026-08-20T00:00:00Z', ultimaVista: '2026-08-27T00:00:00Z', vistas: 20 };
  const APLICADAS_OK = {
    valor: { disponible: true, motivo: null, filas: MIGRACIONES_EXIGIDAS.map((m, i) => ({ version: String(20260810000000 + i), nombre: m.nombre })) },
    error: null,
  };
  const TABLAS_OK = { valor: MIGRACIONES_EXIGIDAS.flatMap((m) => [...m.tablas]), error: null };

  it('sin SHA lo dice y no afirma qué código corre', () => {
    const h = evaluarReleases(null, APLICADAS_OK, TABLAS_OK);
    expect(h.find((x) => x.codigo === 'D0')?.evidencia).toContain('NO se inventa un SHA');
  });

  it('el código exige una migración cuyo objeto la base NO tiene: ROJO, la mitad cara de «mergeado ≠ desplegado»', () => {
    const filas = MIGRACIONES_EXIGIDAS.slice(1).map((m, i) => ({ version: String(20260810000000 + i), nombre: m.nombre }));
    const tablas = { valor: MIGRACIONES_EXIGIDAS.slice(1).flatMap((m) => [...m.tablas]), error: null };
    const h = evaluarReleases(DESPLIEGUE, { valor: { disponible: true, motivo: null, filas }, error: null }, tablas);
    const d2 = h.find((x) => x.codigo === 'D2');
    expect(d2?.semaforo).toBe('ROJO');
    expect(d2?.evidencia).toContain(MIGRACIONES_EXIGIDAS[0].tablas[0]);
  });

  // La prueba que faltaba (correo en falso #1 del 28-ago-2026): el registro
  // sin el rótulo canónico Y el hecho presente no es un despliegue roto.
  it('una exigida aplicada en piezas o bajo otro nombre, con sus tablas presentes, NO es D2 ROJO', () => {
    const filas = [
      ...MIGRACIONES_EXIGIDAS.slice(1).map((m, i) => ({ version: String(20260810000000 + i), nombre: m.nombre })),
      { version: '20260814202259', nombre: 'agente_corrida' }, // la 0102 real de producción
    ];
    const h = evaluarReleases(DESPLIEGUE, { valor: { disponible: true, motivo: null, filas }, error: null }, TABLAS_OK);
    const d2 = h.filter((x) => x.codigo === 'D2');
    expect(d2.every((x) => x.semaforo === 'NOTA')).toBe(true);
  });

  it('una migración aplicada DESPUÉS de la primera vista del SHA es la otra mitad: el esquema se movió y el código no', () => {
    const filas = [
      ...MIGRACIONES_EXIGIDAS.map((m, i) => ({ version: String(20260810000000 + i), nombre: m.nombre })),
      { version: '20260825120000', nombre: '9999_posterior' },
    ];
    const h = evaluarReleases(DESPLIEGUE, { valor: { disponible: true, motivo: null, filas }, error: null }, TABLAS_OK);
    const d3 = h.find((x) => x.codigo === 'D3');
    expect(d3?.semaforo).toBe('AMBAR');
    expect(d3?.evidencia).toContain('9999_posterior');
  });

  it('sin registro de migraciones no se compara nada y se dice', () => {
    const h = evaluarReleases(DESPLIEGUE, { valor: { disponible: false, motivo: 'no existe', filas: [] }, error: null }, TABLAS_OK);
    expect(h).toHaveLength(1);
    expect(h[0].codigo).toBe('D1');
  });

  it('el parte aclara que la primera vista NO es la hora del deploy', () => {
    const cuerpo = armarParteReleases([], DESPLIEGUE, [DESPLIEGUE], APLICADAS_OK, LUNES, null);
    expect(cuerpo).toContain('NO la hora del despliegue');
    expect(cuerpo).toContain('Vercel no la expone');
  });

  it('sin SHA el parte lo dice en la primera línea, sin rellenar', () => {
    vi.stubEnv('VERCEL_ENV', '');
    const cuerpo = armarParteReleases([], null, [], APLICADAS_OK, LUNES, null);
    expect(cuerpo).toContain('SIN SHA DECLARADO');
  });
});

describe('la corrida de releases', () => {
  it('el REGISTRO del SHA corre aunque el parte de la semana ya exista', async () => {
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', 'abc1234');
    respuestas.set('despliegue_visto', [{ data: [], error: null }]);
    respuestas.set('cola_aprobacion', [{ data: [], error: null, count: 1 }]);
    const r = await correrAgenteIngenieria('releases', 'cron', HOY);
    expect(escrituras.some((e) => e.tabla === 'despliegue_visto')).toBe(true);
    expect(r).toMatchObject({ resultado: 'corrio', piezas: 0 });
    expect(r.motivo).toContain('quedó registrado igual');
  });

  it('fabrica el parte con el SHA en fuentes', async () => {
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', 'abc1234');
    vi.stubEnv('VERCEL_ENV', 'production');
    respuestas.set('despliegue_visto', [
      { data: [], error: null },  // registrarDespliegue: no existía
      { data: [], error: null },  // leerDespliegues
    ]);
    respuestas.set('cola_aprobacion', [{ data: [], error: null, count: 0 }]);
    rpcs.set('migraciones_aplicadas', [{ data: { disponible: true, motivo: null, filas: MIGRACIONES_EXIGIDAS.map((m, i) => ({ version: String(20260810000000 + i), nombre: m.nombre })) }, error: null }]);
    rpcs.set('postura_seguridad', [{ data: POSTURA_CONTRATO(), error: null }]);
    const r = await correrAgenteIngenieria('releases', 'cron', HOY);
    expect(r.piezas).toBe(1);
    expect(ultimo().fuentes.sha).toBe('abc1234');
    expect(ultimo().fuentes.entorno).toBe('production');
  });
});

// ── El predicado del catálogo vivo ─────────────────────────────────────────

describe('autonomos', () => {
  it('solo cuenta vivo + habilitado + cron: los tres candados que el runner consulta', () => {
    const base = { nombre: 'x', departamento: 'ingenieria', presupuestoDiaUsd: 0.1 };
    expect(autonomos([
      { id: 'a', ...base, estado: 'vivo', runnerHabilitado: true, disparador: 'cron' },
      { id: 'b', ...base, estado: 'vivo', runnerHabilitado: false, disparador: 'cron' },
      { id: 'c', ...base, estado: 'disenado', runnerHabilitado: true, disparador: 'cron' },
      { id: 'd', ...base, estado: 'vivo', runnerHabilitado: true, disparador: 'manual' },
    ]).map((f) => f.id)).toEqual(['a']);
  });
});
