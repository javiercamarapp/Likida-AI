import { describe, it, expect, vi, beforeEach } from 'vitest';

// El acceso a datos del Vigía contra un CLIENTE GRABADOR de Supabase: no hay base,
// pero sí se ve exactamente qué se le pregunta y con qué filtros. Lo que se fija:
// el aislamiento por tenant en TODA consulta, el mapeo de filas, el reclamo
// condicional, la idempotencia por clave y las validaciones de las acciones.

interface Llamada { tabla: string; op: string; filtros: Array<[string, string, unknown]>; valores?: unknown }
let llamadas: Llamada[] = [];
let respuesta: (l: Llamada) => { data: unknown; error: { message: string; code?: string } | null } = () => ({ data: [], error: null });

function constructor(tabla: string) {
  const l: Llamada = { tabla, op: 'select', filtros: [] };
  const b: Record<string, unknown> = {};
  const encadenar = (nombre: string) => (...a: unknown[]) => {
    if (['eq', 'neq', 'in', 'is', 'not', 'gte', 'lt', 'or'].includes(nombre)) l.filtros.push([nombre, String(a[0]), a[1]]);
    return b;
  };
  for (const m of ['select', 'eq', 'neq', 'in', 'is', 'not', 'gte', 'lt', 'or', 'order', 'limit', 'range']) b[m] = encadenar(m);
  b.insert = (v: unknown) => { l.op = 'insert'; l.valores = v; return b; };
  b.update = (v: unknown) => { l.op = 'update'; l.valores = v; return b; };
  b.upsert = (v: unknown) => { l.op = 'upsert'; l.valores = v; return b; };
  b.maybeSingle = () => { llamadas.push(l); return Promise.resolve(unaFila(respuesta(l))); };
  b.single = () => { llamadas.push(l); return Promise.resolve(unaFila(respuesta(l))); };
  b.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => { llamadas.push(l); return Promise.resolve(respuesta(l)).then(ok, ko); };
  return b;
}
function unaFila(r: { data: unknown; error: unknown }) {
  return { ...r, data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data };
}
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (t: string) => constructor(t),
    rpc: (nombre: string, args: unknown) => {
      const l: Llamada = { tabla: `rpc:${nombre}`, op: 'rpc', filtros: [], valores: args };
      llamadas.push(l);
      return Promise.resolve(respuesta(l));
    },
  }),
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../contactos', () => ({
  telefonoDeUsuario: vi.fn(async (u: string) => (u === 'u-ger' ? '5215599990000' : null)),
  telefonoJefeDe: vi.fn(async () => '525511112222'),
}));

const repoMod = await import('./repo');
const { crearRepoVigia, estatusViajeReal, aConfig, aContacto, validarConfig, telefonoDeAllowlist, altaContactoVigia, bajaManualContacto, suprimirContactoVigia, cargarTablero } = repoMod;
const { T1, T2, CLIENTE_A, VIAJE_1 } = await import('./datos.fixture');

const tiene = (l: Llamada, op: string, col: string, valor?: unknown) =>
  l.filtros.some(([o, c, v]) => o === op && c === col && (valor === undefined || JSON.stringify(v) === JSON.stringify(valor)));

beforeEach(() => { llamadas = []; respuesta = () => ({ data: [], error: null }); });

