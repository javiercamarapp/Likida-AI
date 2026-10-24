import { beforeEach, describe, expect, it, vi } from 'vitest';

// Reenvío si cambia (T-A4-18). Se prueba contra un repo EN MEMORIA que imita las reglas de la 0797 (único por huella y por
// versión, estados que no vuelven, `enviado` inmutable) y contra un CLIENTE GRABADOR de Supabase para el aislamiento.

interface Llamada { tabla: string; op: string; filtros: Array<[string, string, unknown]>; valores?: unknown; columnas?: string }
let llamadas: Llamada[] = [];
let respuesta: (l: Llamada) => { data: unknown; error: { message: string; code?: string } | null } = () => ({ data: [], error: null });

function constructor(tabla: string) {
  const l: Llamada = { tabla, op: 'select', filtros: [] };
  const b: Record<string, unknown> = {};
  const encadenar = (nombre: string) => (...a: unknown[]) => {
    if (['eq', 'in', 'gte', 'lte'].includes(nombre)) l.filtros.push([nombre, String(a[0]), a[1]]);
    if (nombre === 'select' && l.op === 'select') l.columnas = String(a[0]);
    return b;
  };
  for (const m of ['select', 'eq', 'in', 'gte', 'lte', 'order', 'range']) b[m] = encadenar(m);
  b.update = (v: unknown) => { l.op = 'update'; l.valores = v; return b; };
  b.maybeSingle = () => { llamadas.push(l); const r = respuesta(l); return Promise.resolve({ ...r, data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data }); };
  b.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => { llamadas.push(l); return Promise.resolve(respuesta(l)).then(ok, ko); };
  return b;
}
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: (t: string) => constructor(t) }) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { procesarCambios, crearRepoCambios, CAMPOS_RELEVANTES } = await import('./cambios');
const { generarAvisos } = await import('./generar');
import type { AvisoRegistro, CambioRegistro, DepsCambios, FilaActual, ParametrosReenvio, RepoCambios } from './cambios';
import { normalizarAlias, type AliasCliente } from './equivalencias';
import { AvisoSinMigrar, type ConfigAviso, type EstadoAviso, type NuevoAviso, type RepoAviso } from './repo';
import type { DepsResolver, OperadorDato } from './resolver';
import type { Contacto } from '../tipos';

const T1 = '00000000-0000-4000-8000-000000000001';
const T2 = '00000000-0000-4000-8000-000000000002';
const C1 = '10000000-0000-4000-8000-000000000001';
const MIN = 60_000;

const CONFIG: ConfigAviso = {
  habilitado: true, modo: 'confirmar', canalDefault: 'ejecutivo_copia', ccpListos: [], exigirTransito: false,
  secciones: [], horasAntesCita: null, zona: 'America/Mexico_City',
};
const PARAMS: ParametrosReenvio = { maxReenvios: 3, debounceMin: 10 };

const T0 = new Date('2026-10-05T14:00:00Z'); // 08:00 en Ciudad de México

