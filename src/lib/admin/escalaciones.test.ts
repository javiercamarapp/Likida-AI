import { describe, it, expect, vi, beforeEach } from 'vitest';

// La bandeja de escalaciones: seis lecturas reales aplanadas en UNA cola.
// El mock pagina COMO POSTGREST (mismo patrón que negocio.test.ts): `range`
// rebana, `eq`/`in` FILTRAN de verdad y `limit` recorta — un mock donde los
// filtros fueran no-ops "pasaría" una bandeja que trae tablas enteras.
type Resp = { data: unknown; error: { message: string } | null; count?: number | null };
const respuestas = new Map<string, Resp>();

function crearBuilder(tabla: string) {
  const raw = (): Resp => respuestas.get(tabla) ?? { data: [], error: null };
  let pidioConteo = false;
  let esHead = false;
  let tope: number | null = null;
  const filtros: Array<(f: Record<string, unknown>) => boolean> = [];
  const filtradas = (): Array<Record<string, unknown>> => {
    let todas = (raw().data ?? []) as Array<Record<string, unknown>>;
    for (const pasa of filtros) todas = todas.filter(pasa);
    return todas;
  };
  const b: Record<string, unknown> = {};
  b.order = () => b;
  b.eq = (col: string, val: unknown) => { filtros.push((f) => f[col] === val); return b; };
  b.in = (col: string, vals: unknown[]) => { filtros.push((f) => vals.includes(f[col])); return b; };
  // FE-9/FE-11: los conteos de la campana ya NO se derivan de `items.length`
  // (las listas vienen acotadas), así que el mock tiene que FILTRAR de verdad
  // en `not`/`lt`/`is` — con no-ops, un conteo mal filtrado pasaría verde.
  b.not = (col: string, op: string, val: unknown) => {
    if (op === 'in') {
      // PostgREST lo recibe como `(a,b)`.
      const vals = String(val).replace(/^\(|\)$/g, '').split(',').map((v) => v.trim());
      filtros.push((f) => !vals.includes(String(f[col])));
    } else if (op === 'is' && val === null) {
      filtros.push((f) => f[col] !== null && f[col] !== undefined);
    }
    return b;
  };
  b.lt = (col: string, val: unknown) => {
    filtros.push((f) => f[col] !== null && f[col] !== undefined && String(f[col]) < String(val));
    return b;
  };
  b.is = (col: string, val: unknown) => {
    filtros.push((f) => (f[col] ?? null) === val);
    return b;
  };
  b.limit = (n: number) => { tope = n; return b; };
  b.select = (_cols?: unknown, opts?: { count?: string; head?: boolean }) => {
    if (opts?.count === 'exact') pidioConteo = true;
    if (opts?.head) esHead = true;
    return b;
  };
  b.range = (desde: number, hasta: number) => {
    const r = raw();
    if (r.error) return Promise.resolve(r);
    const todas = filtradas();
    return Promise.resolve({
      data: todas.slice(desde, hasta + 1),
      error: null,
      count: pidioConteo ? todas.length : null,
    });
  };
  b.then = (ok: (v: Resp) => unknown, fail?: (e: unknown) => unknown) => {
    const r = raw();
    if (r.error) return Promise.resolve(r).then(ok, fail);
    const todas = filtradas();
    return Promise.resolve({
      data: esHead ? null : tope !== null ? todas.slice(0, tope) : todas,
      error: null,
      count: pidioConteo ? todas.length : null,
    }).then(ok, fail);
  };
  return b;
}

// A37-P-06: la RPC `corridas_fallidas_por_grupo` (0870). Por omisión «no existe todavía» → la bandeja cae a la ventana global.
let rpcGrupo: { data: unknown; error: { message: string } | null } = { data: null, error: { message: 'function public.corridas_fallidas_por_grupo does not exist' } };
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({ from: (t: string) => crearBuilder(t), rpc: () => Promise.resolve(rpcGrupo) }),
}));

const {
  getBandejaEscalaciones, getSolicitudesArcoPendientes, getTalachasPendientes,
  getFacturasProveedorPendientes, conteoDeFuente, totalEscalaciones,
} = await import('./escalaciones');