describe('AISLAMIENTO: toda consulta a una tabla con tenant filtra por él', () => {
  const TABLAS_CON_TENANT = ['vigia_config', 'vigia_contacto', 'vigia_conversacion', 'vigia_mensaje', 'vigia_evento', 'viaje', 'posicion', 'pod', 'factura_emitida', 'cliente', 'app_user', 'tenant'];

  /** Las únicas dos que cruzan flotas A PROPÓSITO (rotuladas en el código). */
  const EXENTAS = new Set(['contactoPorTelefono', 'conversacionesEnEspera', 'aprobadosAtorados']);

  it('cada método del repo (salvo las tres que cruzan flotas a propósito) filtra por tenant_id en cada consulta', async () => {
    const repo = crearRepoVigia();
    const id = '12345678-1234-4234-8234-123456789abc';
    const ahora = new Date('2026-10-01T18:00:00Z');
    const contacto = { id, tenantId: T1, clienteId: CLIENTE_A, telefono: '525511110001', nombre: 'x', gerenteUserId: 'u-ger', estado: 'activo' as const, consentimientoEn: 'x', optoutEn: null, avisoPrivacidadEn: null };
    // Respuestas con forma suficiente para que ningún método se detenga antes de consultar.
    respuesta = (l) => {
      if (l.tabla === 'vigia_conversacion') return { data: [{ id, tenant_id: T1, contacto_id: id, cliente_id: CLIENTE_A, estado: 'activa' }], error: null };
      if (l.tabla === 'vigia_mensaje' && l.op === 'insert') return { data: { id }, error: null };
      return { data: [], error: null };
    };
    const metodos: Array<[string, () => Promise<unknown>]> = [
      ['config', () => repo.config(T1)],
      ['nombreFlota', () => repo.nombreFlota(T1)],
      ['nombreCliente', () => repo.nombreCliente(T1, CLIENTE_A)],
      ['conversacion', () => repo.conversacion(T1, id)],
      ['mensaje', () => repo.mensaje(T1, id)],
      ['contactoDe', () => repo.contactoDe(T1, id)],
      ['ultimoEntranteId', () => repo.ultimoEntranteId(T1, id)],
      ['entrantesRecientes', () => repo.entrantesRecientes(T1, id, ahora, 10)],
      ['anotarClasificacion', () => repo.anotarClasificacion(T1, id, { intencion: 'eta', confianza: 0.9, clasificador: 'reglas', senales: [] })],
      ['crearSaliente', () => repo.crearSaliente(T1, { conversacionId: id, respuestaA: id, autor: 'agente', texto: 't', estado: 'pendiente_aprobacion', intencion: 'eta', riesgo: 'bajo', datosRespaldo: null, senales: [], autoenviado: false, aprobadoPor: null })],
      ['reclamarEstado', () => repo.reclamarEstado(T1, id, ['pendiente_aprobacion'], 'aprobado', { aprobadoPor: 'u' })],
      ['marcarEnviado', () => repo.marcarEnviado(T1, id, { via: 'texto', wamid: 'w', ahora })],
      ['marcarFallido', () => repo.marcarFallido(T1, id, 'x')],
      ['marcarAvisoGerente', () => repo.marcarAvisoGerente(T1, id, ahora)],
      ['aprobacionesSinEditar', () => repo.aprobacionesSinEditar(T1, 'ubicacion')],
      ['pendientesDeHilo', () => repo.pendientesDeHilo(T1, id)],
      ['actualizarConversacion', () => repo.actualizarConversacion(T1, id, { control: 'humano' })],
      ['marcarRespondida', () => repo.marcarRespondida(T1, id, ahora)],
      ['cerrarConversacion', () => repo.cerrarConversacion(T1, id, ahora)],
      ['evento', () => repo.evento(T1, { tipo: 'entrante' })],
      ['registrarOptOut', () => repo.registrarOptOut(T1, id, ahora)],
      ['marcarAvisoPrivacidad', () => repo.marcarAvisoPrivacidad(T1, id, ahora)],
      ['destinatarioNivel2', () => repo.destinatarioNivel(T1, contacto, 2)],
      ['viajesEnCurso', () => estatusViajeReal.viajesEnCurso({ tenantId: T1, clienteId: CLIENTE_A })],
      ['estatus', () => estatusViajeReal.estatus({ tenantId: T1, clienteId: CLIENTE_A, viajeId: id })],
      ['altaContacto', () => altaContactoVigia(T1, 'u', { clienteId: CLIENTE_A, telefono: '5511110001', nombre: null, gerenteUserId: 'u-ger', consentimiento: true })],
      ['bajaManual', () => bajaManualContacto(T1, 'u', id)],
      ['tablero', () => cargarTablero(T1)],
    ];
    for (const [nombre, f] of metodos) {
      llamadas = [];
      await f().catch(() => {}); // algunos paran al leer una fila vacía; lo que importa es lo que preguntaron
      expect(llamadas.length, `${nombre} no consultó nada`).toBeGreaterThan(0);
      for (const l of llamadas) {
        if (l.tabla.startsWith('rpc:') || l.tabla === 'factura_viaje') continue; // factura_viaje no tiene tenant_id: hereda el de su factura
        if (l.op === 'insert') { expect(JSON.stringify(l.valores), `${nombre} → insert en ${l.tabla}`).toContain(T1); continue; }
        if (l.op === 'upsert') { expect(JSON.stringify(l.valores), `${nombre}`).toContain(T1); continue; }
        if (!TABLAS_CON_TENANT.includes(l.tabla)) continue;
        const colTenant = l.tabla === 'tenant' ? 'id' : 'tenant_id';
        expect(tiene(l, 'eq', colTenant, T1) || tiene(l, 'in', 'tenant_id'), `${nombre} → ${l.op} ${l.tabla} sin filtro de tenant: ${JSON.stringify(l.filtros)}`).toBe(true);
      }
    }
    expect(EXENTAS.size).toBe(3);
  });

  it('las tres que cruzan flotas a propósito lo hacen por la llave correcta y devuelven filas con su propio tenant', async () => {
    const repo = crearRepoVigia();
    await repo.contactoPorTelefono('+52 1 55 1111 0001');
    expect(llamadas[0].tabla).toBe('vigia_contacto');
    expect(tiene(llamadas[0], 'eq', 'telefono', '525511110001')).toBe(true); // 521 → 52: la forma de la allowlist
    expect(tiene(llamadas[0], 'in', 'estado', ['activo', 'baja'])).toBe(true);
    llamadas = [];
    await repo.aprobadosAtorados(new Date(), 10);
    expect(tiene(llamadas[0], 'eq', 'estado', 'aprobado') && tiene(llamadas[0], 'eq', 'direccion', 'saliente')).toBe(true);
  });

  it('el estatus del viaje SOLO se lee si el viaje es de ese tenant Y de ese cliente', async () => {
    await estatusViajeReal.estatus({ tenantId: T1, clienteId: CLIENTE_A, viajeId: VIAJE_1 });
    const v = llamadas.find((l) => l.tabla === 'viaje')!;
    expect(tiene(v, 'eq', 'id', VIAJE_1)).toBe(true);
    expect(tiene(v, 'eq', 'tenant_id', T1)).toBe(true);
    expect(tiene(v, 'eq', 'cliente_id', CLIENTE_A)).toBe(true);
    llamadas = [];
    await estatusViajeReal.viajesEnCurso({ tenantId: T2, clienteId: CLIENTE_A });
    expect(tiene(llamadas[0], 'eq', 'tenant_id', T2) && tiene(llamadas[0], 'eq', 'cliente_id', CLIENTE_A)).toBe(true);
  });

  it('un viaje que no es de ese cliente: null y NO se consulta posición, POD ni factura', async () => {
    respuesta = () => ({ data: null, error: null });
    expect(await estatusViajeReal.estatus({ tenantId: T1, clienteId: CLIENTE_A, viajeId: VIAJE_1 })).toBeNull();
    expect(llamadas.map((l) => l.tabla)).toEqual(['viaje']);
  });
});