/** Mundo en memoria de UNA corrida de pruebas. */
function mundo(opciones: { config?: Partial<ConfigAviso> | null; params?: ParametrosReenvio | null } = {}) {
  const config = opciones.config === null ? null : { ...CONFIG, ...opciones.config };
  const params = opciones.params === undefined ? PARAMS : opciones.params;
  const filas: Array<FilaActual & { tenantId: string }> = [];
  const avisos: Array<AvisoRegistro & { tenantId: string }> = [];
  const cambiosPrograma: Array<CambioRegistro & { tenantId: string }> = [];
  const cierres: Array<{ id: string; desde: EstadoAviso; hacia: string }> = [];
  const lecturas: string[] = [];
  let reloj = T0;
  let n = 0;
  const placas: Record<string, string | null> = {};
  let operadorNombre = 'Operador Sintético';

  const repo: RepoAviso = {
    async leerConfig(t) { lecturas.push(t); return t === T1 ? config : null; },
    async filasVisibles(t, desde, hasta, desp, lim) {
      return filas.filter((f) => f.tenantId === t && f.visible && f.fecha >= desde && f.fecha <= hasta).slice(desp, desp + lim);
    },
    async avisosDeFilas(t, ids) {
      return avisos.filter((a) => a.tenantId === t && ids.includes(a.filaId)).map((a) => ({ filaId: a.filaId, estado: a.estado }));
    },
    async insertarAviso(t, a: NuevoAviso) {
      if (avisos.some((x) => x.tenantId === t && x.filaId === a.filaId && (x.huella === a.huella || x.version === a.version))) return 'duplicado';
      n++;
      avisos.push({
        tenantId: t, id: `a-${n}`, filaId: a.filaId, clienteId: a.clienteId, version: a.version, estado: a.estado, canal: a.canal,
        texto: a.texto, huella: a.huella, datos: a.datos, creadoEn: reloj.toISOString(),
      });
      return 'creado';
    },
  };
  const cambios: RepoCambios = {
    async parametros(t) { lecturas.push(t); return t === T1 ? params : null; },
    async avisosRecientes(t, desde, lim) {
      return avisos.filter((a) => a.tenantId === t && a.creadoEn >= desde).slice(0, lim);
    },
    async filasPorIds(t, ids) { return filas.filter((f) => f.tenantId === t && ids.includes(f.id)); },
    async cambiosDeFilas(t, ids, desde) {
      return cambiosPrograma.filter((c) => c.tenantId === t && ids.includes(c.filaId) && c.en >= desde);
    },
    async cambiarEstado(t, id, desde, hacia, motivo) {
      const a = avisos.find((x) => x.tenantId === t && x.id === id);
      // La 0797: un enviado/descartado/reemplazado es historia y no se edita.
      if (!a || a.estado !== desde) return false;
      if (['enviado', 'descartado', 'reemplazado'].includes(a.estado)) throw new Error('trigger: aviso es historia');
      cierres.push({ id, desde, hacia });
      a.estado = hacia; a.datos = { ...a.datos, cierre: motivo };
      return true;
    },
  };

  const alias1: AliasCliente = { tenantId: T1, textoNormalizado: normalizarAlias('Cliente Uno'), clienteId: C1, campo: 'cliente' };
  const contacto: Contacto = {
    id: 'ct-1', tenantId: T1, clienteId: C1, telefono: '5252899900001', nombre: 'Contacto Uno', gerenteUserId: null,
    estado: 'activo', consentimientoEn: '2026-09-01T00:00:00Z', optoutEn: null, avisoPrivacidadEn: null,
  };
  let conContacto = true;
  const resolver = (tenantId = T1): DepsResolver => ({
    tenantId,
    aliasDe: async () => [alias1],
    contactosDeCliente: async () => (conContacto ? [contacto] : []),
    unidadesPorNumero: async (num) => [{ tenantId: T1, id: `u-${num}`, numero: num, placas: num in placas ? placas[num] : 'AAA-111' }],
    cajaPorNumero: async (num) => ({ tenantId: T1, numero: num, placas: 'BBB-222', estado: 'cargada' }),
    operadorDeUnidad: async (): Promise<OperadorDato> => ({
      tenantId: T1, nombre: operadorNombre, licencia: 'LIC-0001', licenciaVence: '2027-03-01', telefono: '5252899900009',
      servicio: { fecha: '2026-10-05', reque: null },
    }),
    datoManual: async () => null,
  });
  let permitido = false;
  const deps = (): DepsCambios => ({ repo, cambios, resolver: resolver(), autonomoPermitido: async () => permitido });

  let seq = 0;
  const agregarFila = (o: Partial<FilaActual> = {}): FilaActual => {
    seq++;
    const f: FilaActual & { tenantId: string } = {
      tenantId: T1, id: `20000000-0000-4000-8000-${String(seq).padStart(12, '0')}`, fecha: '2026-10-05', tipo: 'EXPORTACION',
      cliente: 'Cliente Uno', consignatario: null, caja: `CJ-${seq}`, unidad: 'U-101', citaEn: null, citaTexto: null,
      transito: 'patio_nld', ccp: 'listo', visible: true, ...o,
    };
    filas.push(f);
    return f;
  };

  return {
    filas, avisos, cierres, lecturas, cambiosPrograma, deps, agregarFila,
    ahora: () => reloj,
    avanzar(ms: number) { reloj = new Date(reloj.getTime() + ms); },
    /** El programa cambia una fila y deja su renglón en la historia (como `sincronizar`). */
    cambiar(f: FilaActual, campo: 'unidad' | 'caja' | 'ccp' | 'comentarios', valor: string) {
      const antes = (f as unknown as Record<string, unknown>)[campo];
      (f as unknown as Record<string, unknown>)[campo] = valor;
      cambiosPrograma.push({ tenantId: T1, filaId: f.id, campo, antes: typeof antes === 'string' ? antes : null, despues: valor, en: reloj.toISOString() });
    },
    ponerPlacas(unidad: string, p: string | null) { placas[unidad] = p; },
    ponerOperador(n: string) { operadorNombre = n; },
    sinContacto() { conContacto = false; },
    permitirAutonomo() { permitido = true; },
    /** Lo que el sistema de envío hará después: marca el aviso como entregado. */
    marcarEnviado(a: AvisoRegistro) { a.estado = 'enviado'; },
    generar() { return generarAvisos(T1, reloj, deps()); },
    pasar() { return procesarCambios(T1, reloj, deps()); },
  };
}
type Mundo = ReturnType<typeof mundo>;