// `ahora`: 15-ago-2026 mediodía UTC — todos los relojes de la bandeja se
// restan contra ESTE valor inyectado, nunca contra el reloj real.
const AHORA = Date.parse('2026-08-15T12:00:00Z');

/** Fixtures pensadas para que el orden de urgencia sea deducible a mano:
 *  ticket vencido (11-ago) < corrida (12) < talacha (13) < liquidación (14)
 *  < factura (15) < ARCO (vence 29-ago, plazo fresco). */
function sembrarTodo() {
  respuestas.set('solicitud_arco', {
    data: [
      {
        id: 'a1', tipo: 'acceso', estado: 'recibida',
        recibida_en: '2026-08-01T10:00:00Z', vence_en: '2026-08-29',
        tenant_id: 't1', flota: { nombre: 'Flota Demo SA de CV' },
      },
      // Resuelta: NO es pendiente — si aparece, el `.in` no filtró.
      {
        id: 'a2', tipo: 'cancelacion', estado: 'resuelta',
        recibida_en: '2026-07-01T10:00:00Z', vence_en: '2026-07-29',
        tenant_id: 't1', flota: { nombre: 'Flota Demo SA de CV' },
      },
    ],
    error: null,
  });
  respuestas.set('agente_corrida', {
    data: [
      {
        agente: 'cobranza', estado: 'fallo', disparo: 'cron',
        inicio: '2026-08-12T00:00:00Z', fin: null,
        tareas_hechas: 1, tareas_total: 3,
        tenant_id: 't2', tenant: { nombre: 'Transportes Dos' },
      },
      // OK: no es escalación.
      {
        agente: 'liquidacion', estado: 'ok', disparo: 'cron',
        inicio: '2026-08-14T00:00:00Z', fin: '2026-08-14T00:00:05Z',
        tareas_hechas: 2, tareas_total: 2,
        tenant_id: 't1', tenant: { nombre: 'Flota Demo SA de CV' },
      },
    ],
    error: null,
  });
  respuestas.set('incidencia', {
    data: [
      {
        // Sin monto reportado: NULL ≠ $0 — el título lo dice con palabras.
        id: 'i1', descripcion: 'se poncho una llanta', monto_estimado: null,
        abierta_en: '2026-08-13T00:00:00Z', autorizacion: 'pendiente',
        tenant_id: 't1', tenant: { nombre: 'Flota Demo SA de CV' },
      },
      // Informativa (autorizacion NULL): jamás entra a la bandeja.
      {
        id: 'i2', descripcion: 'retraso por lluvia', monto_estimado: null,
        abierta_en: '2026-08-13T00:00:00Z', autorizacion: null,
        tenant_id: 't1', tenant: { nombre: 'Flota Demo SA de CV' },
      },
    ],
    error: null,
  });
  respuestas.set('factura_proveedor', {
    data: [
      {
        id: 'f1', emisor_nombre: 'Taller El Buen Freno', total: 1160,
        created_at: '2026-08-15T00:00:00Z', estado: 'pendiente',
        tenant_id: 't1', tenant: { nombre: 'Flota Demo SA de CV' },
      },
      {
        id: 'f2', emisor_nombre: 'Refaccionaria X', total: 500,
        created_at: '2026-08-01T00:00:00Z', estado: 'aprobada',
        tenant_id: 't1', tenant: { nombre: 'Flota Demo SA de CV' },
      },
    ],
    error: null,
  });
  respuestas.set('ticket_soporte', {
    data: [
      {
        id: 'tk1', asunto: 'No sale el PDF', categoria: 'bug', prioridad: 'alta',
        estado: 'abierto', abierto_en: '2026-08-10T00:00:00Z', resuelto_en: null,
        vence_en: '2026-08-11T00:00:00Z', // vencido contra AHORA (15-ago)
        tenant_id: 't1', tenant: { nombre: 'Flota Demo SA de CV' },
      },
      // Terminal: fuera de la cola (mismo conjunto que /admin/soporte).
      {
        id: 'tk2', asunto: 'Duda de factura', categoria: 'duda', prioridad: 'baja',
        estado: 'resuelto', abierto_en: '2026-08-01T00:00:00Z', resuelto_en: '2026-08-02T00:00:00Z',
        vence_en: null,
        tenant_id: 't1', tenant: { nombre: 'Flota Demo SA de CV' },
      },
    ],
    error: null,
  });
  respuestas.set('liquidacion', {
    data: [
      {
        id: 'l1', estatus: 'revisar', created_at: '2026-08-14T00:00:00Z',
        tenant_id: 't1', tenant: { nombre: 'Flota Demo SA de CV' }, viaje: { folio: 'V-001' },
      },
      { id: 'l2', estatus: 'cuadrada', created_at: '2026-08-14T00:00:00Z', tenant_id: 't1', tenant: { nombre: 'Flota Demo SA de CV' }, viaje: null },
    ],
    error: null,
  });
}

