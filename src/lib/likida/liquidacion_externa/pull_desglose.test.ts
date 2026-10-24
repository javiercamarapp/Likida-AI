import { describe, it, expect, vi } from 'vitest';
import { DESGLOSE_SINTETICO } from './desglose.fixture';
import { claveDeBitacora, type DesgloseBitacora } from './desglose_contrato';
import { lectorEnMemoria, TmsLimite, TmsNoDisponible, type CursorDesglose, type FilaEnMemoria, type LectorDesglosesPuerto } from './desglose_puerto';
import type { ResultadoDesglose } from './desglose_recibir';
import type { EntregaCorreo, EstadoPull, TipoExcepcion } from './repo_correo';

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => { throw new Error('la base no debe tocarse en estas pruebas'); } }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { pullDesgloses, TOPE_ITEMS_POR_PASADA } = await import('./pull_desglose');
type Deps = import('./pull_desglose').DependenciasPull;

// ═══════════════════════════════════════════════════════════════════════════
// pullDesgloses (T-A1-24). Dobles en memoria y datos sintéticos: ningún nombre, correo ni importe reales.
// ═══════════════════════════════════════════════════════════════════════════

const TENANT = '00000000-0000-4000-8000-000000000001';
const AHORA = new Date('2026-10-15T12:00:00Z');
const f = DESGLOSE_SINTETICO;

const bitacora = (n: number, extra: Partial<DesgloseBitacora> = {}): DesgloseBitacora => ({
  terminal: 'T1',
  bitacora: `B-${String(n).padStart(4, '0')}`,
  poliza: `P-${n}`,
  operador: { numeroEmpleado: `E-${n}` },
  desde: f.desde,
  hasta: f.hasta,
  percepciones: [{ concepto: 'Sueldo', monto: 1000 }],
  deducciones: [{ concepto: 'Anticipo', monto: 100 }],
  neto: 900,
  ...extra,
});
const clave = (n: number) => claveDeBitacora('T1', `B-${String(n).padStart(4, '0')}`);
const fila = (n: number, extra: Partial<DesgloseBitacora> = {}, hora = n): FilaEnMemoria => ({
  modificadoEn: `2026-10-14T${String(hora % 24).padStart(2, '0')}:00:00Z`,
  desglose: bitacora(n, extra),
});

interface Banco {
  deps: Deps;
  estado: EstadoPull;
  guardados: Array<Record<string, unknown>>;
  /** clave → neto ya recibido */
  recibidos: Map<string, number>;
  llamadasRecibir: string[];
  excepciones: Array<{ id: number; clave: string; tipo: TipoExcepcion; detalle: Record<string, unknown>; resuelta: boolean }>;
  entregas: Map<string, Array<{ rol: string; estado: string }>>;
}