describe('estatusViajeReal: mapeo y honestidad', () => {
  const fila = { id: VIAJE_1, folio: 'F-1042', origen: 'Guadalajara', destino: 'Monterrey', estatus: 'abierto', unidad_id: 'un1', llegada_en: null, descarga_en: null, regreso_en: null };
  const responder = (extra: Partial<Record<string, { data: unknown; error: { message: string } | null }>> = {}) => {
    respuesta = (l) => extra[l.tabla] ?? (l.tabla === 'viaje' ? { data: [fila], error: null } : { data: [], error: null });
  };

  it('arma etapa, último hito y posición reales; no hay ETA (no existe en Likida)', async () => {
    responder({
      viaje: { data: [{ ...fila, llegada_en: '2026-10-01T16:00:00Z', descarga_en: '2026-10-01T17:00:00Z' }], error: null },
      posicion: { data: [{ lat: 21.1, lng: -101.6, medida_en: '2026-10-01T17:50:00Z' }], error: null },
      pod: { data: [{ id: 'p1' }], error: null },
    });
    const e = (await estatusViajeReal.estatus({ tenantId: T1, clienteId: CLIENTE_A, viajeId: VIAJE_1 }))!;
    expect(e).toMatchObject({ folio: 'F-1042', etapa: 'descargando', etaIso: null, podRecibido: true, facturaEmitida: false });
    expect(e.ultimoHito).toEqual({ tipo: 'descarga', en: '2026-10-01T17:00:00Z' });
    expect(e.posicion).toEqual({ lat: 21.1, lng: -101.6, medidaEn: '2026-10-01T17:50:00Z' });
    expect(e.documentos).toEqual([{ nombre: 'Comprobante de entrega (POD)', estado: 'entregado' }]);
  });

  it('sin unidad no se consulta posición; sin filas de GPS la posición es null (nunca coordenadas inventadas)', async () => {
    responder({ viaje: { data: [{ ...fila, unidad_id: null }], error: null } });
    const e = (await estatusViajeReal.estatus({ tenantId: T1, clienteId: CLIENTE_A, viajeId: VIAJE_1 }))!;
    expect(e.posicion).toBeNull();
    expect(llamadas.some((l) => l.tabla === 'posicion')).toBe(false);
    llamadas = [];
    responder();
    expect((await estatusViajeReal.estatus({ tenantId: T1, clienteId: CLIENTE_A, viajeId: VIAJE_1 }))!.posicion).toBeNull();
  });

  it('una fila de GPS con forma rara se ignora (no se inventa una posición)', async () => {
    responder({ posicion: { data: [{ lat: '21', lng: null, medida_en: 5 }], error: null } });
    expect((await estatusViajeReal.estatus({ tenantId: T1, clienteId: CLIENTE_A, viajeId: VIAJE_1 }))!.posicion).toBeNull();
  });

  it('un error de lectura de POD/factura es `null` («no sé»), NO «no hay»', async () => {
    responder({ pod: { data: null, error: { message: 'timeout' } }, factura_emitida: { data: null, error: { message: 'timeout' } } });
    const e = (await estatusViajeReal.estatus({ tenantId: T1, clienteId: CLIENTE_A, viajeId: VIAJE_1 }))!;
    expect(e.podRecibido).toBeNull();
    expect(e.documentos).toBeNull();
    expect(e.facturaEmitida).toBeNull();
  });

  it('un error al leer el viaje o la posición LANZA (no se disfraza de «sin viaje» ni de «sin GPS»)', async () => {
    responder({ viaje: { data: null, error: { message: 'caída' } } });
    await expect(estatusViajeReal.estatus({ tenantId: T1, clienteId: CLIENTE_A, viajeId: VIAJE_1 })).rejects.toThrow(/caída/);
    responder({ posicion: { data: null, error: { message: 'caída gps' } } });
    await expect(estatusViajeReal.estatus({ tenantId: T1, clienteId: CLIENTE_A, viajeId: VIAJE_1 })).rejects.toThrow(/caída gps/);
  });

  it('la factura se encuentra también por la liga factura_viaje', async () => {
    respuesta = (l) => {
      if (l.tabla === 'viaje') return { data: [fila], error: null };
      if (l.tabla === 'factura_viaje') return { data: [{ factura_id: 'f1' }], error: null };
      if (l.tabla === 'factura_emitida') return { data: tiene(l, 'in', 'id') ? [{ id: 'f1' }] : [], error: null };
      return { data: [], error: null };
    };
    expect((await estatusViajeReal.estatus({ tenantId: T1, clienteId: CLIENTE_A, viajeId: VIAJE_1 }))!.facturaEmitida).toBe(true);
  });

  it('viajesEnCurso: solo en curso y sin regreso; el error lanza', async () => {
    responder({ viaje: { data: [{ id: 'a', folio: 'F-1', origen: 'X', destino: 'Y' }], error: null } });
    expect(await estatusViajeReal.viajesEnCurso({ tenantId: T1, clienteId: CLIENTE_A })).toEqual([{ viajeId: 'a', folio: 'F-1', origen: 'X', destino: 'Y' }]);
    expect(tiene(llamadas[0], 'in', 'estatus', ['abierto', 'en_cuadre'])).toBe(true);
    expect(tiene(llamadas[0], 'is', 'regreso_en', null)).toBe(true);
    responder({ viaje: { data: null, error: { message: 'x' } } });
    await expect(estatusViajeReal.viajesEnCurso({ tenantId: T1, clienteId: CLIENTE_A })).rejects.toThrow();
  });
});