describe('getBandejaEscalaciones', () => {
  beforeEach(() => { respuestas.clear(); });

  it('junta las seis fuentes en UNA cola ordenada por urgencia (plazo vencido y espera vieja compiten en la misma línea)', async () => {
    sembrarTodo();
    const b = await getBandejaEscalaciones(AHORA);
    expect(b.cola.map((i) => i.fuente)).toEqual([
      'tickets',            // SLA vencido desde el 11-ago — lo más urgente
      'corridas',           // fallo del 12-ago
      'talachas',           // esperando desde el 13-ago
      'liquidaciones',      // en revisar desde el 14-ago
      'facturas_proveedor', // pendiente desde el 15-ago
      'arco',               // plazo fresco: vence hasta el 29-ago
    ]);
    // Cada fila sabe de qué flota es y a dónde se resuelve.
    const porFuente = new Map(b.cola.map((i) => [i.fuente, i]));
    expect(porFuente.get('corridas')).toMatchObject({
      tenantNombre: 'Transportes Dos',
      href: '/dashboard/agentes/cobranza?tenant=t2',
      detalle: 'Se quedó en 1/3 tareas (disparo: cron).',
    });
    expect(porFuente.get('facturas_proveedor')?.href).toBe('/dashboard/agentes/proveedores?tenant=t1');
    expect(porFuente.get('liquidaciones')).toMatchObject({
      titulo: 'Liquidación en revisión — viaje V-001',
      href: '/dashboard/agentes/liquidacion?tenant=t1',
    });
    expect(porFuente.get('arco')?.href).toBe('/admin/compliance');
    expect(porFuente.get('tickets')).toMatchObject({ href: '/admin/soporte', vence: '2026-08-11T00:00:00Z' });
    // NULL ≠ $0: la talacha sin monto lo dice con palabras, nunca "$0.00".
    expect(porFuente.get('talachas')?.titulo).toContain('sin monto reportado');
  });

  it('los conteos de la campana salen de las MISMAS lecturas', async () => {
    sembrarTodo();
    const b = await getBandejaEscalaciones(AHORA);
    expect(b.conteos).toEqual({
      arco: 1,
      corridasFallo: 1,
      talachas: 1,
      facturasProveedor: 1,
      ticketsAbiertos: 1,
      ticketsVencidos: 1,
      liquidacionesRevisar: 1,
    });
  });

  it('una fuente caída llega POR VALOR: su error se dice, su conteo es null (≠ 0) y las otras cinco siguen', async () => {
    sembrarTodo();
    respuestas.set('ticket_soporte', { data: null, error: { message: 'fetch failed' } });
    const b = await getBandejaEscalaciones(AHORA);
    expect(b.fuentes.tickets.items).toBeNull();
    expect(b.fuentes.tickets.error).toContain('fetch failed');
    expect(b.conteos.ticketsAbiertos).toBeNull();
    expect(b.conteos.ticketsVencidos).toBeNull();
    // Las demás no se caen con ella.
    expect(b.conteos.arco).toBe(1);
    expect(b.conteos.liquidacionesRevisar).toBe(1);
    expect(b.cola.some((i) => i.fuente === 'tickets')).toBe(false);
    expect(b.cola).toHaveLength(5);
  });

  it('todo vacío y legible: cola vacía DE VERDAD, conteos en 0 contado', async () => {
    const b = await getBandejaEscalaciones(AHORA);
    expect(b.cola).toEqual([]);
    expect(b.conteos).toEqual({
      arco: 0, corridasFallo: 0, talachas: 0, facturasProveedor: 0,
      ticketsAbiertos: 0, ticketsVencidos: 0, liquidacionesRevisar: 0,
    });
  });

  // ADM-4 (auditoría 24): `conteoDeFuente`/`totalEscalaciones` — el real,
  // no `items.length` de una lista topada (corridas/tickets/liquidaciones).
  it('conteoDeFuente mapea cada fuente a SU conteo real (tickets = abiertos, no vencidos)', async () => {
    sembrarTodo();
    const b = await getBandejaEscalaciones(AHORA);
    expect(conteoDeFuente('arco', b.conteos)).toBe(1);
    expect(conteoDeFuente('corridas', b.conteos)).toBe(1);
    expect(conteoDeFuente('talachas', b.conteos)).toBe(1);
    expect(conteoDeFuente('facturas_proveedor', b.conteos)).toBe(1);
    expect(conteoDeFuente('tickets', b.conteos)).toBe(1);
    expect(conteoDeFuente('liquidaciones', b.conteos)).toBe(1);
  });

  it('totalEscalaciones suma las seis fuentes sin duplicar tickets (abiertos y vencidos son el mismo universo)', async () => {
    sembrarTodo();
    const b = await getBandejaEscalaciones(AHORA);
    expect(totalEscalaciones(b)).toBe(6);
  });

  it('totalEscalaciones no fabrica: una fuente caída aporta 0 al total, no lanza', async () => {
    sembrarTodo();
    respuestas.set('ticket_soporte', { data: null, error: { message: 'fetch failed' } });
    const b = await getBandejaEscalaciones(AHORA);
    expect(conteoDeFuente('tickets', b.conteos)).toBeNull();
    expect(totalEscalaciones(b)).toBe(5); // las otras cinco, 1 cada una
  });
});

