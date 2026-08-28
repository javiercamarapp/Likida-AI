import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// LOS TRES DESENLACES DEL PORTAL, CONTRA UN SUPABASE FALSO.
//
// El repo evita probar escrituras contra un mock —eso demuestra que el mock
// funciona— y esa regla se respeta: aquí NO se prueba que un insert inserte.
// Lo que se prueba es la DECISIÓN, que es lo único que este código tiene y lo
// que no se puede ver de otra forma:
//
//   · «no se pudo preguntar» NO se colapsa en «tu enlace murió». Supabase
//     reporta por VALOR: sin esta prueba, el día que alguien cambie un
//     `if (error)` por un `?? []`, un bache de red le diría a un cliente
//     legítimo que pida otro enlace, y saldría a pedirlo.
//   · el saldo `null` NO se vuelve 0. Un cero ahí se lee como «ya no debes».
//   · una liga caducada o revocada contesta EXACTAMENTE lo mismo que una que
//     no existe.
// ═══════════════════════════════════════════════════════════════════════════

const sbMock = vi.fn();
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => sbMock() }));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
  redactarTexto: (s: string) => s,
}));

import { hashDeToken, generarTokenPortal } from './portal_pago';
import {
  resolverLiga, vistaDelPortal, anotarAcceso, sellarUltimoAcceso, xmlDelRep, panelDelPortal,
  TOPE_REPS_PANEL,
} from './portal_pago_lectura';

type Resultado = { data: unknown; error: { message: string; code?: string } | null };

/**
 * Una cadena de PostgREST falsa: cualquier método devuelve la propia cadena, y
 * la cadena es `await`-able al resultado. Así funciona `.select().eq().eq()
 * .maybeSingle()` sin declarar cada verbo.
 */
function cadena(resultado: Resultado): unknown {
  const p = Promise.resolve(resultado);
  const proxy: unknown = new Proxy({}, {
    get(_t, prop) {
      if (typeof prop === 'symbol') return undefined;
      if (prop === 'then') return p.then.bind(p);
      if (prop === 'catch') return p.catch.bind(p);
      if (prop === 'finally') return p.finally.bind(p);
      return () => proxy;
    },
  });
  return proxy;
}

const OK = (data: unknown): Resultado => ({ data, error: null });
const FALLA = (message = 'la base no contestó'): Resultado => ({ data: null, error: { message } });

/** Respuestas POR TABLA, consumidas en orden; la última se repite. */
function conTablas(porTabla: Record<string, Resultado[]>) {
  const usados: Record<string, number> = {};
  sbMock.mockReturnValue({
    from(tabla: string) {
      const r = porTabla[tabla];
      if (!r) return cadena(OK(null));
      const i = usados[tabla] ?? 0;
      usados[tabla] = i + 1;
      return cadena(r[Math.min(i, r.length - 1)]);
    },
  });
}

const HOY = new Date();
const FUTURO = new Date(HOY.getTime() + 86_400_000).toISOString();
const PASADO = new Date(HOY.getTime() - 86_400_000).toISOString();

const TOKEN = generarTokenPortal();
const FILA_LIGA = {
  id: 'liga-1', tenant_id: 't-1', factura_id: 'f-1',
  token_hash: hashDeToken(TOKEN.enClaro),
  expira_en: FUTURO, revocada_en: null,
};

beforeEach(() => { sbMock.mockReset(); });