function banco(opciones: { falla?: (n: number) => boolean; fallaGuardarCursor?: boolean; estadoNulo?: boolean } = {}): Banco {
  const b: Banco = {
    deps: null as unknown as Deps,
    estado: { cursor: null, ultimaCorrida: null, ultimoExito: null, ultimoError: null, leidas: 0, importadas: 0, excepciones: 0 },
    guardados: [], recibidos: new Map(), llamadasRecibir: [], excepciones: [], entregas: new Map(),
  };
  let ordinal = 0;
  b.deps = {
    ahora: () => AHORA,
    leerEstado: async () => (opciones.estadoNulo ? null : b.estado),
    guardarEstado: async (_t, e) => {
      if (opciones.fallaGuardarCursor) throw new Error('base caída');
      b.guardados.push({ ...e });
      b.estado = {
        ...b.estado,
        ...(e.exito && e.cursor !== undefined ? { cursor: e.cursor } : {}),
        ultimaCorrida: e.ahora.toISOString(),
        ultimoExito: e.exito ? e.ahora.toISOString() : b.estado.ultimoExito,
        ultimoError: e.exito ? null : (e.error ?? 'x'),
        leidas: e.leidas, importadas: e.importadas, excepciones: e.excepciones,
      };
    },
    recibir: async (_t, d): Promise<ResultadoDesglose> => {
      const k = claveDeBitacora(d.terminal, d.bitacora);
      ordinal += 1;
      b.llamadasRecibir.push(k);
      if (opciones.falla?.(ordinal)) throw new Error('storage caído');
      const antes = b.recibidos.get(k);
      const neto = d.neto ?? 0;
      if (antes === undefined) {
        b.recibidos.set(k, neto);
        return { estado: 'creada', liquidacionId: `liq-${k}`, claveExterna: k, entregas: 1, retenida: false, motivos: [], excepciones: [] };
      }
      if (antes === neto) return { estado: 'idempotente', liquidacionId: `liq-${k}`, claveExterna: k };
      b.excepciones.push({ id: b.excepciones.length + 1, clave: k, tipo: 'correccion_pendiente', detalle: {}, resuelta: false });
      return { estado: 'correccion_pendiente', liquidacionId: `liq-${k}`, claveExterna: k };
    },
    abrirExcepcion: async (_t, k, tipo, detalle) => {
      const previa = b.excepciones.find((e) => e.clave === k && e.tipo === tipo && !e.resuelta);
      if (previa) { previa.detalle = detalle; return { id: previa.id, nueva: false }; }
      const id = b.excepciones.length + 1;
      b.excepciones.push({ id, clave: k, tipo, detalle, resuelta: false });
      return { id, nueva: true };
    },
    excepcionesSinPoliza: async () => new Map(b.excepciones.filter((e) => e.tipo === 'sin_poliza' && !e.resuelta).map((e) => [e.clave, e.id] as const)),
    resolverExcepcion: async (_t, id) => {
      const e = b.excepciones.find((x) => x.id === id && !x.resuelta);
      if (!e) return false;
      e.resuelta = true;
      return true;
    },
    entregasDe: async (_t, liqId) => (b.entregas.get(liqId) ?? []).map((e) => ({ rol: e.rol, estado: e.estado }) as unknown as EntregaCorreo),
  };
  return b;
}

const abiertas = (b: Banco, tipo: TipoExcepcion) => b.excepciones.filter((e) => e.tipo === tipo && !e.resuelta);

describe('pullDesgloses: páginas, sin póliza y conflictos', () => {
  it('3 páginas con un ítem sin póliza y uno con neto distinto del ya recibido => importadas y excepciones correctas', async () => {
    const b = banco();
    b.recibidos.set(clave(5), 800); // ya recibido con otro neto
    const lector = lectorEnMemoria([fila(1), fila(2), fila(3, { poliza: null }), fila(4), fila(5), fila(6)]);
    const r = await pullDesgloses(TENANT, lector, b.deps, { limite: 2 });
    expect(r).toMatchObject({ estado: 'ok', paginas: 3, leidas: 6, importadas: 4, excepciones: 2, resueltas: 0, hayMas: false });
    expect(abiertas(b, 'sin_poliza').map((e) => e.clave)).toEqual([clave(3)]);
    expect(abiertas(b, 'correccion_pendiente').map((e) => e.clave)).toEqual([clave(5)]);
    expect(b.llamadasRecibir).not.toContain(clave(3)); // sin póliza: no se envía
    expect(b.recibidos.get(clave(5))).toBe(800); // nada se sobrescribió
    expect(b.estado.cursor).toEqual({ desde: '2026-10-14T06:00:00Z', despuesDe: clave(6) });
    expect(b.estado).toMatchObject({ leidas: 6, importadas: 4, excepciones: 2, ultimoError: null, ultimoExito: AHORA.toISOString() });
  });

  it('el cursor se persiste página a página, solo después de procesarla', async () => {
    const b = banco();
    await pullDesgloses(TENANT, lectorEnMemoria([fila(1), fila(2), fila(3), fila(4)]), b.deps, { limite: 2 });
    expect(b.guardados.map((g) => (g.cursor as CursorDesglose).despuesDe)).toEqual([clave(2), clave(4)]);
  });

  it('cuando la póliza llega en una lectura posterior, la excepción sin_poliza se resuelve sola y la bitácora se importa', async () => {
    const b = banco();
    await pullDesgloses(TENANT, lectorEnMemoria([fila(1), fila(2, { poliza: null })]), b.deps);
    expect(abiertas(b, 'sin_poliza')).toHaveLength(1);
    expect(b.recibidos.has(clave(2))).toBe(false);

    // la bitácora 2 se modifica horas después (llega la póliza) y cae dentro del traslape
    const r = await pullDesgloses(TENANT, lectorEnMemoria([fila(1), { modificadoEn: '2026-10-15T01:00:00Z', desglose: bitacora(2) }]), b.deps);
    expect(r).toMatchObject({ estado: 'ok', importadas: 1, resueltas: 1 });
    expect(abiertas(b, 'sin_poliza')).toHaveLength(0);
    expect(b.recibidos.has(clave(2))).toBe(true);
  });

  it('una bitácora sin póliza que sigue sin póliza no duplica la excepción (se refresca la misma)', async () => {
    const b = banco();
    const lector = lectorEnMemoria([fila(1, { poliza: null })]);
    await pullDesgloses(TENANT, lector, b.deps);
    await pullDesgloses(TENANT, lector, b.deps);
    expect(b.excepciones.filter((e) => e.tipo === 'sin_poliza')).toHaveLength(1);
  });

  it('mapeo inválido => excepción mapeo_invalido que nombra el campo y NO trae el valor', async () => {
    const b = banco();
    const mala = fila(2, { percepciones: [{ concepto: 'Sueldo', monto: -777.77 }] });
    const r = await pullDesgloses(TENANT, lectorEnMemoria([fila(1), mala, fila(3)]), b.deps);
    expect(r).toMatchObject({ estado: 'ok', importadas: 2, excepciones: 1 });
    const ex = abiertas(b, 'mapeo_invalido');
    expect(ex).toHaveLength(1);
    expect(ex[0].clave).toBe(clave(2));
    expect(Object.keys(ex[0].detalle)).toEqual(['campo']);
    expect(JSON.stringify(ex[0].detalle)).not.toContain('777');
  });
});