/** Fila lista, ya avisada (v1) y enviada: el punto de partida de casi todo. */
async function avisada(m: Mundo, o: Partial<FilaActual> = {}) {
  const f = m.agregarFila(o);
  await m.generar();
  const v1 = m.avisos.find((a) => a.filaId === f.id)!;
  m.marcarEnviado(v1);
  return { f, v1 };
}

describe('procesarCambios · apagado y errores', () => {
  it('sin configuración o con habilitado=false no hace nada', async () => {
    const a = mundo({ config: null });
    expect((await a.pasar()).estado).toBe('apagado');
    const b = mundo({ config: { habilitado: false } });
    expect((await b.pasar()).estado).toBe('apagado');
  });

  it('sin fila de parámetros tampoco', async () => {
    const m = mundo({ params: null });
    expect((await m.pasar()).estado).toBe('apagado');
  });

  it('la 0797 sin aplicar se informa como sin_migrar', async () => {
    const m = mundo();
    const d = m.deps();
    d.cambios = { ...d.cambios, parametros: async () => { throw new AvisoSinMigrar(); } };
    expect((await procesarCambios(T1, T0, d)).estado).toBe('sin_migrar');
  });

  it('un error de la base que no es «sin migrar» se propaga', async () => {
    const m = mundo();
    const d = m.deps();
    d.cambios = { ...d.cambios, avisosRecientes: async () => { throw new Error('aviso.cambios.x: caída'); } };
    await expect(procesarCambios(T1, T0, d)).rejects.toThrow('caída');
  });

  it('el resolver de otra flota se rechaza', async () => {
    const m = mundo();
    const d = m.deps();
    d.resolver = { ...d.resolver, tenantId: T2 };
    await expect(procesarCambios(T1, T0, d)).rejects.toThrow('otra flota');
  });
});