describe('mapeos y config', () => {
  it('sin fila de config: APAGADO (falla cerrado)', async () => {
    respuesta = () => ({ data: null, error: null });
    const c = await crearRepoVigia().config(T1);
    expect(c).toMatchObject({ tenantId: T1, habilitado: false, modoAprobacion: 'siempre' });
  });
  it('un error de la base al leer config LANZA (no se lee como «apagado por defecto» ni «encendido»)', async () => {
    respuesta = () => ({ data: null, error: { message: 'caída' } });
    await expect(crearRepoVigia().config(T1)).rejects.toThrow(/caída/);
  });
  it('aConfig: valores basura caen a los defaults seguros, nunca a «encendido»', () => {
    expect(aConfig({ tenant_id: T1 })).toMatchObject({ habilitado: false, modoAprobacion: 'siempre', slaRespuestaMin: 30, escalarNivel2Min: 60, retencionDias: 180 });
    expect(aConfig({ tenant_id: T1, habilitado: 'true', modo_aprobacion: 'otra_cosa' })).toMatchObject({ habilitado: false, modoAprobacion: 'siempre' });
    expect(aConfig({ tenant_id: T1, habilitado: true, modo_aprobacion: 'autoenviar_bajo_riesgo', sla_respuesta_min: 15 })).toMatchObject({ habilitado: true, modoAprobacion: 'autoenviar_bajo_riesgo', slaRespuestaMin: 15 });
  });
  it('aContacto: un estado desconocido NO se vuelve «activo»… se vuelve activo solo si dice activo', () => {
    expect(aContacto({ id: '1', tenant_id: T1, cliente_id: 'c', telefono: '52x', estado: 'baja' }).estado).toBe('baja');
    expect(aContacto({ id: '1', tenant_id: T1, cliente_id: 'c', telefono: '52x', estado: 'suprimido' }).estado).toBe('suprimido');
  });
});

describe('contactoPorTelefono: activo gana a baja; ninguno → null', () => {
  it('devuelve el activo si hay uno y una baja', async () => {
    respuesta = () => ({ data: [
      { id: 'b', tenant_id: T2, cliente_id: 'c', telefono: '525511110001', estado: 'baja' },
      { id: 'a', tenant_id: T1, cliente_id: 'c', telefono: '525511110001', estado: 'activo' },
    ], error: null });
    expect((await crearRepoVigia().contactoPorTelefono('525511110001'))!.id).toBe('a');
  });
  it('sin filas: null; con error: lanza', async () => {
    expect(await crearRepoVigia().contactoPorTelefono('525511110001')).toBeNull();
    respuesta = () => ({ data: null, error: { message: 'caída' } });
    await expect(crearRepoVigia().contactoPorTelefono('525511110001')).rejects.toThrow();
  });
});