describe('pullDesgloses: cursor, traslape e idempotencia', () => {
  it('reinicio a mitad de página: nada se duplica y la segunda pasada completa el trabajo', async () => {
    const b = banco({ falla: (n) => n === 3 }); // la 3.ª llamada a recibir falla (a mitad de la 2.ª página)
    const lector = lectorEnMemoria([fila(1), fila(2), fila(3), fila(4), fila(5)]);
    const r1 = await pullDesgloses(TENANT, lector, b.deps, { limite: 2 });
    expect(r1.estado).toBe('error');
    expect(b.estado.cursor).toEqual({ desde: '2026-10-14T02:00:00Z', despuesDe: clave(2) }); // solo avanzó la página 1
    expect(b.estado.ultimoError).toBeTruthy();

    const r2 = await pullDesgloses(TENANT, lector, b.deps, { limite: 2 });
    expect(r2.estado).toBe('ok');
    expect(b.recibidos.size).toBe(5);
    expect(new Set(b.llamadasRecibir.slice(0, 2)).size).toBe(2);
    expect(b.estado.cursor?.despuesDe).toBe(clave(5));
    expect(b.estado.importadas).toBe(5); // 2 + 3, sin duplicar
  });

  it('si falla la persistencia del cursor, el cursor no avanza y la pasada no lanza', async () => {
    const b = banco({ fallaGuardarCursor: true });
    const r = await pullDesgloses(TENANT, lectorEnMemoria([fila(1), fila(2)]), b.deps);
    expect(r.estado).toBe('error');
    expect(b.estado.cursor).toBeNull();
    expect(r.cursor).toBeNull();
  });

  it.each([
    ['TmsNoDisponible', () => new TmsNoDisponible()],
    ['TmsLimite', () => new TmsLimite('límite', 30)],
  ])('error de red (%s) => cursor intacto, ultimo_error guardado, sin lanzar', async (_n, crear) => {
    const b = banco();
    b.estado.cursor = { desde: '2026-10-14T05:00:00.000Z', despuesDe: clave(5) };
    const lector: LectorDesglosesPuerto = { listar: async () => { throw crear(); } };
    const r = await pullDesgloses(TENANT, lector, b.deps);
    expect(r.estado).toBe('error');
    expect(b.estado.cursor).toEqual({ desde: '2026-10-14T05:00:00.000Z', despuesDe: clave(5) });
    expect(b.estado.ultimoError).toContain(crear().name);
    expect(b.guardados.at(-1)).toMatchObject({ exito: false });
    expect(b.guardados.at(-1)).not.toHaveProperty('cursor');
  });

  it('la primera página re-lee el traslape de 24 h y las siguientes siguen el cursor; el cursor nunca retrocede', async () => {
    const b = banco();
    b.estado.cursor = { desde: '2026-10-14T10:00:00.000Z', despuesDe: clave(10) };
    const filas = [fila(8, {}, 8), fila(9, {}, 9), fila(10, {}, 10), fila(11, {}, 11)];
    const base = lectorEnMemoria(filas);
    const llamadas: Array<{ cursor: CursorDesglose | null; reLeerDesde?: string }> = [];
    const lector: LectorDesglosesPuerto = { listar: async (p) => { llamadas.push({ cursor: p.cursor, reLeerDesde: p.reLeerDesde }); return base.listar(p); } };
    await pullDesgloses(TENANT, lector, b.deps, { limite: 2 });
    expect(llamadas[0].reLeerDesde).toBe('2026-10-13T10:00:00.000Z');
    expect(llamadas[1].reLeerDesde).toBeUndefined();
    expect(b.estado.cursor?.despuesDe).toBe(clave(11));
    // la página 1 (8 y 9) quedó antes del cursor: no lo hizo retroceder
    expect(b.guardados[0]).not.toHaveProperty('cursor');
  });

  it('tope por pasada: con 250 ítems nuevos procesa 100 y deja hayMas; la siguiente pasada continúa', async () => {
    const b = banco();
    const filas = Array.from({ length: 250 }, (_, i) => fila(i + 1, {}, 0)).map((x, i) => ({ ...x, modificadoEn: new Date(Date.UTC(2026, 9, 14, 0, 0, i)).toISOString() }));
    const lector = lectorEnMemoria(filas);
    const r1 = await pullDesgloses(TENANT, lector, b.deps);
    expect(r1).toMatchObject({ estado: 'ok', leidas: TOPE_ITEMS_POR_PASADA, hayMas: true });
    const r2 = await pullDesgloses(TENANT, lector, b.deps);
    expect(r2.hayMas).toBe(true);
    expect(b.recibidos.size).toBeGreaterThanOrEqual(200);
  });

  it('sin las tablas del pull => no_disponible, sin leer del origen', async () => {
    const b = banco({ estadoNulo: true });
    const listar = vi.fn();
    const r = await pullDesgloses(TENANT, { listar }, b.deps);
    expect(r.estado).toBe('no_disponible');
    expect(listar).not.toHaveBeenCalled();
  });
});