describe('procesarCambios · cambio de lo que el cliente ve', () => {
  it('el aviso inicial guarda lo que el cliente vio, sin licencia ni teléfono', async () => {
    const m = mundo();
    const { v1 } = await avisada(m);
    expect(v1.datos.tipo).toBe('inicial');
    expect(v1.datos.valores).toMatchObject({ unidad: 'U-101', placas_unidad: 'AAA-111', operador_nombre: 'Operador Sintético' });
    const json = JSON.stringify(v1.datos);
    expect(json).not.toContain('LIC-0001');
    expect(json).not.toContain('5252899900009');
  });

  it('cambio de unidad → versión 2 con «U-101 → U-205» y la v1 enviada intacta', async () => {
    const m = mundo();
    const { f, v1 } = await avisada(m);
    const antesV1 = JSON.stringify(v1);
    m.avanzar(30 * MIN);
    m.cambiar(f, 'unidad', 'U-205');
    m.avanzar(11 * MIN);
    const r = await m.pasar();
    expect(r).toMatchObject({ reenvios: 1, reemplazados: 0 });
    const v2 = m.avisos.find((a) => a.version === 2)!;
    expect(v2).toMatchObject({ filaId: f.id, estado: 'pendiente_confirmacion', canal: 'ejecutivo_copia', clienteId: C1 });
    expect(v2.texto).toContain('cambió la unidad: U-101 → U-205');
    expect(v2.datos).toMatchObject({ tipo: 'actualizacion', baseVersion: 1 });
    expect(v2.datos.cambios).toEqual([{ campo: 'unidad', antes: 'U-101', despues: 'U-205' }]);
    expect(v2.huella).not.toBe(v1.huella);
    // El enviado jamás se edita ni se cierra.
    expect(JSON.stringify(v1)).toBe(antesV1);
    expect(m.cierres).toHaveLength(0);
  });

  it('A37-S62-02: volver a un valor ya avisado (U-101 → U-205 → U-101 → U-205) genera cada versión; ninguna se pierde como duplicado', async () => {
    const m = mundo();
    const { f } = await avisada(m);
    for (const [i, unidad] of ['U-205', 'U-101', 'U-205'].entries()) {
      m.avanzar(30 * MIN);
      m.cambiar(f, 'unidad', unidad);
      m.avanzar(11 * MIN);
      const r = await m.pasar();
      expect(r.duplicados, `paso ${i + 2}`).toBe(0);
      expect(r.reenvios, `paso ${i + 2}`).toBe(1);
      m.marcarEnviado(m.avisos.find((a) => a.version === i + 2)!);
    }
    const v4 = m.avisos.find((a) => a.version === 4)!;
    expect(v4.texto).toContain('cambió la unidad: U-101 → U-205');
    expect(new Set(m.avisos.map((a) => a.huella)).size).toBe(4);
  });

  it('cambio de operador (viene del catálogo, no del programa) también reenvía', async () => {
    const m = mundo();
    await avisada(m);
    m.avanzar(30 * MIN);
    m.ponerOperador('Otro Operador Sintético');
    const r = await m.pasar();
    expect(r.reenvios).toBe(1);
    expect(m.avisos.find((a) => a.version === 2)!.texto).toContain('cambió el operador: Operador Sintético → Otro Operador Sintético');
  });

  it('idempotente: una segunda pasada sin cambios nuevos no crea nada', async () => {
    const m = mundo();
    const { f } = await avisada(m);
    m.avanzar(30 * MIN);
    m.cambiar(f, 'unidad', 'U-205');
    m.avanzar(11 * MIN);
    await m.pasar();
    const r2 = await m.pasar();
    expect(r2).toMatchObject({ reenvios: 0, duplicados: 0 });
    expect(m.avisos).toHaveLength(2);
  });

  it('si el aviso aún no salió, la versión nueva va completa y la anterior queda reemplazada', async () => {
    const m = mundo();
    const f = m.agregarFila();
    await m.generar(); // v1 pendiente_confirmacion, nunca enviado
    m.avanzar(30 * MIN);
    m.cambiar(f, 'unidad', 'U-205');
    m.avanzar(11 * MIN);
    const r = await m.pasar();
    expect(r).toMatchObject({ reenvios: 1, reemplazados: 1 });
    const [v1, v2] = m.avisos;
    expect(v1.estado).toBe('reemplazado');
    expect(v2.version).toBe(2);
    expect(v2.texto).toContain('Unidad: U-205');
    expect(v2.texto).not.toContain('Actualización'); // el cliente no ha recibido nada: no es una «actualización» para él
    expect(v2.estado).toBe('pendiente_confirmacion');
  });

  it('unidad sin placas registradas → aviso incompleto, marcado', async () => {
    const m = mundo();
    const { f } = await avisada(m);
    m.ponerPlacas('U-999', null);
    m.avanzar(30 * MIN);
    m.cambiar(f, 'unidad', 'U-999');
    m.avanzar(11 * MIN);
    const r = await m.pasar();
    expect(r).toMatchObject({ reenvios: 1, incompletas: 1 });
    const v2 = m.avisos.find((a) => a.version === 2)!;
    expect(v2.datos.incompleto).toBe(true);
    expect(v2.datos.pendientes).toContain('placas_unidad');
    expect(v2.texto).toContain('Placas de la unidad: por confirmar');
  });

  it('sin contacto resuelto el reenvío queda sin_destinatario, visible', async () => {
    const m = mundo();
    const { f } = await avisada(m);
    m.sinContacto();
    m.avanzar(30 * MIN);
    m.cambiar(f, 'unidad', 'U-205');
    m.avanzar(11 * MIN);
    const r = await m.pasar();
    expect(r).toMatchObject({ reenvios: 1, sinDestinatario: 1 });
    expect(m.avisos.find((a) => a.version === 2)!.estado).toBe('sin_destinatario');
  });
});