describe('recibir / reclamar / evento / crearSaliente', () => {
  it('recibir: lee la fila de la RPC (atómica) y rechaza una forma rara (migración sin aplicar)', async () => {
    respuesta = () => ({ data: [{ mensaje_id: 'm1', conversacion_id: 'c1', duplicado: true }], error: null });
    expect(await crearRepoVigia().recibir({ tenantId: T1, contactoId: 'ct', wamid: 'w', tipo: 'texto', texto: 'hola', ahora: new Date('2026-10-01T18:00:00Z') }))
      .toEqual({ mensajeId: 'm1', conversacionId: 'c1', duplicado: true });
    expect(llamadas[0].valores).toMatchObject({ p_tenant: T1, p_contacto: 'ct', p_wamid: 'w', p_texto: 'hola' });
    respuesta = () => ({ data: [], error: null });
    await expect(crearRepoVigia().recibir({ tenantId: T1, contactoId: 'ct', wamid: null, tipo: 'texto', texto: '', ahora: new Date() })).rejects.toThrow(/0400/);
    respuesta = () => ({ data: null, error: { message: 'contacto no autorizado para el vigía' } });
    await expect(crearRepoVigia().recibir({ tenantId: T1, contactoId: 'ct', wamid: null, tipo: 'texto', texto: '', ahora: new Date() })).rejects.toThrow(/no autorizado/);
  });

  it('reclamarEstado: UPDATE condicional por estado; cero filas = «otro lo ganó» (null), no error', async () => {
    const repo = crearRepoVigia();
    respuesta = () => ({ data: [], error: null });
    expect(await repo.reclamarEstado(T1, 'm1', ['pendiente_aprobacion', 'borrador'], 'aprobado', { aprobadoPor: 'u' })).toBeNull();
    const l = llamadas[0];
    expect(l.op).toBe('update');
    expect(tiene(l, 'in', 'estado', ['pendiente_aprobacion', 'borrador'])).toBe(true);
    expect(tiene(l, 'eq', 'direccion', 'saliente')).toBe(true);
    expect(l.valores).toMatchObject({ estado: 'aprobado', aprobado_por: 'u' });
    expect((l.valores as Record<string, unknown>).aprobado_en).toEqual(expect.any(String));
    respuesta = () => ({ data: [{ id: 'm1', tenant_id: T1, conversacion_id: 'c', direccion: 'saliente', autor: 'agente', estado: 'aprobado', created_at: 'x', texto: 't' }], error: null });
    expect((await repo.reclamarEstado(T1, 'm1', ['pendiente_aprobacion'], 'aprobado'))!.estado).toBe('aprobado');
    respuesta = () => ({ data: null, error: { message: 'caída' } });
    await expect(repo.reclamarEstado(T1, 'm1', ['pendiente_aprobacion'], 'aprobado')).rejects.toThrow();
  });

  it('evento: una clave repetida (23505) NO inserta y devuelve false; otro error lanza', async () => {
    const repo = crearRepoVigia();
    expect(await repo.evento(T1, { tipo: 'escalada', clave: 'k', nivel: 1 })).toBe(true);
    respuesta = () => ({ data: null, error: { message: 'duplicate key', code: '23505' } });
    expect(await repo.evento(T1, { tipo: 'escalada', clave: 'k', nivel: 1 })).toBe(false);
    // sin clave, un 23505 NO es el sello: lanza
    await expect(repo.evento(T1, { tipo: 'entrante' })).rejects.toThrow();
    respuesta = () => ({ data: null, error: { message: 'otra cosa' } });
    await expect(repo.evento(T1, { tipo: 'escalada', clave: 'k' })).rejects.toThrow();
  });

  it('crearSaliente: 23505 (ya hay respuesta del agente a ese entrante) devuelve el existente con creado=false', async () => {
    const repo = crearRepoVigia();
    let n = 0;
    respuesta = (l) => {
      n += 1;
      if (l.op === 'insert') return { data: null, error: { message: 'dup', code: '23505' } };
      return { data: [{ id: 'previo' }], error: null };
    };
    expect(await repo.crearSaliente(T1, { conversacionId: 'c', respuestaA: 'e1', autor: 'agente', texto: 't', estado: 'pendiente_aprobacion', intencion: null, riesgo: null, datosRespaldo: null, senales: [], autoenviado: false, aprobadoPor: null }))
      .toEqual({ id: 'previo', creado: false });
    expect(n).toBe(2);
    const previo = llamadas[1];
    expect(tiene(previo, 'eq', 'tenant_id', T1) && tiene(previo, 'eq', 'respuesta_a', 'e1') && tiene(previo, 'eq', 'autor', 'agente')).toBe(true);
  });

  it('aprobacionesSinEditar cuenta SOLO envíos reales aprobados por una persona y sin editar', async () => {
    respuesta = () => ({ data: null, error: null, count: 4 } as never);
    await crearRepoVigia().aprobacionesSinEditar(T1, 'ubicacion');
    const l = llamadas[0];
    expect(tiene(l, 'eq', 'editado', false) && tiene(l, 'eq', 'autoenviado', false) && tiene(l, 'eq', 'estado', 'enviado') && tiene(l, 'eq', 'intencion', 'ubicacion')).toBe(true);
    expect(tiene(l, 'not', 'aprobado_por')).toBe(true);
  });

  it('destinatarioNivel: nivel 1 = responsable del cliente, o el jefe; nivel 2 = dueño activo con teléfono', async () => {
    const repo = crearRepoVigia();
    const base = { id: 'c', tenantId: T1, clienteId: CLIENTE_A, telefono: '525511110001', nombre: null, estado: 'activo' as const, consentimientoEn: 'x', optoutEn: null, avisoPrivacidadEn: null };
    expect(await repo.destinatarioNivel(T1, { ...base, gerenteUserId: 'u-ger' }, 1)).toEqual({ userId: 'u-ger', telefono: '525599990000' });
    expect(await repo.destinatarioNivel(T1, { ...base, gerenteUserId: 'otro' }, 1)).toEqual({ userId: null, telefono: '525511112222' });
    expect(await repo.destinatarioNivel(T1, { ...base, gerenteUserId: null }, 1)).toEqual({ userId: null, telefono: '525511112222' });
    respuesta = () => ({ data: [{ id: 'd1', telefono: '+52 55 8888 7777', activo: false }, { id: 'd2', telefono: '5215588889999', activo: true }], error: null });
    expect(await repo.destinatarioNivel(T1, { ...base, gerenteUserId: null }, 2)).toEqual({ userId: 'd2', telefono: '525588889999' });
    respuesta = () => ({ data: [], error: null });
    expect(await repo.destinatarioNivel(T1, { ...base, gerenteUserId: null }, 2)).toBeNull();
  });

  it('conversacionesEnEspera: descarta filas sin config encendida o sin contacto de SU flota', async () => {
    const conv = (id: string, tenant: string, contacto: string) => ({ id, tenant_id: tenant, contacto_id: contacto, cliente_id: 'c', estado: 'activa', sin_respuesta_desde: '2026-10-01T10:00:00Z' });
    respuesta = (l) => {
      if (l.tabla === 'vigia_conversacion') return { data: [conv('c1', T1, 'k1'), conv('c2', T2, 'k2'), conv('c3', T1, 'k3')], error: null };
      if (l.tabla === 'vigia_config') return { data: [{ tenant_id: T1, habilitado: true }], error: null }; // T2 sin config encendida
      if (l.tabla === 'vigia_contacto') return { data: [
        { id: 'k1', tenant_id: T1, cliente_id: 'c', telefono: '525511110001', estado: 'activo' },
        { id: 'k2', tenant_id: T2, cliente_id: 'c', telefono: '525511110002', estado: 'activo' },
        { id: 'k3', tenant_id: T2, cliente_id: 'c', telefono: '525511110003', estado: 'activo' }, // contacto de OTRA flota colgado de una conv de T1
      ], error: null };
      return { data: [], error: null };
    };
    const filas = await crearRepoVigia().conversacionesEnEspera(100);
    expect(filas.map((f) => f.conversacion.id)).toEqual(['c1']);
    expect(filas[0].config.tenantId).toBe(T1);
  });
});