describe('resolverLiga — el token que no vale y el que no se pudo comprobar', () => {
  it('un token sin forma NI SIQUIERA consulta la base', async () => {
    conTablas({});
    const r = await resolverLiga('hola');
    expect(r).toEqual({ ok: false, motivo: 'no_valida' });
    expect(sbMock).not.toHaveBeenCalled();
  });

  it('un error de lectura es `no_disponible`, JAMÁS `no_valida`', async () => {
    // Ésta es la que importa: colapsarlas mandaría a un cliente legítimo a
    // pedir un enlace nuevo por un bache de red.
    conTablas({ portal_pago_liga: [FALLA()] });
    expect(await resolverLiga(TOKEN.enClaro)).toEqual({ ok: false, motivo: 'no_disponible' });
  });

  it('sin candidatas, `no_valida`', async () => {
    conTablas({ portal_pago_liga: [OK([])] });
    expect(await resolverLiga(TOKEN.enClaro)).toEqual({ ok: false, motivo: 'no_valida' });
  });

  it('una candidata del mismo prefijo con otro hash NO abre nada', async () => {
    conTablas({ portal_pago_liga: [OK([{ ...FILA_LIGA, token_hash: 'f'.repeat(64) }])] });
    expect(await resolverLiga(TOKEN.enClaro)).toEqual({ ok: false, motivo: 'no_valida' });
  });

  it('el token correcto resuelve su liga, y trae el tenant de la fila', async () => {
    conTablas({ portal_pago_liga: [OK([FILA_LIGA])] });
    const r = await resolverLiga(TOKEN.enClaro);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.liga).toEqual({ ligaId: 'liga-1', tenantId: 't-1', facturaId: 'f-1', estado: 'vigente' });
    }
  });

  it('caducada y revocada contestan lo MISMO que un token inventado', async () => {
    conTablas({ portal_pago_liga: [OK([{ ...FILA_LIGA, expira_en: PASADO }])], portal_pago_acceso: [OK(null)] });
    expect(await resolverLiga(TOKEN.enClaro)).toEqual({ ok: false, motivo: 'no_valida' });

    conTablas({ portal_pago_liga: [OK([{ ...FILA_LIGA, revocada_en: PASADO }])], portal_pago_acceso: [OK(null)] });
    expect(await resolverLiga(TOKEN.enClaro)).toEqual({ ok: false, motivo: 'no_valida' });
  });
});

// ── La vista ───────────────────────────────────────────────────────────────

const LIGA = { ligaId: 'liga-1', tenantId: 't-1', facturaId: 'f-1', estado: 'vigente' as const };

const FACTURA = {
  id: 'f-1', cliente_id: 'c-1', serie: 'A', folio: '1042', cfdi_uuid: null,
  fecha: '2026-08-14', vence_en: '2026-09-13', estatus: 'emitida', total: 11600, moneda: 'MXN',
};

function escenario(over: Partial<Record<string, Resultado[]>> = {}) {
  conTablas({
    factura_emitida: [OK(FACTURA)],
    tenant: [OK({ nombre: 'Transportes del Bajío', razon_social: 'TRANSPORTES DEL BAJIO SA DE CV' })],
    portal_pago_propuesta: [OK([])],
    // Dos lecturas: los complementos, y CUÁLES de ellos traen XML.
    rep_emitido: [OK([]), OK([])],
    factura_saldo: [OK({ saldo: 11600, pagado: 0 })],
    cliente: [OK({ nombre: 'Cemex', razon_social: 'CEMENTOS DEL NORTE SA' })],
    ...over,
  });
}