describe('procesarCambios · modo de confirmación', () => {
  it('en modo confirmar el reenvío nunca nace aprobado, aunque haya permiso', async () => {
    const m = mundo({ config: { modo: 'confirmar' } });
    m.permitirAutonomo();
    const { f } = await avisada(m);
    m.avanzar(30 * MIN);
    m.cambiar(f, 'unidad', 'U-205');
    m.avanzar(11 * MIN);
    await m.pasar();
    expect(m.avisos.find((a) => a.version === 2)!.estado).toBe('pendiente_confirmacion');
  });

  it('en modo autónomo CON permiso nace aprobado, con aprobadoEn; sin permiso, no', async () => {
    const sin = mundo({ config: { modo: 'autonomo' } });
    const a = await avisada(sin);
    sin.avanzar(30 * MIN); sin.cambiar(a.f, 'unidad', 'U-205'); sin.avanzar(11 * MIN);
    await sin.pasar();
    expect(sin.avisos.find((x) => x.version === 2)!.estado).toBe('pendiente_confirmacion');

    const con = mundo({ config: { modo: 'autonomo' } });
    con.permitirAutonomo();
    const b = await avisada(con);
    con.avanzar(30 * MIN); con.cambiar(b.f, 'unidad', 'U-205'); con.avanzar(11 * MIN);
    await con.pasar();
    expect(con.avisos.find((x) => x.version === 2)!.estado).toBe('aprobado');
  });
});

describe('procesarCambios · anti-ruido', () => {
  it('tres cambios en 5 min → nada mientras se mueve, y UN solo reenvío cuando se calma', async () => {
    const m = mundo();
    const { f } = await avisada(m);
    m.avanzar(30 * MIN);
    m.cambiar(f, 'unidad', 'U-201');
    m.avanzar(2 * MIN);
    m.cambiar(f, 'unidad', 'U-202');
    m.avanzar(2 * MIN);
    m.cambiar(f, 'unidad', 'U-203');
    m.avanzar(1 * MIN);
    const durante = await m.pasar();
    expect(durante).toMatchObject({ esperando: 1, reenvios: 0 });
    expect(m.avisos).toHaveLength(1);
    m.avanzar(10 * MIN);
    const despues = await m.pasar();
    expect(despues.reenvios).toBe(1);
    expect(m.avisos).toHaveLength(2);
    // El «antes» es lo que el cliente RECIBIÓ (U-101), no un intermedio.
    expect(m.avisos[1].texto).toContain('U-101 → U-203');
  });

  it('quinto cambio → no se envía y queda una alerta interna, una sola vez', async () => {
    const m = mundo(); // max_reenvios = 3
    const { f } = await avisada(m);
    for (const u of ['U-201', 'U-202', 'U-203']) {
      m.avanzar(30 * MIN); m.cambiar(f, 'unidad', u); m.avanzar(11 * MIN);
      const r = await m.pasar();
      expect(r.reenvios).toBe(1);
      m.marcarEnviado(m.avisos[m.avisos.length - 1]);
    }
    expect(m.avisos).toHaveLength(4); // v1 + 3 reenvíos

    m.avanzar(30 * MIN); m.cambiar(f, 'unidad', 'U-204'); m.avanzar(11 * MIN);
    const r = await m.pasar();
    expect(r).toMatchObject({ reenvios: 0, excedidos: 1 });
    expect(r.alertas).toEqual([{ tipo: 'cambia_demasiado', filaId: f.id }]);
    const alerta = m.avisos[4];
    expect(alerta).toMatchObject({ version: 5, estado: 'sin_destinatario', clienteId: null, canal: 'ejecutivo_copia' });
    expect(alerta.datos).toMatchObject({ tipo: 'alerta_cambia_demasiado', interno: true });
    expect(alerta.texto).toContain('cambió más de 3 veces');
    expect(m.avisos.some((a) => a.texto.includes('U-204') && a.estado !== 'sin_destinatario')).toBe(false);

    // Otra pasada: sigue excedido pero NO repite la alerta.
    const r2 = await m.pasar();
    expect(r2).toMatchObject({ excedidos: 1, alertas: [] });
    expect(m.avisos).toHaveLength(5);
  });

  it('max_reenvios = 0 no reenvía nunca', async () => {
    const m = mundo({ params: { maxReenvios: 0, debounceMin: 0 } });
    const { f } = await avisada(m);
    m.avanzar(MIN); m.cambiar(f, 'unidad', 'U-205'); m.avanzar(MIN);
    const r = await m.pasar();
    expect(r).toMatchObject({ reenvios: 0, excedidos: 1 });
  });

  it('un cambio de COMENTARIOS o de color/estatus se ignora', async () => {
    const m = mundo();
    const { f } = await avisada(m);
    m.avanzar(30 * MIN);
    m.cambiar(f, 'comentarios', 'LLEGAR TEMPRANO');
    m.cambiar(f, 'ccp', 'despachado');
    m.avanzar(11 * MIN);
    const r = await m.pasar();
    expect(r).toMatchObject({ reenvios: 0, ignoradas: 1 });
    expect(m.avisos).toHaveLength(1);
    expect(CAMPOS_RELEVANTES).not.toContain('comentarios');
    expect(CAMPOS_RELEVANTES).not.toContain('ccp');
  });

  it('sin ningún cambio no se cuenta como ignorado sino como sin cambio', async () => {
    const m = mundo();
    await avisada(m);
    m.avanzar(30 * MIN);
    expect((await m.pasar())).toMatchObject({ sinCambio: 1, ignoradas: 0, reenvios: 0 });
  });

  it('un cambio de CITA solo no reenvía: la cita no es un renglón del aviso (ver notas)', async () => {
    const m = mundo();
    const { f } = await avisada(m, { citaEn: '2026-10-05T19:00:00Z' });
    m.avanzar(30 * MIN);
    f.citaEn = '2026-10-05T20:00:00Z';
    m.cambiosPrograma.push({ tenantId: T1, filaId: f.id, campo: 'cita_en', antes: '2026-10-05T19:00:00Z', despues: '2026-10-05T20:00:00Z', en: m.ahora().toISOString() });
    m.avanzar(11 * MIN);
    expect(await m.pasar()).toMatchObject({ reenvios: 0, ignoradas: 1 });
  });

  it('A → B → A con B aún sin enviar: no queda nada pendiente', async () => {
    const m = mundo();
    const { f } = await avisada(m);
    m.avanzar(30 * MIN); m.cambiar(f, 'unidad', 'U-205'); m.avanzar(11 * MIN);
    await m.pasar(); // v2 pendiente (U-101 → U-205)
    m.avanzar(5 * MIN); m.cambiar(f, 'unidad', 'U-101'); m.avanzar(11 * MIN);
    const r = await m.pasar();
    expect(r).toMatchObject({ reenvios: 0, revertidos: 1 });
    expect(m.avisos[1].estado).toBe('descartado');
  });

  it('una nueva modificación con v2 sin enviar lo reemplaza y el «antes» sigue siendo lo enviado', async () => {
    const m = mundo();
    const { f } = await avisada(m);
    m.avanzar(30 * MIN); m.cambiar(f, 'unidad', 'U-205'); m.avanzar(11 * MIN);
    await m.pasar();
    m.avanzar(5 * MIN); m.cambiar(f, 'unidad', 'U-300'); m.avanzar(11 * MIN);
    const r = await m.pasar();
    expect(r).toMatchObject({ reenvios: 1, reemplazados: 1 });
    expect(m.avisos[1].estado).toBe('reemplazado');
    expect(m.avisos[2].texto).toContain('U-101 → U-300');
    expect(m.avisos[0].estado).toBe('enviado');
  });
});