describe('validaciones de las acciones de la flota', () => {
  const ok = { modoAprobacion: 'siempre', autoenviarMinAprobaciones: 5, slaRespuestaMin: 30, escalarNivel2Min: 60, retencionDias: 180, habilitado: true, avisoPrivacidadUrl: '' };

  it('validarConfig acepta lo válido y normaliza la liga vacía a null', () => {
    expect(validarConfig(ok)).toEqual({ ok: true, valor: { ...ok, avisoPrivacidadUrl: null, slaCriticoMin: 10, molestiaAvisoNivel: 2 } });
    expect(validarConfig({ ...ok, slaCriticoMin: '8', molestiaAvisoNivel: '3' })).toMatchObject({ ok: true, valor: { slaCriticoMin: 8, molestiaAvisoNivel: 3 } });
    expect(validarConfig({ ...ok, slaRespuestaMin: '45', modoAprobacion: 'autoenviar_bajo_riesgo', avisoPrivacidadUrl: ' https://flota.mx/privacidad ' }))
      .toMatchObject({ ok: true, valor: { slaRespuestaMin: 45, modoAprobacion: 'autoenviar_bajo_riesgo', avisoPrivacidadUrl: 'https://flota.mx/privacidad' } });
  });
  it('validarConfig rechaza fuera de rango, no enteros, modos inventados y ligas no https', () => {
    const malos: Array<Record<string, unknown>> = [
      { modoAprobacion: 'siempre_autoenviar' }, { autoenviarMinAprobaciones: 0 }, { autoenviarMinAprobaciones: 101 }, { slaRespuestaMin: 4 },
      { slaRespuestaMin: 1441 }, { slaRespuestaMin: 30.5 }, { slaRespuestaMin: 'abc' }, { escalarNivel2Min: 4 }, { retencionDias: 29 }, { retencionDias: 731 },
      { slaCriticoMin: 1 }, { slaCriticoMin: 1441 }, { slaCriticoMin: 'diez' }, { molestiaAvisoNivel: 1 }, { molestiaAvisoNivel: 4 },
      { avisoPrivacidadUrl: 'http://x.mx' }, { avisoPrivacidadUrl: 'javascript:alert(1)' }, { avisoPrivacidadUrl: 'https://x.mx/a b' },
    ];
    for (const m of malos) expect(validarConfig({ ...ok, ...m }).ok, JSON.stringify(m)).toBe(false);
  });
  it('habilitado solo con `true` estricto (un string «true» no enciende)', () => {
    expect(validarConfig({ ...ok, habilitado: 'true' })).toMatchObject({ ok: true, valor: { habilitado: false } });
  });

  it('telefonoDeAllowlist: 52+10; acepta 10 dígitos, 521 y formatos con signos; rechaza lo demás', () => {
    expect(telefonoDeAllowlist('55 1111 0001')).toBe('525511110001');
    expect(telefonoDeAllowlist('+52 1 55 1111 0001')).toBe('525511110001');
    expect(telefonoDeAllowlist('525511110001')).toBe('525511110001');
    for (const m of ['', '123', '55111100019', 'abc', '+1 415 555 0000', '52551111000']) expect(telefonoDeAllowlist(m), m).toBeNull();
  });
});