describe('pullDesgloses: marca «enviado»', () => {
  it('sin marcarEnviadas en el puerto => todo ok', async () => {
    const b = banco();
    b.entregas.set(`liq-${clave(1)}`, [{ rol: 'operador', estado: 'enviada' }]);
    const r = await pullDesgloses(TENANT, lectorEnMemoria([fila(1)]), b.deps);
    expect(r).toMatchObject({ estado: 'ok', importadas: 1, marcadas: 0, marcasFallidas: 0 });
  });

  it('marca solo las claves cuyo correo al operador está enviada/entregada', async () => {
    const b = banco();
    b.entregas.set(`liq-${clave(1)}`, [{ rol: 'operador', estado: 'enviada' }]);
    b.entregas.set(`liq-${clave(2)}`, [{ rol: 'operador', estado: 'pendiente' }, { rol: 'coordinador', estado: 'enviada' }]);
    b.entregas.set(`liq-${clave(3)}`, [{ rol: 'coordinador', estado: 'entregada' }]); // el operador no tiene correo
    b.entregas.set(`liq-${clave(4)}`, [{ rol: 'operador', estado: 'entregada' }]);
    b.entregas.set(`liq-${clave(5)}`, [{ rol: 'operador', estado: 'rebotada' }]);
    const lector = lectorEnMemoria([fila(1), fila(2), fila(3), fila(4), fila(5)], { conMarcar: true });
    const r = await pullDesgloses(TENANT, lector, b.deps);
    expect([...lector.enviadas].sort()).toEqual([clave(1), clave(4)].sort());
    expect(r).toMatchObject({ marcadas: 2, marcasFallidas: 0 });
  });

  it('no remarca lo que la fuente ya trae como enviado', async () => {
    const b = banco();
    b.entregas.set(`liq-${clave(1)}`, [{ rol: 'operador', estado: 'enviada' }]);
    const lector = lectorEnMemoria([fila(1, { enviadoOrigen: true })], { conMarcar: true });
    await pullDesgloses(TENANT, lector, b.deps);
    expect(lector.enviadas.size).toBe(0);
  });

  it('un fallo de la marca NO afecta la entrega ni el cursor', async () => {
    const b = banco();
    b.entregas.set(`liq-${clave(1)}`, [{ rol: 'operador', estado: 'enviada' }]);
    const base = lectorEnMemoria([fila(1)]);
    const lector: LectorDesglosesPuerto = { listar: (p) => base.listar(p), marcarEnviadas: async () => { throw new TmsNoDisponible(); } };
    const r = await pullDesgloses(TENANT, lector, b.deps);
    expect(r).toMatchObject({ estado: 'ok', importadas: 1, marcadas: 0, marcasFallidas: 1 });
    expect(b.estado.cursor?.despuesDe).toBe(clave(1));
    expect(b.estado.ultimoError).toBeNull();
  });

  it('claves fallidas que devuelve el puerto se cuentan, sin afectar nada más', async () => {
    const b = banco();
    b.entregas.set(`liq-${clave(1)}`, [{ rol: 'operador', estado: 'enviada' }]);
    const base = lectorEnMemoria([fila(1)]);
    const lector: LectorDesglosesPuerto = { listar: (p) => base.listar(p), marcarEnviadas: async (c) => ({ ok: [], fallidas: c.map((k) => ({ clave: k, motivo: 'x' })) }) };
    const r = await pullDesgloses(TENANT, lector, b.deps);
    expect(r).toMatchObject({ estado: 'ok', marcadas: 0, marcasFallidas: 1 });
  });
});