describe('procesarCambios · cancelación y desaparición', () => {
  it('la fila pasa a CANCELACIONES tras avisar → borrador para confirmar, sin mensaje al cliente', async () => {
    const m = mundo();
    const { f } = await avisada(m);
    m.avanzar(30 * MIN);
    f.tipo = 'CANCELACIONES';
    const r = await m.pasar();
    expect(r).toMatchObject({ cancelaciones: 1, reenvios: 0 });
    expect(r.alertas).toEqual([{ tipo: 'cancelacion', filaId: f.id }]);
    const c = m.avisos[1];
    expect(c).toMatchObject({ version: 2, estado: 'pendiente_confirmacion', canal: 'ejecutivo_copia', clienteId: C1 });
    expect(c.texto).toMatch(/^Se canceló el servicio programado con caja CJ-\d+ y unidad U-101\.$/);
    expect(c.datos).toMatchObject({ tipo: 'cancelacion', requiere_humano: true });
  });

  it('la fila desaparece del programa tras avisar → misma alerta; una segunda pasada no la repite', async () => {
    const m = mundo();
    const { f } = await avisada(m);
    m.avanzar(30 * MIN);
    f.visible = false;
    expect((await m.pasar()).cancelaciones).toBe(1);
    const r2 = await m.pasar();
    expect(r2).toMatchObject({ cancelaciones: 0, alertas: [] });
    expect(m.avisos).toHaveLength(2);
  });

  it('el borrador de cancelación jamás nace aprobado, ni en modo autónomo con permiso', async () => {
    const m = mundo({ config: { modo: 'autonomo' } });
    m.permitirAutonomo();
    const { f } = await avisada(m);
    f.visible = false;
    await m.pasar();
    const c = m.avisos[1];
    expect(c.estado).toBe('pendiente_confirmacion');
    expect(c.canal).toBe('ejecutivo_copia');
  });

  it('desaparece SIN haber avisado → se descarta lo pendiente y no hay alerta', async () => {
    const m = mundo();
    const f = m.agregarFila();
    await m.generar(); // v1 pendiente, nunca enviado
    f.visible = false;
    const r = await m.pasar();
    expect(r).toMatchObject({ descartadosPorCancelacion: 1, cancelaciones: 0, alertas: [] });
    expect(m.avisos[0].estado).toBe('descartado');
    expect(m.avisos).toHaveLength(1);
  });

  it('avisó (v1 enviada) y hay v2 pendiente: se descarta la v2 y se alerta la cancelación', async () => {
    const m = mundo();
    const { f } = await avisada(m);
    m.avanzar(30 * MIN); m.cambiar(f, 'unidad', 'U-205'); m.avanzar(11 * MIN);
    await m.pasar(); // v2 pendiente
    f.visible = false;
    const r = await m.pasar();
    expect(r).toMatchObject({ descartadosPorCancelacion: 1, cancelaciones: 1 });
    expect(m.avisos[1].estado).toBe('descartado');
    expect(m.avisos[2].datos.tipo).toBe('cancelacion');
  });

  it('una fila que ya no existe (borrada) también se trata como desaparecida', async () => {
    const m = mundo();
    const { f } = await avisada(m);
    m.filas.splice(m.filas.indexOf(f as never), 1);
    expect((await m.pasar()).cancelaciones).toBe(1);
  });

  it('un viaje que ya pasó no se actualiza ni se alerta (el programa del día se renueva solo)', async () => {
    const m = mundo();
    const { f } = await avisada(m, { citaEn: '2026-10-05T15:00:00Z' });
    m.avanzar(3 * 3_600_000); // ya pasó la cita
    f.visible = false;
    const r = await m.pasar();
    expect(r).toMatchObject({ pasadas: 1, cancelaciones: 0 });
    expect(m.avisos).toHaveLength(1);
  });
});