describe('vistaDelPortal — el saldo `null` no es cero', () => {
  it('con todo bien, arma la vista con la razón social de ambos lados', async () => {
    escenario();
    const r = await vistaDelPortal(LIGA);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.vista.flota).toBe('TRANSPORTES DEL BAJIO SA DE CV');
    expect(r.vista.cliente).toBe('CEMENTOS DEL NORTE SA');
    expect(r.vista.factura.saldo).toBe(11600);
    expect(r.vista.factura.total).toBe(11600);
  });

  it('si `factura_saldo` falla, el saldo queda en NULL y la vista sigue viva', async () => {
    // Degradar a `null` y no a 0: la pantalla dirá «sin dato», y el formulario
    // se apaga. Un cero invitaría a registrar un pago contra una cifra falsa.
    escenario({ factura_saldo: [FALLA()] });
    const r = await vistaDelPortal(LIGA);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.vista.factura.saldo).toBeNull();
      expect(r.vista.factura.pagado).toBeNull();
    }
  });

  it('un saldo ausente en la vista tampoco se vuelve 0', async () => {
    escenario({ factura_saldo: [OK({ saldo: null, pagado: null })] });
    const r = await vistaDelPortal(LIGA);
    if (r.ok) expect(r.vista.factura.saldo).toBeNull();
  });

  it('si la FACTURA no se pudo leer, la respuesta es `no_disponible`', async () => {
    escenario({ factura_emitida: [FALLA()] });
    expect(await vistaDelPortal(LIGA)).toEqual({ ok: false, motivo: 'no_disponible' });
  });

  it('si la factura NO EXISTE, es `no_valida` — sin decir que se borró', async () => {
    escenario({ factura_emitida: [OK(null)] });
    expect(await vistaDelPortal(LIGA)).toEqual({ ok: false, motivo: 'no_valida' });
  });

  it('si falla el tenant, `no_disponible`: sin emisor no hay factura que enseñar', async () => {
    escenario({ tenant: [FALLA()] });
    expect(await vistaDelPortal(LIGA)).toEqual({ ok: false, motivo: 'no_disponible' });
  });

  it('sin razón social, cae al nombre comercial — nunca a un vacío', async () => {
    escenario({
      tenant: [OK({ nombre: 'Transportes del Bajío', razon_social: null })],
      cliente: [OK({ nombre: 'Cemex', razon_social: null })],
    });
    const r = await vistaDelPortal(LIGA);
    if (r.ok) {
      expect(r.vista.flota).toBe('Transportes del Bajío');
      expect(r.vista.cliente).toBe('Cemex');
    }
  });

  it('si el CLIENTE no se pudo leer, la página no se cae', async () => {
    escenario({ cliente: [FALLA()] });
    const r = await vistaDelPortal(LIGA);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.vista.cliente).toBe('Cliente');
  });

  it('el REP viaja SIN su XML: solo si lo tiene', async () => {
    // El documento fiscal no se carga en cada render. La segunda lectura de
    // `rep_emitido` es la que dice CUÁLES tienen archivo, sin traer un byte.
    escenario({
      rep_emitido: [
        OK([{ cfdi_uuid: 'aaa', fecha_pago: '2026-08-20', imp_pagado: 11600 }]),
        OK([{ cfdi_uuid: 'aaa' }]),
      ],
    });
    const r = await vistaDelPortal(LIGA);
    if (r.ok) {
      expect(r.vista.reps).toEqual([
        { cfdiUuid: 'aaa', fechaPago: '2026-08-20', impPagado: 11600, tieneXml: true },
      ]);
      expect(JSON.stringify(r.vista.reps)).not.toContain('xml');
    }
  });

  it('un REP sin XML lo declara, en vez de ofrecer una descarga vacía', async () => {
    escenario({
      rep_emitido: [
        OK([{ cfdi_uuid: 'aaa', fecha_pago: '2026-08-20', imp_pagado: 11600 }]),
        OK([]),
      ],
    });
    const r = await vistaDelPortal(LIGA);
    if (r.ok) expect(r.vista.reps[0].tieneXml).toBe(false);
  });

  // ── `c7-16`: LOS TRES COMPLEMENTOS DE UNA FACTURA EN PARCIALIDADES ──────
  it('con parcialidades llegan TODOS los complementos, no el último', async () => {
    escenario({
      rep_emitido: [
        OK([
          { cfdi_uuid: 'c3', fecha_pago: '2026-08-20', imp_pagado: 4000 },
          { cfdi_uuid: 'c2', fecha_pago: '2026-07-20', imp_pagado: 4000 },
          { cfdi_uuid: 'c1', fecha_pago: '2026-06-20', imp_pagado: 3600 },
        ]),
        OK([{ cfdi_uuid: 'c1' }, { cfdi_uuid: 'c3' }]),
      ],
    });
    const r = await vistaDelPortal(LIGA);
    if (!r.ok) throw new Error('la vista tenía que salir');
    expect(r.vista.reps.map((x) => x.cfdiUuid)).toEqual(['c3', 'c2', 'c1']);
    // Y cada uno con SU verdad sobre el archivo, no la del más reciente.
    expect(r.vista.reps.map((x) => x.tieneXml)).toEqual([true, false, true]);
  });

  it('si falla la lectura de CUÁLES tienen XML, ninguno se anuncia descargable', async () => {
    // Fallar cerrado: un botón que no baja nada es peor que no ofrecerlo.
    escenario({
      rep_emitido: [
        OK([{ cfdi_uuid: 'aaa', fecha_pago: '2026-08-20', imp_pagado: 11600 }]),
        FALLA(),
      ],
    });
    const r = await vistaDelPortal(LIGA);
    if (r.ok) expect(r.vista.reps[0].tieneXml).toBe(false);
  });

  it('las propuestas del cliente llegan con su estado', async () => {
    escenario({
      portal_pago_propuesta: [OK([
        { fecha: '2026-08-20', monto: 5000, referencia: 'R1', estado: 'pendiente', registrada_en: '2026-08-20T10:00:00Z' },
      ])],
    });
    const r = await vistaDelPortal(LIGA);
    if (r.ok) {
      expect(r.vista.propuestas).toHaveLength(1);
      expect(r.vista.propuestas[0].estado).toBe('pendiente');
    }
  });
});