describe('pullDesgloses: rendimiento', () => {
  it('20 bitácoras sintéticas se importan en menos de 2 s con dobles', async () => {
    const b = banco();
    const lector = lectorEnMemoria(Array.from({ length: 20 }, (_, i) => fila(i + 1)));
    const t0 = performance.now();
    const r = await pullDesgloses(TENANT, lector, b.deps);
    const ms = performance.now() - t0;
    expect(r).toMatchObject({ estado: 'ok', importadas: 20, excepciones: 0 });
    expect(ms).toBeLessThan(2000);
  });
});

describe('A37-A1-liquidaciones-17: más de 300 ítems releídos NO dejan el pull fallando para siempre', () => {
  it('360 ítems ya procesados dentro de la ventana de 24 h + 3 nuevos: la pasada termina ok, importa los nuevos y el cursor avanza', async () => {
    const b = banco();
    const viejas = Array.from({ length: 360 }, (_, i) => ({
      modificadoEn: new Date(Date.UTC(2026, 9, 14, 0, 0, i)).toISOString(), desglose: bitacora(i + 1),
    }));
    for (let i = 1; i <= 360; i++) b.recibidos.set(clave(i), 900); // ya recibidas: la relectura las absorbe como idempotentes
    b.estado.cursor = { desde: '2026-10-14T10:00:00.000Z', despuesDe: clave(360) };
    const nuevas = [361, 362, 363].map((n, i) => ({ modificadoEn: new Date(Date.UTC(2026, 9, 14, 11, 0, i)).toISOString(), desglose: bitacora(n) }));
    const r = await pullDesgloses(TENANT, lectorEnMemoria([...viejas, ...nuevas]), b.deps);
    expect(r.estado).toBe('ok');
    expect(r.error).toBeUndefined();
    expect(r.importadas).toBe(3);
    expect(b.estado.cursor?.despuesDe).toBe(clave(363));
    expect(b.estado.ultimoError).toBeNull();
  });

  it('un cursor antiguo tras una caída (ventana enorme de ya procesados) tampoco lo atasca', async () => {
    const b = banco();
    const todas = Array.from({ length: 450 }, (_, i) => ({
      modificadoEn: new Date(Date.UTC(2026, 9, 14, 0, 0, i)).toISOString(), desglose: bitacora(i + 1),
    }));
    for (let i = 1; i <= 400; i++) b.recibidos.set(clave(i), 900);
    b.estado.cursor = { desde: new Date(Date.UTC(2026, 9, 14, 0, 0, 399)).toISOString(), despuesDe: clave(400) };
    const r = await pullDesgloses(TENANT, lectorEnMemoria(todas), b.deps);
    expect(r.estado).toBe('ok');
    expect(r.importadas).toBe(50);
    expect(r.relecturaTruncada).toBe(true);
    // Lo releído está acotado: no recorre toda la ventana (400 ya procesados) para llegar a lo nuevo.
    expect(b.llamadasRecibir.length).toBeLessThan(400 + 50);
  });
});