describe('procesarCambios · inmutabilidad y bordes', () => {
  it('nunca intenta cerrar un aviso enviado (el trigger de la 0797 lo prohíbe)', async () => {
    const m = mundo();
    const { f } = await avisada(m);
    for (const u of ['U-201', 'U-202']) {
      m.avanzar(30 * MIN); m.cambiar(f, 'unidad', u); m.avanzar(11 * MIN);
      await m.pasar();
    }
    f.visible = false;
    await m.pasar();
    expect(m.cierres.every((c) => c.desde !== 'enviado')).toBe(true);
    expect(m.avisos[0].estado).toBe('enviado');
  });

  it('avisos sin la base de comparación no se tocan', async () => {
    const m = mundo();
    const { f, v1 } = await avisada(m);
    delete v1.datos.valores;
    m.avanzar(30 * MIN); m.cambiar(f, 'unidad', 'U-205'); m.avanzar(11 * MIN);
    const r = await m.pasar();
    expect(r).toMatchObject({ sinBase: 1, reenvios: 0 });
  });

  it('un aviso descartado o sin destinatario no se resucita', async () => {
    const m = mundo();
    const f = m.agregarFila();
    await m.generar();
    m.avisos[0].estado = 'descartado';
    m.cambiar(f, 'unidad', 'U-205');
    m.avanzar(11 * MIN);
    const r = await m.pasar();
    expect(r).toMatchObject({ revisadas: 0, reenvios: 0 });
  });

  it('una carrera: si el aviso cambió de estado entre leer y cerrar, se cuenta y no truena', async () => {
    const m = mundo();
    const f = m.agregarFila();
    await m.generar();
    m.avanzar(30 * MIN); m.cambiar(f, 'unidad', 'U-205'); m.avanzar(11 * MIN);
    const d = m.deps();
    d.cambios = { ...d.cambios, cambiarEstado: async () => false };
    const r = await procesarCambios(T1, m.ahora(), d);
    expect(r).toMatchObject({ reenvios: 1, reemplazados: 0, carreras: 1 });
  });

  it('el tope de filas por pasada acota y lo declara', async () => {
    const m = mundo();
    const filas = [];
    for (let i = 0; i < 205; i++) filas.push((await avisada(m, { unidad: `U-${i}` })).f);
    m.avanzar(30 * MIN);
    for (const f of filas) m.cambiar(f, 'unidad', `${f.unidad}-B`);
    m.avanzar(11 * MIN);
    const r = await m.pasar();
    expect(r.reenvios).toBe(200);
    expect(r).toMatchObject({ omitidas: 5, acotada: true });
  });

  it('aislamiento por tenant: otra flota no ve ni toca estos avisos', async () => {
    const m = mundo();
    const { f } = await avisada(m);
    m.cambiar(f, 'unidad', 'U-205');
    m.avanzar(11 * MIN);
    const d = m.deps();
    d.resolver = { ...d.resolver, tenantId: T2 };
    const r = await procesarCambios(T2, m.ahora(), d); // T2 no tiene configuración
    expect(r.estado).toBe('apagado');
    expect(m.avisos).toHaveLength(1);
  });
});