// ── `c7-7` · UNA FACTURA CANCELADA NO PIDE DINERO ─────────────────────────

describe('vistaDelPortal — el CFDI cancelado deja de cobrar', () => {
  it('una factura CANCELADA es `no_cobrable`, no una página con saldo', async () => {
    // El escenario real: la liga se emitió sobre una factura `emitida`, el
    // cliente pidió refacturación y el contralor la canceló. `cancelarFactura`
    // no tocaba la liga, así que `estadoLiga` la seguía viendo VIGENTE y el
    // cliente veía «Saldo pendiente $11,600.00» con el formulario activo — la
    // vista `factura_saldo` calcula total − pagos sin mirar el estatus.
    escenario({ factura_emitida: [OK({ ...FACTURA, estatus: 'cancelada' })] });
    expect(await vistaDelPortal(LIGA)).toEqual({ ok: false, motivo: 'no_cobrable', estatus: 'cancelada' });
  });

  it('NI SIQUIERA se lee el saldo de una cancelada', async () => {
    // La puerta va antes que la lectura del saldo a propósito: sobre un CFDI
    // cancelado no hay cifra que enseñar, y una que se lee acaba pintándose.
    escenario({
      factura_emitida: [OK({ ...FACTURA, estatus: 'cancelada' })],
      factura_saldo: [OK({ saldo: 11600, pagado: 0 })],
    });
    const r = await vistaDelPortal(LIGA);
    expect(JSON.stringify(r)).not.toContain('11600');
  });

  it('un borrador tampoco cobra, y el desenlace lo distingue', async () => {
    escenario({ factura_emitida: [OK({ ...FACTURA, estatus: 'borrador' })] });
    expect(await vistaDelPortal(LIGA)).toEqual({ ok: false, motivo: 'no_cobrable', estatus: 'borrador' });
  });

  it('un estatus DESCONOCIDO cae al lado seguro: no cobra', async () => {
    // Fail-closed por lista blanca: si mañana `factura_emitida` estrena un
    // estatus, entra por omisión al lado que no le pide dinero a nadie.
    escenario({ factura_emitida: [OK({ ...FACTURA, estatus: 'en_disputa' })] });
    expect(await vistaDelPortal(LIGA)).toEqual({ ok: false, motivo: 'no_cobrable', estatus: 'en_disputa' });
  });

  it('emitida y pagada SÍ arman la vista', async () => {
    escenario();
    expect((await vistaDelPortal(LIGA)).ok).toBe(true);
    escenario({ factura_emitida: [OK({ ...FACTURA, estatus: 'pagada' })] });
    expect((await vistaDelPortal(LIGA)).ok).toBe(true);
  });
});