describe('A37-A1-liquidaciones-07: un error de DATOS de un ítem no congela el pull', () => {
  it('la recepción choca con el índice único de la bitácora (misma bitácora, otra clave): excepción visible y SIGUE con los demás', async () => {
    const { DesgloseEnConflicto } = await import('./repo_correo');
    const b = banco();
    const recibir = b.deps.recibir;
    b.deps.recibir = async (t, d) => {
      if (d.bitacora === 'B-0002') throw new DesgloseEnConflicto('bitácora duplicada');
      return recibir(t, d);
    };
    const r = await pullDesgloses(TENANT, lectorEnMemoria([fila(1), fila(2), fila(3)]), b.deps);
    expect(r.estado).toBe('ok');
    expect(r.importadas).toBe(2);
    expect(abiertas(b, 'mapeo_invalido').map((e) => e.clave)).toEqual([clave(2)]);
    expect(b.estado.cursor?.despuesDe).toBe(clave(3)); // el cursor pasó por encima del ítem en conflicto, que ya es visible
    expect(b.estado.ultimoError).toBeNull();
  });
  it('un error de infraestructura (storage caído) SIGUE deteniendo la pasada con el cursor intacto', async () => {
    const b = banco({ falla: (n) => n === 2 });
    const r = await pullDesgloses(TENANT, lectorEnMemoria([fila(1), fila(2), fila(3)]), b.deps);
    expect(r.estado).toBe('error');
    expect(b.llamadasRecibir).not.toContain(clave(3));
  });
});

describe('A37-A1-liquidaciones-06: un pull que no avanza se hace notar', () => {
  it('error con el último éxito de hace más de 6 h ⇒ atascado', async () => {
    const b = banco({ falla: () => true });
    b.estado.ultimoExito = '2026-10-15T01:00:00.000Z'; // AHORA = 12:00Z
    const r = await pullDesgloses(TENANT, lectorEnMemoria([fila(1)]), b.deps);
    expect(r).toMatchObject({ estado: 'error', atascado: true });
  });
  it('error reciente (último éxito hace 1 h) ⇒ aún no es atasco', async () => {
    const b = banco({ falla: () => true });
    b.estado.ultimoExito = '2026-10-15T11:00:00.000Z';
    const r = await pullDesgloses(TENANT, lectorEnMemoria([fila(1)]), b.deps);
    expect(r.estado).toBe('error');
    expect(r.atascado).toBeUndefined();
  });
  it('nunca ha tenido éxito y falla ⇒ atascado (credencial mala, etc.)', async () => {
    const b = banco({ falla: () => true });
    const r = await pullDesgloses(TENANT, lectorEnMemoria([fila(1)]), b.deps);
    expect(r).toMatchObject({ estado: 'error', atascado: true });
  });
  it('una pasada ok jamás es atasco', async () => {
    const b = banco();
    b.estado.ultimoExito = '2026-10-01T00:00:00.000Z';
    expect((await pullDesgloses(TENANT, lectorEnMemoria([fila(1)]), b.deps)).atascado).toBeUndefined();
  });
});