describe('crearRepoCambios · acceso a datos', () => {
  const FILA = '22222222-2222-4222-8222-222222222222';
  beforeEach(() => { llamadas = []; respuesta = () => ({ data: [], error: null }); });

  const tieneTenant = (l: Llamada) => l.filtros.some(([o, c, v]) => o === 'eq' && c === 'tenant_id' && v === T1);

  it('cada método filtra con tenant_id y nunca usa select *', async () => {
    const repo = crearRepoCambios();
    await repo.parametros(T1);
    await repo.avisosRecientes(T1, '2026-10-01T00:00:00Z', 100);
    await repo.filasPorIds(T1, [FILA]);
    await repo.cambiosDeFilas(T1, [FILA], '2026-10-01T00:00:00Z');
    await repo.cambiarEstado(T1, 'a-1', 'pendiente_confirmacion', 'reemplazado', 'm');
    expect(llamadas.map((l) => `${l.tabla}:${l.op}`)).toEqual([
      'vigia_aviso_config:select', 'vigia_aviso:select', 'programa_despacho_fila:select',
      'programa_despacho_cambio:select', 'vigia_aviso:update',
    ]);
    for (const l of llamadas) {
      expect(tieneTenant(l), `${l.tabla}:${l.op} sin tenant_id`).toBe(true);
      if (l.columnas) expect(l.columnas).not.toContain('*');
    }
  });

  it('cerrar un aviso es condicional al estado leído (no pisa lo que cambió) y solo hacia reemplazado/descartado', async () => {
    respuesta = () => ({ data: [{ id: 'a-1' }], error: null });
    expect(await crearRepoCambios().cambiarEstado(T1, 'a-1', 'pendiente_confirmacion', 'descartado', 'm')).toBe(true);
    const l = llamadas[0];
    expect(l.filtros).toEqual(expect.arrayContaining([['eq', 'estado', 'pendiente_confirmacion'], ['eq', 'id', 'a-1']]));
    expect(l.valores).toMatchObject({ estado: 'descartado' });
    respuesta = () => ({ data: [], error: null });
    expect(await crearRepoCambios().cambiarEstado(T1, 'a-1', 'pendiente_confirmacion', 'descartado', 'm')).toBe(false);
  });

  it('un error de la base lanza y la tabla sin migrar se traduce', async () => {
    respuesta = () => ({ data: null, error: { message: 'caída' } });
    await expect(crearRepoCambios().avisosRecientes(T1, 'x', 10)).rejects.toThrow('aviso.cambios.avisos_recientes: caída');
    respuesta = () => ({ data: null, error: { message: 'no existe', code: '42P01' } });
    await expect(crearRepoCambios().parametros(T1)).rejects.toBeInstanceOf(AvisoSinMigrar);
  });

  it('los parámetros y los avisos se leen con sus nombres de columna', async () => {
    respuesta = (l) => (l.tabla === 'vigia_aviso_config'
      ? { data: [{ max_reenvios: 4, debounce_min: 15 }], error: null }
      : { data: [{ id: 'a-1', fila_id: FILA, cliente_id: null, version: 2, estado: 'enviado', canal: 'cliente_1a1', texto: 't', huella: 'h', datos: { tipo: 'inicial' }, creado_en: '2026-10-05T14:00:00Z' }], error: null });
    const repo = crearRepoCambios();
    expect(await repo.parametros(T1)).toEqual({ maxReenvios: 4, debounceMin: 15 });
    const [a] = await repo.avisosRecientes(T1, 'x', 10);
    expect(a).toMatchObject({ id: 'a-1', filaId: FILA, version: 2, estado: 'enviado', canal: 'cliente_1a1', datos: { tipo: 'inicial' } });
  });
});