// ── `c7-24` · «NO PUDE PREGUNTAR» NO ES «NO HAY» ──────────────────────────

describe('xmlDelRep — el error de la base no se disfraza de «todavía no hay»', () => {
  const UUID = 'aaaaaaaa-bbbb-4ccc-8ddd-000000000001';

  it('un error de lectura es `no_disponible`, no `sin_xml`', async () => {
    // La ruta contestaba 404 «Todavía no hay un XML de complemento para esta
    // factura» ante un hipo de Supabase: una afirmación de hecho FALSA que
    // manda al cliente a molestar a la flota por un archivo que sí está.
    conTablas({ rep_emitido: [FALLA()] });
    expect(await xmlDelRep(LIGA, UUID)).toEqual({ ok: false, motivo: 'no_disponible' });
  });

  it('sin fila con ese folio, `sin_xml` — que es un hecho comprobado', async () => {
    conTablas({ rep_emitido: [OK([])] });
    expect(await xmlDelRep(LIGA, UUID)).toEqual({ ok: false, motivo: 'sin_xml' });
  });

  it('un folio sin forma de UUID ni consulta la base', async () => {
    conTablas({});
    expect(await xmlDelRep(LIGA, 'no-es-uuid')).toEqual({ ok: false, motivo: 'sin_xml' });
    expect(sbMock).not.toHaveBeenCalled();
  });

  it('con XML lo entrega, con su folio', async () => {
    conTablas({ rep_emitido: [OK([{ cfdi_uuid: UUID, xml: '<x/>' }])] });
    expect(await xmlDelRep(LIGA, UUID.toUpperCase())).toEqual({ ok: true, uuid: UUID, xml: '<x/>' });
  });
});

// ── `c7-23` · LA BANDEJA NO INVENTA «sin folio · Cliente» ─────────────────