describe('altaContactoVigia', () => {
  const alta = { clienteId: CLIENTE_A, telefono: '55 1111 0001', nombre: '  María  ', gerenteUserId: null, consentimiento: true };

  it('sin la constancia de consentimiento NO hay alta (y no toca la base)', async () => {
    const r = await altaContactoVigia(T1, 'u', { ...alta, consentimiento: false });
    expect(r).toMatchObject({ ok: false });
    expect(llamadas).toEqual([]);
  });
  it('teléfono inválido: error, sin tocar la base', async () => {
    expect((await altaContactoVigia(T1, 'u', { ...alta, telefono: '123' })).ok).toBe(false);
    expect(llamadas).toEqual([]);
  });
  it('un cliente que no es de ESTA flota no se da de alta', async () => {
    respuesta = (l) => (l.tabla === 'cliente' ? { data: null, error: null } : { data: [], error: null });
    const r = await altaContactoVigia(T1, 'u', alta);
    expect(r).toEqual({ ok: false, error: 'Ese cliente no es de tu flota.' });
    expect(llamadas.some((l) => l.op === 'insert')).toBe(false);
    expect(tiene(llamadas[0], 'eq', 'tenant_id', T1)).toBe(true);
  });
  it('un responsable que no es de ESTA flota no se acepta', async () => {
    respuesta = (l) => (l.tabla === 'cliente' ? { data: [{ id: CLIENTE_A }], error: null } : l.tabla === 'app_user' ? { data: null, error: null } : { data: [], error: null });
    const r = await altaContactoVigia(T1, 'u', { ...alta, gerenteUserId: 'u-ajeno' });
    expect(r).toEqual({ ok: false, error: 'Ese responsable no es de tu flota.' });
    expect(tiene(llamadas.find((l) => l.tabla === 'app_user')!, 'eq', 'tenant_id', T1)).toBe(true);
  });
  it('alta correcta: teléfono normalizado, consentimiento fechado, hash y bitácora SIN el teléfono', async () => {
    respuesta = (l) => {
      if (l.tabla === 'cliente') return { data: [{ id: CLIENTE_A }], error: null };
      if (l.tabla === 'vigia_contacto' && l.op === 'insert') return { data: { id: 'nuevo' }, error: null };
      return { data: [], error: null };
    };
    const r = await altaContactoVigia(T1, 'u-dueno', alta);
    expect(r).toEqual({ ok: true, valor: { id: 'nuevo' } });
    const ins = llamadas.find((l) => l.tabla === 'vigia_contacto' && l.op === 'insert')!;
    expect(ins.valores).toMatchObject({ tenant_id: T1, cliente_id: CLIENTE_A, telefono: '525511110001', nombre: 'María', estado: 'activo', consentimiento_origen: 'alta_flota' });
    expect((ins.valores as Record<string, unknown>).telefono_hash).toMatch(/^[0-9a-f]{64}$/);
    expect((ins.valores as Record<string, unknown>).consentimiento_en).toEqual(expect.any(String));
    const ev = llamadas.find((l) => l.tabla === 'vigia_evento')!;
    expect(JSON.stringify(ev.valores)).not.toContain('525511110001');
    expect(ev.valores).toMatchObject({ tipo: 'alta', actor_user_id: 'u-dueno' });
  });
  it('un número ya en uso (23505): mensaje GENÉRICO, sin decir en qué otra flota está', async () => {
    respuesta = (l) => {
      if (l.tabla === 'cliente') return { data: [{ id: CLIENTE_A }], error: null };
      if (l.op === 'insert') return { data: null, error: { message: 'duplicate key value violates unique constraint "vigia_contacto_telefono_activo_uq"', code: '23505' } };
      return { data: [], error: null };
    };
    const r = await altaContactoVigia(T1, 'u', alta);
    expect(r).toMatchObject({ ok: false });
    expect((r as { error: string }).error).not.toMatch(/flota|tenant|uq|unique/i);
  });
});