describe('las lecturas propias de la bandeja', () => {
  beforeEach(() => { respuestas.clear(); });

  it('getSolicitudesArcoPendientes: solo recibida/en_proceso — la resuelta no es pendiente', async () => {
    sembrarTodo();
    const r = await getSolicitudesArcoPendientes();
    expect(r).toEqual([{
      id: 'a1', tipo: 'acceso', estado: 'recibida',
      recibidaEn: '2026-08-01T10:00:00Z', venceEn: '2026-08-29',
      tenantId: 't1', flotaNombre: 'Flota Demo SA de CV',
    }]);
  });

  it('getTalachasPendientes: la informativa (autorizacion NULL) no entra, y el monto NULL sigue NULL', async () => {
    sembrarTodo();
    const r = await getTalachasPendientes();
    expect(r).toEqual([{
      id: 'i1', descripcion: 'se poncho una llanta', montoEstimado: null,
      abiertaEn: '2026-08-13T00:00:00Z', tenantId: 't1', tenantNombre: 'Flota Demo SA de CV',
    }]);
  });

  it('getFacturasProveedorPendientes: solo estado=pendiente', async () => {
    sembrarTodo();
    const r = await getFacturasProveedorPendientes();
    expect(r).toEqual([{
      id: 'f1', emisorNombre: 'Taller El Buen Freno', total: 1160,
      creadaEn: '2026-08-15T00:00:00Z', tenantId: 't1', tenantNombre: 'Flota Demo SA de CV',
    }]);
  });

  it('un fallo de lectura LANZA en la lectura directa — el "por valor" es de la bandeja, no de cada fuente', async () => {
    respuestas.set('incidencia', { data: null, error: { message: 'fetch failed' } });
    await expect(getTalachasPendientes()).rejects.toThrow('fetch failed');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// UNA RACHA DE FALLOS = UN INCIDENTE (23-oct-2026). El enriquecedor falló en
// cada vuelta de 4 h durante 10 días: cada corrida fallida era una fila de la
// cola con su propio `desde` y la guardia la avisaba como incidente NUEVO
// (32 correos «5 incidente(s) nuevo(s)»). Ahora la racha del mismo agente con
// el mismo error se junta en UN item: `desde` = primer fallo de la racha, el
// conteo en el título y una huella estable que NO cambia al crecer la racha.
// ═══════════════════════════════════════════════════════════════════════════
describe('getBandejaEscalaciones — las corridas en fallo se juntan en rachas', () => {
  beforeEach(() => { respuestas.clear(); });
  const ERR_401 = 'El modelo no pudo extraer el dossier (auth: HTTP 401)';
  const fila = (agente: string, estado: string, inicio: string, error: string | null = null, tenantId: string | null = null) => ({
    agente, estado, disparo: 'cron', inicio, fin: null, tareas_hechas: null, tareas_total: null,
    tenant_id: tenantId, tenant: null, error,
  });
  const corridas = async () => (await getBandejaEscalaciones(AHORA)).cola.filter((i) => i.fuente === 'corridas');

  it('5 fallos del mismo agente y el mismo error son UN item, desde el primero, con el conteo en el título', async () => {
    respuestas.set('agente_corrida', {
      data: ['2026-08-14T20:00:00Z', '2026-08-14T16:00:00Z', '2026-08-14T12:00:00Z', '2026-08-14T08:00:00Z', '2026-08-14T04:00:00Z']
        .map((t) => fila('enriquecedor', 'fallo', t, ERR_401)),
      error: null,
    });
    const items = await corridas();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      titulo: 'Corrida en fallo — agente enriquecedor (5 corridas desde 2026-08-14)',
      desde: '2026-08-14T04:00:00Z',
    });
    expect(items[0].detalle).toContain(ERR_401);
  });

  it('la huella NO depende del conteo ni del desde: crece la racha y sigue siendo el mismo incidente', async () => {
    respuestas.set('agente_corrida', { data: [fila('enriquecedor', 'fallo', '2026-08-14T20:00:00Z', ERR_401), fila('enriquecedor', 'fallo', '2026-08-14T16:00:00Z', ERR_401)], error: null });
    const antes = (await corridas())[0];
    respuestas.set('agente_corrida', { data: [fila('enriquecedor', 'fallo', '2026-08-15T00:00:00Z', ERR_401), ...(respuestas.get('agente_corrida')!.data as never[])], error: null });
    const despues = (await corridas())[0];
    expect(despues.titulo).not.toBe(antes.titulo);
    expect(despues.huella).toBeDefined();
    expect(despues.huella).toBe(antes.huella);
  });

  it('un error DISTINTO es otro incidente (otra huella) y cuenta solo su propia racha', async () => {
    respuestas.set('agente_corrida', {
      data: [
        fila('enriquecedor', 'fallo', '2026-08-15T04:00:00Z', 'El modelo no pudo extraer el dossier (credito: HTTP 402)'),
        fila('enriquecedor', 'fallo', '2026-08-14T20:00:00Z', ERR_401),
        fila('enriquecedor', 'fallo', '2026-08-14T16:00:00Z', ERR_401),
      ],
      error: null,
    });
    const items = await corridas();
    expect(items).toHaveLength(1);
    expect(items[0].titulo).toContain('(1 corrida desde 2026-08-15)');
    expect(items[0].huella).not.toContain(ERR_401);
  });

  it('una corrida ok DESPUÉS de los fallos rompe la racha: nada vigente; los fallos nuevos arrancan otra', async () => {
    const base = [
      fila('enriquecedor', 'fallo', '2026-08-10T00:00:00Z', ERR_401),
      fila('enriquecedor', 'fallo', '2026-08-10T04:00:00Z', ERR_401),
      fila('enriquecedor', 'ok', '2026-08-11T00:00:00Z'),
    ];
    respuestas.set('agente_corrida', { data: base, error: null });
    expect(await corridas()).toHaveLength(0);

    respuestas.set('agente_corrida', { data: [...base, fila('enriquecedor', 'fallo', '2026-08-14T00:00:00Z', ERR_401), fila('enriquecedor', 'fallo', '2026-08-14T04:00:00Z', ERR_401)], error: null });
    const items = await corridas();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ desde: '2026-08-14T00:00:00Z' });
    expect(items[0].titulo).toContain('2 corridas desde 2026-08-14');
  });

  // A37-S22-01 (ALTO): la ruptura de la racha se calculaba por AGENTE, sin flota. Si el mismo agente
  // salía ok en la flota B DESPUÉS de fallar en la flota A, el incidente de A desaparecía de la bandeja.
  it('A37-S22-01: un ok del mismo agente en OTRA flota no rompe la racha de fallos de esta', async () => {
    respuestas.set('agente_corrida', {
      data: [
        fila('peajes', 'fallo', '2026-08-14T10:00:00Z', ERR_401, 't1'),
        fila('peajes', 'fallo', '2026-08-14T06:00:00Z', ERR_401, 't1'),
        fila('peajes', 'ok', '2026-08-14T12:00:00Z', null, 't2'),
      ],
      error: null,
    });
    const items = await corridas();
    expect(items).toHaveLength(1);
    expect(items[0].titulo).toContain('agente peajes (2 corridas desde 2026-08-14)');
  });

  it('A37-S22-01: el ok de la MISMA flota sí rompe su racha', async () => {
    respuestas.set('agente_corrida', {
      data: [
        fila('peajes', 'fallo', '2026-08-14T06:00:00Z', ERR_401, 't1'),
        fila('peajes', 'ok', '2026-08-14T12:00:00Z', null, 't1'),
        fila('peajes', 'fallo', '2026-08-14T10:00:00Z', ERR_401, 't2'),
      ],
      error: null,
    });
    const items = await corridas();
    expect(items).toHaveLength(1);
    expect(items[0].titulo).toContain('agente peajes (1 corrida');
  });

  // A37-P-06: con la 0870 la ventana es POR agente+flota. La RPC entrega, de cada grupo, sus fallos vigentes y su última corrida ok.
  it('A37-P-06: con la RPC por grupo, la flota ruidosa no esconde el fallo de otra (la ventana global de 200 sí lo hacía)', async () => {
    const ruido = Array.from({ length: 5 }, (_, i) => ({
      agente: 'peajes', estado: 'fallo', disparo: 'cron', inicio: `2026-08-14T1${i}:00:00Z`, fin: null,
      tareas_hechas: null, tareas_total: null, tenant_id: 't1', tenant_nombre: 'Flota Uno', error: ERR_401, ultimo_sin_fallo: null,
    }));
    const otra = {
      agente: 'peajes', estado: 'fallo', disparo: 'cron', inicio: '2026-08-10T08:00:00Z', fin: null,
      tareas_hechas: null, tareas_total: null, tenant_id: 't2', tenant_nombre: 'Flota Dos', error: ERR_401, ultimo_sin_fallo: null,
    };
    rpcGrupo = { data: [...ruido, otra], error: null };
    try {
      const items = await corridas();
      expect(items).toHaveLength(2);
      expect(items.map((i) => i.tenantNombre).sort()).toEqual(['Flota Dos', 'Flota Uno']);
    } finally {
      rpcGrupo = { data: null, error: { message: 'function public.corridas_fallidas_por_grupo does not exist' } };
    }
  });

  it('agentes o flotas distintos NO se mezclan', async () => {
    respuestas.set('agente_corrida', {
      data: [
        fila('enriquecedor', 'fallo', '2026-08-14T20:00:00Z', ERR_401),
        fila('sdr', 'fallo', '2026-08-14T20:00:00Z', ERR_401),
        fila('cobranza', 'fallo', '2026-08-14T20:00:00Z', ERR_401, 't1'),
        fila('cobranza', 'fallo', '2026-08-14T20:00:00Z', ERR_401, 't2'),
      ],
      error: null,
    });
    expect(await corridas()).toHaveLength(4);
  });
});