describe('panelDelPortal — una propuesta huérfana se DICE, no se rotula', () => {
  const PROPUESTA = {
    id: 'p-1', factura_id: 'f-vieja', fecha: '2026-08-20', monto: 5000,
    referencia: 'SPEI-8891', metodo: 'transferencia', registrada_en: '2026-08-20T10:00:00Z',
  };

  it('la factura que la primera lectura no alcanzó se resuelve POR ID, sin filtro de estatus', async () => {
    // La primera consulta trae las 300 más recientes y solo emitida/pagada
    // —es la lista de candidatas a generar enlace—, así que una factura
    // CANCELADA después de registrar la propuesta no aparece ahí. Antes el
    // renglón se pintaba «sin folio · Cliente»; ahora se busca por id.
    conTablas({
      portal_pago_propuesta: [OK([PROPUESTA])],
      portal_pago_liga: [OK([])],
      factura_emitida: [
        OK([]),
        OK([{ id: 'f-vieja', serie: 'A', folio: '1042', cfdi_uuid: null, cliente_id: 'c-1', estatus: 'cancelada' }]),
      ],
      factura_saldo: [OK([])],
      cliente: [OK([{ id: 'c-1', nombre: 'Cemex', razon_social: 'CEMENTOS DEL NORTE SA' }])],
    });
    const panel = await panelDelPortal('t-1');
    expect(panel.pendientes[0].factura).toBe('A-1042');
    expect(panel.pendientes[0].cliente).toBe('CEMENTOS DEL NORTE SA');
    expect(panel.pendientes[0].identificada).toBe(true);
    // Y el estatus viaja: conciliar contra una cancelada rebota en la RPC, y
    // el contralor tiene que verlo ANTES de apretar.
    expect(panel.pendientes[0].estatus).toBe('cancelada');
  });

  it('si NI ASÍ aparece, el renglón dice que no se pudo identificar', async () => {
    // «sin folio» es la VERDAD de una factura sin folio ni UUID. Usarlo aquí lo
    // convertía en «no la pude resolver», y «Cliente» aparecía donde hay una
    // razón social real: el contralor decidía sobre dinero mirando una fila que
    // no identificaba nada.
    conTablas({
      portal_pago_propuesta: [OK([PROPUESTA])],
      portal_pago_liga: [OK([])],
      factura_emitida: [OK([]), OK([])],
      factura_saldo: [OK([])],
      cliente: [OK([])],
    });
    const panel = await panelDelPortal('t-1');
    expect(panel.pendientes[0].factura).toBe('no se pudo identificar');
    expect(panel.pendientes[0].cliente).toBe('no se pudo identificar');
    expect(panel.pendientes[0].identificada).toBe(false);
    expect(panel.pendientes[0].estatus).toBeNull();
    // Y el monto y la referencia siguen ahí: lo que no se sabe se dice, lo que
    // sí se sabe no se esconde.
    expect(panel.pendientes[0].monto).toBe(5000);
    expect(panel.pendientes[0].referencia).toBe('SPEI-8891');
  });

  it('si la segunda lectura falla, la bandeja sigue —diciendo lo que no supo—', async () => {
    conTablas({
      portal_pago_propuesta: [OK([PROPUESTA])],
      portal_pago_liga: [OK([])],
      factura_emitida: [OK([]), FALLA()],
      factura_saldo: [OK([])],
      cliente: [OK([])],
    });
    const panel = await panelDelPortal('t-1');
    expect(panel.pendientes[0].identificada).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// LOS REP QUE EL CONTRALOR REGISTRA Y NUNCA VOLVÍA A VER.
//
// `rep_emitido` sólo se leía del lado del PAGADOR (`vistaDelPortal`).
// `panelDelPortal` no la consultaba ni una vez: quien registra el complemento
// lo hacía a ciegas y no tenía cómo contestar «¿ya le mandé el de esta
// factura?» antes de emitir otro — y el texto de la pantalla ya prometía «con
// el sello de cuándo lo abrió», que tampoco se pintaba.
// ═══════════════════════════════════════════════════════════════════════════
describe('panelDelPortal — los complementos ya registrados', () => {
  const REP = {
    id: 'r-1', factura_id: 'f-1', cfdi_uuid: 'AAAA-BBBB', fecha_pago: '2026-08-22',
    imp_pagado: 5000, forma_pago_p: '03',
    registrado_en: '2026-08-22T18:00:00Z', entregado_en: null,
  };
  const FACTURA = { id: 'f-1', serie: 'A', folio: '77', cfdi_uuid: null, cliente_id: 'c-1', estatus: 'pagada' };

  it('los trae con su factura y su cliente resueltos', async () => {
    conTablas({
      portal_pago_propuesta: [OK([])], portal_pago_liga: [OK([])],
      factura_emitida: [OK([FACTURA]), OK([])], factura_saldo: [OK([])],
      cliente: [OK([{ id: 'c-1', nombre: 'Cemex', razon_social: 'CEMENTOS DEL NORTE SA' }])],
      rep_emitido: [OK([REP])],
    });
    const panel = await panelDelPortal('t-1');
    expect(panel.reps).toHaveLength(1);
    expect(panel.reps[0]).toMatchObject({
      factura: 'A-77', cliente: 'CEMENTOS DEL NORTE SA',
      cfdiUuid: 'AAAA-BBBB', impPagado: 5000, formaPago: '03',
    });
    // `null` = NUNCA lo abrió. Es la pregunta que este bloque contesta.
    expect(panel.reps[0].entregadoEn).toBeNull();
    expect(panel.repsTruncados).toBe(false);
  });

  it('un REP sobre una factura vieja se resuelve POR ID, no se pinta huérfano', async () => {
    // Un complemento se registra sobre una factura que YA se pagó, así que cae
    // fuera de las 300 recientes con altísima frecuencia. Sin meter sus ids en
    // la segunda lectura, la lista entera salía «no se pudo identificar».
    conTablas({
      portal_pago_propuesta: [OK([])], portal_pago_liga: [OK([])],
      factura_emitida: [OK([]), OK([FACTURA])], factura_saldo: [OK([])],
      cliente: [OK([{ id: 'c-1', nombre: 'Cemex', razon_social: 'CEMENTOS DEL NORTE SA' }])],
      rep_emitido: [OK([REP])],
    });
    const panel = await panelDelPortal('t-1');
    expect(panel.reps[0].factura).toBe('A-77');
    expect(panel.reps[0].cliente).toBe('CEMENTOS DEL NORTE SA');
  });

  it('el importe ilegible es null, JAMÁS 0 — un REP no ampara cero pesos', async () => {
    conTablas({
      portal_pago_propuesta: [OK([])], portal_pago_liga: [OK([])],
      factura_emitida: [OK([FACTURA]), OK([])], factura_saldo: [OK([])],
      cliente: [OK([])],
      rep_emitido: [OK([{ ...REP, imp_pagado: null, forma_pago_p: null }])],
    });
    const panel = await panelDelPortal('t-1');
    expect(panel.reps[0].impPagado).toBeNull();
    expect(panel.reps[0].formaPago).toBeNull();
  });

  it('el sello de entrega viaja cuando existe', async () => {
    conTablas({
      portal_pago_propuesta: [OK([])], portal_pago_liga: [OK([])],
      factura_emitida: [OK([FACTURA]), OK([])], factura_saldo: [OK([])],
      cliente: [OK([])],
      rep_emitido: [OK([{ ...REP, entregado_en: '2026-08-23T09:15:00Z' }])],
    });
    const panel = await panelDelPortal('t-1');
    expect(panel.reps[0].entregadoEn).toBe('2026-08-23T09:15:00Z');
  });

  it('el tope se DECLARA truncado en vez de callarlo', async () => {
    // Un `.limit()` que recorta sin decirlo es una cifra inventada (c7-4). Se
    // piden TOPE+1 justo para poder afirmar «hay más» sin traerlos todos.
    const muchos = Array.from({ length: TOPE_REPS_PANEL + 1 }, (_, i) => ({ ...REP, id: `r-${i}` }));
    conTablas({
      portal_pago_propuesta: [OK([])], portal_pago_liga: [OK([])],
      factura_emitida: [OK([FACTURA]), OK([])], factura_saldo: [OK([])],
      cliente: [OK([])],
      rep_emitido: [OK(muchos)],
    });
    const panel = await panelDelPortal('t-1');
    expect(panel.reps).toHaveLength(TOPE_REPS_PANEL);
    expect(panel.repsTruncados).toBe(true);
  });

  it('si la consulta de REPs falla, LANZA — no una lista vacía', async () => {
    // Una lista vacía por una consulta caída se leería como «no hemos emitido
    // ninguno», que es justo la conclusión que haría emitir uno repetido.
    conTablas({
      portal_pago_propuesta: [OK([])], portal_pago_liga: [OK([])],
      factura_emitida: [OK([]), OK([])], factura_saldo: [OK([])],
      cliente: [OK([])],
      rep_emitido: [FALLA()],
    });
    await expect(panelDelPortal('t-1')).rejects.toThrow(/reps/);
  });
});

describe('los sellos y la bitácora nunca tumban la página', () => {
  it('`anotarAcceso` traga un error de la base', async () => {
    conTablas({ portal_pago_acceso: [FALLA()] });
    await expect(anotarAcceso(LIGA, 'vista')).resolves.toBeUndefined();
  });

  it('`anotarAcceso` traga hasta una excepción del cliente', async () => {
    sbMock.mockImplementation(() => { throw new Error('sin red'); });
    await expect(anotarAcceso(LIGA, 'vista')).resolves.toBeUndefined();
  });

  it('`sellarUltimoAcceso` tampoco puede negar la factura por no anotar la fecha', async () => {
    conTablas({ portal_pago_liga: [FALLA()] });
    await expect(sellarUltimoAcceso(LIGA)).resolves.toBeUndefined();
    sbMock.mockImplementation(() => { throw new Error('sin red'); });
    await expect(sellarUltimoAcceso(LIGA)).resolves.toBeUndefined();
  });
});