describe('baja manual y supresión ARCO', () => {
  it('baja manual: solo contactos ACTIVOS de la flota; cierra sus hilos; bitácora con hash', async () => {
    respuesta = (l) => (l.tabla === 'vigia_contacto' ? { data: [{ telefono_hash: 'a'.repeat(64) }], error: null } : { data: [], error: null });
    expect(await bajaManualContacto(T1, 'u', 'ct1')).toBe(true);
    const upd = llamadas.find((l) => l.tabla === 'vigia_contacto')!;
    expect(tiene(upd, 'eq', 'tenant_id', T1) && tiene(upd, 'eq', 'estado', 'activo')).toBe(true);
    const conv = llamadas.find((l) => l.tabla === 'vigia_conversacion')!;
    expect(tiene(conv, 'eq', 'tenant_id', T1)).toBe(true);
    expect(llamadas.find((l) => l.tabla === 'vigia_evento')!.valores).toMatchObject({ tipo: 'baja_manual', destinatario_hash: 'a'.repeat(64) });
  });
  it('baja manual de un contacto inexistente o de otra flota: false, sin efectos', async () => {
    expect(await bajaManualContacto(T1, 'u', 'ajeno')).toBe(false);
    expect(llamadas.filter((l) => l.op === 'insert')).toEqual([]);
  });
  it('suprimir: usa la RPC con el tenant del llamador; «inexistente» → null; otro error lanza', async () => {
    respuesta = () => ({ data: { mensajes: 7, conversaciones: 2 }, error: null });
    expect(await suprimirContactoVigia(T1, 'ct1')).toEqual({ mensajes: 7, conversaciones: 2 });
    expect(llamadas[0]).toMatchObject({ tabla: 'rpc:vigia_suprimir_contacto', valores: { p_tenant: T1, p_contacto: 'ct1' } });
    respuesta = () => ({ data: null, error: { message: 'contacto inexistente en esta flota', code: 'P0001' } });
    expect(await suprimirContactoVigia(T2, 'ct1')).toBeNull();
    respuesta = () => ({ data: null, error: { message: 'caída' } });
    await expect(suprimirContactoVigia(T1, 'ct1')).rejects.toThrow();
  });
});

describe('cargarTablero', () => {
  it('arma conversaciones, cola de aprobación y el tiempo de primera respuesta REAL (sin muestra = null, no 0)', async () => {
    const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
    respuesta = (l) => {
      switch (l.tabla) {
        case 'vigia_config': return { data: [{ tenant_id: T1, habilitado: true }], error: null };
        case 'vigia_conversacion': return { data: [{ id: id(1), tenant_id: T1, contacto_id: id(2), cliente_id: CLIENTE_A, estado: 'activa', control: 'agente', sin_respuesta_desde: '2026-10-01T17:00:00Z', molestia_nivel: 2, molestia_motivos: ['insistencia'], escalamiento_nivel: 1 }], error: null };
        case 'vigia_contacto': return { data: [{ id: id(2), tenant_id: T1, cliente_id: CLIENTE_A, telefono: '525511110001', nombre: 'María', estado: 'activo', consentimiento_en: 'x' }], error: null };
        case 'cliente': return { data: [{ id: CLIENTE_A, nombre: 'Compras Acme' }], error: null };
        case 'vigia_mensaje': {
          if (tiene(l, 'eq', 'direccion', 'entrante') && tiene(l, 'in', 'conversacion_id')) return { data: [{ conversacion_id: id(1), texto: '¿dónde va?', created_at: '2026-10-01T17:00:00Z' }], error: null };
          if (tiene(l, 'eq', 'estado', 'pendiente_aprobacion')) return { data: [{ id: id(3), tenant_id: T1, conversacion_id: id(1), direccion: 'saliente', autor: 'agente', estado: 'pendiente_aprobacion', respuesta_a: id(4), texto: 'borrador', intencion: 'ubicacion', riesgo: 'bajo', senales: [], created_at: '2026-10-01T17:01:00Z' }], error: null };
          if (tiene(l, 'eq', 'estado', 'enviado')) return { data: [{ respuesta_a: id(4), enviado_en: '2026-10-01T17:10:00Z' }, { respuesta_a: id(5), enviado_en: '2026-10-01T17:40:00Z' }], error: null };
          if (tiene(l, 'in', 'id')) return { data: [{ id: id(4), texto: '¿dónde va?', created_at: '2026-10-01T17:00:00Z' }, { id: id(5), texto: 'x', created_at: '2026-10-01T17:00:00Z' }], error: null };
          return { data: [], error: null };
        }
        default: return { data: [], error: null };
      }
    };
    const t = await cargarTablero(T1, new Date('2026-10-01T18:00:00Z'));
    expect(t.config.habilitado).toBe(true);
    expect(t.conversaciones).toHaveLength(1);
    expect(t.conversaciones[0]).toMatchObject({ clienteNombre: 'Compras Acme', contactoNombre: 'María', molestiaNivel: 2, escalamientoNivel: 1, ultimoMensajeCliente: '¿dónde va?' });
    expect(t.pendientes).toHaveLength(1);
    expect(t.pendientes[0]).toMatchObject({ borrador: 'borrador', mensajeCliente: '¿dónde va?', clienteNombre: 'Compras Acme', riesgo: 'bajo' });
    expect(t.respuesta).toEqual({ muestra: 2, promedioMin: 25, medianaMin: 40 });
    expect(t.contactos[0]).toMatchObject({ telefonoTerminacion: '0001', nombre: 'María' });
    // el teléfono completo NUNCA viaja al tablero
    expect(JSON.stringify(t)).not.toContain('525511110001');
  });

  it('sin respuestas enviadas: la muestra es 0 y los promedios son null (no un 0 que parezca medición)', async () => {
    const t = await cargarTablero(T1);
    expect(t.respuesta).toEqual({ muestra: 0, promedioMin: null, medianaMin: null });
    expect(t.config.habilitado).toBe(false);
  });
});
